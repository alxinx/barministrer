import { prisma } from './prisma.js'

// Costo de una receta (shot/coctel) a partir de sus ingredientes: ml de un
// producto que se vende por botella (promedio de costo-por-ml entre sus
// presentaciones, porque la receta no amarra a una presentacion puntual) o
// unidades de una presentacion sellada. Se usa tanto para costear una venta
// ya hecha como para mostrar el costo actual del catalogo en el reporte de
// utilidad por producto, aunque nunca se haya vendido.
export function costoDeReceta(recipeItems) {
  let costo = 0
  for (const ing of recipeItems || []) {
    if (ing.variantId) {
      costo += Number(ing.variant?.cost || 0) * (ing.qty || 1)
    } else if (ing.sourceProductId && ing.ml) {
      const candidatas = (ing.sourceProduct?.variants || []).filter((v) => v.volumeMl && Number(v.cost) > 0)
      const costoPorMl = candidatas.length
        ? candidatas.reduce((s, v) => s + Number(v.cost) / v.volumeMl, 0) / candidatas.length
        : 0
      costo += costoPorMl * ing.ml
    }
  }
  return costo
}

// Costo de cada linea activa de un pedido (o de muchos pedidos a la vez: el
// reporte de ventas pasa items de varios dias juntos para ahorrarse una
// consulta por pedido). Una presentacion sellada (variantId) usa su propio
// costo; un shot/coctel (productId sin variantId) no tiene costo propio, se
// deriva de su receta: ml de un producto que se vende por botella (promedio
// de costo-por-ml entre sus presentaciones, porque la receta no amarra a una
// presentacion puntual) o unidades de una presentacion sellada. Si el costo
// nunca se registro en el catalogo, queda en 0 (margen = precio completo):
// un descuento repartido por utilidad va a cargarle mas a ese producto, y un
// reporte de utilidad va a sobreestimarla, hasta que alguien le ponga costo
// real en /productos.
export async function calcularCostos(items, tenantId) {
  const activos = items.filter((i) => i.status === 'ACTIVE')
  const variantIds = [...new Set(activos.filter((i) => i.variantId).map((i) => i.variantId))]
  const recipeProductIds = [...new Set(activos.filter((i) => !i.variantId && i.productId).map((i) => i.productId))]

  const variants = variantIds.length ? await prisma.variant.findMany({ where: { id: { in: variantIds } } }) : []
  const costoVariante = new Map(variants.map((v) => [v.id, Number(v.cost)]))

  const costoReceta = new Map()
  if (recipeProductIds.length) {
    const productos = await prisma.product.findMany({
      where: { id: { in: recipeProductIds }, tenantId },
      include: {
        recipe: {
          include: {
            items: { include: { sourceProduct: { include: { variants: true } }, variant: true } },
          },
        },
      },
    })
    for (const p of productos) {
      costoReceta.set(p.id, costoDeReceta(p.recipe?.items))
    }
  }

  const porItem = new Map()
  let total = 0
  for (const item of activos) {
    const unitario = item.variantId ? costoVariante.get(item.variantId) ?? 0 : costoReceta.get(item.productId) ?? 0
    const linea = unitario * item.qty
    porItem.set(item.id, linea)
    total += linea
  }
  return { total, porItem }
}
