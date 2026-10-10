/** Arma el arbol de categorias (2 niveles: padre > hija) a partir de la lista plana. */
export function categoryTree(categories) {
  const byParent = {}
  categories.forEach((c) => {
    const key = c.parentId || 'root'
    ;(byParent[key] ||= []).push(c)
  })
  const sortFn = (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
  function build(parentId) {
    return (byParent[parentId || 'root'] || []).sort(sortFn).map((c) => ({ ...c, children: build(c.id) }))
  }
  return build(null)
}

/** Aplana el arbol para un <select>, conservando la profundidad para indentar. */
export function flattenCategories(tree, depth = 0) {
  return tree.flatMap((c) => [{ ...c, depth }, ...flattenCategories(c.children, depth + 1)])
}
