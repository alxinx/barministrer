import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireRole } from '../middleware/auth.js'
import { calcularCostos, costoDeReceta } from '../lib/costos.js'
import { diaLocal, rangoUltimosDias, rangoEntreFechas, rangoValido } from '../lib/fechas.js'

export const reportRoutes = Router()
const soloAdmin = requireRole('ADMIN')

function clampDias(value) {
  return Math.min(365, Math.max(1, Number(value) || 30))
}

// El calendario de la UI manda un rango explicito (desde/hasta, YYYY-MM-DD)
// cuando el dueno elige "fecha a fecha" en vez de un pill de dias; si no
// viene un rango valido, se sigue calculando por cantidad de dias como
// siempre. Ningun reporte necesita saber cual de los dos eligio el usuario.
function resolverRango(req, timezone) {
  const { desde, hasta } = req.query
  if (rangoValido(desde, hasta)) return rangoEntreFechas(desde, hasta)
  return rangoUltimosDias(clampDias(req.query.days), timezone)
}

// Reporte de ventas: recaudado (plata que de verdad entro) contra utilidad
// (precio - costo - descuento de lo vendido, se haya cobrado ya o no) por
// dia, mas totales del periodo y que productos se mueven y cuales no.
reportRoutes.get('/reports/ventas', soloAdmin, async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.auth.tenantId }, select: { timezone: true } })
  const { etiquetas, desde, hasta } = resolverRango(req, tenant.timezone)

  const [ordenes, pagos, abonos, egresos, cargosCredito, pagosCredito, productosStock] = await Promise.all([
    prisma.order.findMany({
      where: { tenantId: req.auth.tenantId, status: 'CLOSED', closedAt: { gte: desde, lte: hasta } },
      select: { id: true, closedAt: true, isCourtesy: true, discountAmount: true, items: true },
    }),
    prisma.orderPayment.findMany({
      where: { tenantId: req.auth.tenantId, method: { not: 'CREDITO' }, createdAt: { gte: desde, lte: hasta } },
      select: { amount: true, method: true, createdAt: true },
    }),
    prisma.customerPayment.findMany({
      where: { tenantId: req.auth.tenantId, createdAt: { gte: desde, lte: hasta } },
      select: { amount: true, method: true, createdAt: true },
    }),
    prisma.shiftExpense.aggregate({
      where: { tenantId: req.auth.tenantId, createdAt: { gte: desde, lte: hasta } },
      _sum: { amount: true },
    }),
    prisma.customerCharge.aggregate({ where: { tenantId: req.auth.tenantId }, _sum: { amount: true } }),
    prisma.customerPayment.aggregate({ where: { tenantId: req.auth.tenantId }, _sum: { amount: true } }),
    prisma.product.findMany({
      where: { tenantId: req.auth.tenantId, kind: 'STOCK', active: true },
      select: { id: true, name: true, variants: { select: { stock: true } } },
    }),
  ])

  const todosLosItems = ordenes.flatMap((o) => o.items)
  const { porItem } = await calcularCostos(todosLosItems, req.auth.tenantId)

  // Un bucket por dia con, ademas de recaudado/utilidad, el costo de lo
  // vendido ese dia y cuanto entro por cada medio de pago: lo primero
  // alimenta la tercera linea de la grafica, lo segundo es la columna que
  // necesita el excel para el cuadre dia por dia. OTRO existe solo para que
  // la suma de medios de pago nunca quede por debajo de recaudado: un abono
  // de antes de que el medio de pago fuera obligatorio no tiene a donde ir.
  const porDia = new Map(
    etiquetas.map((e) => [
      e,
      { date: e, recaudado: 0, utilidad: 0, costo: 0, EFECTIVO: 0, NEQUI: 0, TRANSFERENCIA: 0, DATAFONO: 0, OTRO: 0 },
    ])
  )
  const ventaPorProducto = new Map() // productId -> { name, qty }
  let vendidoTotal = 0

  for (const o of ordenes) {
    const etiqueta = diaLocal(o.closedAt, tenant.timezone)
    const bucket = porDia.get(etiqueta)
    if (!bucket || o.isCourtesy) continue // cortesia no es una venta real, ya queda como gasto

    const activos = o.items.filter((i) => i.status === 'ACTIVE')
    const vendidoOrden = activos.reduce((s, i) => s + Number(i.price) * i.qty, 0)
    const costoOrden = activos.reduce((s, i) => s + (porItem.get(i.id) || 0), 0)
    const descuento = Number(o.discountAmount) || 0

    bucket.utilidad += vendidoOrden - costoOrden - descuento
    bucket.costo += costoOrden
    vendidoTotal += vendidoOrden - descuento

    for (const i of activos) {
      if (!i.productId) continue
      const prev = ventaPorProducto.get(i.productId)
      ventaPorProducto.set(i.productId, { name: i.name, qty: (prev?.qty || 0) + i.qty })
    }
  }

  for (const p of pagos) {
    const bucket = porDia.get(diaLocal(p.createdAt, tenant.timezone))
    if (!bucket) continue
    bucket.recaudado += Number(p.amount)
    bucket[bucket[p.method] !== undefined ? p.method : 'OTRO'] += Number(p.amount)
  }
  for (const a of abonos) {
    const bucket = porDia.get(diaLocal(a.createdAt, tenant.timezone))
    if (!bucket) continue
    bucket.recaudado += Number(a.amount)
    bucket[a.method && bucket[a.method] !== undefined ? a.method : 'OTRO'] += Number(a.amount)
  }

  const serie = etiquetas.map((e) => porDia.get(e))
  const utilidadTotal = serie.reduce((s, d) => s + d.utilidad, 0)
  const pendienteCredito = Number(cargosCredito._sum.amount || 0) - Number(pagosCredito._sum.amount || 0)

  const masVendidos = [...ventaPorProducto.entries()]
    .map(([productId, v]) => ({ productId, name: v.name, qty: v.qty }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10)

  const masQuedados = productosStock
    .map((p) => ({
      productId: p.id,
      name: p.name,
      qty: ventaPorProducto.get(p.id)?.qty || 0,
      stock: p.variants.reduce((s, v) => s + v.stock, 0),
    }))
    .sort((a, b) => a.qty - b.qty)
    .slice(0, 10)

  res.json({
    days: etiquetas.length,
    serie,
    totales: {
      vendido: vendidoTotal,
      pendienteCredito,
      utilidad: utilidadTotal,
      egresos: Number(egresos._sum.amount || 0),
    },
    masVendidos,
    masQuedados,
  })
})

// Utilidad por producto: margen de catalogo (precio - costo, tal como esta
// configurado hoy) junto con lo que de verdad dejo cada uno en el periodo
// (cantidad vendida y utilidad ya con su parte del descuento, la misma que
// quedo congelada en OrderItem.discountAmount al cerrar la cuenta). Una
// presentacion sellada es su propia fila (cada una tiene su propio
// precio/costo); un shot/coctel es una fila por producto, porque su receta
// tiene un solo precio. Solo catalogo activo: un producto desactivado no
// aporta nada a una decision de precios hacia adelante.
reportRoutes.get('/reports/utilidad-producto', soloAdmin, async (req, res) => {
  const tenantId = req.auth.tenantId
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } })
  const { etiquetas, desde, hasta } = resolverRango(req, tenant.timezone)

  const [variantes, preparados, ordenes] = await Promise.all([
    prisma.variant.findMany({
      where: { active: true, product: { tenantId, active: true, kind: 'STOCK' } },
      include: { product: { include: { category: { select: { name: true, color: true } } } } },
    }),
    prisma.product.findMany({
      where: { tenantId, active: true, kind: 'PREPARED' },
      include: {
        category: { select: { name: true, color: true } },
        recipe: { include: { items: { include: { sourceProduct: { include: { variants: true } }, variant: true } } } },
      },
    }),
    prisma.order.findMany({
      where: { tenantId, status: 'CLOSED', isCourtesy: false, closedAt: { gte: desde, lte: hasta } },
      select: { items: true },
    }),
  ])

  const todosLosItems = ordenes.flatMap((o) => o.items)
  const { porItem } = await calcularCostos(todosLosItems, tenantId)

  // Se agrupa por la misma llave que ya distingue una presentacion de una
  // receta en todo el resto del sistema: variantId si lo tiene, si no el
  // productId (shot/coctel).
  const porClave = new Map()
  for (const item of todosLosItems) {
    if (item.status !== 'ACTIVE') continue
    const clave = item.variantId || `receta:${item.productId}`
    const prev = porClave.get(clave) || { qty: 0, utilidad: 0 }
    const costoLinea = porItem.get(item.id) || 0
    const utilidadLinea = Number(item.price) * item.qty - costoLinea - Number(item.discountAmount || 0)
    porClave.set(clave, { qty: prev.qty + item.qty, utilidad: prev.utilidad + utilidadLinea })
  }

  function filaDe(clave, { name, categoryName, categoryColor, imageUrl, kind, precio, costo }) {
    const agg = porClave.get(clave) || { qty: 0, utilidad: 0 }
    return {
      id: clave,
      name,
      categoryName,
      categoryColor,
      imageUrl,
      kind,
      precio,
      costo,
      margenUnitario: precio - costo,
      margenPct: precio > 0 ? ((precio - costo) / precio) * 100 : 0,
      qtyVendida: agg.qty,
      utilidadPeriodo: agg.utilidad,
    }
  }

  const productos = [
    ...variantes.map((v) =>
      filaDe(v.id, {
        name: `${v.product.name} · ${v.name}`,
        categoryName: v.product.category.name,
        categoryColor: v.product.category.color,
        imageUrl: v.product.imageUrl,
        kind: 'STOCK',
        precio: Number(v.price),
        costo: Number(v.cost),
      })
    ),
    ...preparados.map((p) =>
      filaDe(`receta:${p.id}`, {
        name: p.name,
        categoryName: p.category.name,
        categoryColor: p.category.color,
        imageUrl: p.imageUrl,
        kind: 'PREPARED',
        precio: Number(p.recipe?.price || 0),
        costo: costoDeReceta(p.recipe?.items),
      })
    ),
  ].sort((a, b) => b.utilidadPeriodo - a.utilidadPeriodo)

  res.json({ days: etiquetas.length, productos })
})
