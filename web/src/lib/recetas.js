// Disponibilidad de una receta con ingredientes que tienen stock propio
// (presentacion por unidad, ej. pan de molde, o insumo, ej. cebolla/queso):
// cuantas veces se puede armar con el stock actual, limitado por el
// ingrediente que se acabe primero. Null si la receta no tiene ningun
// ingrediente con stock (solo ml, o ninguno todavia) -- ahi no hay nada que
// contar, a diferencia de ml (que ademas ni tiene stock propio: ver
// CLAUDE.md, OpenContainer no existe todavia).
export function unidadesDisponibles(recipeItems) {
  const conStock = (recipeItems || []).filter((i) => (i.variantId || i.insumoId) && i.qty)
  if (!conStock.length) return null
  return Math.min(
    ...conStock.map((i) => Math.floor((Number(i.variantId ? i.variant?.stock : i.insumo?.stock) || 0) / i.qty))
  )
}
