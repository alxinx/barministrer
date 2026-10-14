import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requirePermission, tienePermiso } from '../middleware/permissions.js'

export const layoutRoutes = Router()
const adminOnly = requirePermission('cajeroGestionaDistribucion')

// Revisa si una mesa tiene una cuenta abierta con contenido real (cliente o
// items activos), antes de marcarla disponible, fusionarla, separarla de una
// fusion o borrarla. Una cuenta vacia (se abrio para asociar cliente y nunca
// se le agrego nada) no tiene nada que auditar, asi que se descarta sola en
// vez de bloquear. Usado en los cuatro sitios porque todos necesitan la
// misma garantia: nunca perder el rastro de una cuenta real.
async function cuentaAbiertaBloquea(tableId, tenantId, numero, accion = 'continuar') {
  const abierta = await prisma.order.findFirst({
    where: { tableId, tenantId, status: 'OPEN' },
    include: { items: true },
  })
  if (!abierta) return null
  const vacia = !abierta.customerId && abierta.items.every((i) => i.status !== 'ACTIVE')
  if (vacia) {
    await prisma.order.delete({ where: { id: abierta.id } })
    return null
  }
  return `La mesa ${numero} tiene una cuenta abierta con productos o cliente. Liquídala antes de ${accion}.`
}

/** Plano completo: zonas con sus mesas y elementos. Una sola llamada. */
layoutRoutes.get('/zones', async (req, res) => {
  const [zones, ordenesConCliente] = await Promise.all([
    prisma.zone.findMany({
      where: { tenantId: req.auth.tenantId },
      include: {
        tables: { where: { active: true }, orderBy: { number: 'asc' } },
        elements: true,
      },
      orderBy: { sortOrder: 'asc' },
    }),
    // Solo las cuentas abiertas con cliente asociado: es lo que se muestra
    // como etiqueta sobre la mesa en el plano del POS. Una cuenta siempre
    // vive en la mesa principal aunque este fusionada, asi que se resuelve
    // por groupId al armar la respuesta, no aqui.
    prisma.order.findMany({
      where: { tenantId: req.auth.tenantId, status: 'OPEN', customerId: { not: null } },
      select: { tableId: true, customer: { select: { firstName: true, lastName: true, alias: true } } },
    }),
  ])
  const clientePorMesa = new Map(ordenesConCliente.map((o) => [o.tableId, o.customer]))
  const zonasConCliente = zones.map((z) => ({
    ...z,
    tables: z.tables.map((t) => ({ ...t, customer: clientePorMesa.get(t.groupId || t.id) || null })),
  }))
  res.json(zonasConCliente)
})

layoutRoutes.post('/zones', adminOnly, async (req, res) => {
  const { name, icon, gridCols, gridRows, sortOrder } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'La zona necesita un nombre' })

  const zone = await prisma.zone.create({
    data: {
      tenantId: req.auth.tenantId,
      name: name.trim(),
      icon: icon || 'table',
      gridCols: gridCols ?? 16,
      gridRows: gridRows ?? 10,
      sortOrder: sortOrder ?? 0,
    },
    include: { tables: true, elements: true },
  })
  res.status(201).json(zone)
})

/// Celdas fuera del salon: cada una dentro de la cuadricula actual (o la nueva,
/// si gridCols/gridRows cambian en la misma peticion).
function celdasValidas(cells, cols, rows) {
  return (
    Array.isArray(cells) &&
    cells.every(
      (c) =>
        c && Number.isInteger(c.x) && Number.isInteger(c.y) && c.x >= 0 && c.x < cols && c.y >= 0 && c.y < rows
    )
  )
}

layoutRoutes.patch('/zones/:id', adminOnly, async (req, res) => {
  const zone = await prisma.zone.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
  })
  if (!zone) return res.status(404).json({ error: 'Zona no encontrada' })

  const { name, icon, gridCols, gridRows, active, sortOrder, blockedCells } = req.body || {}
  const cols = gridCols ?? zone.gridCols
  const rows = gridRows ?? zone.gridRows

  if (blockedCells !== undefined && !celdasValidas(blockedCells, cols, rows)) {
    return res.status(400).json({ error: 'Las celdas bloqueadas deben estar dentro de la cuadricula' })
  }

  // Si se achica la cuadricula, las celdas bloqueadas que quedan por fuera se
  // descartan solas: no tiene sentido guardar una celda que ya no existe.
  const existentes = Array.isArray(zone.blockedCells) ? zone.blockedCells : []
  const recortadas = existentes.filter((c) => c.x < cols && c.y < rows)
  const siguienteBloqueadas = blockedCells !== undefined ? blockedCells : recortadas

  const updated = await prisma.zone.update({
    where: { id: zone.id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(icon !== undefined && { icon }),
      ...(gridCols !== undefined && { gridCols }),
      ...(gridRows !== undefined && { gridRows }),
      ...(active !== undefined && { active: Boolean(active) }),
      ...(sortOrder !== undefined && { sortOrder }),
      blockedCells: siguienteBloqueadas,
    },
  })
  res.json(updated)
})

layoutRoutes.delete('/zones/:id', adminOnly, async (req, res) => {
  const zone = await prisma.zone.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
    include: { tables: true },
  })
  if (!zone) return res.status(404).json({ error: 'Zona no encontrada' })
  if (zone.tables.length) {
    return res.status(400).json({
      error: `La zona tiene ${zone.tables.length} mesas. Muevelas o eliminalas primero.`,
    })
  }
  await prisma.zone.delete({ where: { id: zone.id } })
  res.status(204).end()
})

// --- Mesas -----------------------------------------------------------------

layoutRoutes.post('/tables', adminOnly, async (req, res) => {
  const { zoneId, number, seats, shape, gridX, gridY, width, height } = req.body || {}
  if (!number?.toString().trim()) return res.status(400).json({ error: 'La mesa necesita un numero' })

  const zone = await prisma.zone.findFirst({
    where: { id: zoneId, tenantId: req.auth.tenantId },
  })
  if (!zone) return res.status(400).json({ error: 'La zona no existe' })

  const duplicate = await prisma.barTable.findFirst({
    where: { tenantId: req.auth.tenantId, number: String(number).trim() },
  })
  if (duplicate) {
    return res.status(400).json({ error: `Ya existe la mesa ${number} en este bar` })
  }

  const table = await prisma.barTable.create({
    data: {
      tenantId: req.auth.tenantId,
      zoneId,
      number: String(number).trim(),
      seats: seats ?? 4,
      shape: shape || 'ROUND',
      gridX: gridX ?? 0,
      gridY: gridY ?? 0,
      width: width ?? 1,
      height: height ?? 1,
    },
  })
  res.status(201).json(table)
})

layoutRoutes.patch('/tables/:id', async (req, res) => {
  const table = await prisma.barTable.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
  })
  if (!table) return res.status(404).json({ error: 'Mesa no encontrada' })

  const { number, seats, shape, gridX, gridY, width, height, status, zoneId, active } = req.body || {}

  // Mover o renombrar una mesa es configuracion: solo ADMIN. Cambiar el estado
  // (libre/ocupada) es operacion: cualquier rol.
  const isConfigChange = [number, seats, shape, gridX, gridY, width, height, zoneId, active]
    .some((v) => v !== undefined)
  if (isConfigChange && !(await tienePermiso(req.auth, 'cajeroGestionaDistribucion'))) {
    return res.status(403).json({ error: 'Solo el administrador puede mover o editar mesas' })
  }

  // Marcar disponible o cerrada dice que ahi no hay nadie. Si por debajo quedo
  // una cuenta abierta vacia (el caso tipico: se abrio solo para asociar un
  // cliente y al final no se asocio nada), se descarta sola porque nunca hubo
  // nada que auditar. Si de verdad tiene productos o cliente, se rechaza el
  // cambio para no perder el rastro de una cuenta real: hay que liquidarla.
  if ((status === 'AVAILABLE' || status === 'CLOSED') && table.status !== status) {
    const bloqueo = await cuentaAbiertaBloquea(table.id, req.auth.tenantId, table.number, 'cambiarle el estado')
    if (bloqueo) return res.status(400).json({ error: bloqueo })
  }

  const updated = await prisma.barTable.update({
    where: { id: table.id },
    data: {
      ...(number !== undefined && { number: String(number).trim() }),
      ...(seats !== undefined && { seats }),
      ...(shape !== undefined && { shape }),
      ...(gridX !== undefined && { gridX }),
      ...(gridY !== undefined && { gridY }),
      ...(width !== undefined && { width }),
      ...(height !== undefined && { height }),
      ...(status !== undefined && { status }),
      ...(zoneId !== undefined && { zoneId }),
      ...(active !== undefined && { active: Boolean(active) }),
    },
  })
  res.json(updated)
})

layoutRoutes.delete('/tables/:id', adminOnly, async (req, res) => {
  const table = await prisma.barTable.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
  })
  if (!table) return res.status(404).json({ error: 'Mesa no encontrada' })

  const bloqueo = await cuentaAbiertaBloquea(table.id, req.auth.tenantId, table.number, 'eliminarla')
  if (bloqueo) return res.status(400).json({ error: bloqueo })

  // Si esta mesa ya tuvo alguna cuenta (aunque este cerrada hace meses),
  // borrarla de verdad rompe esa factura (y la base de datos lo rechaza a la
  // fuerza, tumbando la peticion): se desactiva en vez de borrarse, igual que
  // al fusionar. Si nunca se uso, se borra sin dejar un registro muerto.
  const tuvoHistorial = await prisma.order.findFirst({ where: { tableId: table.id, tenantId: req.auth.tenantId } })
  if (tuvoHistorial) {
    await prisma.barTable.update({ where: { id: table.id }, data: { active: false } })
  } else {
    await prisma.barTable.delete({ where: { id: table.id } })
  }
  res.status(204).end()
})

// Fusionar dos mesas del plano en una sola: la que recibe el POST sobrevive
// (conserva numero, forma y status), la otra desaparece. Ocupa el rectangulo
// que cubre a las dos y suma los puestos. Antes de tocar nada se revisa que
// ninguna tenga una cuenta abierta con contenido real (igual que al marcarla
// disponible/cerrada): fusionar una mesa con un pedido en curso podria perder
// o mezclar esa cuenta, y eso es dinero real, no solo geometria.
layoutRoutes.post('/tables/:id/merge', adminOnly, async (req, res) => {
  const { withId } = req.body || {}
  const [sobrevive, otra] = await Promise.all([
    prisma.barTable.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } }),
    prisma.barTable.findFirst({ where: { id: withId, tenantId: req.auth.tenantId } }),
  ])
  if (!sobrevive || !otra) return res.status(404).json({ error: 'Mesa no encontrada' })

  for (const t of [sobrevive, otra]) {
    const bloqueo = await cuentaAbiertaBloquea(t.id, req.auth.tenantId, t.number, 'fusionar')
    if (bloqueo) return res.status(400).json({ error: bloqueo })
  }

  const left = Math.min(sobrevive.gridX, otra.gridX)
  const top = Math.min(sobrevive.gridY, otra.gridY)
  const right = Math.max(sobrevive.gridX + sobrevive.width, otra.gridX + otra.width)
  const bottom = Math.max(sobrevive.gridY + sobrevive.height, otra.gridY + otra.height)

  // Si la mesa que desaparece ya tuvo alguna cuenta (aunque este cerrada hace
  // meses), borrarla de verdad rompe esa factura: se desactiva en vez de
  // borrarse, igual que categorias y productos. Si nunca se uso, se borra sin
  // dejar un registro muerto en el plano.
  const tuvoHistorial = await prisma.order.findFirst({ where: { tableId: otra.id, tenantId: req.auth.tenantId } })

  const [actualizada] = await prisma.$transaction([
    prisma.barTable.update({
      where: { id: sobrevive.id },
      data: {
        gridX: left,
        gridY: top,
        width: right - left,
        height: bottom - top,
        seats: sobrevive.seats + otra.seats,
        // El area resultante es el rectangulo que cubre a las dos mesas (el
        // "hueco" de una L no se puede representar, solo el rectangulo que la
        // envuelve). ROUND dibuja un circulo perfecto sobre esa area: en
        // cuanto el ancho/alto crece o deja de ser 1:1, un circulo ya no se
        // parece en nada a las dos mesas que la formaron. RECT es lo unico
        // que sigue viendose coherente sin importar la proporcion final.
        shape: 'RECT',
      },
    }),
    tuvoHistorial
      ? prisma.barTable.update({ where: { id: otra.id }, data: { active: false } })
      : prisma.barTable.delete({ where: { id: otra.id } }),
  ])

  res.json(actualizada)
})

// Fusion TEMPORAL para una cuenta grande repartida en varias mesas (mesa 21 +
// 22 para un grupo que no cupo en una sola). A diferencia de /merge, esto no
// cambia numero, puestos ni geometria de nadie: solo hace que los pedidos de
// las satelites caigan en la cuenta de la principal, y se deshace solo al
// cerrar esa cuenta. Operacion (como cambiar el estado de una mesa), no
// configuracion: cualquier rol que opere el salon la puede usar.
layoutRoutes.post('/tables/group', async (req, res) => {
  const { tableIds } = req.body || {}
  const unicos = [...new Set(Array.isArray(tableIds) ? tableIds : [])]
  if (unicos.length < 2) return res.status(400).json({ error: 'Selecciona al menos dos mesas para fusionar' })

  const mesas = await prisma.barTable.findMany({ where: { id: { in: unicos }, tenantId: req.auth.tenantId, active: true } })
  if (mesas.length !== unicos.length) return res.status(404).json({ error: 'Alguna mesa no existe' })

  // Ninguna puede venir ya fusionada (ni de satelite ni de principal de otro
  // grupo): encadenar grupos a medias es mas confuso que pedir que separen
  // primero cerrando esa cuenta.
  const yaFusionada = await prisma.barTable.findFirst({
    where: { tenantId: req.auth.tenantId, OR: [{ id: { in: unicos }, groupId: { not: null } }, { groupId: { in: unicos } }] },
  })
  if (yaFusionada) {
    return res.status(400).json({ error: 'Una de estas mesas ya esta fusionada con otra. Cierra esa cuenta antes de volver a fusionar.' })
  }

  // Si una ya tiene una cuenta con consumo real, esa es la que manda (los
  // pedidos de las demas se suman ahi). Si hay mas de una asi, no hay forma
  // automatica de decidir cual gana.
  const ordenesAbiertas = await prisma.order.findMany({
    where: { tableId: { in: unicos }, tenantId: req.auth.tenantId, status: 'OPEN' },
    include: { items: true },
  })
  const conConsumo = ordenesAbiertas.filter((o) => o.customerId || o.items.some((i) => i.status === 'ACTIVE'))
  if (conConsumo.length > 1) {
    return res.status(400).json({ error: 'Más de una de estas mesas ya tiene consumo. Liquida o traslada una antes de fusionar.' })
  }

  const principalId = conConsumo[0]?.tableId || unicos[0]
  const satelites = unicos.filter((id) => id !== principalId)
  // Una cuenta vacia en una satelite (se abrio para asociar cliente y nunca
  // se le agrego nada) no tiene nada que auditar: se descarta, igual que al
  // marcar una mesa disponible de nuevo.
  const vaciasABorrar = ordenesAbiertas.filter((o) => o.tableId !== principalId)

  await prisma.$transaction([
    ...vaciasABorrar.map((o) => prisma.order.delete({ where: { id: o.id } })),
    prisma.barTable.updateMany({ where: { id: { in: satelites } }, data: { groupId: principalId, status: 'OCCUPIED' } }),
    prisma.barTable.update({ where: { id: principalId }, data: { status: 'OCCUPIED' } }),
  ])

  res.json({ principalId, satelites })
})

// Sacar una o mas mesas de una fusion ya activa, sin tocar las demas. Si lo
// que queda del grupo despues de sacarlas sigue siendo 2 o mas, la cuenta
// compartida sigue viva para esas y no importa si hay consumo pendiente: a
// las que salen no les pertenecia nada de esa cuenta. Si lo que queda es
// menos de 2 (se disuelve toda la fusion, incluida la mesa principal si la
// sacan), ahi si aplica la misma regla de siempre: no deja si hay consumo
// real sin liquidar.
layoutRoutes.post('/tables/ungroup', async (req, res) => {
  const { tableIds } = req.body || {}
  const unicos = [...new Set(Array.isArray(tableIds) ? tableIds : [])]
  if (!unicos.length) return res.status(400).json({ error: 'Selecciona al menos una mesa para separar' })

  const mesas = await prisma.barTable.findMany({ where: { id: { in: unicos }, tenantId: req.auth.tenantId } })
  if (mesas.length !== unicos.length) return res.status(404).json({ error: 'Alguna mesa no existe' })

  const anclas = new Set(mesas.map((m) => m.groupId || m.id))
  if (anclas.size > 1) {
    return res.status(400).json({ error: 'Esas mesas no están todas en la misma fusión' })
  }
  const principalId = [...anclas][0]

  const grupoCompleto = await prisma.barTable.findMany({
    where: { tenantId: req.auth.tenantId, OR: [{ id: principalId }, { groupId: principalId }] },
  })
  if (grupoCompleto.length < 2) {
    return res.status(400).json({ error: 'Esa mesa no está fusionada con ninguna otra' })
  }

  const principal = grupoCompleto.find((t) => t.id === principalId)
  const sacarPrincipal = unicos.includes(principalId)
  const restantes = grupoCompleto.filter((t) => !unicos.includes(t.id))

  // Sacar la principal dejando otras fusionadas significaria mudar la cuenta
  // a una nueva principal: mas simple pedir que separen todas de una vez (o
  // solo las satelites) en vez de inventar ese reacomodo aqui.
  if (sacarPrincipal && restantes.length > 0) {
    return res.status(400).json({
      error: 'No puedes sacar la mesa principal dejando otras fusionadas. Separa primero las demás, o sepáralas todas.',
    })
  }

  if (restantes.length < 2) {
    const bloqueo = await cuentaAbiertaBloquea(principalId, req.auth.tenantId, principal.number, 'separar la fusión')
    if (bloqueo) return res.status(400).json({ error: bloqueo })
  }

  await prisma.barTable.updateMany({ where: { id: { in: unicos } }, data: { groupId: null, status: 'AVAILABLE' } })
  res.json({ ok: true })
})

// --- Elementos del plano (pared, barra, puerta, planta, tarima) -------------

layoutRoutes.post('/elements', adminOnly, async (req, res) => {
  const { zoneId, type, label, gridX, gridY, width, height, rotation } = req.body || {}
  const zone = await prisma.zone.findFirst({
    where: { id: zoneId, tenantId: req.auth.tenantId },
  })
  if (!zone) return res.status(400).json({ error: 'La zona no existe' })

  const element = await prisma.layoutElement.create({
    data: {
      tenantId: req.auth.tenantId,
      zoneId,
      type: type || 'WALL',
      label: label || null,
      gridX: gridX ?? 0,
      gridY: gridY ?? 0,
      width: width ?? 1,
      height: height ?? 1,
      rotation: rotation ?? 0,
    },
  })
  res.status(201).json(element)
})

layoutRoutes.patch('/elements/:id', adminOnly, async (req, res) => {
  const element = await prisma.layoutElement.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
  })
  if (!element) return res.status(404).json({ error: 'Elemento no encontrado' })

  const { label, gridX, gridY, width, height, rotation } = req.body || {}
  const updated = await prisma.layoutElement.update({
    where: { id: element.id },
    data: {
      ...(label !== undefined && { label }),
      ...(gridX !== undefined && { gridX }),
      ...(gridY !== undefined && { gridY }),
      ...(width !== undefined && { width }),
      ...(height !== undefined && { height }),
      ...(rotation !== undefined && { rotation }),
    },
  })
  res.json(updated)
})

layoutRoutes.delete('/elements/:id', adminOnly, async (req, res) => {
  const element = await prisma.layoutElement.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
  })
  if (!element) return res.status(404).json({ error: 'Elemento no encontrado' })
  await prisma.layoutElement.delete({ where: { id: element.id } })
  res.status(204).end()
})
