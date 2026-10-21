import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'
import { requireRole } from '../middleware/auth.js'
import { requirePermission } from '../middleware/permissions.js'
import { pinLimiter } from '../middleware/rateLimit.js'

export const inventoryRoutes = Router()
const adminOnly = requirePermission('cajeroGestionaInventario')
const soloAdminReal = requireRole('ADMIN')

async function verificarPin(tenantId, pin) {
  const encargados = await prisma.user.findMany({
    where: { tenantId, active: true, role: { in: ['ADMIN', 'CAJERO'] }, pinHash: { not: null } },
  })
  for (const u of encargados) {
    if (await bcrypt.compare(String(pin), u.pinHash)) return u
  }
  return null
}

// Entradas recientes, para ver que se agrego sin tener que ir variante por
// variante. Solo entradas (PURCHASE); el stock mismo sigue siendo el numero
// en Variant, esto es el rastro de como llego ahi.
inventoryRoutes.get('/inventory/movements', adminOnly, async (req, res) => {
  const movements = await prisma.stockMovement.findMany({
    where: { tenantId: req.auth.tenantId },
    include: {
      variant: { select: { id: true, name: true, product: { select: { id: true, name: true } } } },
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  res.json(movements)
})

// Compra por empaque (caja, canasta) se resuelve aqui con unitsPerPack x
// packs, nunca en el producto: qty es lo que de verdad entra al stock.
inventoryRoutes.post('/inventory/movements', adminOnly, async (req, res) => {
  const { variantId, qty, unitsPerPack, packs, cost, note } = req.body || {}

  const variant = await prisma.variant.findFirst({
    where: { id: variantId, product: { tenantId: req.auth.tenantId } },
  })
  if (!variant) return res.status(400).json({ error: 'Esa presentación no existe' })

  const unidades = Number(qty) || 0
  if (unidades <= 0) return res.status(400).json({ error: 'La cantidad que entra debe ser mayor a cero' })

  const [movement] = await prisma.$transaction([
    prisma.stockMovement.create({
      data: {
        tenantId: req.auth.tenantId,
        variantId: variant.id,
        qty: unidades,
        unitsPerPack: unitsPerPack ? Number(unitsPerPack) : null,
        packs: packs ? Number(packs) : null,
        cost: cost !== undefined && cost !== null && cost !== '' ? Number(cost) : null,
        note: note?.trim() || null,
        createdById: req.auth.userId,
      },
      include: {
        variant: { select: { id: true, name: true, product: { select: { id: true, name: true } } } },
        createdBy: { select: { id: true, name: true } },
      },
    }),
    prisma.variant.update({
      where: { id: variant.id },
      data: {
        stock: { increment: unidades },
        ...(cost !== undefined && cost !== null && cost !== '' && { cost: Number(cost) }),
      },
    }),
  ])

  res.status(201).json(movement)
})

// Merma/perdida manual: solo el admin real (no delegable, ni con
// cajeroGestionaInventario) y con PIN, porque a diferencia de vender en
// negativo (que nunca se bloquea) esto SI tiene techo: nunca se puede
// mermar mas de lo que hay. Genera su propio movimiento de stock (WASTE,
// para no perder el rastro) y un egreso de caja menor por el costo de lo
// perdido -- nunca por el precio de venta, eso inflaria el gasto real.
inventoryRoutes.post('/variants/:id/waste', soloAdminReal, pinLimiter, async (req, res) => {
  const { qty, reason, pin } = req.body || {}
  const unidades = Number(qty) || 0
  if (unidades <= 0) return res.status(400).json({ error: 'La cantidad a eliminar debe ser mayor a cero' })
  if (!reason?.trim()) return res.status(400).json({ error: 'Escribe la razón o motivo de la eliminación' })
  if (!pin?.toString().trim()) return res.status(400).json({ error: 'Escribe el PIN' })

  const variant = await prisma.variant.findFirst({
    where: { id: req.params.id, product: { tenantId: req.auth.tenantId } },
    include: { product: true },
  })
  if (!variant) return res.status(400).json({ error: 'Esa presentación no existe' })
  if (unidades > variant.stock) {
    return res.status(400).json({ error: `Solo hay ${variant.stock} en stock, no se puede mermar más de eso` })
  }

  const encargado = await verificarPin(req.auth.tenantId, pin)
  if (!encargado) return res.status(401).json({ error: 'PIN incorrecto' })

  const shift = await prisma.shift.findFirst({ where: { tenantId: req.auth.tenantId, status: 'OPEN' } })
  if (!shift) {
    return res.status(400).json({ error: 'Necesitas un turno abierto para registrar una merma' })
  }

  const costoUnitario = Number(variant.cost) || 0
  const montoEgreso = costoUnitario * unidades
  const nombre = `${variant.product.name}${variant.name ? ` · ${variant.name}` : ''}`

  const [movement, , expense] = await prisma.$transaction([
    prisma.stockMovement.create({
      data: {
        tenantId: req.auth.tenantId,
        variantId: variant.id,
        type: 'WASTE',
        qty: -unidades,
        cost: costoUnitario,
        note: reason.trim(),
        createdById: encargado.id,
      },
    }),
    prisma.variant.update({ where: { id: variant.id }, data: { stock: { decrement: unidades } } }),
    prisma.shiftExpense.create({
      data: {
        tenantId: req.auth.tenantId,
        shiftId: shift.id,
        type: 'GASTO',
        amount: montoEgreso,
        reason: `Eliminación de ${unidades} ${nombre} por ${reason.trim()}`,
        authorizedById: encargado.id,
      },
      include: { authorizedBy: { select: { id: true, name: true } } },
    }),
  ])

  res.status(201).json({
    movement,
    expense,
    productName: variant.product.name,
    variantName: variant.name,
    qty: unidades,
    reason: reason.trim(),
    unitCost: costoUnitario,
    total: montoEgreso,
    authorizedBy: { id: encargado.id, name: encargado.name },
    createdAt: movement.createdAt,
  })
})
