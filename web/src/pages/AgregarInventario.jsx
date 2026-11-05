import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { getCategories } from '../lib/categoriesStore'
import { useAuth } from '../context/AuthContext'
import { getSocket } from '../lib/socket'
import { Icon } from '../components/Icons'
import ProductoForm from '../components/ProductoForm'

const CLAVE_VISTA = 'licorplus:inventarioVista'

export default function AgregarInventario() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [ultimaCompra, setUltimaCompra] = useState(null)
  const [listaCompra, setListaCompra] = useState([])
  const [categoriaActiva, setCategoriaActiva] = useState('todas') // 'todas' | 'criticos' | nombre de categoria
  const [search, setSearch] = useState('')
  const [movements, setMovements] = useState([])
  const [creando, setCreando] = useState(false)
  // Preferencia del operador, no un dato del negocio -- se guarda local nada
  // mas, igual que el colapso del menu (ver Shell.jsx).
  const [vista, setVista] = useState(() => {
    try {
      return localStorage.getItem(CLAVE_VISTA) === 'list' ? 'list' : 'grid'
    } catch {
      return 'grid'
    }
  })
  function cambiarVista(v) {
    setVista(v)
    try {
      localStorage.setItem(CLAVE_VISTA, v)
    } catch {
      // Sin localStorage (modo privado, etc.) simplemente no persiste.
    }
  }

  useEffect(() => {
    load()
  }, [])

  // El stock cambia desde sitios que no son esta pantalla (una venta, una
  // compra recibida desde /compras, una merma) -- sin esto, las tarjetas de
  // stock bajo/critico quedarian desactualizadas hasta que el operador
  // refresque a mano. Mismo patron que NuevaVenta.jsx ya usa para
  // 'mesas:actualizadas'.
  useEffect(() => {
    const socket = getSocket()
    const onInventarioActualizado = () => load()
    socket.on('inventario:actualizado', onInventarioActualizado)
    return () => socket.off('inventario:actualizado', onInventarioActualizado)
  }, [])

  async function load() {
    const [p, c, m] = await Promise.all([api('/products'), getCategories(session?.tenant.id), api('/inventory/movements')])
    setProducts(p)
    setCategories(c)
    setMovements(m)

    // El modulo de Compras puede estar apagado para este tenant (no todos lo
    // tienen activado) -- a diferencia de lo de arriba, que siempre existe,
    // esto se pide aparte y se degrada en silencio si no esta disponible, en
    // vez de romper toda la pagina de inventario por algo opcional.
    try {
      const [compras, lista] = await Promise.all([api('/compras?filtro=RECIBIDA'), api('/compras/lista')])
      setUltimaCompra(compras.items?.[0] || null)
      setListaCompra(lista)
    } catch {
      setUltimaCompra(null)
      setListaCompra([])
    }
  }

  function productoCreado() {
    setCreando(false)
    setSearch('')
    load()
  }

  // Cada presentacion (Variant) es su propia fila -- Media, Botella y
  // Garrafa del mismo licor tienen stock propio, no son el mismo renglon.
  const presentaciones = useMemo(
    () =>
      products
        .filter((p) => p.kind === 'STOCK')
        .flatMap((p) => p.variants.filter((v) => v.active).map((v) => ({ product: p, variant: v }))),
    [products]
  )

  // "Critico" es 0 o menos, siempre -- un producto agotado lo esta sin
  // importar si alguien configuro un minimo o no, por eso no depende de
  // stockMinimo. "Stock bajo" es el resto de la regla que ya usa
  // Insumo.stockMinimo (null = nunca se configuro, no avisa) MAS los
  // agotados: un agotado es "bajo" por definicion, aunque nadie le haya
  // puesto mínimo todavía.
  const criticos = useMemo(() => presentaciones.filter(({ variant }) => variant.stock <= 0), [presentaciones])
  const stockBajo = useMemo(() => {
    const bajoConfigurado = presentaciones.filter(
      ({ variant }) => variant.stock > 0 && variant.stockMinimo != null && variant.stock <= variant.stockMinimo
    )
    return [...criticos, ...bajoConfigurado]
  }, [presentaciones, criticos])
  const criticosSet = useMemo(() => new Set(criticos.map(({ variant }) => variant.id)), [criticos])
  const stockBajoSet = useMemo(() => new Set(stockBajo.map(({ variant }) => variant.id)), [stockBajo])

  const categoriasConConteo = useMemo(() => {
    const porCategoria = new Map()
    for (const { product } of presentaciones) {
      const nombre = product.category?.name || 'Sin categoría'
      porCategoria.set(nombre, (porCategoria.get(nombre) || 0) + 1)
    }
    return [...porCategoria.entries()].sort((a, b) => b[1] - a[1])
  }, [presentaciones])

  const enListaVariantSet = useMemo(
    () => new Set(listaCompra.filter((it) => it.variantId).map((it) => it.variantId)),
    [listaCompra]
  )

  async function toggleListaProducto(variantId) {
    const yaEstaba = enListaVariantSet.has(variantId)
    if (yaEstaba) {
      setListaCompra((prev) => prev.filter((it) => it.variantId !== variantId))
      try {
        await api(`/compras/lista/producto/${variantId}`, { method: 'DELETE' })
      } catch {
        await load()
      }
    } else {
      setListaCompra((prev) => [...prev, { variantId }])
      try {
        await api(`/compras/lista/producto/${variantId}`, { method: 'POST' })
      } catch {
        await load()
      }
    }
  }

  // Un solo grid para todo el catalogo -- la tab de categoria y el filtro de
  // "Criticos" son excluyentes entre si (elegir uno limpia el otro), mismo
  // criterio que cualquier fila de pills de un solo filtro activo.
  const visibles = useMemo(() => {
    const term = search.trim().toLowerCase()
    let base = presentaciones
    if (categoriaActiva === 'criticos') base = criticos
    else if (categoriaActiva !== 'todas') base = presentaciones.filter((o) => (o.product.category?.name || 'Sin categoría') === categoriaActiva)
    return base.filter(
      (o) => !term || o.product.name.toLowerCase().includes(term) || o.variant.name.toLowerCase().includes(term)
    )
  }, [presentaciones, criticos, search, categoriaActiva])

  return (
    <div className="p-5 md:p-7 max-w-[1200px] mx-auto space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Inventario de productos</h1>
          <p className="text-muted text-sm mt-1">
            Stock de lo que se vende tal cual (cervezas, gaseosas, empacados) y lo que está por agotarse.
          </p>
        </div>
        <button type="button" onClick={() => navigate('/compras')} className="btn-primary shrink-0">
          <Icon.truck width={16} height={16} />
          Registrar compra
        </button>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Tarjeta icon={<Icon.cart width={15} height={15} />} label="Productos con stock bajo">
          <p className="text-xl font-bold mt-1">{stockBajo.length}</p>
          <p className="text-xs text-muted mt-1">{stockBajo.length > 0 ? 'Requieren pedido pronto' : 'Todo por encima del mínimo'}</p>
        </Tarjeta>

        <Tarjeta icon={<Icon.alert width={15} height={15} />} label="Críticos / agotados">
          <p className={`text-xl font-bold mt-1 ${criticos.length > 0 ? 'text-ocupada' : ''}`}>{criticos.length}</p>
          <p className="text-xs text-muted mt-1">{criticos.length > 0 ? 'Atención inmediata' : 'Nada agotado ahora mismo'}</p>
        </Tarjeta>

        <Tarjeta icon={<Icon.truck width={15} height={15} />} label="Fecha última compra">
          <p className="text-xl font-bold mt-1">{ultimaCompra ? formatFecha(ultimaCompra.fecha) : '—'}</p>
          <p className="text-xs text-muted mt-1">
            {ultimaCompra ? `Recibida · ${ultimaCompra.proveedor.name}` : 'Todavía no hay compras registradas'}
          </p>
        </Tarjeta>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={() => setCategoriaActiva('todas')}
          className={`h-8 px-2.5 rounded-lg text-xs font-semibold border transition-colors ${
            categoriaActiva === 'todas' ? 'bg-amber text-night border-amber' : 'bg-raised text-muted border-edge hover:text-ink'
          }`}
        >
          Todos <span className="opacity-70">({presentaciones.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setCategoriaActiva('criticos')}
          className={`h-8 px-2.5 rounded-lg text-xs font-semibold border transition-colors inline-flex items-center gap-1 ${
            categoriaActiva === 'criticos'
              ? 'bg-ocupada text-ink border-ocupada'
              : 'bg-ocupada/10 text-ocupada border-ocupada/30 hover:bg-ocupada/20'
          }`}
        >
          <Icon.alert width={12} height={12} />
          Críticos <span className="opacity-80">({criticos.length})</span>
        </button>
        {categoriasConConteo.map(([nombre, n]) => (
          <button
            key={nombre}
            type="button"
            onClick={() => setCategoriaActiva(nombre)}
            className={`h-8 px-2.5 rounded-lg text-xs font-semibold border transition-colors ${
              categoriaActiva === nombre ? 'bg-amber text-night border-amber' : 'bg-raised text-muted border-edge hover:text-ink'
            }`}
          >
            {nombre} <span className="opacity-70">({n})</span>
          </button>
        ))}
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold">
            {categoriaActiva === 'criticos' ? 'Críticos y agotados' : categoriaActiva === 'todas' ? 'Catálogo' : categoriaActiva}
          </h2>
          <div className="flex items-center gap-2 flex-1 sm:flex-initial justify-end">
            <div className="relative w-full sm:w-64">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
                <Icon.search width={15} height={15} />
              </span>
              <input
                className="field pl-9 h-9 text-sm"
                placeholder="Buscar producto o presentación"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-0.5 bg-raised border border-edge rounded-lg p-0.5 shrink-0">
              <button
                type="button"
                onClick={() => cambiarVista('grid')}
                title="Ver en cuadros"
                className={`w-8 h-8 rounded-md grid place-items-center transition-colors ${
                  vista === 'grid' ? 'bg-amber text-night' : 'text-muted hover:text-ink'
                }`}
              >
                <Icon.grid width={15} height={15} />
              </button>
              <button
                type="button"
                onClick={() => cambiarVista('list')}
                title="Ver en lista"
                className={`w-8 h-8 rounded-md grid place-items-center transition-colors ${
                  vista === 'list' ? 'bg-amber text-night' : 'text-muted hover:text-ink'
                }`}
              >
                <Icon.list width={15} height={15} />
              </button>
            </div>
          </div>
        </div>

        {vista === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {visibles.map(({ product, variant }) => (
              <TarjetaProducto
                key={variant.id}
                product={product}
                variant={variant}
                estado={criticosSet.has(variant.id) ? 'critico' : stockBajoSet.has(variant.id) ? 'bajo' : null}
                enLista={enListaVariantSet.has(variant.id)}
                onToggleLista={() => toggleListaProducto(variant.id)}
              />
            ))}
          </div>
        ) : (
          visibles.length > 0 && (
            <div className="rounded-xl border border-edge overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left text-xs text-muted uppercase tracking-wide bg-raised">
                    <th className="py-2.5 px-3 font-semibold">Producto</th>
                    <th className="py-2.5 px-3 font-semibold">Estado</th>
                    <th className="py-2.5 px-3 font-semibold">Stock actual</th>
                    <th className="py-2.5 px-3 font-semibold">Mínimo</th>
                    <th className="py-2.5 px-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map(({ product, variant }) => (
                    <FilaProducto
                      key={variant.id}
                      product={product}
                      variant={variant}
                      estado={criticosSet.has(variant.id) ? 'critico' : stockBajoSet.has(variant.id) ? 'bajo' : null}
                      enLista={enListaVariantSet.has(variant.id)}
                      onToggleLista={() => toggleListaProducto(variant.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {visibles.length === 0 && (
          <div className="card text-center py-10 space-y-3">
            <p className="text-sm text-muted">
              {categoriaActiva === 'criticos'
                ? 'Nada crítico ahora mismo.'
                : search.trim()
                  ? <>No encontré “{search.trim()}” en el catálogo.</>
                  : 'No hay presentaciones todavía.'}
            </p>
            {categoriaActiva !== 'criticos' && (
              <button type="button" onClick={() => setCreando(true)} className="btn-primary">
                <Icon.plus width={16} height={16} />
                Agregar {search.trim() ? `"${search.trim()}"` : ''} como producto nuevo
              </button>
            )}
          </div>
        )}
      </section>

      <section className="card p-5">
        <h2 className="font-semibold mb-3">Entradas recientes</h2>
        {movements.length === 0 ? (
          <p className="text-sm text-muted">Todavía no hay entradas de inventario registradas.</p>
        ) : (
          <div>
            {movements.map((m) => (
              <div key={m.id} className="flex items-center gap-3 py-2.5 border-b border-edge/60 last:border-0">
                <span className="w-9 h-9 rounded-full bg-raised border border-edge grid place-items-center text-muted shrink-0">
                  <Icon.truck width={17} height={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {m.variant.product.name} · {m.variant.name}
                    {m.packs && m.unitsPerPack ? ` (${m.packs} × ${m.unitsPerPack})` : ''}
                  </p>
                  <p className="text-xs text-muted">
                    {m.createdBy?.name} · {formatFechaHora(m.createdAt)}
                    {m.note ? ` · ${m.note}` : ''}
                  </p>
                </div>
                <span className="text-sm font-semibold text-libre shrink-0">+{m.qty}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {creando && (
        <ProductoForm
          categories={categories}
          product={null}
          initialName={search.trim()}
          onClose={() => setCreando(false)}
          onSaved={productoCreado}
        />
      )}
    </div>
  )
}

function Tarjeta({ icon, label, children }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold tracking-wide text-muted uppercase">{label}</p>
        <span className="text-muted">{icon}</span>
      </div>
      {children}
    </div>
  )
}

// La insignia es lo unico que rompe la paleta ambar/oscuro de proposito --
// rojo solido para critico, ambar para bajo, igual que el semaforo de mesas
// ya usa colores puntuales solo para el estado. Sin insignia si el stock
// esta sano: no hay nada que resaltar.
function TarjetaProducto({ product, variant, estado, enLista, onToggleLista }) {
  const nombre = variant.name && variant.name !== 'Unidad' ? `${product.name} · ${variant.name}` : product.name
  return (
    <div className="card overflow-hidden flex flex-col">
      <div className="relative h-28 shrink-0" style={{ background: product.category?.color || 'rgb(var(--color-raised))' }}>
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full grid place-items-center text-night font-bold text-lg">
            {product.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        {estado === 'critico' && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-pill bg-ocupada text-ink">
            <Icon.alert width={11} height={11} />
            Crítico · {variant.stock} un.
          </span>
        )}
        {estado === 'bajo' && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-pill bg-amber text-night">
            Stock bajo · {variant.stock} un.
          </span>
        )}
      </div>
      <div className="p-3 space-y-2.5 flex-1 flex flex-col">
        <div>
          <p className="text-[10px] text-muted uppercase tracking-wide">{product.category?.name}</p>
          <p className="text-sm font-semibold leading-tight truncate">{nombre}</p>
        </div>
        <div className="flex items-center justify-between text-xs">
          <div>
            <p className="text-muted">Stock actual</p>
            <p className={`font-semibold ${estado === 'critico' ? 'text-ocupada' : estado === 'bajo' ? 'text-amberText' : ''}`}>
              {variant.stock} un.
            </p>
          </div>
          <div className="text-right">
            <p className="text-muted">Mínimo sugerido</p>
            <p className="font-semibold">{variant.stockMinimo != null ? `${variant.stockMinimo} un.` : 'Sin configurar'}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleLista}
          className={`h-9 text-xs justify-center mt-auto ${enLista ? 'btn-ghost border-amber/40 text-amberText' : 'btn-primary'}`}
        >
          <Icon.clipboard width={14} height={14} />
          {enLista ? 'En la lista de compras' : 'Agregar a lista de compras'}
        </button>
      </div>
    </div>
  )
}

function FilaProducto({ product, variant, estado, enLista, onToggleLista }) {
  const nombre = variant.name && variant.name !== 'Unidad' ? `${product.name} · ${variant.name}` : product.name
  return (
    <tr className="border-t border-edge first:border-t-0 hover:bg-raised/60 transition-colors">
      <td className="py-2 px-3">
        <div className="flex items-center gap-2.5">
          <span
            className="w-9 h-9 rounded-lg overflow-hidden shrink-0 grid place-items-center text-[10px] font-bold text-night"
            style={{ background: product.category?.color || 'rgb(var(--color-raised))' }}
          >
            {product.imageUrl ? (
              <img src={product.imageUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              product.name.slice(0, 2).toUpperCase()
            )}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{nombre}</p>
            <p className="text-xs text-muted truncate">{product.category?.name}</p>
          </div>
        </div>
      </td>
      <td className="py-2 px-3">
        {estado === 'critico' && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-pill bg-ocupada text-ink">
            <Icon.alert width={10} height={10} /> Crítico
          </span>
        )}
        {estado === 'bajo' && (
          <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-pill bg-amber text-night">Bajo</span>
        )}
        {!estado && <span className="text-xs text-muted">—</span>}
      </td>
      <td className={`py-2 px-3 font-semibold ${estado === 'critico' ? 'text-ocupada' : estado === 'bajo' ? 'text-amberText' : ''}`}>
        {variant.stock} un.
      </td>
      <td className="py-2 px-3 text-muted">{variant.stockMinimo != null ? `${variant.stockMinimo} un.` : 'Sin configurar'}</td>
      <td className="py-2 px-3 text-right">
        <button
          type="button"
          onClick={onToggleLista}
          className={`h-8 px-3 text-xs whitespace-nowrap ${enLista ? 'btn-ghost border-amber/40 text-amberText' : 'btn-primary'}`}
        >
          <Icon.clipboard width={13} height={13} />
          {enLista ? 'En la lista' : 'Agregar'}
        </button>
      </td>
    </tr>
  )
}

function formatFecha(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('es-CO', { dateStyle: 'medium' })
}
function formatFechaHora(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
}
