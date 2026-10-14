import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireRole } from '../middleware/auth.js'
import { diaLocal, rangoEntreFechas, rangoValido } from '../lib/fechas.js'

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

function sumarDias(fechaStr, delta) {
  return new Date(Date.parse(`${fechaStr}T00:00:00Z`) + delta * 86400000).toISOString().slice(0, 10)
}

function calcularVariacion(actual, anterior) {
  if (!anterior) return null
  return ((actual - anterior) / anterior) * 100
}

// Movimientos de caja (ventas facturadas + devoluciones) entre dos fechas,
// sin importar a que turno pertenezcan: esto es para que el dueño navegue
// "que paso hoy/esta semana", no para el cuadre de un turno puntual (eso
// sigue siendo por turno, con conteo ciego, en /shifts/:id/close). Ventas en
// base de caja (cuando entro el pago, igual que "recaudado" en el reporte de
// ventas), devoluciones por cuando se anularon.
async function calcularMovimientos(tenantId, desdeStr, hastaStr, timezone) {
  const { etiquetas, desde, hasta } = rangoEntreFechas(desdeStr, hastaStr)
  // rangoEntreFechas da un colchon de hasta 2 dias extra en UTC a cada lado
  // (para no tener que calcular la medianoche local exacta): hay que filtrar
  // fino aqui comparando el dia local real de cada registro contra el pedido,
  // o un rango de "hoy"/"ayer" de un solo dia terminaria trayendo movimientos
  // de otros dias.
  const enRango = (fecha) => etiquetas.includes(diaLocal(fecha, timezone))

  const [pagosCrudo, abonosCrudo, ordenesCrudo, devueltosCrudo] = await Promise.all([
    prisma.orderPayment.findMany({
      where: { tenantId, method: { not: 'CREDITO' }, createdAt: { gte: desde, lte: hasta } },
      select: { amount: true, method: true, createdAt: true },
    }),
    prisma.customerPayment.findMany({
      where: { tenantId, createdAt: { gte: desde, lte: hasta } },
      select: { amount: true, method: true, createdAt: true },
    }),
    prisma.order.findMany({
      where: { tenantId, status: 'CLOSED', isCourtesy: false, closedAt: { gte: desde, lte: hasta } },
      select: {
        id: true,
        closedAt: true,
        table: { select: { number: true } },
        items: { where: { status: 'ACTIVE' }, select: { name: true, variantName: true, qty: true, price: true } },
        payments: { select: { method: true } },
      },
      orderBy: { closedAt: 'desc' },
    }),
    prisma.orderItem.findMany({
      where: { status: 'VOIDED', voidedAt: { gte: desde, lte: hasta }, order: { tenantId } },
      select: {
        id: true,
        name: true,
        variantName: true,
        qty: true,
        price: true,
        voidedAt: true,
        orderId: true,
        order: { select: { table: { select: { number: true } } } },
      },
      orderBy: { voidedAt: 'desc' },
    }),
  ])

  const pagos = pagosCrudo.filter((p) => enRango(p.createdAt))
  const abonos = abonosCrudo.filter((a) => enRango(a.createdAt))
  const ordenes = ordenesCrudo.filter((o) => enRango(o.closedAt))
  const devueltos = devueltosCrudo.filter((i) => enRango(i.voidedAt))

  let efectivo = 0
  let tarjetaTransferencia = 0
  for (const p of [...pagos, ...abonos]) {
    if (p.method === 'EFECTIVO') efectivo += Number(p.amount)
    else tarjetaTransferencia += Number(p.amount)
  }

  let devoluciones = 0
  const movimientosDevolucion = devueltos.map((i) => {
    const monto = Number(i.price) * i.qty
    devoluciones += monto
    return {
      id: `dev-${i.id}`,
      orderId: i.orderId,
      hora: i.voidedAt,
      tipo: 'DEVOLUCION',
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
    },
    orderBy: { closedAt: 'desc' },
  })
  return orders.map((o) => ({
    id: o.id,
    tableNumber: o.table.number,
    closedAt: o.closedAt,
    isCourtesy: o.isCourtesy,
    invoiceNumber: o.invoiceNumber,
    discountAmount: Number(o.discountAmount),
    openedByName: o.openedBy.name,
    total: o.items.filter((i) => i.status === 'ACTIVE').reduce((s, i) => s + Number(i.price) * i.qty, 0),
  }))
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

  const facturas = await facturasDelTurno(req.auth.tenantId, shift.id)
  // Un turno cerrado trae su snapshot congelado; uno abierto todavia no.
  const sales = shift.sales ?? (await resumenVentas(req.auth.tenantId, shift.id))
  res.json({ ...shift, sales, facturas })
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

  const { baseCash } = req.body || {}
  if (baseCash === undefined || baseCash === null || Number(baseCash) < 0) {
    return res.status(400).json({ error: 'Declara la base inicial en efectivo para abrir el turno' })
  }

  const shift = await prisma.shift.create({
    data: {
      tenantId: req.auth.tenantId,
      baseCash,
      openedById: req.auth.userId,
    },
    include: {
      openedBy: { select: { id: true, name: true } },
      expenses: true,
    },
  })
  res.status(201).json(shift)
})

// --- Egresos --------------------------------------------------------------
// Retiro (sacar efectivo del cajon) o gasto de caja menor (hielo, limones,
// cortesias). Los dos descuentan del efectivo esperado al cuadrar.
shiftRoutes.post('/shifts/:id/expenses', cajero, async (req, res) => {
  const shift = await prisma.shift.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
  })
  if (!shift) return res.status(404).json({ error: 'Turno no encontrado' })
  if (shift.status !== 'OPEN') {
    return res.status(400).json({ error: 'Este turno ya esta cerrado, no se le pueden agregar egresos' })
  }

  const { type, amount, reason } = req.body || {}
  if (!['RETIRO', 'GASTO'].includes(type)) {
    return res.status(400).json({ error: 'El egreso necesita un tipo: retiro o gasto' })
  }
  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'El egreso necesita un monto mayor a cero' })
  }
  if (!reason?.trim()) {
    return res.status(400).json({ error: 'El egreso necesita un motivo' })
  }

  const expense = await prisma.shiftExpense.create({
    data: {
      tenantId: req.auth.tenantId,
      shiftId: shift.id,
      type,
      amount,
      reason: reason.trim(),
      authorizedById: req.auth.userId,
    },
    include: { authorizedBy: { select: { id: true, name: true } } },
  })
  res.status(201).json(expense)
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

  const { counts } = req.body || {}
  if (!counts || typeof counts !== 'object') {
    return res.status(400).json({ error: 'Contá cada medio de pago para cerrar el turno' })
  }
  for (const m of METHODS) {
    if (counts[m] === undefined || counts[m] === null || Number(counts[m]) < 0) {
      return res.status(400).json({ error: `Falta el conteo de ${m.toLowerCase()}` })
    }
  }

  const sales = await resumenVentas(req.auth.tenantId, shift.id)
  const egresosEfectivo = shift.expenses.reduce((sum, e) => sum + Number(e.amount), 0)

  const resultado = METHODS.map((method) => {
    const recibido = sales.byMethod[method] + sales.abonos.byMethod[method]
    const expected = method === 'EFECTIVO' ? Number(shift.baseCash) + recibido - egresosEfectivo : recibido
    const counted = Number(counts[method])
    return { method, expected, counted, difference: counted - expected }
  })

  const updated = await prisma.shift.update({
    where: { id: shift.id },
    data: {
      status: 'CLOSED',
      closedById: req.auth.userId,
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
  res.json(updated)
})
