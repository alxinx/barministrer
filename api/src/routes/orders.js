import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'
import { requireRole } from '../middleware/auth.js'
import { avisarEncargados } from '../lib/realtime.js'

export const orderRoutes = Router()
const puedeCerrar = requireRole('ADMIN', 'CAJERO') // cobrar/cerrar cuenta no es cosa de mesera
const puedeGestionarPrePedidos = requireRole('ADMIN', 'CAJERO') // ambos se enteran y ambos pueden aprobar

const ITEM_INCLUDE = {
  createdBy: { select: { id: true, name: true } },
  voidedBy: { select: { id: true, name: true } },
  product: { select: { imageUrl: true } },
}
const ORDER_INCLUDE = {
  items: { include: ITEM_INCLUDE, orderBy: { orderedAt: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' } },
  openedBy: { select: { id: true, name: true } },
  closedBy: { select: { id: true, name: true } },
  table: { select: { id: true, number: true, zoneId: true } },
  customer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      alias: true,
      idNumber: true,
      creditEnabled: true,
      creditLimit: true,
    },
  },
}

function total(order) {
  return order.items
    .filter((i) => i.status === 'ACTIVE')
    .reduce((sum, i) => sum + Number(i.price) * i.qty, 0)
}

async function verificarPin(tenantId, pin) {
  const encargados = await prisma.user.findMany({
    where: { tenantId, active: true, role: { in: ['ADMIN', 'CAJERO'] }, pinHash: { not: null } },
  })
  for (const u of encargados) {
    if (await bcrypt.compare(String(pin), u.pinHash)) return u
  }
  return null
}

// --- Mas pedidos por zona ----------------------------------------------------
// Lo que mas se pide varia de un sector a otro (la barra no pide lo mismo que
// el salon). Suma las cantidades activas de cada producto, filtrando por la
// zona de la mesa si se pide una.
orderRoutes.get('/products/popular', async (req, res) => {
  const { zoneId } = req.query
  const items = await prisma.orderItem.groupBy({
    by: ['productId'],
    where: {
      tenantId: req.auth.tenantId,
      status: 'ACTIVE',
      productId: { not: null },
      ...(zoneId && { order: { table: { zoneId: String(zoneId) } } }),
    },
    _sum: { qty: true },
    orderBy: { _sum: { qty: 'desc' } },
    take: 20,
  })
  res.json(items.map((i) => ({ productId: i.productId, qty: i._sum.qty })))
})

// A nombre de quien va la cuenta. Null quita el cliente asociado.
orderRoutes.patch('/orders/:id/customer', async (req, res) => {
  const order = await prisma.order.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } })
  if (!order) return res.status(404).json({ error: 'Cuenta no encontrada' })
  if (order.status !== 'OPEN') return res.status(400).json({ error: 'Esta cuenta ya esta cerrada' })

  const { customerId } = req.body || {}
  if (customerId) {
    const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId: req.auth.tenantId } })
    if (!customer) return res.status(400).json({ error: 'Ese cliente no existe' })
  }

  await prisma.order.update({ where: { id: order.id }, data: { customerId: customerId || null } })
  const actualizada = await prisma.order.findFirst({ where: { id: order.id }, include: ORDER_INCLUDE })
  res.json({ ...actualizada, total: total(actualizada) })
})

// Trasladar la cuenta abierta a otra mesa: el cliente se cambio de puesto pero
// el pedido sigue siendo el mismo, no se abre uno nuevo. La mesa destino debe
// estar libre porque fusionar dos cuentas no esta soportado.
orderRoutes.patch('/orders/:id/table', async (req, res) => {
  const order = await prisma.order.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } })
  if (!order) return res.status(404).json({ error: 'Cuenta no encontrada' })
  if (order.status !== 'OPEN') return res.status(400).json({ error: 'Esta cuenta ya esta cerrada' })

  const { tableId } = req.body || {}
  if (!tableId) return res.status(400).json({ error: 'Elige la mesa destino' })
  if (tableId === order.tableId) return res.status(400).json({ error: 'Esa es la misma mesa' })

  const destino = await prisma.barTable.findFirst({ where: { id: tableId, tenantId: req.auth.tenantId } })
  if (!destino) return res.status(400).json({ error: 'La mesa destino no existe' })
  if (destino.status !== 'AVAILABLE') return res.status(400).json({ error: 'La mesa destino no esta disponible' })

  await prisma.$transaction([
    prisma.order.update({ where: { id: order.id }, data: { tableId: destino.id } }),
    prisma.barTable.update({ where: { id: order.tableId }, data: { status: 'AVAILABLE' } }),
    prisma.barTable.update({ where: { id: destino.id }, data: { status: 'OCCUPIED' } }),
  ])

  const actualizada = await prisma.order.findFirst({ where: { id: order.id }, include: ORDER_INCLUDE })
  res.json({ ...actualizada, total: total(actualizada) })
})

// --- Cuenta de la mesa -------------------------------------------------------

orderRoutes.get('/orders/by-table/:tableId', async (req, res) => {
  const order = await prisma.order.findFirst({
    where: { tableId: req.params.tableId, tenantId: req.auth.tenantId, status: 'OPEN' },
    include: ORDER_INCLUDE,
  })
  res.json(order ? { ...order, total: total(order) } : null)
})

// Historial de la mesa: cuentas ya cerradas, para consultar que paso antes sin
// inventar un log de estados aparte (ya queda registrado en cada Order).
orderRoutes.get('/orders/history/:tableId', async (req, res) => {
  const table = await prisma.barTable.findFirst({ where: { id: req.params.tableId, tenantId: req.auth.tenantId } })
  if (!table) return res.status(404).json({ error: 'Mesa no encontrada' })

  const orders = await prisma.order.findMany({
    where: { tableId: table.id, tenantId: req.auth.tenantId, status: 'CLOSED' },
    include: ORDER_INCLUDE,
    orderBy: { closedAt: 'desc' },
    take: 20,
  })
  res.json(orders.map((o) => ({ ...o, total: total(o) })))
})

// La cola de pre-pedidos esperando aprobacion, para cuando el admin entra o
// recarga: los eventos de socket solo avisan de lo que pasa despues de
// conectarse, esto es lo que ya esta pendiente en ese momento. Va antes de
// /orders/:id para que "pending" no se confunda con un id de cuenta.
orderRoutes.get('/orders/pending', puedeGestionarPrePedidos, async (req, res) => {
  const items = await prisma.orderItem.findMany({
    where: { tenantId: req.auth.tenantId, status: 'PENDING' },
    include: {
      createdBy: { select: { id: true, name: true } },
      order: {
        select: {
          id: true,
          tableId: true,
          table: { select: { number: true, zoneId: true, zone: { select: { name: true } } } },
        },
      },
    },
    orderBy: { orderedAt: 'asc' },
  })

  const porOrden = new Map()
  for (const it of items) {
    const existente = porOrden.get(it.orderId)
    if (!existente) {
      porOrden.set(it.orderId, {
        orderId: it.orderId,
        tableId: it.order.tableId,
        tableNumber: it.order.table.number,
        zoneId: it.order.table.zoneId,
        zoneName: it.order.table.zone.name,
        since: it.orderedAt,
        meseras: new Set([it.createdBy?.name].filter(Boolean)),
      })
    } else if (it.createdBy?.name) {
      existente.meseras.add(it.createdBy.name)
    }
  }

  res.json([...porOrden.values()].map((o) => ({ ...o, meseras: [...o.meseras] })))
})

orderRoutes.get('/orders/:id', async (req, res) => {
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
    include: ORDER_INCLUDE,
  })
  if (!order) return res.status(404).json({ error: 'Cuenta no encontrada' })
  res.json({ ...order, total: total(order) })
})

// Abrir cuenta: toda venta va atada a un turno, asi que sin uno abierto no
// hay donde registrarla. Si la mesa ya tiene una cuenta abierta, se reutiliza
// en vez de abrir otra: todo se va sumando a la misma hasta que se cobre.
orderRoutes.post('/orders', async (req, res) => {
  const { tableId } = req.body || {}
  if (!tableId) return res.status(400).json({ error: 'Elige una mesa' })

  const table = await prisma.barTable.findFirst({ where: { id: tableId, tenantId: req.auth.tenantId } })
  if (!table) return res.status(400).json({ error: 'La mesa no existe' })

  const existente = await prisma.order.findFirst({
    where: { tableId, tenantId: req.auth.tenantId, status: 'OPEN' },
    include: ORDER_INCLUDE,
  })
  if (existente) return res.json({ ...existente, total: total(existente) })

  const shift = await prisma.shift.findFirst({ where: { tenantId: req.auth.tenantId, status: 'OPEN' } })
  if (!shift) return res.status(400).json({ error: 'No hay un turno abierto. Abre caja antes de enviar pedidos.' })

  const order = await prisma.order.create({
    data: { tenantId: req.auth.tenantId, tableId, shiftId: shift.id, openedById: req.auth.userId },
    include: ORDER_INCLUDE,
  })
  await prisma.barTable.update({ where: { id: tableId }, data: { status: 'OCCUPIED' } })
  res.status(201).json({ ...order, total: total(order) })
})

// Agregar una ronda de productos. El precio se congela aqui: si el catalogo
// cambia despues, esta cuenta no se mueve.
//
// Quien la registra importa: si no es el admin, queda como PENDING (un
// pre-pedido) en vez de ACTIVE. No suma al total ni llega a la barra todavia
// -- el admin tiene que aprobarlo y enviarlo (POST /orders/:id/send) cuando
// la mesera llegue a confirmarlo. Esto es decision del dueno del bar.
orderRoutes.post('/orders/:id/items', async (req, res) => {
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
    include: { table: { select: { number: true, zoneId: true, zone: { select: { name: true } } } } },
  })
  if (!order) return res.status(404).json({ error: 'Cuenta no encontrada' })
  if (order.status !== 'OPEN') return res.status(400).json({ error: 'Esta cuenta ya esta cerrada' })

  const { items } = req.body || {}
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'Agrega al menos un producto' })
  }

  const status = req.auth.role === 'ADMIN' ? 'ACTIVE' : 'PENDING'
  const data = []
  for (const it of items) {
    const qty = Number(it.qty) || 1
    if (it.variantId) {
      const variant = await prisma.variant.findFirst({
        where: { id: it.variantId, product: { tenantId: req.auth.tenantId } },
        include: { product: true },
      })
      if (!variant) return res.status(400).json({ error: 'Una presentacion del pedido ya no existe' })
      data.push({
        tenantId: req.auth.tenantId,
        orderId: order.id,
        variantId: variant.id,
        productId: variant.productId,
        name: variant.product.name,
        variantName: variant.name,
        price: variant.price,
        qty,
        status,
        createdById: req.auth.userId,
      })
    } else if (it.productId) {
      const product = await prisma.product.findFirst({
        where: { id: it.productId, tenantId: req.auth.tenantId },
        include: { recipe: true },
      })
      if (!product?.recipe) return res.status(400).json({ error: 'Ese shot ya no existe' })
      data.push({
        tenantId: req.auth.tenantId,
        orderId: order.id,
        productId: product.id,
        name: product.name,
        variantName: null,
        price: product.recipe.price,
        qty,
        status,
        createdById: req.auth.userId,
      })
    } else {
      return res.status(400).json({ error: 'Cada producto necesita una presentacion o un shot' })
    }
  }

  await prisma.orderItem.createMany({ data })
  const updated = await prisma.order.findFirst({ where: { id: order.id }, include: ORDER_INCLUDE })

  if (status === 'PENDING') {
    // Misma forma que GET /orders/pending: el frontend guarda ambos en la
    // misma lista y no deberia importarle si llego por fetch o por socket.
    avisarEncargados(req.auth.tenantId, 'pre-pedido:nuevo', {
      orderId: order.id,
      tableId: order.tableId,
      tableNumber: order.table.number,
      zoneId: order.table.zoneId,
      zoneName: order.table.zone.name,
      since: new Date().toISOString(),
      meseras: [req.auth.name],
    })
  }

  res.status(201).json({ ...updated, total: total(updated) })
})

// Admin o cajero aprueban el pre-pedido que dejo la mesera: los items PENDING
// de esta cuenta pasan a ACTIVE (ahi si llegan a la barra y suman al total).
orderRoutes.post('/orders/:id/send', puedeGestionarPrePedidos, async (req, res) => {
  const order = await prisma.order.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } })
  if (!order) return res.status(404).json({ error: 'Cuenta no encontrada' })
  if (order.status !== 'OPEN') return res.status(400).json({ error: 'Esta cuenta ya esta cerrada' })

  const { count } = await prisma.orderItem.updateMany({
    where: { orderId: order.id, tenantId: req.auth.tenantId, status: 'PENDING' },
    data: { status: 'ACTIVE' },
  })
  if (!count) return res.status(400).json({ error: 'Esta mesa no tiene un pre-pedido esperando envio' })

  const updated = await prisma.order.findFirst({ where: { id: order.id }, include: ORDER_INCLUDE })
  avisarEncargados(req.auth.tenantId, 'pre-pedido:enviado', { orderId: order.id })
  res.json({ ...updated, total: total(updated) })
})

// Devolver un producto: necesita el PIN de un encargado (ADMIN o CAJERO) y un
// motivo. No se borra, queda marcado como devuelto con quien lo autorizo.
orderRoutes.patch('/orders/:id/items/:itemId/void', async (req, res) => {
  const order = await prisma.order.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } })
  if (!order) return res.status(404).json({ error: 'Cuenta no encontrada' })
  if (order.status !== 'OPEN') return res.status(400).json({ error: 'Esta cuenta ya esta cerrada' })

  const item = await prisma.orderItem.findFirst({ where: { id: req.params.itemId, orderId: order.id } })
  if (!item) return res.status(404).json({ error: 'Producto no encontrado en esta cuenta' })
  if (item.status === 'VOIDED') return res.status(400).json({ error: 'Ese producto ya estaba devuelto' })

  const { pin, reason } = req.body || {}
  if (!reason?.trim()) return res.status(400).json({ error: 'Explica por que se devuelve' })

  const encargado = await verificarPin(req.auth.tenantId, pin)
  if (!encargado) return res.status(401).json({ error: 'PIN incorrecto' })

  const updated = await prisma.orderItem.update({
    where: { id: item.id },
    data: { status: 'VOIDED', voidedAt: new Date(), voidReason: reason.trim(), voidedById: encargado.id },
    include: ITEM_INCLUDE,
  })
  res.json(updated)
})

// --- Cerrar cuenta (cobrar) --------------------------------------------------
// Dos caminos: pago real (uno o varios medios, con cambio si es en efectivo)
// o cortesia (no cobra nada, pero queda como un gasto del turno con motivo).
orderRoutes.post('/orders/:id/close', puedeCerrar, async (req, res) => {
  const order = await prisma.order.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId }, include: ORDER_INCLUDE })
  if (!order) return res.status(404).json({ error: 'Cuenta no encontrada' })
  if (order.status !== 'OPEN') return res.status(400).json({ error: 'Esta cuenta ya esta cerrada' })

  const cuenta = total(order)
  const { courtesy, payments } = req.body || {}

  if (courtesy) {
    if (!order.shiftId) return res.status(400).json({ error: 'Esta cuenta no tiene un turno asociado' })
    await prisma.$transaction(async (tx) => {
      // El consecutivo se asigna aqui, no antes: mientras la cuenta sigue
      // abierta no es una factura todavia. El increment es atomico (una fila
      // de Tenant), asi que dos cierres a la vez nunca repiten numero.
      const tenant = await tx.tenant.update({
        where: { id: req.auth.tenantId },
        data: { lastInvoiceNumber: { increment: 1 } },
      })
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedById: req.auth.userId,
          isCourtesy: true,
          invoiceNumber: tenant.lastInvoiceNumber,
        },
      })
      await tx.shiftExpense.create({
        data: {
          tenantId: req.auth.tenantId,
          shiftId: order.shiftId,
          type: 'GASTO',
          amount: cuenta,
          reason: 'Pago a proveedor oficial',
          authorizedById: req.auth.userId,
        },
      })
      await tx.barTable.update({ where: { id: order.tableId }, data: { status: 'AVAILABLE' } })
    })
  } else {
    if (!Array.isArray(payments) || !payments.length) {
      return res.status(400).json({ error: 'Elige cómo se paga la cuenta' })
    }
    const sumaPagos = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
    if (sumaPagos !== cuenta) {
      return res.status(400).json({ error: `Los pagos suman ${sumaPagos} y la cuenta es ${cuenta}` })
    }
    for (const p of payments) {
      if (!['EFECTIVO', 'TRANSFERENCIA', 'NEQUI', 'DATAFONO', 'CREDITO'].includes(p.method)) {
        return res.status(400).json({ error: 'Medio de pago no valido' })
      }
      if (p.method === 'EFECTIVO' && p.tendered !== undefined && Number(p.tendered) < Number(p.amount)) {
        return res.status(400).json({ error: 'Lo que entregó el cliente no puede ser menor a lo que paga' })
      }
    }

    // Credito: no entra a caja, se carga como deuda al cliente vinculado a la
    // cuenta. Necesita cliente con credito habilitado; el 90% del limite ya
    // se avisa antes de llegar aqui, no se bloquea por eso.
    const montoCredito = payments
      .filter((p) => p.method === 'CREDITO')
      .reduce((s, p) => s + (Number(p.amount) || 0), 0)
    if (montoCredito > 0) {
      if (!order.customer) return res.status(400).json({ error: 'Esta cuenta necesita un cliente vinculado para fiar' })
      if (!order.customer.creditEnabled) {
        return res.status(400).json({ error: `${order.customer.firstName} no tiene crédito habilitado` })
      }
    }

    await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.update({
        where: { id: req.auth.tenantId },
        data: { lastInvoiceNumber: { increment: 1 } },
      })
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedById: req.auth.userId,
          invoiceNumber: tenant.lastInvoiceNumber,
        },
      })
      await tx.orderPayment.createMany({
        data: payments.map((p) => {
          const amount = Number(p.amount)
          const tendered = p.method === 'EFECTIVO' ? Number(p.tendered ?? amount) : null
          return {
            tenantId: req.auth.tenantId,
            orderId: order.id,
            method: p.method,
            amount,
            tendered,
            change: tendered !== null ? tendered - amount : null,
          }
        }),
      })
      await tx.barTable.update({ where: { id: order.tableId }, data: { status: 'AVAILABLE' } })
      if (montoCredito > 0) {
        await tx.customerCharge.create({
          data: {
            tenantId: req.auth.tenantId,
            customerId: order.customer.id,
            orderId: order.id,
            amount: montoCredito,
            description: `Fiado - mesa ${order.table.number}`,
            createdById: req.auth.userId,
          },
        })
      }
    })
  }

  const cerrada = await prisma.order.findFirst({ where: { id: order.id }, include: ORDER_INCLUDE })
  res.json({ ...cerrada, total: total(cerrada) })
})
