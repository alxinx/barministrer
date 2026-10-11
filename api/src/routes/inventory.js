import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireRole } from '../middleware/auth.js'

export const inventoryRoutes = Router()
const adminOnly = requireRole('ADMIN')

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
