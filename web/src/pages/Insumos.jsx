import { useEffect, useMemo, useState } from 'react'
import { api, money } from '../lib/api'
import { Icon } from '../components/Icons'
import InsumoForm from '../components/InsumoForm'

const CLAVE_VISTA = 'licorplus:insumosVista'

export default function Insumos() {
  const [insumos, setInsumos] = useState([])
  const [categorias, setCategorias] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [unidades, setUnidades] = useState([])
  const [filter, setFilter] = useState('')
  const [search, setSearch] = useState('')
  const [target, setTarget] = useState(undefined) // undefined = cerrado, null = nuevo, insumo = editar
  const [vista, setVista] = useState(() => {
    try {
      return localStorage.getItem(CLAVE_VISTA) === 'list' ? 'list' : 'grid'
    } catch {
      return 'grid'
    }
  })

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
  function cambiarVista(nuevaVista) {
    setVista(nuevaVista)
    try {
      localStorage.setItem(CLAVE_VISTA, nuevaVista)
    } catch {
      // La vista sigue funcionando aunque el navegador no permita guardar preferencias.
    }
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
        <div
          className="ml-auto flex items-center gap-0.5 border border-edge rounded-lg p-0.5 shrink-0"
          role="group"
          aria-label="Forma de ver los insumos"
        >
          <button
            type="button"
            onClick={() => cambiarVista('grid')}
            aria-label="Ver en cuadros"
            aria-pressed={vista === 'grid'}
            className={`w-9 h-9 rounded-md grid place-items-center ${
              vista === 'grid' ? 'bg-amber text-night' : 'text-muted hover:text-ink'
            }`}
          >
            <Icon.grid width={16} height={16} />
          </button>
          <button
            type="button"
            onClick={() => cambiarVista('list')}
            aria-label="Ver en lista"
            aria-pressed={vista === 'list'}
            className={`w-9 h-9 rounded-md grid place-items-center ${
              vista === 'list' ? 'bg-amber text-night' : 'text-muted hover:text-ink'
            }`}
          >
            <Icon.list width={16} height={16} />
          </button>
        </div>
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

            {vista === 'grid' ? (
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
                        <EstadoInsumo insumo={i} />
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="border-y border-edge overflow-x-auto">
                <table className="w-full min-w-[680px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted uppercase tracking-wide">
                      <th className="py-3 px-3 font-semibold">Insumo</th>
                      <th className="py-3 px-3 font-semibold text-right">Stock</th>
                      <th className="py-3 px-3 font-semibold">Proveedor</th>
                      <th className="py-3 px-3 font-semibold text-right">Costo de compra</th>
                      <th className="py-3 px-3 font-semibold">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.id} className="border-t border-edge hover:bg-raised/50 transition-colors">
                        <td className="py-2.5 px-3">
                          <button
                            type="button"
                            onClick={() => setTarget(i)}
                            aria-label={`Editar ${i.name}`}
                            className="flex items-center gap-3 text-left rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber"
                          >
                            <span className="w-10 h-10 rounded-lg overflow-hidden grid place-items-center bg-raised border border-edge shrink-0">
                              {i.imageUrl ? (
                                <img src={i.imageUrl} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <Icon.box width={18} height={18} className="text-muted" />
                              )}
                            </span>
                            <span className="font-medium text-ink">{i.name}</span>
                          </button>
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          {i.stock} {nombreUnidad(i.unidadInventario)}
                        </td>
                        <td className="py-2.5 px-3 text-muted">{i.proveedor?.name || '—'}</td>
                        <td className="py-2.5 px-3 text-right font-medium tabular-nums">{money(i.costoCompra)}</td>
                        <td className="py-2.5 px-3"><EstadoInsumo insumo={i} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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

function EstadoInsumo({ insumo }) {
  const agotado = insumo.stockMinimo != null && insumo.stock <= insumo.stockMinimo
  return (
    <span
      className={`text-[10px] font-semibold px-2 py-1 rounded-pill border shrink-0 ${
        !insumo.active
          ? 'text-muted border-edge bg-raised'
          : agotado
            ? 'text-ocupada border-ocupada/40 bg-ocupada/10'
            : 'text-libre border-libre/40 bg-libre/10'
      }`}
    >
      {!insumo.active ? 'Desactivado' : agotado ? 'Stock bajo' : 'Disponible'}
    </span>
  )
}
