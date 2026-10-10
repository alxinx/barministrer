import { useEffect, useMemo, useState } from 'react'
import { api, money } from '../lib/api'
import { categoryTree } from '../lib/categories'
import { Icon } from '../components/Icons'
import ProductoForm from '../components/ProductoForm'

export default function Productos() {
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [filter, setFilter] = useState('')
  const [search, setSearch] = useState('')
  const [target, setTarget] = useState(undefined) // undefined = cerrado, null = nuevo, producto = editar

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const [p, c] = await Promise.all([api('/products'), api('/categories')])
    setProducts(p)
    setCategories(c)
  }

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return products
      .filter((p) => !filter || p.categoryId === filter)
      .filter((p) => !term || p.name.toLowerCase().includes(term))
  }, [products, filter, search])

  // El catalogo se distribuye por categoria (2 niveles: padre > hija), en el
  // mismo orden que ya definio el dueno al crearlas. Una categoria sin
  // productos visibles no ocupa espacio.
  const groups = useMemo(() => {
    function sections(nodes, depth = 0) {
      return nodes.flatMap((c) => [
        { category: c, depth, items: visible.filter((p) => p.categoryId === c.id) },
        ...sections(c.children, depth + 1),
      ])
    }
    return sections(categoryTree(categories)).filter((s) => s.items.length)
  }, [categories, visible])

  async function alternar(product) {
    await api(`/products/${product.id}`, { method: 'PATCH', body: { active: !product.active } })
    load()
  }

  function cerrar() {
    setTarget(undefined)
  }
  function guardado() {
    cerrar()
    load()
  }

  return (
    <div className="p-5 md:p-7 max-w-[1500px] mx-auto">
      <header className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-bold">Productos</h1>
          <p className="text-muted text-sm mt-1">
            Cada producto vive en una categoría. Desactivar la categoría oculta sus productos sin
            perder el estado de cada uno.
          </p>
        </div>
        <button onClick={() => setTarget(null)} className="btn-primary">
          <Icon.plus />
          Nuevo producto
        </button>
      </header>

      <div className="flex gap-3 flex-wrap mb-5">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
            <Icon.search />
          </span>
          <input
            className="field pl-10"
            placeholder="Buscar producto"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="flex gap-2 flex-wrap mb-5">
        <button
          onClick={() => setFilter('')}
          className={`h-10 px-4 rounded-xl text-sm font-semibold border transition-colors ${
            !filter ? 'bg-amber text-night border-amber' : 'bg-surface text-muted border-edge'
          }`}
        >
          Todas
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setFilter(c.id)}
            className={`flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-semibold border transition-colors ${
              filter === c.id
                ? 'bg-amber text-night border-amber'
                : 'bg-surface text-muted border-edge hover:text-ink'
            } ${c.active ? '' : 'opacity-50'}`}
          >
            <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
            {c.name}
            {c.allowsPour && <span className="text-[10px] font-bold opacity-70">ml</span>}
          </button>
        ))}
      </div>

      <div className="space-y-6">
        {groups.map(({ category: c, depth, items }) => (
          <section key={c.id}>
            <div className="flex items-center gap-2 mb-2.5" style={{ paddingLeft: depth * 20 }}>
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} />
              <h2 className="font-semibold">{c.name}</h2>
              {c.allowsPour && (
                <span className="text-[10px] font-bold text-muted border border-edge rounded-pill px-1.5 py-0.5">
                  vende por ml
                </span>
              )}
              <span className="text-muted text-sm">{items.length}</span>
              {!c.active && <span className="text-xs text-muted">· categoría desactivada</span>}
            </div>

            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <tbody>
                  {items.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => setTarget(p)}
                      className="border-b border-edge/60 last:border-0 cursor-pointer hover:bg-raised/60"
                    >
                      <td className="px-4 py-3 w-[45%]">
                        <div className="flex items-center gap-3">
                          <span
                            className="w-9 h-9 rounded-lg shrink-0 grid place-items-center text-[11px] font-bold text-night"
                            style={{ background: c.color }}
                          >
                            {p.name.slice(0, 2).toUpperCase()}
                          </span>
                          <span className="font-medium flex items-center gap-1.5">
                            {p.name}
                            {p.kind === 'PREPARED' && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-muted border border-edge rounded-pill px-1.5 py-0.5">
                                <Icon.drop width={11} height={11} />
                                Shot
                              </span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {p.kind === 'PREPARED' ? (
                          <span className="inline-flex items-baseline gap-1.5 px-2.5 py-1 rounded-pill bg-raised border border-edge text-xs">
                            <span className="text-muted">
                              {p.recipe?.items
                                .map((i) => `${i.ml} ml de ${i.sourceProduct?.name}`)
                                .join(' + ')}
                            </span>
                            <span className="font-semibold">{money(p.recipe?.price)}</span>
                          </span>
                        ) : (
                          <div className="flex gap-1.5 flex-wrap">
                            {p.variants.map((v) => (
                              <span
                                key={v.id}
                                className="inline-flex items-baseline gap-1.5 px-2.5 py-1 rounded-pill
                                           bg-raised border border-edge text-xs"
                              >
                                <span className="text-muted">{v.name}</span>
                                <span className="font-semibold">{money(v.price)}</span>
                                <span className="text-muted">· {v.stock}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            alternar(p)
                          }}
                          className={`text-xs font-semibold px-3 py-1.5 rounded-pill border ${
                            p.available
                              ? 'text-libre border-libre/40 bg-libre/10'
                              : 'text-muted border-edge bg-raised'
                          }`}
                        >
                          {p.available ? 'Disponible' : p.active ? 'Categoría apagada' : 'Desactivado'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}

        {groups.length === 0 && (
          <p className="card px-4 py-10 text-center text-muted text-sm">No hay productos con ese filtro.</p>
        )}
      </div>

      {target !== undefined && (
        <ProductoForm
          categories={categories}
          products={products}
          product={target}
          onClose={cerrar}
          onSaved={guardado}
        />
      )}
    </div>
  )
}
