import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireRole } from '../middleware/auth.js'
import { pinLimitExcedido, pinIncorrecto } from '../middleware/rateLimit.js'
import { verificarPin } from '../lib/pin.js'
import { diaLocal, rangoValido, sumarDias } from '../lib/fechas.js'
import { crearShiftExpense } from '../lib/shiftExpense.js'
import { buscarTurnosDelRango } from '../lib/turnosRango.js'
import { avisarTenant } from '../lib/realtime.js'

export const shiftRoutes = Router()
const cajero = requireRole('ADMIN', 'CAJERO')

// Medios que se cuentan a ciegas al cerrar caja. Credito no entra: el fiado
// es una cuenta por cobrar, nunca efectivo ni plastico en el cajon.
const METHODS = ['EFECTIVO', 'NEQUI', 'TRANSFERENCIA', 'DATAFONO']
const METHOD_LABEL = {
  EFECTIVO: 'Efectivo',
  NEQUI: 'Nequi',
  TRANSFERENCIA: 'Transferencia',
  DATAFONO: 'Datáfono',
  CREDITO: 'Crédito',
}

// Ventas reales del turno, agrupadas por medio de pago. Se usa en vivo (para
// mostrar el movimiento del dia con el turno todavia abierto) y una sola vez
// al cerrar, para congelar el snapshot que despues ve el historial.
//
// Los abonos a credito van separados de las ventas (no son una venta nueva,
// son plata que ya se habia vendido fiada), pero igual hay que sumarlos al
// medio de pago en que entraron: ese dinero tiene que estar en el cajon.
async function resumenVentas(tenantId, shiftId) {
  const [pagos, abonos] = await Promise.all([
    prisma.orderPayment.groupBy({
      by: ['method'],
      where: { tenantId, order: { shiftId } },
      _sum: { amount: true },
    }),
    prisma.customerPayment.groupBy({
      by: ['method'],
      where: { tenantId, shiftId },
      _sum: { amount: true },
    }),
  ])

  const byMethod = Object.fromEntries(METHODS.map((m) => [m, 0]))
  let fiado = 0
  for (const p of pagos) {
    const monto = Number(p._sum.amount) || 0
    if (p.method === 'CREDITO') fiado = monto
    else byMethod[p.method] = monto
  }

  const abonosByMethod = Object.fromEntries(METHODS.map((m) => [m, 0]))
  for (const a of abonos) {
    if (a.method) abonosByMethod[a.method] = Number(a._sum.amount) || 0
  }
  const totalAbonos = Object.values(abonosByMethod).reduce((s, v) => s + v, 0)

  const [tickets, cortesias, devueltos] = await Promise.all([
    prisma.order.count({ where: { tenantId, shiftId, status: 'CLOSED' } }),
    prisma.order.count({ where: { tenantId, shiftId, status: 'CLOSED', isCourtesy: true } }),
    // Una devolucion solo puede pasar con la cuenta todavia abierta (ver
    // /orders/:id/items/:itemId/void): no es plata que sale del cajon, es
    // valor que se quito antes de cobrar. Se cuenta igual porque informa
    // cuanto se esta corrigiendo antes de facturar.
    prisma.orderItem.findMany({
      where: { status: 'VOIDED', order: { tenantId, shiftId } },
      select: { price: true, qty: true },
    }),
  ])
  const devoluciones = devueltos.reduce((s, i) => s + Number(i.price) * i.qty, 0)

  const totalVentas = Object.values(byMethod).reduce((s, v) => s + v, 0) + fiado
  return {
    byMethod,
    fiado,
    totalVentas,
    tickets,
    cortesias,
    devoluciones,
    abonos: { byMethod: abonosByMethod, total: totalAbonos },
  }
}

function calcularVariacion(actual, anterior) {
  if (!anterior) return null
  return ((actual - anterior) / anterior) * 100
}

// Movimientos de caja (ventas facturadas + devoluciones) entre dos fechas,
// sin importar a que turno pertenezcan: esto es para que el dueño navegue
// "que paso hoy/esta semana", no para el cuadre de un turno puntual (eso
// sigue siendo por turno, con conteo ciego, en /shifts/:id/close).
//
// El turno no es el dia calendario (un viernes puede cerrar a las 3am del
// sabado): tambien se incluye el turno abierto el dia anterior al rango si
// cierra antes de las 6am durante el periodo consultado. No filtrar por el
// momento de cada pago o devolucion: partiria un mismo turno entre dos dias.
// Las cifras salen de sales.byMethod, el mismo snapshot que usa el cuadre.
async function calcularMovimientos(tenantId, desdeStr, hastaStr, timezone) {
  const turnos = await buscarTurnosDelRango(tenantId, desdeStr, hastaStr, timezone)
  const numerosTurno = await Promise.all(
    turnos.map((turno) =>
      prisma.shift.count({ where: { tenantId, openedAt: { lte: turno.openedAt } } })
    )
  )
  const turnosConNumero = turnos.map((turno, index) => ({ ...turno, numero: numerosTurno[index] }))
  const turnoPorId = new Map(turnosConNumero.map((turno) => [turno.id, turno]))
  const datosTurno = (shiftId) => {
    const turno = turnoPorId.get(shiftId)
    return turno ? { turnoId: turno.id, turnoNumero: turno.numero, turnoAbiertoAt: turno.openedAt } : {}
  }

  // El turno todavia abierto no tiene snapshot congelado (eso pasa al
  // cerrar): se calcula en vivo, igual que en GET /shifts/current.
  const salesPorTurno = await Promise.all(
    turnos.map((s) => (s.status === 'OPEN' ? resumenVentas(tenantId, s.id) : Promise.resolve(s.sales)))
  )

  // Las ventas/abonos salen del snapshot del turno (misma fuente que su
  // cuadre); las devoluciones se recalculan mas abajo desde el detalle real
  // que de todos modos hay que traer para la lista de movimientos.
  let efectivo = 0
  let tarjetaTransferencia = 0
  turnos.forEach((s, i) => {
    const sales = salesPorTurno[i]
    if (!sales) return
    efectivo += (sales.byMethod?.EFECTIVO || 0) + (sales.abonos?.byMethod?.EFECTIVO || 0)
    for (const m of ['NEQUI', 'TRANSFERENCIA', 'DATAFONO']) {
      tarjetaTransferencia += (sales.byMethod?.[m] || 0) + (sales.abonos?.byMethod?.[m] || 0)
    }
  })

  const shiftIds = turnos.map((s) => s.id)
  if (shiftIds.length === 0) {
    return {
      totales: { totalVentas: 0, efectivo: 0, tarjetaTransferencia: 0, devoluciones: 0 },
      movimientos: [],
      turnos: [],
    }
  }

  // El detalle linea por linea si necesita las ordenes y devoluciones reales
  // (para mostrar mesa, productos y hora): se traen por pertenecer a uno de
  // estos turnos, no por su propio timestamp.
  const [ordenes, devueltos] = await Promise.all([
    prisma.order.findMany({
      where: { tenantId, status: 'CLOSED', isCourtesy: false, shiftId: { in: shiftIds } },
      select: {
        id: true,
        closedAt: true,
        shiftId: true,
        table: { select: { number: true } },
        items: { where: { status: 'ACTIVE' }, select: { name: true, variantName: true, qty: true, price: true } },
        payments: { select: { method: true } },
      },
      orderBy: { closedAt: 'desc' },
    }),
    prisma.orderItem.findMany({
      where: { status: 'VOIDED', order: { tenantId, shiftId: { in: shiftIds } } },
      select: {
        id: true,
        name: true,
        variantName: true,
        qty: true,
        price: true,
        voidedAt: true,
        orderId: true,
        order: { select: { shiftId: true, table: { select: { number: true } } } },
      },
      orderBy: { voidedAt: 'desc' },
    }),
  ])

  let devoluciones = 0
  const movimientosDevolucion = devueltos.map((i) => {
    const monto = Number(i.price) * i.qty
    devoluciones += monto
    return {
      id: `dev-${i.id}`,
      orderId: i.orderId,
      hora: i.voidedAt,
      tipo: 'DEVOLUCION',
      ...datosTurno(i.order.shiftId),
      descripcion: `Mesa ${i.order.table.number}`,
      detalle: `${i.qty} × ${i.name}${i.variantName ? ` · ${i.variantName}` : ''}`,
      // Una devolucion pasa antes de cobrar: nunca tuvo un medio de pago
      // propio, por eso no hay nada que mostrar aqui.
      metodo: null,
      monto: -monto,
    }
  })

  const movimientosVenta = ordenes.map((o) => {
    const metodos = [...new Set(o.payments.map((p) => METHOD_LABEL[p.method] || p.method))]
    const monto = o.items.reduce((s, i) => s + Number(i.price) * i.qty, 0)
    const detalle = o.items.map((i) => `${i.qty} × ${i.name}${i.variantName ? ` ${i.variantName}` : ''}`).join(', ')
    return {
      id: `venta-${o.id}`,
      orderId: o.id,
      hora: o.closedAt,
      tipo: 'VENTA',
      ...datosTurno(o.shiftId),
      descripcion: `Mesa ${o.table.number}`,
      detalle: detalle || 'Sin productos',
      metodo: metodos.length ? metodos.join(' + ') : 'Crédito',
      monto,
    }
  })

  const movimientos = [...movimientosVenta, ...movimientosDevolucion].sort(
    (a, b) => new Date(b.hora) - new Date(a.hora)
  )

  return {
    totales: { totalVentas: efectivo + tarjetaTransferencia, efectivo, tarjetaTransferencia, devoluciones },
    movimientos,
    turnos: turnosConNumero.map((turno) => ({
      id: turno.id,
      numero: turno.numero,
      openedAt: turno.openedAt,
      closedAt: turno.closedAt,
      openedByName: turno.openedBy.name,
      closedByName: turno.closedBy?.name || null,
    })),
  }
}

// Lista liviana de las cuentas cerradas del turno, para "ver la factura" de
// cualquier mesa sin cargar el pedido completo de una.
async function facturasDelTurno(tenantId, shiftId) {
  const orders = await prisma.order.findMany({
    where: { tenantId, shiftId, status: 'CLOSED' },
    select: {
      id: true,
      closedAt: true,
      isCourtesy: true,
      invoiceNumber: true,
      discountAmount: true,
      table: { select: { number: true } },
      items: { select: { price: true, qty: true, status: true } },
      openedBy: { select: { name: true } },
      payments: { select: { method: true } },
    },
    orderBy: { closedAt: 'desc' },
  })
  return orders.map((o) => {
    const metodos = [...new Set(o.payments.map((p) => p.method))]
    return {
      id: o.id,
      tableNumber: o.table.number,
      closedAt: o.closedAt,
      isCourtesy: o.isCourtesy,
      invoiceNumber: o.invoiceNumber,
      discountAmount: Number(o.discountAmount),
      openedByName: o.openedBy.name,
      // Null si pago con mas de un medio a la vez (cuenta dividida): ahi no
      // hay un solo medio que mostrar, el detalle completo esta en la factura.
      metodoPago: metodos.length === 1 ? metodos[0] : null,
      total: o.items.filter((i) => i.status === 'ACTIVE').reduce((s, i) => s + Number(i.price) * i.qty, 0),
    }
  })
}

// --- Turno actual ------------------------------------------------------------

shiftRoutes.get('/shifts/current', async (req, res) => {
  const shift = await prisma.shift.findFirst({
    where: { tenantId: req.auth.tenantId, status: 'OPEN' },
    include: {
      openedBy: { select: { id: true, name: true } },
      expenses: {
        include: { authorizedBy: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  })
  if (!shift) return res.json(null)

  const [sales, facturas] = await Promise.all([
    resumenVentas(req.auth.tenantId, shift.id),
    facturasDelTurno(req.auth.tenantId, shift.id),
  ])
  res.json({ ...shift, sales, facturas })
})

shiftRoutes.get('/shifts', async (req, res) => {
  const shifts = await prisma.shift.findMany({
    where: { tenantId: req.auth.tenantId, status: 'CLOSED' },
    include: {
      openedBy: { select: { id: true, name: true } },
      closedBy: { select: { id: true, name: true } },
      expenses: true,
    },
    orderBy: { closedAt: 'desc' },
    take: 30,
  })
  res.json(shifts)
})

// Movimientos de caja por calendario (hoy/ayer/N dias/rango), para la vista
// de "Caja" en vivo: no reemplaza el cuadre por turno, es para navegar que
// paso sin tener que entrar turno por turno. Va antes de /shifts/:id para
// que Express no confunda "movimientos" con un id.
shiftRoutes.get('/shifts/movimientos', cajero, async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.auth.tenantId }, select: { timezone: true } })
  const hoy = diaLocal(new Date(), tenant.timezone)
  const { modo, desde: desdeQ, hasta: hastaQ } = req.query

  let desdeStr
  let hastaStr
  if (rangoValido(desdeQ, hastaQ)) {
    desdeStr = desdeQ
    hastaStr = hastaQ
  } else if (modo === 'ayer') {
    desdeStr = hastaStr = sumarDias(hoy, -1)
  } else if (modo === '7d') {
    desdeStr = sumarDias(hoy, -6)
    hastaStr = hoy
  } else if (modo === '30d') {
    desdeStr = sumarDias(hoy, -29)
    hastaStr = hoy
  } else {
    desdeStr = hastaStr = hoy
  }

  const dias = Math.round((Date.parse(hastaStr) - Date.parse(desdeStr)) / 86400000) + 1
  const desdeAnteriorStr = sumarDias(desdeStr, -dias)
  const hastaAnteriorStr = sumarDias(desdeStr, -1)

  const [actual, anterior] = await Promise.all([
    calcularMovimientos(req.auth.tenantId, desdeStr, hastaStr, tenant.timezone),
    calcularMovimientos(req.auth.tenantId, desdeAnteriorStr, hastaAnteriorStr, tenant.timezone),
  ])

  res.json({
    desde: desdeStr,
    hasta: hastaStr,
    totales: {
      ...actual.totales,
      variacion: calcularVariacion(actual.totales.totalVentas, anterior.totales.totalVentas),
    },
    movimientos: actual.movimientos,
    turnos: actual.turnos,
  })
})

// Detalle de un turno (pasado o actual) para el drill-down desde el
// historial: cuadre, ventas, egresos y consumo por mesa, todo discriminado.
shiftRoutes.get('/shifts/:id', async (req, res) => {
  const shift = await prisma.shift.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
    include: {
      openedBy: { select: { id: true, name: true } },
      closedBy: { select: { id: true, name: true } },
      expenses: {
        include: { authorizedBy: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  })
  if (!shift) return res.status(404).json({ error: 'Turno no encontrado' })

  const [facturas, numero] = await Promise.all([
    facturasDelTurno(req.auth.tenantId, shift.id),
    // No hay un consecutivo propio para turnos (solo facturas lo tienen):
    // se deriva contando cuantos se abrieron hasta este, para una referencia
    // corta y estable en vez de mostrar el UUID completo.
    prisma.shift.count({ where: { tenantId: req.auth.tenantId, openedAt: { lte: shift.openedAt } } }),
  ])
  // Un turno cerrado trae su snapshot congelado; uno abierto todavia no.
  const sales = shift.sales ?? (await resumenVentas(req.auth.tenantId, shift.id))
  res.json({ ...shift, sales, facturas, numero })
})

// Preparados (productos PREPARED: shot, sanduche...) anulados en el turno
// cuyos ingredientes de verdad se quedaron descontados en ESE void en
// particular (OrderItem.ingredientesRepuestos=false -- ver POST
// /orders/:id/items/:itemId/void). No se filtra por la receta: un void
// dentro del minuto de gracia, o con confirmaSinPreparar confirmado, si
// repuso aunque la receta tenga ingredientesRecuperables=false, y no debe
// aparecer aqui. Esto es lo que el admin necesita para saber que reponer en
// inventario al dia siguiente (el resumen) y para auditar cada caso si algo
// no cuadra (el detalle). Los ingredientes "por ml" (sourceProductId,
// legado de antes de Insumo) no entran: no descuentan nada real todavia
// (ver nota de OpenContainer en CLAUDE.md), asi que no se quedaron "sin
// recuperar".
shiftRoutes.get('/shifts/:id/prepared-voids', cajero, async (req, res) => {
  const shift = await prisma.shift.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
    select: { id: true },
  })
  if (!shift) return res.status(404).json({ error: 'Turno no encontrado' })

  const items = await prisma.orderItem.findMany({
    where: {
      tenantId: req.auth.tenantId,
      status: 'VOIDED',
      order: { shiftId: shift.id },
      product: { kind: 'PREPARED' },
      // El resultado real del void manda, no la receta (ver
      // OrderItem.ingredientesRepuestos): un void dentro del minuto de
      // gracia o con confirmaSinPreparar si repuso, aunque la receta diga
      // ingredientesRecuperables=false, y no debe salir aqui como "sin
      // recuperar".
      ingredientesRepuestos: false,
    },
    include: {
      order: { select: { table: { select: { number: true } } } },
      product: {
        select: {
          recipe: {
            select: {
              items: {
                where: { OR: [{ variantId: { not: null } }, { insumoId: { not: null } }] },
                include: {
                  variant: { select: { name: true, product: { select: { name: true } } } },
                  insumo: { select: { name: true, unidadInventario: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { voidedAt: 'asc' },
  })

  const detalle = items.map((item) => ({
    id: item.id,
    productName: item.name,
    tableNumber: item.order.table?.number ?? null,
    voidedAt: item.voidedAt,
    voidReason: item.voidReason,
    ingredientes: (item.product?.recipe?.items || []).map((ri) => ({
      nombre: ri.variant ? `${ri.variant.product.name} (${ri.variant.name})` : ri.insumo?.name || 'Ingrediente',
      unidad: ri.insumo?.unidadInventario || 'un.',
      qty: Number(ri.qty || 0) * item.qty,
    })),
  }))

  // Resumen: total consumido por ingrediente en todo el turno, para que el
  // admin lo reponga en un solo vistazo sin tener que sumar void por void.
  const porIngrediente = new Map()
  for (const d of detalle) {
    for (const ing of d.ingredientes) {
      const key = `${ing.nombre}·${ing.unidad}`
      const acumulado = porIngrediente.get(key)
      if (acumulado) acumulado.qty += ing.qty
      else porIngrediente.set(key, { nombre: ing.nombre, unidad: ing.unidad, qty: ing.qty })
    }
  }

  res.json({ resumen: [...porIngrediente.values()], detalle })
})

// --- Abrir --------------------------------------------------------------
// Inicio con la base y apertura de caja son el mismo momento: no hay turno
// sin una base inicial declarada, asi que se piden juntos.
shiftRoutes.post('/shifts', cajero, async (req, res) => {
  const existing = await prisma.shift.findFirst({
    where: { tenantId: req.auth.tenantId, status: 'OPEN' },
  })
  if (existing) {
    return res.status(400).json({ error: 'Ya hay un turno abierto. Cierralo antes de abrir uno nuevo.' })
  }

  const { baseCash, pin } = req.body || {}
  if (baseCash === undefined || baseCash === null || Number(baseCash) < 0) {
    return res.status(400).json({ error: 'Declara la base inicial en efectivo para abrir el turno' })
  }
  if (!pin?.toString().trim()) return res.status(400).json({ error: 'Escribe el PIN de quien abre la caja' })

  // Solo se limita aqui, no toda la ruta: ya haber un turno abierto o base
  // invalida no tiene nada que ver con un PIN mal escrito (ver pinLimiter en
  // middleware/rateLimit.js).
  if (await pinLimitExcedido(req, res)) return
  const encargado = await verificarPin(req.auth.tenantId, pin)
  if (!encargado) return pinIncorrecto(req, res)

  const shift = await prisma.shift.create({
    data: {
      tenantId: req.auth.tenantId,
      baseCash,
      openedById: encargado.id,
    },
    include: {
      openedBy: { select: { id: true, name: true } },
      expenses: true,
    },
  })
  avisarTenant(req.auth.tenantId, 'turno:actualizado', { shiftId: shift.id })
  res.status(201).json(shift)
})

// --- Egresos --------------------------------------------------------------
// Retiro (sacar efectivo del cajon, ej. pagarle a un proveedor -- ver tambien
// el modulo de Compras, que reusa crearShiftExpense para lo mismo dentro de
// su propia transaccion) o gasto de caja menor (hielo, limones, cortesias).
// Los dos descuentan del efectivo esperado al cuadrar.
shiftRoutes.post('/shifts/:id/expenses', cajero, async (req, res) => {
  const { type, amount, reason } = req.body || {}
  try {
    const expense = await crearShiftExpense(prisma, {
      tenantId: req.auth.tenantId,
      shiftId: req.params.id,
      type,
      amount,
      reason,
      authorizedById: req.auth.userId,
    })
    const conAutor = await prisma.shiftExpense.findUnique({
      where: { id: expense.id },
      include: { authorizedBy: { select: { id: true, name: true } } },
    })
    avisarTenant(req.auth.tenantId, 'turno:actualizado', { shiftId: req.params.id })
    res.status(201).json(conAutor)
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message })
  }
})

// --- Cuadre y cierre --------------------------------------------------------
// Conteo ciego: el cajero cuenta cada medio de pago sin ver lo esperado (eso
// lo calcula el servidor, no el cliente). Turno cerrado queda bloqueado.
shiftRoutes.post('/shifts/:id/close', cajero, async (req, res) => {
  const shift = await prisma.shift.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
    include: { expenses: true },
  })
  if (!shift) return res.status(404).json({ error: 'Turno no encontrado' })
  if (shift.status !== 'OPEN') return res.status(400).json({ error: 'Este turno ya esta cerrado' })

  const { counts, pin } = req.body || {}
  if (!counts || typeof counts !== 'object') {
    return res.status(400).json({ error: 'Contá cada medio de pago para cerrar el turno' })
  }
  // EGRESOS no es un medio de pago: es la suma de los recibos de gastos y
  // retiros que el cajero tiene en mano, para cruzarla contra lo que
  // realmente quedo registrado en el sistema durante el turno.
  for (const m of [...METHODS, 'EGRESOS']) {
    if (counts[m] === undefined || counts[m] === null || Number(counts[m]) < 0) {
      return res.status(400).json({ error: `Falta el conteo de ${m === 'EGRESOS' ? 'egresos' : m.toLowerCase()}` })
    }
  }
  if (!pin?.toString().trim()) return res.status(400).json({ error: 'Escribe el PIN de quien cierra la caja' })

  // Solo se limita aqui, no toda la ruta: falta un conteo o un medio de pago
  // no tiene nada que ver con un PIN mal escrito (ver pinLimiter en
  // middleware/rateLimit.js).
  if (await pinLimitExcedido(req, res)) return
  const encargado = await verificarPin(req.auth.tenantId, pin)
  if (!encargado) return pinIncorrecto(req, res)

  const sales = await resumenVentas(req.auth.tenantId, shift.id)
  const egresosEfectivo = shift.expenses.reduce((sum, e) => sum + Number(e.amount), 0)

  const resultado = [
    ...METHODS.map((method) => {
      const recibido = sales.byMethod[method] + sales.abonos.byMethod[method]
      const expected = method === 'EFECTIVO' ? Number(shift.baseCash) + recibido - egresosEfectivo : recibido
      const counted = Number(counts[method])
      return { method, expected, counted, difference: counted - expected }
    }),
    {
      method: 'EGRESOS',
      expected: egresosEfectivo,
      counted: Number(counts.EGRESOS),
      difference: Number(counts.EGRESOS) - egresosEfectivo,
    },
  ]

  const updated = await prisma.shift.update({
    where: { id: shift.id },
    data: {
      status: 'CLOSED',
      closedById: encargado.id,
      closedAt: new Date(),
      counts: resultado,
      sales,
    },
    include: {
      openedBy: { select: { id: true, name: true } },
      closedBy: { select: { id: true, name: true } },
      expenses: { include: { authorizedBy: { select: { id: true, name: true } } } },
    },
  })
  avisarTenant(req.auth.tenantId, 'turno:actualizado', { shiftId: shift.id })
  res.json(updated)
})
