import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireRole } from '../middleware/auth.js'

export const shiftRoutes = Router()
const cajero = requireRole('ADMIN', 'CAJERO')

const METHODS = ['EFECTIVO', 'NEQUI', 'DAVIPLATA', 'DATAFONO']

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
  res.json(shift)
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

  // Ventas por medio de pago: todavia no existe el modulo de pedidos, asi que
  // por ahora son 0 para todos. Cuando exista, esto se vuelve una suma real
  // sobre las ventas del turno (no hay que tocar el resto del cuadre).
  const ventasPorMedio = { EFECTIVO: 0, NEQUI: 0, DAVIPLATA: 0, DATAFONO: 0 }
  const egresosEfectivo = shift.expenses.reduce((sum, e) => sum + Number(e.amount), 0)

  const resultado = METHODS.map((method) => {
    const expected =
      method === 'EFECTIVO'
        ? Number(shift.baseCash) + ventasPorMedio.EFECTIVO - egresosEfectivo
        : ventasPorMedio[method]
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
    },
    include: {
      openedBy: { select: { id: true, name: true } },
      closedBy: { select: { id: true, name: true } },
      expenses: { include: { authorizedBy: { select: { id: true, name: true } } } },
    },
  })
  res.json(updated)
})
