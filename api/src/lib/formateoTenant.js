// Formateo de datos desde /plataforma (ver routes/platform.js). SIEMPRE
// recibe tenantId como argumento explicito -- nunca lo infiere de nada mas,
// y cada query de este archivo lo lleva en el where (directo o via relacion)
// para que un bug aqui no pueda tocar el tenant equivocado.
//
// No se confia en cascada implicita de la base de datos (onDelete: Cascade
// del schema): el orden de borrado de cada tabla se resuelve a mano abajo,
// hoja antes que raiz, para que esto siga siendo correcto aunque algun dia
// cambie una relacion en schema.prisma sin que alguien se acuerde de revisar
// este archivo.
import { prisma } from './prisma.js'

// --- Formatear todo ---------------------------------------------------------
// Borra todo lo operativo de un tenant (ventas, inventario, catalogo,
// compras, caja, clientes). Sobrevive: el Tenant mismo (nombre, logo,
// modulos, permisos...), los Usuarios, y el plano del bar (Zone/BarTable/
// LayoutElement) -- redibujar 15 mesas no es trivial y no es un dato
// operativo como una venta o un insumo.
export async function formatearTodo(tenantId) {
  await prisma.$transaction(async (tx) => {
    await tx.movimientoFinanciero.deleteMany({ where: { tenantId } })
    await tx.orderPayment.deleteMany({ where: { tenantId } })
    await tx.customerCharge.deleteMany({ where: { tenantId } })
    await tx.customerPayment.deleteMany({ where: { tenantId } })
    await tx.orderItem.deleteMany({ where: { tenantId } })
    await tx.stockMovement.deleteMany({ where: { tenantId } })
    await tx.insumoMovement.deleteMany({ where: { tenantId } })
    await tx.listaCompraItem.deleteMany({ where: { tenantId } })
    await tx.compraPago.deleteMany({ where: { tenantId } })
    await tx.compraItem.deleteMany({ where: { compra: { tenantId } } })
    await tx.traslado.deleteMany({ where: { tenantId } })
    await tx.order.deleteMany({ where: { tenantId } })
    await tx.compra.deleteMany({ where: { tenantId } })
    await tx.shiftExpense.deleteMany({ where: { tenantId } })
    await tx.shift.deleteMany({ where: { tenantId } })
    await tx.customer.deleteMany({ where: { tenantId } })
    await tx.recipeItem.deleteMany({ where: { recipe: { product: { tenantId } } } })
    await tx.recipe.deleteMany({ where: { product: { tenantId } } })
    await tx.variant.deleteMany({ where: { product: { tenantId } } })
    await tx.product.deleteMany({ where: { tenantId } })
    await tx.insumo.deleteMany({ where: { tenantId } })
    // Hijas antes que padres: Category es jerarquica (parentId se auto-
    // referencia) y un solo deleteMany sobre las dos a la vez no garantiza
    // el orden fila por fila que MySQL necesita para no chocar con su propia
    // FK (ver @@unique([tenantId, parentId, name]) en schema.prisma).
    await tx.category.deleteMany({ where: { tenantId, parentId: { not: null } } })
    await tx.category.deleteMany({ where: { tenantId } })
    await tx.insumoCategoria.deleteMany({ where: { tenantId } })
    await tx.proveedor.deleteMany({ where: { tenantId } })
    await tx.cuentaFinanciera.deleteMany({ where: { tenantId } })

    await tx.barTable.updateMany({ where: { tenantId }, data: { status: 'AVAILABLE', groupId: null } })
    await tx.tenant.update({ where: { id: tenantId }, data: { lastInvoiceNumber: 0 } })
  })
}

// --- Formatear movimientos --------------------------------------------------
// Borra solo lo transaccional (ventas, turnos, compras, movimientos
// financieros). El catalogo (productos, insumos, recetas, categorias,
// proveedores), los clientes y las cuentas financieras sobreviven -- pero su
// stock en cache vuelve a 0, porque era justo lo que sumaban los movimientos
// que se acaban de borrar: dejarlo como estaba seria mentir sobre cuanto hay.
export async function formatearMovimientos(tenantId) {
  await prisma.$transaction(async (tx) => {
    await tx.movimientoFinanciero.deleteMany({ where: { tenantId } })
    await tx.orderPayment.deleteMany({ where: { tenantId } })
    await tx.customerCharge.deleteMany({ where: { tenantId } })
    await tx.customerPayment.deleteMany({ where: { tenantId } })
    await tx.orderItem.deleteMany({ where: { tenantId } })
    await tx.stockMovement.deleteMany({ where: { tenantId } })
    await tx.insumoMovement.deleteMany({ where: { tenantId } })
    await tx.compraPago.deleteMany({ where: { tenantId } })
    await tx.compraItem.deleteMany({ where: { compra: { tenantId } } })
    await tx.traslado.deleteMany({ where: { tenantId } })
    await tx.order.deleteMany({ where: { tenantId } })
    await tx.compra.deleteMany({ where: { tenantId } })
    await tx.shiftExpense.deleteMany({ where: { tenantId } })
    await tx.shift.deleteMany({ where: { tenantId } })

    await tx.variant.updateMany({ where: { product: { tenantId } }, data: { stock: 0 } })
    await tx.insumo.updateMany({ where: { tenantId }, data: { stock: 0 } })
    await tx.barTable.updateMany({ where: { tenantId }, data: { status: 'AVAILABLE', groupId: null } })
    await tx.tenant.update({ where: { id: tenantId }, data: { lastInvoiceNumber: 0 } })
  })
}

// --- Formatear productos/insumos/recetas (selectivo) ------------------------
// A diferencia de los dos de arriba, esto SI puede toparse con un elemento
// que ya tiene una venta, una compra o una receta enganchada -- ahi es donde
// el operador elige: "conservar" (se saltan, solo se borra lo nunca usado) o
// "borrar" (se borran tambien, arrastrando en cascada la orden/compra
// COMPLETA que lo contenia -- no se puede sacar una sola linea de una cuenta
// ya cerrada sin desincronizar su total).

async function analizarProductosStock(client, tenantId) {
  const productos = await client.product.findMany({
    where: { tenantId, kind: 'STOCK' },
    select: { id: true, variants: { select: { id: true } } },
  })
  const productIds = productos.map((p) => p.id)
  const variantIds = productos.flatMap((p) => p.variants.map((v) => v.id))
  const variantAProducto = new Map(productos.flatMap((p) => p.variants.map((v) => [v.id, p.id])))
  if (productIds.length === 0) {
    return { productIds, conHistorial: new Set(), ordenesAfectadas: new Set(), comprasAfectadas: new Set() }
  }

  const [itemsOrden, compraItems, recipeItems] = await Promise.all([
    client.orderItem.findMany({
      where: { tenantId, OR: [{ productId: { in: productIds } }, { variantId: { in: variantIds } }] },
      select: { productId: true, variantId: true, orderId: true },
    }),
    client.compraItem.findMany({ where: { variantId: { in: variantIds } }, select: { variantId: true, compraId: true } }),
    client.recipeItem.findMany({
      where: { OR: [{ variantId: { in: variantIds } }, { sourceProductId: { in: productIds } }] },
      select: { variantId: true, sourceProductId: true },
    }),
  ])

  const conHistorial = new Set()
  const ordenesAfectadas = new Set()
  const comprasAfectadas = new Set()
  for (const it of itemsOrden) {
    const pid = it.productId || variantAProducto.get(it.variantId)
    if (pid) conHistorial.add(pid)
    ordenesAfectadas.add(it.orderId)
  }
  for (const it of compraItems) {
    const pid = variantAProducto.get(it.variantId)
    if (pid) conHistorial.add(pid)
    comprasAfectadas.add(it.compraId)
  }
  for (const it of recipeItems) {
    const pid = it.sourceProductId || variantAProducto.get(it.variantId)
    if (pid) conHistorial.add(pid)
  }

  return { productIds, variantAProducto, conHistorial, ordenesAfectadas, comprasAfectadas }
}

async function analizarInsumos(client, tenantId) {
  const insumos = await client.insumo.findMany({ where: { tenantId }, select: { id: true } })
  const insumoIds = insumos.map((i) => i.id)
  if (insumoIds.length === 0) {
    return { insumoIds, conHistorial: new Set(), comprasAfectadas: new Set() }
  }

  const [movimientos, compraItems, recipeItems] = await Promise.all([
    client.insumoMovement.findMany({ where: { insumoId: { in: insumoIds } }, select: { insumoId: true } }),
    client.compraItem.findMany({ where: { insumoId: { in: insumoIds } }, select: { insumoId: true, compraId: true } }),
    client.recipeItem.findMany({ where: { insumoId: { in: insumoIds } }, select: { insumoId: true } }),
  ])

  const conHistorial = new Set([
    ...movimientos.map((m) => m.insumoId),
    ...compraItems.map((c) => c.insumoId),
    ...recipeItems.map((r) => r.insumoId),
  ])
  const comprasAfectadas = new Set(compraItems.map((c) => c.compraId))

  return { insumoIds, conHistorial, comprasAfectadas }
}

async function analizarRecetas(client, tenantId) {
  const recetas = await client.product.findMany({ where: { tenantId, kind: 'PREPARED' }, select: { id: true } })
  const productIds = recetas.map((r) => r.id)
  if (productIds.length === 0) {
    return { productIds, conHistorial: new Set(), ordenesAfectadas: new Set() }
  }

  const [itemsVendidos, usadaComoIngrediente] = await Promise.all([
    client.orderItem.findMany({ where: { tenantId, productId: { in: productIds } }, select: { productId: true, orderId: true } }),
    client.recipeItem.findMany({ where: { sourceProductId: { in: productIds } }, select: { sourceProductId: true } }),
  ])

  const conHistorial = new Set([
    ...itemsVendidos.map((i) => i.productId),
    ...usadaComoIngrediente.map((i) => i.sourceProductId),
  ])
  const ordenesAfectadas = new Set(itemsVendidos.map((i) => i.orderId))

  return { productIds, conHistorial, ordenesAfectadas }
}

function resumen(ids, analisis, extra = {}) {
  return {
    total: ids.length,
    libres: ids.length - analisis.conHistorial.size,
    conHistorial: analisis.conHistorial.size,
    ...extra,
  }
}

export async function previsualizarFormateoProductos(tenantId, { productos, insumos, recetas }) {
  const resultado = {}
  if (productos) {
    const a = await analizarProductosStock(prisma, tenantId)
    resultado.productos = resumen(a.productIds, a, {
      ordenesAfectadas: a.ordenesAfectadas.size,
      comprasAfectadas: a.comprasAfectadas.size,
    })
  }
  if (insumos) {
    const a = await analizarInsumos(prisma, tenantId)
    resultado.insumos = resumen(a.insumoIds, a, { comprasAfectadas: a.comprasAfectadas.size })
  }
  if (recetas) {
    const a = await analizarRecetas(prisma, tenantId)
    resultado.recetas = resumen(a.productIds, a, { ordenesAfectadas: a.ordenesAfectadas.size })
  }
  return resultado
}

async function borrarOrdenesCompletas(tx, ordenIds) {
  if (ordenIds.length === 0) return
  await tx.orderPayment.deleteMany({ where: { orderId: { in: ordenIds } } })
  await tx.customerCharge.deleteMany({ where: { orderId: { in: ordenIds } } })
  await tx.orderItem.deleteMany({ where: { orderId: { in: ordenIds } } })
  await tx.order.deleteMany({ where: { id: { in: ordenIds } } })
}

async function borrarComprasCompletas(tx, compraIds) {
  if (compraIds.length === 0) return
  await tx.stockMovement.deleteMany({ where: { compraItem: { compraId: { in: compraIds } } } })
  await tx.insumoMovement.deleteMany({ where: { compraItem: { compraId: { in: compraIds } } } })
  await tx.compraPago.deleteMany({ where: { compraId: { in: compraIds } } })
  await tx.compraItem.deleteMany({ where: { compraId: { in: compraIds } } })
  await tx.compra.deleteMany({ where: { id: { in: compraIds } } })
}

async function borrarProductosStock(tx, tenantId, modo) {
  const a = await analizarProductosStock(tx, tenantId)
  if (a.productIds.length === 0) return

  let idsABorrar
  if (modo === 'conservar') {
    idsABorrar = a.productIds.filter((id) => !a.conHistorial.has(id))
  } else {
    idsABorrar = a.productIds
    await borrarOrdenesCompletas(tx, [...a.ordenesAfectadas])
    await borrarComprasCompletas(tx, [...a.comprasAfectadas])
  }

  await tx.recipeItem.deleteMany({
    where: { OR: [{ variant: { productId: { in: idsABorrar } } }, { sourceProductId: { in: idsABorrar } }] },
  })
  await tx.stockMovement.deleteMany({ where: { variant: { productId: { in: idsABorrar } } } })
  await tx.orderItem.deleteMany({ where: { productId: { in: idsABorrar } } })
  await tx.variant.deleteMany({ where: { productId: { in: idsABorrar } } })
  await tx.product.deleteMany({ where: { id: { in: idsABorrar } } })
}

async function borrarInsumos(tx, tenantId, modo) {
  const a = await analizarInsumos(tx, tenantId)
  if (a.insumoIds.length === 0) return

  let idsABorrar
  if (modo === 'conservar') {
    idsABorrar = a.insumoIds.filter((id) => !a.conHistorial.has(id))
  } else {
    idsABorrar = a.insumoIds
    await borrarComprasCompletas(tx, [...a.comprasAfectadas])
  }

  await tx.recipeItem.deleteMany({ where: { insumoId: { in: idsABorrar } } })
  await tx.insumoMovement.deleteMany({ where: { insumoId: { in: idsABorrar } } })
  await tx.listaCompraItem.deleteMany({ where: { insumoId: { in: idsABorrar } } })
  await tx.insumo.deleteMany({ where: { id: { in: idsABorrar } } })
}

async function borrarRecetas(tx, tenantId, modo) {
  const a = await analizarRecetas(tx, tenantId)
  if (a.productIds.length === 0) return

  let idsABorrar
  if (modo === 'conservar') {
    idsABorrar = a.productIds.filter((id) => !a.conHistorial.has(id))
  } else {
    idsABorrar = a.productIds
    await borrarOrdenesCompletas(tx, [...a.ordenesAfectadas])
  }

  await tx.recipeItem.deleteMany({
    where: { OR: [{ recipe: { productId: { in: idsABorrar } } }, { sourceProductId: { in: idsABorrar } }] },
  })
  await tx.recipe.deleteMany({ where: { productId: { in: idsABorrar } } })
  await tx.orderItem.deleteMany({ where: { productId: { in: idsABorrar } } })
  await tx.product.deleteMany({ where: { id: { in: idsABorrar } } })
}

export async function ejecutarFormateoProductos(tenantId, { productos, insumos, recetas, modo }) {
  await prisma.$transaction(
    async (tx) => {
      if (productos) await borrarProductosStock(tx, tenantId, modo)
      if (insumos) await borrarInsumos(tx, tenantId, modo)
      if (recetas) await borrarRecetas(tx, tenantId, modo)
    },
    { timeout: 30_000 }
  )
}
