import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireRole } from '../middleware/auth.js'

export const customerRoutes = Router()
const puedeGestionar = requireRole('ADMIN', 'CAJERO')

function saldo(customer) {
  const cargos = customer.charges.reduce((sum, c) => sum + Number(c.amount), 0)
  const pagos = customer.payments.reduce((sum, p) => sum + Number(p.amount), 0)
  return cargos - pagos
}

function conSaldo(customer) {
  return { ...customer, balance: saldo(customer) }
}

// --- Listado y detalle ------------------------------------------------------

customerRoutes.get('/customers', puedeGestionar, async (req, res) => {
  const { search } = req.query
  const customers = await prisma.customer.findMany({
    where: {
      tenantId: req.auth.tenantId,
      ...(search && {
        OR: [
          { firstName: { contains: String(search) } },
          { lastName: { contains: String(search) } },
          { alias: { contains: String(search) } },
          { idNumber: { contains: String(search) } },
        ],
      }),
    },
    include: { charges: true, payments: true },
    orderBy: { firstName: 'asc' },
  })
  res.json(customers.map(conSaldo))
})

customerRoutes.get('/customers/:id', puedeGestionar, async (req, res) => {
  const customer = await prisma.customer.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
    include: {
      charges: { include: { createdBy: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } },
      payments: { include: { createdBy: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } },
    },
  })
  if (!customer) return res.status(404).json({ error: 'Cliente no encontrado' })
  res.json(conSaldo(customer))
})

// --- Crear y editar ----------------------------------------------------------
// Cualquiera que gestione clientes puede crearlos y editar sus datos basicos,
// pero habilitar credito (y su tope) es una decision de confianza: solo ADMIN.
customerRoutes.post('/customers', puedeGestionar, async (req, res) => {
  const { firstName, lastName, alias, idNumber, email, whatsapp, creditEnabled, creditLimit } = req.body || {}
  if (!firstName?.trim()) return res.status(400).json({ error: 'El cliente necesita un nombre' })
  if ((creditEnabled !== undefined || creditLimit !== undefined) && req.auth.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Solo el administrador puede habilitar crédito' })
  }

  try {
    const customer = await prisma.customer.create({
      data: {
        tenantId: req.auth.tenantId,
        firstName: firstName.trim(),
        lastName: lastName?.trim() || null,
        alias: alias?.trim() || null,
        idNumber: idNumber?.trim() || null,
        email: email?.trim() || null,
        whatsapp: whatsapp?.trim() || null,
        creditEnabled: Boolean(creditEnabled),
        creditLimit: creditLimit ?? null,
      },
      include: { charges: true, payments: true },
    })
    res.status(201).json(conSaldo(customer))
  } catch (err) {
    if (err.code === 'P2002') return res.status(400).json({ error: 'Ya existe un cliente con esa cédula' })
    throw err
  }
})

customerRoutes.patch('/customers/:id', puedeGestionar, async (req, res) => {
  const existing = await prisma.customer.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
  })
  if (!existing) return res.status(404).json({ error: 'Cliente no encontrado' })

  const { firstName, lastName, alias, idNumber, email, whatsapp, creditEnabled, creditLimit, active } =
    req.body || {}
  if ((creditEnabled !== undefined || creditLimit !== undefined) && req.auth.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Solo el administrador puede cambiar el crédito' })
  }

  try {
    const customer = await prisma.customer.update({
      where: { id: existing.id },
      data: {
        ...(firstName !== undefined && { firstName: firstName.trim() }),
        ...(lastName !== undefined && { lastName: lastName?.trim() || null }),
        ...(alias !== undefined && { alias: alias?.trim() || null }),
        ...(idNumber !== undefined && { idNumber: idNumber?.trim() || null }),
        ...(email !== undefined && { email: email?.trim() || null }),
        ...(whatsapp !== undefined && { whatsapp: whatsapp?.trim() || null }),
        ...(creditEnabled !== undefined && { creditEnabled: Boolean(creditEnabled) }),
        ...(creditLimit !== undefined && { creditLimit: creditLimit ?? null }),
        ...(active !== undefined && { active: Boolean(active) }),
      },
      include: { charges: true, payments: true },
    })
    res.json(conSaldo(customer))
  } catch (err) {
    if (err.code === 'P2002') return res.status(400).json({ error: 'Ya existe un cliente con esa cédula' })
    throw err
  }
})

// --- Fiado: cargos y pagos ---------------------------------------------------

customerRoutes.post('/customers/:id/charges', puedeGestionar, async (req, res) => {
  const customer = await prisma.customer.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
  })
  if (!customer) return res.status(404).json({ error: 'Cliente no encontrado' })
  if (!customer.creditEnabled) {
    return res.status(400).json({ error: 'Este cliente no tiene crédito habilitado' })
  }

  const { amount, description } = req.body || {}
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'El consumo necesita un monto mayor a cero' })
  if (!description?.trim()) return res.status(400).json({ error: 'Describe qué consumió' })

  const charge = await prisma.customerCharge.create({
    data: {
      tenantId: req.auth.tenantId,
      customerId: customer.id,
      amount,
      description: description.trim(),
      createdById: req.auth.userId,
    },
    include: { createdBy: { select: { id: true, name: true } } },
  })
  res.status(201).json(charge)
})

customerRoutes.post('/customers/:id/payments', puedeGestionar, async (req, res) => {
  const customer = await prisma.customer.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
  })
  if (!customer) return res.status(404).json({ error: 'Cliente no encontrado' })

  const { amount, note } = req.body || {}
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'El pago necesita un monto mayor a cero' })

  const payment = await prisma.customerPayment.create({
    data: {
      tenantId: req.auth.tenantId,
      customerId: customer.id,
      amount,
      note: note?.trim() || null,
      createdById: req.auth.userId,
    },
    include: { createdBy: { select: { id: true, name: true } } },
  })
  res.status(201).json(payment)
})
