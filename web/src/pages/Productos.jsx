import { useEffect, useMemo, useState } from 'react'
import { api, money } from '../lib/api'
import { categoryTree } from '../lib/categories'
import { useAuth } from '../context/AuthContext'
import { Icon } from '../components/Icons'
import ProductoForm from '../components/ProductoForm'
import CategoriaForm from '../components/CategoriaForm'

export default function Productos() {
  const { session } = useAuth()
  const isAdmin =
    session?.user.role === 'ADMIN' ||
    (session?.user.role === 'CAJERO' && session?.tenant.cajeroEditaCatalogo)
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [filter, setFilter] = useState('')
  const [search, setSearch] = useState('')
  const [target, setTarget] = useState(undefined) // undefined = cerrado, null = nuevo, producto = editar
  const [categoryTarget, setCategoryTarget] = useState(undefined) // idem, para categorias

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
  // productos visibles no ocupa espacio. Cada variante es una tarjeta propia
  // (una presentacion sellada = un precio propio); un shot es una sola
  // tarjeta porque su receta tiene un unico precio.
  const groups = useMemo(() => {
    function sections(nodes, depth = 0) {
      return nodes.flatMap((c) => {
        const products = visible.filter((p) => p.categoryId === c.id)
        const cards = products.flatMap((p) =>
          p.kind === 'PREPARED' ? [{ product: p, variant: null }] : p.variants.map((v) => ({ product: p, variant: v }))
        )
        return [{ category: c, depth, cards }, ...sections(c.children, depth + 1)]
      })
    }
    return sections(categoryTree(categories)).filter((s) => s.cards.length)
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

  function cerrarCategoria() {
    setCategoryTarget(undefined)
  }
  function categoriaGuardada() {
    cerrarCategoria()
    setFilter('')
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
            {isAdmin && (
              <span
                role="button"
                aria-label={`Editar categoría ${c.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setCategoryTarget(c)
                }}
                className="opacity-60 hover:opacity-100"
              >
                <Icon.gear width={13} height={13} />
              </span>
            )}
          </button>
        ))}
        {isAdmin && (
          <button
            onClick={() => setCategoryTarget(null)}
            aria-label="Nueva categoría"
            className="flex items-center gap-1.5 h-10 px-4 rounded-xl text-sm font-semibold
                       border border-dashed border-edge text-muted hover:text-ink hover:border-muted"
          >
            <Icon.plus width={14} height={14} />
            Categoría
          </button>
        )}
      </div>

      <div className="space-y-8">
        {groups.map(({ category: c, depth, cards }) => (
          <section key={c.id}>
            <div className="flex items-center gap-2 mb-3" style={{ paddingLeft: depth * 20 }}>
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} />
              <h2 className="font-semibold">{c.name}</h2>
              {c.allowsPour && (
                <span className="text-[10px] font-bold text-muted border border-edge rounded-pill px-1.5 py-0.5">
                  vende por ml
                </span>
              )}
              <span className="text-muted text-sm">
                {cards.length} {cards.length === 1 ? 'producto' : 'productos'}
              </span>
              {!c.active && <span className="text-xs text-muted">· categoría desactivada</span>}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {cards.map(({ product: p, variant: v }) => {
                const available = v ? p.available && v.active : p.available
                const price = v ? v.price : p.recipe?.price
                const subtitle = v
                  ? `${v.name}${v.volumeMl ? ` · ${v.volumeMl} ml` : ''}`
                  : p.recipe?.items.map((i) => `${i.ml} ml de ${i.sourceProduct?.name}`).join(' + ')

                return (
                  <button
                    key={v ? v.id : p.id}
                    type="button"
                    onClick={() => setTarget(p)}
                    className="card p-3 text-left flex flex-col gap-2.5 hover:border-amber/50 transition-colors"
                  >
                    <div
                      className="aspect-square rounded-xl overflow-hidden grid place-items-center text-xl font-bold text-night shrink-0"
                      style={{ background: c.color }}
                    >
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        p.name.slice(0, 2).toUpperCase()
                      )}
                    </div>

                    <div className="min-w-0">
                      <p className="font-medium text-sm leading-snug flex items-center gap-1.5">
                        <span className="truncate">{p.name}</span>
                        {p.kind === 'PREPARED' && <Icon.drop width={12} height={12} className="text-muted shrink-0" />}
                      </p>
                      <p className="text-xs text-muted truncate">{subtitle}</p>
                    </div>

                    <div className="flex items-center justify-between gap-2 mt-auto">
                      <span className="font-semibold text-sm">{money(price)}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          alternar(p)
                        }}
                        className={`text-[10px] font-semibold px-2 py-1 rounded-pill border shrink-0 ${
                          available ? 'text-libre border-libre/40 bg-libre/10' : 'text-muted border-edge bg-raised'
                        }`}
                      >
                        {available ? 'Disponible' : p.active ? 'Categoría apagada' : 'Desactivado'}
                      </button>
                    </div>
                  </button>
                )
              })}
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

      {categoryTarget !== undefined && (
        <CategoriaForm
          categories={categories}
          category={categoryTarget}
          onClose={cerrarCategoria}
          onSaved={categoriaGuardada}
        />
      )}
    </div>
  )
}
