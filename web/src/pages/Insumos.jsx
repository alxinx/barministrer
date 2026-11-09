import { useEffect, useMemo, useState } from 'react'
import { api, money } from '../lib/api'
import { Icon } from '../components/Icons'
import InsumoForm from '../components/InsumoForm'

export default function Insumos() {
  const [insumos, setInsumos] = useState([])
  const [categorias, setCategorias] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [unidades, setUnidades] = useState([])
  const [filter, setFilter] = useState('')
  const [search, setSearch] = useState('')
  const [target, setTarget] = useState(undefined) // undefined = cerrado, null = nuevo, insumo = editar

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const [i, c, p, u] = await Promise.all([
      api('/insumos'),
      api('/insumo-categorias'),
      api('/proveedores'),
      api('/insumos/unidades'),
    ])
    setInsumos(i)
    setCategorias(c)
    setProveedores(p)
    setUnidades(u)
  }

  const visibles = useMemo(() => {
    const term = search.trim().toLowerCase()
    return insumos
      .filter((i) => !filter || i.categoriaId === filter)
      .filter((i) => !term || i.name.toLowerCase().includes(term))
  }, [insumos, filter, search])

  const nombreUnidad = (codigo) => unidades.find((u) => u.codigo === codigo)?.nombre.split(' ')[0] || codigo

  const grupos = useMemo(() => {
    return categorias
      .map((c) => ({ categoria: c, items: visibles.filter((i) => i.categoriaId === c.id) }))
      .filter((g) => g.items.length)
  }, [categorias, visibles])

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
          <p className="text-xs text-muted mb-1">Inventario &gt; Insumos</p>
          <h1 className="text-2xl font-bold">Insumos</h1>
          <p className="text-muted text-sm mt-1">
            Materia prima e ingredientes de tu negocio, en su propia categoría: nunca se mezclan con
            el catálogo de productos.
          </p>
        </div>
        <button onClick={() => setTarget(null)} className="btn-primary">
          <Icon.plus />
          Nuevo insumo
        </button>
      </header>

      <div className="flex flex-wrap gap-2 mb-6">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
            <Icon.search />
          </span>
          <input
            className="field pl-10"
            placeholder="Buscar insumo"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          onClick={() => setFilter('')}
          className={`h-10 px-3 rounded-xl text-sm font-medium border transition-colors ${
            !filter ? 'bg-amber text-night border-amber' : 'bg-raised text-muted border-edge hover:text-ink'
          }`}
        >
          Todas
        </button>
        {categorias.map((c) => (
          <button
            key={c.id}
            onClick={() => setFilter(c.id)}
            className={`h-10 px-3 rounded-xl text-sm font-medium border transition-colors ${
              filter === c.id ? 'bg-amber text-night border-amber' : 'bg-raised text-muted border-edge hover:text-ink'
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="space-y-8">
        {grupos.map(({ categoria: c, items }) => (
          <section key={c.id}>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="font-semibold">{c.name}</h2>
              <span className="text-muted text-sm">
                {items.length} {items.length === 1 ? 'insumo' : 'insumos'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {items.map((i) => {
                const agotado = i.stockMinimo != null && i.stock <= i.stockMinimo
                return (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => setTarget(i)}
                    className="card p-3 text-left flex flex-col gap-2.5 hover:border-amber/50 transition-colors"
                  >
                    <div className="aspect-square rounded-xl overflow-hidden grid place-items-center text-xl font-bold text-night shrink-0 bg-raised border border-edge">
                      {i.imageUrl ? (
                        <img src={i.imageUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Icon.box width={24} height={24} className="text-muted" />
                      )}
                    </div>

                    <div className="min-w-0">
                      <p className="font-medium text-sm leading-snug truncate">{i.name}</p>
                      <p className="text-xs text-muted truncate">
                        {i.stock} {nombreUnidad(i.unidadInventario)}
                        {i.proveedor ? ` · ${i.proveedor.name}` : ''}
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-2 mt-auto">
                      <span className="font-semibold text-sm">{money(i.costoCompra)}</span>
                      <span
                        className={`text-[10px] font-semibold px-2 py-1 rounded-pill border shrink-0 ${
                          !i.active
                            ? 'text-muted border-edge bg-raised'
                            : agotado
                              ? 'text-ocupada border-ocupada/40 bg-ocupada/10'
                              : 'text-libre border-libre/40 bg-libre/10'
                        }`}
                      >
                        {!i.active ? 'Desactivado' : agotado ? 'Stock bajo' : 'Disponible'}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </section>
        ))}

        {grupos.length === 0 && (
          <p className="card px-4 py-10 text-center text-muted text-sm">
            {insumos.length === 0 ? 'Todavía no hay insumos registrados.' : 'No hay insumos con ese filtro.'}
          </p>
        )}
      </div>

      {target !== undefined && (
        <InsumoForm
          insumo={target}
          categorias={categorias}
          proveedores={proveedores}
          unidades={unidades}
          onClose={cerrar}
          onSaved={guardado}
          onCategoriaCreada={(c) => setCategorias((prev) => [...prev, c])}
          onProveedorCreado={(p) => setProveedores((prev) => [...prev, p])}
        />
      )}
    </div>
  )
}
