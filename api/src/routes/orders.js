import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireRole } from '../middleware/auth.js'
import { tienePermiso } from '../middleware/permissions.js'
import { pinLimitExcedido, pinIncorrecto } from '../middleware/rateLimit.js'
import { verificarPin, verificarPinPropio } from '../lib/pin.js'
import { avisarEncargados, avisarTenant } from '../lib/realtime.js'
import { calcularCostos } from '../lib/costos.js'
import { resolverCuentaPago } from '../lib/cuentaPago.js'
import { consumirInsumoFIFO, restaurarInsumoFIFO } from '../lib/consumoInsumo.js'

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
  // cuentaFinanciera: para que la factura muestre a cual banco/billetera
  // real entro cada pago (ver ReciboModal.jsx), no solo el metodo generico.
  payments: { orderBy: { createdAt: 'asc' }, include: { cuentaFinanciera: { select: { nombre: true } } } },
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
      whatsapp: true,
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

// Movimientos de stock por venta (SALE, resta) o devolucion (VOID_RESTORE,
// suma), agrupados por variante para no crear un movimiento por cada linea
// repetida. Nunca valida que el stock no quede negativo: el stock es un
// aviso para el operador, no un bloqueo de venta. Recibe tx porque corre
// siempre dentro de la misma transaccion que el consumo de insumos (ver
// aplicarConsumoInsumos) y la mutacion del OrderItem.
function stockOpsPorVariante(tx, tenantId, userId, porVariante, type, note) {
  const signo = type === 'SALE' ? -1 : 1
  const ops = []
  for (const [variantId, qty] of porVariante) {
    ops.push(
      tx.variant.update({ where: { id: variantId }, data: { stock: { [signo < 0 ? 'decrement' : 'increment']: qty } } }),
      tx.stockMovement.create({
        data: { tenantId, variantId, type, qty: signo * qty, note, createdById: userId },
      })
    )
  }
  return ops
}

// Consumo/reposicion de insumos por venta o devolucion, agrupado por insumo
// igual que stockOpsPorVariante -- pero a diferencia de ese caso, un insumo
// SI necesita saber de que lote sale o a cual vuelve (ver consumoInsumo.js:
// FIFO al vender, orden inverso aproximado al devolver), asi que no es un
// par de operaciones planas sino una funcion que lee antes de escribir.
async function aplicarConsumoInsumos(tx, { tenantId, porInsumo, tipo, note, createdById }) {
  const fn = tipo === 'SALE' ? consumirInsumoFIFO : restaurarInsumoFIFO
  for (const [insumoId, qty] of porInsumo) {
    await fn(tx, { tenantId, insumoId, qty, note, createdById })
  }
}

// Un producto PREPARED puede tener ingredientes por unidades (variantId+qty,
// ej. 2 lonjas de jamon) o por insumo (insumoId+qty, ej. cebolla/queso en su
// unidadInventario): ambos tienen stock real y se descuentan igual que una
// presentacion vendida directa, sumando a los mapas que stockOpsPorVariante/
// aplicarConsumoInsumos ya saben mover. Los ingredientes por ml (sourceProductId)
// no descuentan nada todavia: el OpenContainer que los respalda no existe
// (ver CLAUDE.md).
async function sumarIngredientesPorUnidad(porVariante, porInsumo, productId, cantidadVendida) {
  const recipe = await prisma.recipe.findUnique({
    where: { productId },
    include: { items: { where: { OR: [{ variantId: { not: null } }, { insumoId: { not: null } }] } } },
  })
  for (const item of recipe?.items || []) {
    if (item.variantId) {
      porVariante.set(item.variantId, (porVariante.get(item.variantId) || 0) + item.qty * cantidadVendida)
    } else if (item.insumoId) {
      porInsumo.set(item.insumoId, (porInsumo.get(item.insumoId) || 0) + item.qty * cantidadVendida)
    }
  }
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
    // Si la mesa de origen tenia satelites fusionados, se mudan con la
    // cuenta: siguen apuntando a donde quedo la cuenta, no a donde ya no hay
    // nada.
    prisma.barTable.updateMany({ where: { groupId: order.tableId }, data: { groupId: destino.id } }),
  ])

  avisarTenant(req.auth.tenantId, 'mesas:actualizadas', {})

  const actualizada = await prisma.order.findFirst({ where: { id: order.id }, include: ORDER_INCLUDE })
  res.json({ ...actualizada, total: total(actualizada) })
})

// --- Cuenta de la mesa -------------------------------------------------------

orderRoutes.get('/orders/by-table/:tableId', async (req, res) => {
  const table = await prisma.barTable.findFirst({ where: { id: req.params.tableId, tenantId: req.auth.tenantId } })
  if (!table) return res.status(404).json({ error: 'Mesa no encontrada' })
  // Una mesa fusionada temporalmente no tiene cuenta propia: la cuenta vive
  // en la principal, aunque se haya pedido parado en la satelite.
  const order = await prisma.order.findFirst({
    where: { tableId: table.groupId || table.id, tenantId: req.auth.tenantId, status: 'OPEN' },
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

// Todas las cuentas abiertas del bar (cualquier mesa), para la pantalla de
// cierre de turno: ahi se decide si se cobran todas antes de cerrar o se
// dejan pasar al siguiente turno.
orderRoutes.get('/orders/open', puedeCerrar, async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { tenantId: req.auth.tenantId, status: 'OPEN' },
    include: ORDER_INCLUDE,
    orderBy: { openedAt: 'asc' },
  })
  res.json(orders.map((o) => ({ ...o, total: total(o) })))
})

orderRoutes.get('/orders/:id', async (req, res) => {
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
    include: ORDER_INCLUDE,
  })
  if (!order) return res.status(404).json({ error: 'Cuenta no encontrada' })
  res.json({ ...order, total: total(order) })
})

// Costo de la cuenta activa, para que el modal de cierre pueda avisar en vivo
// si un descuento la deja en perdida antes de confirmar. Solo lo necesita
// quien va a cobrar/aplicar el descuento.
orderRoutes.get('/orders/:id/cost', puedeCerrar, async (req, res) => {
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
    include: { items: true },
  })
  if (!order) return res.status(404).json({ error: 'Cuenta no encontrada' })
  const { total: cost } = await calcularCostos(order.items, req.auth.tenantId)
  res.json({ cost })
})

// Abrir cuenta: toda venta va atada a un turno, asi que sin uno abierto no
// hay donde registrarla. Si la mesa ya tiene una cuenta abierta, se reutiliza
// en vez de abrir otra: todo se va sumando a la misma hasta que se cobre.
orderRoutes.post('/orders', async (req, res) => {
  const { tableId: tableIdPedida } = req.body || {}
  if (!tableIdPedida) return res.status(400).json({ error: 'Elige una mesa' })

  const tablaPedida = await prisma.barTable.findFirst({ where: { id: tableIdPedida, tenantId: req.auth.tenantId } })
  if (!tablaPedida) return res.status(400).json({ error: 'La mesa no existe' })
  // Pedir parado en una mesa fusionada temporalmente abre/usa la cuenta de la
  // principal, no una propia: asi "mesa 22" y "mesa 21" fusionadas siempre
  // terminan en la misma cuenta sin que la mesera tenga que saberlo.
  const tableId = tablaPedida.groupId || tablaPedida.id

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
  avisarTenant(req.auth.tenantId, 'mesas:actualizadas', {})
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
  const porVariante = new Map() // solo se llena si queda ACTIVE: un pre-pedido todavia no llego a la barra
  const porInsumo = new Map()
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
      if (status === 'ACTIVE') {
        porVariante.set(variant.id, (porVariante.get(variant.id) || 0) + qty)
      }
    } else if (it.productId) {
      const product = await prisma.product.findFirst({
        where: { id: it.productId, tenantId: req.auth.tenantId },
        include: { recipe: true },
      })
      if (!product?.recipe) return res.status(400).json({ error: 'Ese producto ya no existe' })
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
      if (status === 'ACTIVE') {
        await sumarIngredientesPorUnidad(porVariante, porInsumo, product.id, qty)
      }
    } else {
      return res.status(400).json({ error: 'Cada producto necesita una presentacion o un shot' })
    }
  }

  // Llega a la barra ACTIVE solo si lo crea el admin directo; el pre-pedido
  // (PENDING) no descuenta nada todavia, eso pasa recien en /send. Nunca se
  // bloquea por falta de stock -- si queda en negativo, queda en negativo.
  await prisma.$transaction(async (tx) => {
    await tx.orderItem.createMany({ data })
    await Promise.all(stockOpsPorVariante(tx, req.auth.tenantId, req.auth.userId, porVariante, 'SALE', 'Venta directa (admin)'))
    await aplicarConsumoInsumos(tx, {
      tenantId: req.auth.tenantId,
      porInsumo,
      tipo: 'SALE',
      note: 'Venta directa (admin)',
      createdById: req.auth.userId,
    })
  })
  avisarTenant(req.auth.tenantId, 'inventario:actualizado', {})
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

  const pendientes = await prisma.orderItem.findMany({
    where: { orderId: order.id, tenantId: req.auth.tenantId, status: 'PENDING' },
  })
  if (!pendientes.length) return res.status(400).json({ error: 'Esta mesa no tiene un pre-pedido esperando envio' })

  const porVariante = new Map()
  const porInsumo = new Map()
  const porProductoPreparado = new Map()
  for (const it of pendientes) {
    if (it.variantId) porVariante.set(it.variantId, (porVariante.get(it.variantId) || 0) + it.qty)
    else if (it.productId) porProductoPreparado.set(it.productId, (porProductoPreparado.get(it.productId) || 0) + it.qty)
  }
  for (const [productId, qty] of porProductoPreparado) {
    await sumarIngredientesPorUnidad(porVariante, porInsumo, productId, qty)
  }

  // Recien aqui el pre-pedido llega de verdad a la barra: aqui se descuenta,
  // no al crearlo (eso solo es borrador de la mesera).
  await prisma.$transaction(async (tx) => {
    await tx.orderItem.updateMany({
      where: { orderId: order.id, tenantId: req.auth.tenantId, status: 'PENDING' },
      // orderedAt se reescribe aqui a proposito: el minuto de gracia para
      // devolver sin justificar (ver /void) debe contar desde que el pedido
      // de verdad llega a la barra, no desde que la mesera lo toco -- pudo
      // haber quedado esperando aprobacion varios minutos.
      data: { status: 'ACTIVE', orderedAt: new Date() },
    })
    await Promise.all(stockOpsPorVariante(tx, req.auth.tenantId, req.auth.userId, porVariante, 'SALE', 'Pre-pedido enviado a la barra'))
    await aplicarConsumoInsumos(tx, {
      tenantId: req.auth.tenantId,
      porInsumo,
      tipo: 'SALE',
      note: 'Pre-pedido enviado a la barra',
      createdById: req.auth.userId,
    })
  })
  avisarTenant(req.auth.tenantId, 'inventario:actualizado', {})

  const updated = await prisma.order.findFirst({ where: { id: order.id }, include: ORDER_INCLUDE })
  avisarEncargados(req.auth.tenantId, 'pre-pedido:enviado', { orderId: order.id })
  res.json({ ...updated, total: total(updated) })
})

// Quitar una linea de un pre-pedido ANTES de que se envie a la barra:
// todavia es un borrador, no hace falta el PIN ni el motivo que pide
// devolver algo ya servido -- eso es para lo que de verdad se pidio. Solo
// acepta items PENDING; uno ya ACTIVE se devuelve con /void, nunca se borra
// de verdad (ahi si queda el rastro).
orderRoutes.delete('/orders/:id/items/:itemId', async (req, res) => {
  const order = await prisma.order.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } })
  if (!order) return res.status(404).json({ error: 'Cuenta no encontrada' })
  if (order.status !== 'OPEN') return res.status(400).json({ error: 'Esta cuenta ya esta cerrada' })

  const item = await prisma.orderItem.findFirst({ where: { id: req.params.itemId, orderId: order.id } })
  if (!item) return res.status(404).json({ error: 'Producto no encontrado en esta cuenta' })
  if (item.status !== 'PENDING') {
    return res.status(400).json({ error: 'Ese producto ya se envio a la barra; para quitarlo usa Devolver' })
  }

  await prisma.orderItem.delete({ where: { id: item.id } })

  // Si era la ultima linea pendiente, el aviso de "pre-pedido esperando" en
  // el panel de los encargados tiene que desaparecer igual que cuando se
  // envia -- ya no hay nada que aprobar en esta mesa.
  const quedanPendientes = await prisma.orderItem.count({ where: { orderId: order.id, status: 'PENDING' } })
  if (quedanPendientes === 0) {
    avisarEncargados(req.auth.tenantId, 'pre-pedido:cancelado', { orderId: order.id })
  }

  const updated = await prisma.order.findFirst({ where: { id: order.id }, include: ORDER_INCLUDE })
  res.json({ ...updated, total: total(updated) })
})

// Minuto de gracia: deshacer un toque reciente es corregir un error al
// toque, no devolver algo que ya se sirvio -- no pide motivo ni PIN, sin
// importar el rol. orderedAt es el ancla (para un pre-pedido aprobado, POST
// /orders/:id/send lo reescribe al momento de la aprobacion, no se queda en
// cuando la mesera lo toco).
const GRACIA_DEVOLUCION_MS = 60_000

// Devolver un producto. Pasado el minuto de gracia hace falta justificar:
// el admin nunca necesita PIN (ya tiene autoridad plena), pero cajero y
// mesero si, con su PROPIO PIN -- no el de un encargado -- para que quede
// registrado quien lo autorizo sin depender de que haya un admin presente.
// No se borra, queda marcado como devuelto con quien lo autorizo.
orderRoutes.patch('/orders/:id/items/:itemId/void', async (req, res) => {
  const order = await prisma.order.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } })
  if (!order) return res.status(404).json({ error: 'Cuenta no encontrada' })
  if (order.status !== 'OPEN') return res.status(400).json({ error: 'Esta cuenta ya esta cerrada' })

  const item = await prisma.orderItem.findFirst({ where: { id: req.params.itemId, orderId: order.id } })
  if (!item) return res.status(404).json({ error: 'Producto no encontrado en esta cuenta' })
  if (item.status === 'VOIDED') return res.status(400).json({ error: 'Ese producto ya estaba devuelto' })

  const { pin, reason, qty: qtyBody } = req.body || {}

  // Si no mandan cantidad, se devuelve la linea completa (comportamiento de
  // siempre). Si mandan menos que el total, es una correccion de envio: "se
  // pidieron 3, llegaron 4" sin tener que devolver las 4 para volver a
  // mandar 3.
  const qtyDevuelta = qtyBody === undefined ? item.qty : Number(qtyBody)
  if (!Number.isInteger(qtyDevuelta) || qtyDevuelta < 1 || qtyDevuelta > item.qty) {
    return res.status(400).json({ error: `La cantidad a devolver debe ser un numero entre 1 y ${item.qty}` })
  }

  const dentroDeGracia = Date.now() - new Date(item.orderedAt).getTime() < GRACIA_DEVOLUCION_MS

  let autorId
  if (dentroDeGracia) {
    autorId = req.auth.userId
  } else if (req.auth.role === 'ADMIN') {
    if (!reason?.trim()) return res.status(400).json({ error: 'Explica por que se devuelve' })
    autorId = req.auth.userId
  } else {
    if (!reason?.trim()) return res.status(400).json({ error: 'Explica por que se devuelve' })
    // Solo se limita aqui, no toda la ruta: cuenta no encontrada o item ya
    // devuelto no tiene nada que ver con un PIN mal escrito y no tiene por
    // que competir por la misma cuota (ver pinLimiter en middleware/rateLimit.js).
    if (await pinLimitExcedido(req, res)) return
    const propio = await verificarPinPropio(req.auth.tenantId, req.auth.userId, pin)
    if (!propio) return pinIncorrecto(req, res)
    autorId = propio.id
  }
  const motivo = reason?.trim() || 'Sin justificar (dentro del minuto de gracia)'

  // Solo repone stock si ya estaba ACTIVE: si seguia PENDING nunca se le
  // habia restado nada (eso pasa al enviar, no al crear el pre-pedido).
  const porVariante = new Map()
  const porInsumo = new Map()
  if (item.status === 'ACTIVE') {
    if (item.variantId) porVariante.set(item.variantId, qtyDevuelta)
    else if (item.productId) await sumarIngredientesPorUnidad(porVariante, porInsumo, item.productId, qtyDevuelta)
  }
  let updated
  await prisma.$transaction(async (tx) => {
    if (qtyDevuelta === item.qty) {
      updated = await tx.orderItem.update({
        where: { id: item.id },
        data: { status: 'VOIDED', voidedAt: new Date(), voidReason: motivo, voidedById: autorId },
        include: ITEM_INCLUDE,
      })
    } else {
      // Se devuelve solo una parte: la linea original se queda con lo que no
      // se devolvio y la porcion devuelta queda aparte, como una linea VOIDED
      // propia -- asi no se pierde el rastro de cuanto y por que se devolvio.
      await tx.orderItem.update({ where: { id: item.id }, data: { qty: item.qty - qtyDevuelta } })
      updated = await tx.orderItem.create({
        data: {
          tenantId: req.auth.tenantId,
          orderId: item.orderId,
          variantId: item.variantId,
          productId: item.productId,
          name: item.name,
          variantName: item.variantName,
          price: item.price,
          qty: qtyDevuelta,
          status: 'VOIDED',
          orderedAt: item.orderedAt,
          createdById: item.createdById,
          voidedAt: new Date(),
          voidReason: motivo,
          voidedById: autorId,
        },
        include: ITEM_INCLUDE,
      })
    }
    await Promise.all(stockOpsPorVariante(tx, req.auth.tenantId, autorId, porVariante, 'VOID_RESTORE', `Devuelto: ${motivo}`))
    await aplicarConsumoInsumos(tx, {
      tenantId: req.auth.tenantId,
      porInsumo,
      tipo: 'SALE_VOID',
      note: `Devuelto: ${motivo}`,
      createdById: autorId,
    })
  })
  avisarTenant(req.auth.tenantId, 'inventario:actualizado', {})
  if (order.shiftId) avisarTenant(req.auth.tenantId, 'turno:actualizado', { shiftId: order.shiftId })
  res.json(updated)
})

// --- Cerrar cuenta (cobrar) --------------------------------------------------
// Dos caminos: pago real (uno o varios medios, con cambio si es en efectivo)
// o cortesia (no cobra nada, pero queda como un gasto del turno con motivo).
orderRoutes.post('/orders/:id/close', puedeCerrar, async (req, res) => {
  const order = await prisma.order.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId }, include: ORDER_INCLUDE })
  if (!order) return res.status(404).json({ error: 'Cuenta no encontrada' })
  if (order.status !== 'OPEN') return res.status(400).json({ error: 'Esta cuenta ya esta cerrada' })

  // El turno en que se abrio esta cuenta puede ya estar cerrado (se dejo
  // pasar al siguiente turno al cerrar caja, en vez de cobrarla antes). Si es
  // asi, se liquida contra el turno que esta abierto ahora: es el que de
  // verdad va a tener esta plata en el cajon para su propio cuadre.
  let shiftId = order.shiftId
  if (shiftId) {
    const turnoDeApertura = await prisma.shift.findUnique({ where: { id: shiftId } })
    if (turnoDeApertura?.status === 'CLOSED') {
      const abierto = await prisma.shift.findFirst({ where: { tenantId: req.auth.tenantId, status: 'OPEN' } })
      if (!abierto) return res.status(400).json({ error: 'No hay un turno abierto. Abre caja antes de cobrar esta cuenta.' })
      shiftId = abierto.id
    }
  }

  const cuenta = total(order)
  const { courtesy, payments, pin } = req.body || {}
  const discountAmount = Number(req.body?.discountAmount) || 0
  // Propina: nunca en una cortesia (no se cobra nada), solo en el cobro
  // normal. No es una accion sensible (ver CerrarCuentaModal) -- no exige PIN
  // fresco, por eso no se valida aqui arriba junto al descuento/fiado.
  const tipAmount = courtesy ? 0 : Math.max(0, Number(req.body?.tip) || 0)

  if (courtesy && !shiftId) return res.status(400).json({ error: 'Esta cuenta no tiene un turno asociado' })

  // Codigo de empleado: se pide siempre para cerrar una cuenta -- cobro o
  // cortesia -- no solo cuando hay descuento o fiado fuera de cupo como
  // antes. Identifica a quien de verdad esta parado cerrando, sin depender
  // de la cuenta con la que haya quedado logueado el dispositivo (puede
  // seguir logueado todo el dia, ver nota de apertura de turno). Se valida
  // aqui arriba, antes de las reglas de descuento/pagos que siguen abajo,
  // para no gastar un intento de PIN por un error que no tiene nada que ver
  // con el PIN (monto mal armado, medio invalido, etc. se revisan primero
  // en cada rama).
  if (!pin) return res.status(400).json({ error: 'Escribe el código de empleado para cerrar la cuenta' })

  if (courtesy) {
    if (await pinLimitExcedido(req, res)) return
    const encargado = await verificarPin(req.auth.tenantId, pin)
    if (!encargado) return pinIncorrecto(req, res)

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
          closedById: encargado.id,
          isCourtesy: true,
          invoiceNumber: tenant.lastInvoiceNumber,
          shiftId,
        },
      })
      await tx.shiftExpense.create({
        data: {
          tenantId: req.auth.tenantId,
          shiftId,
          type: 'GASTO',
          amount: cuenta,
          reason: 'Pago a proveedor oficial',
          authorizedById: encargado.id,
        },
      })
      await tx.barTable.update({ where: { id: order.tableId }, data: { status: 'AVAILABLE' } })
      // Si esta cuenta tenia mesas fusionadas temporalmente, se sueltan solas
      // aqui: la fusion dura lo que dura la cuenta, nunca mas.
      await tx.barTable.updateMany({ where: { groupId: order.tableId }, data: { groupId: null, status: 'AVAILABLE' } })
    })
  } else {
    if (!Array.isArray(payments) || !payments.length) {
      return res.status(400).json({ error: 'Elige cómo se paga la cuenta' })
    }

    // El descuento edita directamente "lo que se va a cobrar", no un
    // porcentaje: el cajero escribe el nuevo valor y esto es la diferencia
    // contra el total de los items (que nunca se toca, sigue siendo la foto
    // real de lo que se pidio).
    let montoFinal = cuenta
    let costos = null
    if (discountAmount > 0) {
      if (discountAmount > cuenta) {
        return res.status(400).json({ error: 'El descuento no puede ser mayor al valor de la cuenta' })
      }
      if (!(await tienePermiso(req.auth, 'cajeroAplicaDescuentos'))) {
        return res.status(403).json({ error: 'Tu rol no puede aplicar descuentos' })
      }
      costos = await calcularCostos(order.items, req.auth.tenantId)
      montoFinal = cuenta - discountAmount
      if (montoFinal < costos.total) {
        return res.status(400).json({ error: 'Ese descuento deja la cuenta en pérdida' })
      }
    }
    montoFinal += tipAmount

    const sumaPagos = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
    if (sumaPagos !== montoFinal) {
      return res.status(400).json({ error: `Los pagos suman ${sumaPagos} y la cuenta es ${montoFinal}` })
    }
    for (const p of payments) {
      if (!['EFECTIVO', 'TRANSFERENCIA', 'NEQUI', 'DATAFONO', 'CREDITO'].includes(p.method)) {
        return res.status(400).json({ error: 'Medio de pago no valido' })
      }
      if (p.method === 'EFECTIVO' && p.tendered !== undefined && Number(p.tendered) < Number(p.amount)) {
        return res.status(400).json({ error: 'Lo que entregó el cliente no puede ser menor a lo que paga' })
      }
    }

    // Si el operador eligio un banco/billetera real (modulo de Cajas y
    // bancos), cada pago se resuelve contra su cuenta antes de la
    // transaccion: nunca confiar en que el id que llego del cliente es
    // valido. El metodo que se cuenta en el cuadre sigue siendo el generico
    // (ver resolverCuentaPago) -- esto solo liga el pago a la cuenta real.
    const cuentasPorPago = await Promise.all(
      payments.map((p) => resolverCuentaPago(req.auth.tenantId, p.method, p.cuentaFinancieraId))
    )
    for (let i = 0; i < payments.length; i++) {
      if (payments[i].cuentaFinancieraId && !cuentasPorPago[i]) {
        return res.status(400).json({ error: 'Esa cuenta de pago no es válida' })
      }
    }

    // Credito: no entra a caja, se carga como deuda al cliente vinculado a la
    // cuenta. Sin credito habilitado, o si este fiado deja el saldo por
    // encima del cupo, no se bloquea del todo -es decision del encargado, no
    // del codigo- pero el cierre ya pide el codigo de empleado de todos
    // modos (ver arriba): sinCreditoHabilitado/excedeLimite solo deciden si
    // ese mismo codigo tambien queda anotado como quien autorizo el fiado.
    const montoCredito = payments
      .filter((p) => p.method === 'CREDITO')
      .reduce((s, p) => s + (Number(p.amount) || 0), 0)
    let sinCreditoHabilitado = false
    let excedeLimite = false
    if (montoCredito > 0) {
      if (!order.customer) return res.status(400).json({ error: 'Esta cuenta necesita un cliente vinculado para fiar' })

      const [cargos, abonos] = await Promise.all([
        prisma.customerCharge.aggregate({ where: { customerId: order.customer.id }, _sum: { amount: true } }),
        prisma.customerPayment.aggregate({ where: { customerId: order.customer.id }, _sum: { amount: true } }),
      ])
      const saldoActual = Number(cargos._sum.amount || 0) - Number(abonos._sum.amount || 0)
      const limite = order.customer.creditLimit !== null ? Number(order.customer.creditLimit) : null
      sinCreditoHabilitado = !order.customer.creditEnabled
      excedeLimite = limite !== null && saldoActual + montoCredito > limite
    }

    // Codigo de empleado, una sola vez para todo el cierre (descuento, fiado
    // fuera de cupo, o un cobro normal): ya se exigio que viniera en el
    // body arriba, aqui se verifica de verdad contra el PIN real.
    if (await pinLimitExcedido(req, res)) return
    const encargado = await verificarPin(req.auth.tenantId, pin)
    if (!encargado) return pinIncorrecto(req, res)
    const discountEncargadoId = discountAmount > 0 ? encargado.id : null
    const creditoEncargadoId = sinCreditoHabilitado || excedeLimite ? encargado.id : null

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
          closedById: encargado.id,
          invoiceNumber: tenant.lastInvoiceNumber,
          discountAmount,
          tipAmount,
          shiftId,
          ...(discountAmount > 0 && { discountAppliedById: discountEncargadoId }),
        },
      })
      if (discountAmount > 0) {
        // Se reparte segun la utilidad de cada linea (precio - costo): el
        // producto que mas margen deja absorbe mas del descuento. Negativa se
        // trata como 0 para repartir (una linea ya vendida a perdida no debe
        // "ganar" descuento encima), pero sigue contando en costos.total para
        // el chequeo de perdida de arriba.
        const activos = order.items.filter((i) => i.status === 'ACTIVE')
        const utilidades = activos.map((i) => ({
          id: i.id,
          utilidad: Math.max(0, Number(i.price) * i.qty - (costos.porItem.get(i.id) || 0)),
        }))
        const totalUtilidad = utilidades.reduce((s, u) => s + u.utilidad, 0)
        for (const u of utilidades) {
          const parte = totalUtilidad > 0 ? discountAmount * (u.utilidad / totalUtilidad) : 0
          await tx.orderItem.update({ where: { id: u.id }, data: { discountAmount: parte } })
        }
      }
      // Create (no createMany): createMany no devuelve las filas creadas en
      // MySQL, y aqui si hace falta el id de vuelta -- el movimiento
      // financiero que puede colgar de este pago lo necesita para poder
      // reimprimir despues la factura real desde Cajas y bancos (ver
      // orderPaymentId en MovimientoFinanciero). Son como mucho un par de
      // pagos partidos, no hay costo real en hacerlo uno por uno.
      for (let i = 0; i < payments.length; i++) {
        const p = payments[i]
        const amount = Number(p.amount)
        const tendered = p.method === 'EFECTIVO' ? Number(p.tendered ?? amount) : null
        const cuenta = cuentasPorPago[i]
        const referencia = p.referencia?.toString().trim() || null
        const orderPayment = await tx.orderPayment.create({
          data: {
            tenantId: req.auth.tenantId,
            orderId: order.id,
            method: p.method,
            amount,
            tendered,
            change: tendered !== null ? tendered - amount : null,
            cuentaFinancieraId: cuenta?.id,
            referencia,
          },
        })
        if (cuenta) {
          await tx.movimientoFinanciero.create({
            data: {
              tenantId: req.auth.tenantId,
              cuentaId: cuenta.id,
              tipo: 'INGRESO',
              valor: amount,
              concepto: referencia
                ? `Venta mesa ${order.table.number} · Comprobante ${referencia}`
                : `Venta mesa ${order.table.number}`,
              createdById: req.auth.userId,
              orderPaymentId: orderPayment.id,
            },
          })
        }
      }
      await tx.barTable.update({ where: { id: order.tableId }, data: { status: 'AVAILABLE' } })
      // Si esta cuenta tenia mesas fusionadas temporalmente, se sueltan solas
      // aqui: la fusion dura lo que dura la cuenta, nunca mas.
      await tx.barTable.updateMany({ where: { groupId: order.tableId }, data: { groupId: null, status: 'AVAILABLE' } })
      if (montoCredito > 0) {
        await tx.customerCharge.create({
          data: {
            tenantId: req.auth.tenantId,
            customerId: order.customer.id,
            orderId: order.id,
            amount: montoCredito,
            description: `Fiado - mesa ${order.table.number}`,
            createdById: req.auth.userId,
            authorizedById: creditoEncargadoId,
          },
        })
      }
    })
  }

  avisarTenant(req.auth.tenantId, 'mesas:actualizadas', {})
  avisarTenant(req.auth.tenantId, 'turno:actualizado', { shiftId })

  const cerrada = await prisma.order.findFirst({ where: { id: order.id }, include: ORDER_INCLUDE })
  res.json({ ...cerrada, total: total(cerrada) })
})
