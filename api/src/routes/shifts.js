import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireRole } from '../middleware/auth.js'

export const shiftRoutes = Router()
const cajero = requireRole('ADMIN', 'CAJERO')

// Medios que se cuentan a ciegas al cerrar caja. Credito no entra: el fiado
// es una cuenta por cobrar, nunca efectivo ni plastico en el cajon.
const METHODS = ['EFECTIVO', 'NEQUI', 'TRANSFERENCIA', 'DATAFONO']

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

  const [tickets, cortesias] = await Promise.all([
    prisma.order.count({ where: { tenantId, shiftId, status: 'CLOSED' } }),
    prisma.order.count({ where: { tenantId, shiftId, status: 'CLOSED', isCourtesy: true } }),
  ])

  const totalVentas = Object.values(byMethod).reduce((s, v) => s + v, 0) + fiado
  return { byMethod, fiado, totalVentas, tickets, cortesias, abonos: { byMethod: abonosByMethod, total: totalAbonos } }
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
