import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { api, money } from '../lib/api'
import { Icon } from '../components/Icons'
import MoneyInput from '../components/MoneyInput'
import PinField from '../components/PinField'
import RangoFechas from '../components/RangoFechas'
import SelectorFecha from '../components/SelectorFecha'
import InsumoForm from '../components/InsumoForm'
import ProductoForm from '../components/ProductoForm'
import ReciboEncabezado from '../components/ReciboEncabezado'
import ReciboPie from '../components/ReciboPie'
import { usePinVerificado } from '../hooks/usePinVerificado'
import { useShift } from '../context/ShiftContext'
import { useAuth } from '../context/AuthContext'
import { getCategories } from '../lib/categoriesStore'
import { parseISOLocal, calcularRangoDias, isoLocal } from '../lib/fechas'
import { prepararFactura } from '../lib/image'
import { construirTicketRaster } from '../lib/ticketRaster'
import { imprimirSilencioso } from '../lib/printer'

export const ESTADO_LABEL = { BORRADOR: 'Borrador', RECIBIDA: 'Recibida', ANULADA: 'Anulada' }
export const ESTADO_PAGO_LABEL = { PENDIENTE: 'Pendiente', PARCIAL: 'Pago parcial', PAGADA: 'Pagada' }
const FILTROS = [
  { key: 'todas', label: 'Todas' },
  { key: 'CON_SALDO', label: 'Saldo pendiente' },
  { key: 'BORRADOR', label: 'Borrador' },
  { key: 'RECIBIDA', label: 'Recibidas' },
]

export function formatFecha(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('es-CO', { dateStyle: 'medium' })
}
export function formatFechaHora(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
}
// "Hoy, 10:45 a.m." / "Ayer, 4:20 p.m." / fecha corta si es mas vieja -- para
// que la tarjeta de la lista se lea como actividad reciente, no como un dato
// administrativo mas.
function formatFechaRelativa(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const hoy = new Date()
  const ayer = new Date(hoy)
  ayer.setDate(hoy.getDate() - 1)
  const mismoDia = (a, b) => a.toDateString() === b.toDateString()
  const hora = d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })
  if (mismoDia(d, hoy)) return `Hoy, ${hora}`
  if (mismoDia(d, ayer)) return `Ayer, ${hora}`
  return formatFecha(iso)
}
export function diasParaVencer(fechaVencimiento) {
  if (!fechaVencimiento) return null
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const venc = parseISOLocal(fechaVencimiento.slice(0, 10))
  return Math.round((venc - hoy) / 86400000)
}
// Una linea de compra es un insumo (receta) o un producto de consumo final
// (cerveza, gaseosa, pan empacado -- ver CompraItem en el schema): nunca los
// dos, nunca ninguno. Estos dos helpers son el unico lugar que sabe leer esa
// diferencia, para no repetir el if/else en cada pantalla que lista items.
function claveItemCompra(it) {
  return it.insumo?.id || it.variant?.id
}
export function nombreItemCompra(it) {
  return it.insumo ? it.insumo.name : `${it.variant.product.name} · ${it.variant.name}`
}

export function resumenItems(items) {
  if (!items || items.length === 0) return 'Sin insumos'
  if (items.length === 1) return nombreItemCompra(items[0])
  return `${nombreItemCompra(items[0])} + ${items.length - 1} más`
}
function nombreUnidad(codigo, unidades) {
  return unidades.find((u) => u.codigo === codigo)?.nombre.split(' ')[0] || codigo
}

// Lista de insumos por debajo de su stock minimo -- misma info en los dos
// lugares donde se muestra (panel inline en xl+, modal abajo de xl).
// recetasPorInsumo: Map insumoId -> cuantas recetas (productos PREPARED) lo
// usan como ingrediente, para que se note cuales son urgentes de verdad.
// Cada fila es un boton: un clic lo agrega/quita de la lista de compras
// (enLista, un Set de insumoId) para imprimirla o mandarla por WhatsApp
// despues (ver ListaCompraModal).
function ListaStockBajo({ insumos, unidades, recetasPorInsumo, enLista, onToggle }) {
  return (
    <div className="space-y-1.5">
      {insumos.map((i) => {
        const nRecetas = recetasPorInsumo.get(i.id) || 0
        const agregado = enLista.has(i.id)
        const critico = i.stock <= 0
        return (
          <button
            key={i.id}
            type="button"
            onClick={() => onToggle(i.id)}
            className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors ${
              agregado
                ? 'border-amber/50 bg-amber/10'
                : critico
                  ? 'border-ocupada/30 bg-ocupada/5 hover:border-ocupada/50'
                  : 'border-warning/30 bg-warning/5 hover:border-warning/50'
            }`}
          >
            <span className="w-10 h-10 rounded-lg overflow-hidden shrink-0 grid place-items-center bg-canvas border border-edge">
              {i.imageUrl ? (
                <img src={i.imageUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <Icon.box width={16} height={16} className="text-muted" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{i.name}</p>
              <p className="text-xs text-muted truncate">{i.proveedor ? `Proveedor: ${i.proveedor.name}` : 'Sin proveedor habitual'}</p>
              {nRecetas > 0 && (
                <p className={`text-xs font-medium mt-0.5 ${critico ? 'text-ocupada' : 'text-warningText'}`}>
                  La usan {nRecetas} {nRecetas === 1 ? 'receta activa' : 'recetas activas'}
                </p>
              )}
            </div>
            <div className="text-right shrink-0">
              <p className={`text-sm font-bold whitespace-nowrap ${critico ? 'text-ocupada' : 'text-warningText'}`}>
                {i.stock} {nombreUnidad(i.unidadInventario, unidades)}
              </p>
              <p className="text-[10px] text-muted">{critico ? 'Crítico' : `mínimo ${i.stockMinimo}`}</p>
            </div>
            <span
              className={`w-6 h-6 rounded-full grid place-items-center shrink-0 border ${
                agregado ? 'bg-amber border-amber text-night' : 'border-edge text-transparent'
              }`}
            >
              <Icon.check width={13} height={13} />
            </span>
          </button>
        )
      })}
    </div>
  )
}

export default function Compras() {
  const { session } = useAuth()
  const [compras, setCompras] = useState([])
  const [cursor, setCursor] = useState(null)
  const [hayMasCompras, setHayMasCompras] = useState(false)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [counts, setCounts] = useState({ todas: 0, BORRADOR: 0, RECIBIDA: 0, CON_SALDO: 0 })
  const listaScrollRef = useRef(null)
  const centinelaRef = useRef(null)
  const [proveedores, setProveedores] = useState([])
  const [insumos, setInsumos] = useState([])
  const [categoriasInsumo, setCategoriasInsumo] = useState([])
  const [unidades, setUnidades] = useState([])
  const [recetas, setRecetas] = useState([]) // productos PREPARED, solo para contar de cuantos depende cada insumo
  const [productosStock, setProductosStock] = useState([]) // productos de consumo final (cerveza, gaseosa, pan...), para agregarlos a una compra junto con los insumos
  const [categoriasProducto, setCategoriasProducto] = useState([]) // categorias de catalogo (no las de insumo), solo para "matricular producto nuevo"
  const [search, setSearch] = useState('')
  const [filtroProveedor, setFiltroProveedor] = useState('')
  const [filtro, setFiltro] = useState('todas')
  const [rango, setRango] = useState(null) // {desde, hasta} | null = todo el historial
  const [selectedId, setSelectedId] = useState(undefined) // undefined = nada, 'new' = creando, id = viendo
  const [verStockBajo, setVerStockBajo] = useState(false)
  const [listaCompra, setListaCompra] = useState([])
  const [verListaCompra, setVerListaCompra] = useState(false)

  // Scroll infinito de mas nueva a mas vieja, 10 a la vez (ver CLAUDE.md >
  // Paginacion): reset=true pide la primera pagina y reemplaza la lista
  // (cambio de busqueda/filtro/proveedor/fechas); reset=false pide la
  // siguiente con el cursor ya guardado y la agrega al final.
  async function cargarListado(reset) {
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    if (filtroProveedor) params.set('proveedorId', filtroProveedor)
    if (filtro !== 'todas') params.set('filtro', filtro)
    if (rango) {
      params.set('desde', rango.desde)
      params.set('hasta', rango.hasta)
    }
    if (!reset && cursor) params.set('cursor', cursor)
    const qs = params.toString()
    const data = await api(`/compras${qs ? `?${qs}` : ''}`)
    setCompras((prev) => (reset ? data.items : [...prev, ...data.items]))
    setCursor(data.nextCursor)
    setHayMasCompras(Boolean(data.nextCursor))
    setCounts(data.counts)
  }

  async function cargarMas() {
    if (!cursor || cargandoMas) return
    setCargandoMas(true)
    try {
      await cargarListado(false)
    } finally {
      setCargandoMas(false)
    }
  }

  async function cargarCatalogos() {
    const [p, i, c, u, prod, catsProducto] = await Promise.all([
      api('/proveedores'),
      api('/insumos'),
      api('/insumo-categorias'),
      api('/insumos/unidades'),
      api('/products'),
      getCategories(session?.tenant.id),
    ])
    setProveedores(p)
    setInsumos(i)
    setCategoriasInsumo(c)
    setUnidades(u)
    setRecetas(prod.filter((pr) => pr.kind === 'PREPARED'))
    setProductosStock(prod.filter((pr) => pr.kind === 'STOCK' && pr.variants?.some((v) => v.active)))
    setCategoriasProducto(catsProducto)
  }

  async function cargarListaCompra() {
    setListaCompra(await api('/compras/lista'))
  }

  useEffect(() => {
    cargarCatalogos()
    cargarListaCompra()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Un clic sobre un insumo con stock bajo lo agrega/quita de la lista de
  // compras -- optimista (no espera el round-trip) para que el toggle se
  // sienta instantaneo, y revierte si el servidor lo rechaza.
  async function toggleEnListaCompra(insumoId) {
    const yaEstaba = listaCompra.some((it) => it.insumoId === insumoId)
    if (yaEstaba) {
      setListaCompra((prev) => prev.filter((it) => it.insumoId !== insumoId))
      try {
        await api(`/compras/lista/${insumoId}`, { method: 'DELETE' })
      } catch {
        await cargarListaCompra()
      }
    } else {
      const insumo = insumos.find((i) => i.id === insumoId)
      setListaCompra((prev) => [...prev, { insumoId, insumo }])
      try {
        await api(`/compras/lista/${insumoId}`, { method: 'POST' })
      } catch {
        await cargarListaCompra()
      }
    }
  }

  // Quitar desde el ticket de la lista de compras (ListaCompraModal): un
  // item ahi puede ser insumo o producto (ver ListaCompraItem polimorfico en
  // el schema), asi que a diferencia de toggleEnListaCompra -- que solo
  // conoce insumos, para el panel de stock bajo -- esta pega al endpoint
  // correcto segun cual de los dos id trae.
  async function quitarDeListaCompra(it) {
    const id = it.insumoId || it.variantId
    const url = it.insumoId ? `/compras/lista/${id}` : `/compras/lista/producto/${id}`
    setListaCompra((prev) => prev.filter((x) => (x.insumoId || x.variantId) !== id))
    try {
      await api(url, { method: 'DELETE' })
    } catch {
      await cargarListaCompra()
    }
  }

  // "Seleccionar/deseleccionar todo": agrega o quita de una los insumos con
  // stock bajo que todavia no estan en el estado contrario. No hay ruta
  // masiva en el backend -- son pocos insumos a la vez (solo los que estan
  // bajos ahora mismo), asi que varios toggles en paralelo alcanza.
  async function toggleTodoListaCompra() {
    const todosEnLista = insumosStockBajo.every((i) => enListaSet.has(i.id))
    const objetivo = todosEnLista
      ? insumosStockBajo.filter((i) => enListaSet.has(i.id))
      : insumosStockBajo.filter((i) => !enListaSet.has(i.id))
    if (objetivo.length === 0) return

    if (todosEnLista) {
      const ids = new Set(objetivo.map((i) => i.id))
      setListaCompra((prev) => prev.filter((it) => !ids.has(it.insumoId)))
    } else {
      setListaCompra((prev) => [...prev, ...objetivo.map((i) => ({ insumoId: i.id, insumo: i }))])
    }
    try {
      await Promise.all(
        objetivo.map((i) => api(`/compras/lista/${i.id}`, { method: todosEnLista ? 'DELETE' : 'POST' }))
      )
    } catch {
      await cargarListaCompra()
    }
  }

  // Cambiar busqueda, proveedor, fechas o pestaña de estado siempre vuelve a
  // la primera pagina: son filtros distintos, no "mas resultados" de los que
  // ya habia. El filtro de estado ahora lo resuelve el servidor (ver
  // cargarListado) -- antes era un useMemo local sobre el listado completo,
  // pero con scroll infinito solo hay 10 cargadas a la vez.
  useEffect(() => {
    const t = setTimeout(() => cargarListado(true), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filtroProveedor, rango, filtro])

  // Scroll infinito: un centinela invisible al final de la lista, observado
  // dentro del propio contenedor con scroll (root). Entra en pantalla ->
  // pide la siguiente pagina. Se vuelve a armar cuando cambia el cursor o el
  // estado de carga, para no quedarse con una referencia vieja a cargarMas.
  useEffect(() => {
    if (!hayMasCompras) return
    const contenedor = listaScrollRef.current
    const centinela = centinelaRef.current
    if (!contenedor || !centinela) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) cargarMas()
      },
      { root: contenedor, rootMargin: '200px' }
    )
    observer.observe(centinela)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hayMasCompras, cargandoMas, cursor])

  // Solo las recetas disponibles generan urgencia: el endpoint excluye las
  // eliminadas y `available` también descarta las suspendidas o su categoría.
  const recetasPorInsumo = useMemo(() => {
    const mapa = new Map()
    for (const receta of recetas.filter((pr) => pr.available)) {
      const idsUnicos = new Set((receta.recipe?.items || []).filter((it) => it.insumoId).map((it) => it.insumoId))
      for (const id of idsUnicos) mapa.set(id, (mapa.get(id) || 0) + 1)
    }
    return mapa
  }, [recetas])

  // Un insumo agotado es crítico aunque no tenga mínimo configurado. Entre
  // alertas del mismo nivel, prioriza el que afecta a más recetas activas.
  const insumosStockBajo = useMemo(
    () => insumos
      .filter((i) => i.active && (i.stock <= 0 || (i.stockMinimo != null && i.stock <= i.stockMinimo)))
      .sort((a, b) => {
        const porCriticidad = Number(b.stock <= 0) - Number(a.stock <= 0)
        if (porCriticidad) return porCriticidad
        const porRecetas = (recetasPorInsumo.get(b.id) || 0) - (recetasPorInsumo.get(a.id) || 0)
        if (porRecetas) return porRecetas
        return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) || a.id.localeCompare(b.id)
      }),
    [insumos, recetasPorInsumo]
  )

  const enListaSet = useMemo(() => new Set(listaCompra.map((it) => it.insumoId)), [listaCompra])

  async function recargarTodo() {
    await cargarListado(true)
    await cargarCatalogos()
  }

  // Insumo/categoria matriculados al vuelo desde el buscador de la compra
  // (ver "¿No lo encuentras? Matricúlalo" en CompraForm): se suman a la
  // lista en memoria para que aparezcan ya mismo, sin esperar otro round-trip.
  function onInsumoCreado(i) {
    setInsumos((prev) => [...prev, i])
  }
  function onCategoriaInsumoCreada(c) {
    setCategoriasInsumo((prev) => [...prev, c])
  }
  // Mismo criterio, para "crear producto nuevo" (ver CompraForm): un
  // producto de consumo final matriculado al vuelo se suma a la lista en
  // memoria para que aparezca ya mismo en el buscador.
  function onProductoCreado(p) {
    setProductosStock((prev) => [...prev, p])
  }

  const rangoCalendario = rango ? { from: parseISOLocal(rango.desde), to: parseISOLocal(rango.hasta) } : calcularRangoDias(30)
  const selected = typeof selectedId === 'string' && selectedId !== 'new' ? selectedId : null

  return (
    <div className="p-5 md:p-7">
      {/* Dos columnas solo desde xl (1280px): a 1024px (lg) el panel de la
          derecha quedaba demasiado angosto para el formulario de compra.
          Abajo de xl, el panel (nueva compra o detalle) se abre como modal
          en vez de apretarse al lado de la lista. */}
      <div className="grid grid-cols-1 xl:grid-cols-[300px_1fr] xl:gap-5 items-start">
        <div className="card p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="font-bold leading-tight">Órdenes y recepciones</h1>
              <p className="text-xs text-muted mt-0.5">Histórico y borradores activos</p>
            </div>
          </div>
          <button type="button" onClick={() => setSelectedId('new')} className="btn-primary w-full">
            <Icon.plus width={16} height={16} /> Nueva compra
          </button>

          {listaCompra.length > 0 && (
            <button
              type="button"
              onClick={() => setVerListaCompra(true)}
              className="btn-ghost w-full border-amber/40 text-amberText justify-center"
            >
              <Icon.clipboard width={15} height={15} /> Lista de compras ({listaCompra.length})
            </button>
          )}

          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
              <Icon.search />
            </span>
            <input
              className="field pl-10"
              placeholder="Buscar por N° de documento…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex gap-1.5 flex-wrap">
            {FILTROS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFiltro(f.key)}
                className={`h-8 px-2.5 rounded-lg text-xs font-semibold border transition-colors ${
                  f.key === 'CON_SALDO'
                    ? filtro === f.key
                      ? 'bg-ocupada text-white border-ocupada'
                      : 'bg-ocupada/10 text-ocupada border-ocupada/30 hover:border-ocupada/50'
                    : filtro === f.key
                      ? 'bg-amber text-night border-amber'
                      : 'bg-raised text-muted border-edge hover:text-ink'
                }`}
              >
                {f.label} <span className="opacity-70">({counts[f.key]})</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <select
              className="field h-9 text-xs flex-1"
              value={filtroProveedor}
              onChange={(e) => setFiltroProveedor(e.target.value)}
            >
              <option value="">Todos los proveedores</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <RangoFechas rango={rangoCalendario} activo={Boolean(rango)} labelOcioso="Fechas" onElegir={setRango} />
          </div>

          <div ref={listaScrollRef} className="space-y-1.5 max-h-[65vh] overflow-y-auto">
            {compras.map((c) => {
              const seleccionada = selected === c.id
              const badge = (() => {
                if (c.estado === 'BORRADOR') {
                  return seleccionada
                    ? { label: 'Editando recepción', cls: 'text-warningText border-warning/40 bg-warning/10' }
                    : { label: 'Borrador guardado', cls: 'text-muted border-edge bg-raised' }
                }
                if (c.estado === 'ANULADA') return { label: 'Anulada', cls: 'text-muted border-edge bg-raised' }
                if (c.saldoPendiente > 0) return { label: 'Saldo pendiente', cls: 'text-ocupada border-ocupada/40 bg-ocupada/10' }
                return { label: 'Recibida completa', cls: 'text-libre border-libre/40 bg-libre/10' }
              })()
              const dias = c.estado === 'RECIBIDA' && c.saldoPendiente > 0 ? diasParaVencer(c.fechaVencimiento) : null
              const tagDerecha =
                c.estado === 'BORRADOR'
                  ? { label: 'Sin confirmar', cls: 'text-warningText' }
                  : c.estado === 'RECIBIDA' && c.saldoPendiente > 0
                    ? { label: dias === null ? 'Saldo pendiente' : dias < 0 ? 'Vencida' : `Vence en ${dias}d`, cls: 'text-ocupada' }
                    : c.estado === 'RECIBIDA'
                      ? { label: 'Pagada', cls: 'text-libre' }
                      : null

              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full text-left p-3 rounded-xl border transition-colors ${
                    seleccionada ? 'bg-amber/10 border-amber/40' : 'bg-raised border-edge hover:border-amber/30'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-pill border shrink-0 ${badge.cls}`}>
                      {badge.label}
                    </span>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold leading-none">{money(c.total)}</p>
                      <p className="text-[10px] text-muted mt-1">{formatFechaRelativa(c.createdAt)}</p>
                    </div>
                  </div>
                  <p className="text-sm font-semibold truncate">{c.proveedor.name}</p>
                  <p className="text-xs text-muted truncate">Factura: {c.numeroDocumento || 'Sin número'}</p>
                  <div className="flex items-center justify-between gap-2 mt-1.5">
                    <p className="text-xs text-muted truncate">{resumenItems(c.items)}</p>
                    {tagDerecha && (
                      <span className={`text-[10px] font-semibold shrink-0 ${tagDerecha.cls}`}>{tagDerecha.label}</span>
                    )}
                  </div>
                </button>
              )
            })}
            {compras.length === 0 && (
              <p className="text-xs text-muted text-center py-6">No hay compras con ese filtro.</p>
            )}
            {/* Centinela del scroll infinito: invisible, solo marca cuando
                falta poco para el final de la lista (ver IntersectionObserver
                arriba). */}
            {hayMasCompras && (
              <div ref={centinelaRef} className="py-2 text-center">
                {cargandoMas && <p className="text-xs text-muted">Cargando más…</p>}
              </div>
            )}
          </div>
        </div>

        {selectedId === undefined ? (
          <>
            <div className="hidden xl:flex xl:flex-col card p-5 max-h-[75vh]">
              {insumosStockBajo.length === 0 ? (
                <p className="text-center text-muted text-sm py-10">Elige una compra de la lista, o crea una nueva.</p>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2 mb-1 shrink-0">
                    <div className="flex items-center gap-2">
                      <Icon.alert width={16} height={16} className="text-ocupada shrink-0" />
                      <h2 className="font-bold">Insumos con stock bajo</h2>
                    </div>
                    <button
                      type="button"
                      onClick={toggleTodoListaCompra}
                      className="text-xs font-semibold text-amberText hover:underline shrink-0"
                    >
                      {insumosStockBajo.every((i) => enListaSet.has(i.id)) ? 'Deseleccionar todo' : 'Seleccionar todo'}
                    </button>
                  </div>
                  <p className="text-xs text-muted mb-4 shrink-0">
                    Llegaron o bajaron de su mínimo configurado. Puede ser buen momento para pedirlos.
                  </p>
                  {/* Lista con su propio scroll y el boton de abajo fuera de
                      esa zona (shrink-0): con muchos insumos, el boton sigue
                      a la vista sin que el operador tenga que bajar a
                      buscarlo. */}
                  <div className="overflow-y-auto flex-1 min-h-0">
                    <ListaStockBajo
                      insumos={insumosStockBajo}
                      unidades={unidades}
                      recetasPorInsumo={recetasPorInsumo}
                      enLista={enListaSet}
                      onToggle={toggleEnListaCompra}
                    />
                  </div>
                  {listaCompra.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setVerListaCompra(true)}
                      className="btn-ghost w-full justify-center mt-4 shrink-0 border-amber/40 text-amberText"
                    >
                      <Icon.clipboard width={15} height={15} /> Lista de compras ({listaCompra.length})
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Abajo de xl no hay segunda columna donde mostrar esto (ver
                arriba): queda como una pestaña angosta pegada al borde que
                despliega la misma lista en un modal al tocarla. */}
            {insumosStockBajo.length > 0 && (
              <button
                type="button"
                onClick={() => setVerStockBajo(true)}
                aria-label={`${insumosStockBajo.length} insumos con stock bajo`}
                className="xl:hidden alerta-stock-bajo-tab fixed right-0 top-1/2 -translate-y-1/2 z-40
                           bg-ocupada text-white rounded-l-xl px-2.5 py-4 shadow-lg flex flex-col items-center gap-1.5"
              >
                <span className="alerta-stock-bajo-tab__contenido">
                  <Icon.alert width={20} height={20} />
                  <span className="text-xs font-bold">{insumosStockBajo.length}</span>
                </span>
              </button>
            )}

            {verStockBajo && (
              <div
                className="xl:hidden fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
                onClick={() => setVerStockBajo(false)}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="card w-full max-w-md max-h-[85vh] flex flex-col"
                >
                  <div className="flex items-center justify-between gap-2 p-5 pb-3 shrink-0">
                    <div className="flex items-center gap-2">
                      <Icon.alert width={16} height={16} className="text-ocupada shrink-0" />
                      <h2 className="font-bold">Insumos con stock bajo</h2>
                    </div>
                    <button type="button" onClick={() => setVerStockBajo(false)} className="text-muted hover:text-ink">
                      <Icon.x width={16} height={16} />
                    </button>
                  </div>

                  <div className="px-5 pb-3 shrink-0">
                    <button
                      type="button"
                      onClick={toggleTodoListaCompra}
                      className="text-xs font-semibold text-amberText hover:underline"
                    >
                      {insumosStockBajo.every((i) => enListaSet.has(i.id)) ? 'Deseleccionar todo' : 'Seleccionar todo'}
                    </button>
                  </div>

                  <div className="overflow-y-auto px-5 flex-1 min-h-0">
                    <ListaStockBajo
                      insumos={insumosStockBajo}
                      unidades={unidades}
                      recetasPorInsumo={recetasPorInsumo}
                      enLista={enListaSet}
                      onToggle={toggleEnListaCompra}
                    />
                  </div>

                  {/* Fuera de la zona con scroll (shrink-0): con muchos
                      insumos el operador no tiene que bajar a buscarlo. */}
                  {listaCompra.length > 0 && (
                    <div className="p-5 pt-3 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setVerStockBajo(false)
                          setVerListaCompra(true)
                        }}
                        className="btn-ghost w-full border-amber/40 text-amberText justify-center"
                      >
                        <Icon.clipboard width={15} height={15} /> Lista de compras ({listaCompra.length})
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        ) : selectedId === 'new' ? null : (
          <>
            <button
              type="button"
              onClick={() => setSelectedId(undefined)}
              className="xl:hidden fixed top-4 right-4 z-[60] w-9 h-9 rounded-full bg-raised border border-edge
                         grid place-items-center text-muted hover:text-ink"
            >
              <Icon.x width={16} height={16} />
            </button>
            <div
              className="fixed inset-0 z-50 bg-black/60 p-4 overflow-y-auto
                         xl:static xl:inset-auto xl:z-auto xl:bg-transparent xl:p-0 xl:overflow-visible"
            >
              <div className="max-w-5xl mx-auto xl:max-w-none xl:mx-0">
                <CompraDetalle
                  key={selected}
                  id={selected}
                  proveedores={proveedores}
                  insumos={insumos}
                  productosStock={productosStock}
                  categoriasInsumo={categoriasInsumo}
                  categoriasProducto={categoriasProducto}
                  unidades={unidades}
                  onProveedorCreado={(p) => setProveedores((prev) => [...prev, p])}
                  onInsumoCreado={onInsumoCreado}
                  onCategoriaInsumoCreada={onCategoriaInsumoCreada}
                  onProductoCreado={onProductoCreado}
                  onActualizada={recargarTodo}
                  onCancel={() => setSelectedId(undefined)}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {selectedId === 'new' && (
        <NuevaCompraModal
          onClose={() => setSelectedId(undefined)}
          onCreated={async (compra) => {
            await recargarTodo()
            setSelectedId(compra.id)
          }}
        />
      )}

      {verListaCompra && (
        <ListaCompraModal
          items={listaCompra}
          unidades={unidades}
          tenant={session?.tenant}
          onQuitar={quitarDeListaCompra}
          onClose={() => setVerListaCompra(false)}
        />
      )}
    </div>
  )
}

// --- Lista de compras (recordatorio de insumos a pedir, ver toggle en
// ListaStockBajo) -- imprime como tirilla (misma via que el resto del POS:
// termica si hay, si no window.print()) o manda un resumen por WhatsApp. ---

// Un item de la lista es un insumo o un producto (ver ListaCompraItem
// polimorfico en el schema) -- este es el unico lugar de este modal que sabe
// leer esa diferencia, para no repetirla en el ticket, el whatsapp y el
// render. Solo el insumo trae "proveedor habitual" (un producto no lo
// rastrea todavia), de ahi que el detalle entre parentesis sea opcional.
function claveListaItem(it) {
  return it.insumoId || it.variantId
}
function etiquetaListaItem(it) {
  if (it.insumo) return `${it.insumo.name}${it.insumo.proveedor ? ` (${it.insumo.proveedor.name})` : ''}`
  return `${it.variant.product.name} · ${it.variant.name}`
}

function ListaCompraModal({ items, unidades, tenant, onQuitar, onClose }) {
  const [pidiendoWhatsapp, setPidiendoWhatsapp] = useState(false)
  const [numeroWhatsapp, setNumeroWhatsapp] = useState('')

  function lineasTicket() {
    return [
      { texto: (tenant?.legalName || tenant?.name || 'Barminister').toUpperCase(), centro: true, negrita: true },
      { texto: 'Lista de compras', centro: true },
      { texto: new Date().toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }), centro: true },
      { raya: true },
      ...items.map((it) => ({ texto: etiquetaListaItem(it) })),
      { raya: true },
    ]
  }

  async function imprimir() {
    const bytes = await construirTicketRaster(tenant, lineasTicket())
    const ok = await imprimirSilencioso(bytes)
    if (!ok) window.print()
  }

  // Mismo criterio que ReciboModal: numero vacio abre el selector de
  // contactos de WhatsApp en vez de un chat puntual; local de 10 digitos se
  // le agrega el indicativo de Colombia.
  function enviarWhatsapp() {
    const digitos = numeroWhatsapp.replace(/\D/g, '')
    const numero = digitos ? (digitos.length === 10 ? `57${digitos}` : digitos) : ''
    const lineas = [
      `*Lista de compras · ${tenant?.legalName || tenant?.name || 'Barminister'}*`,
      '',
      ...items.map((it) => `• ${etiquetaListaItem(it)}`),
    ]
    const texto = encodeURIComponent(lineas.join('\n'))
    window.open(`https://wa.me/${numero}?text=${texto}`, '_blank')
    setPidiendoWhatsapp(false)
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
      <div className="flex flex-col items-center gap-3 my-auto">
        <div
          id="receipt-print-root"
          className="bg-white text-[#111] w-[310px] p-4 text-xs rounded shadow-xl max-h-[65vh] overflow-y-auto"
          style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
        >
          <ReciboEncabezado tenant={tenant} />
          <div className="text-center space-y-0.5 mt-1">
            <p className="font-semibold">Lista de compras</p>
            <p>{new Date().toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</p>
          </div>

          <div className="my-2 border-t border-dashed border-black/40" />

          {items.length === 0 ? (
            <p className="text-center text-black/60">Vacía por ahora.</p>
          ) : (
            items.map((it) => <p key={claveListaItem(it)}>{etiquetaListaItem(it)}</p>)
          )}

          <ReciboPie tenant={tenant} />
        </div>

        {pidiendoWhatsapp ? (
          <div className="card w-[310px] p-3 space-y-2">
            <label className="label">Número de WhatsApp (vacío para elegir el chat)</label>
            <input
              className="field h-9"
              value={numeroWhatsapp}
              onChange={(e) => setNumeroWhatsapp(e.target.value)}
              placeholder="300 123 4567"
              autoFocus
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => setPidiendoWhatsapp(false)} className="btn-ghost flex-1">
                Cancelar
              </button>
              <button type="button" onClick={enviarWhatsapp} className="btn-primary flex-1">
                Enviar
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-2 w-[310px]">
            <button type="button" onClick={onClose} className="btn-ghost">
              Cerrar
            </button>
            <button type="button" onClick={imprimir} disabled={items.length === 0} className="btn-ghost">
              <Icon.printer width={16} height={16} />
              Imprimir
            </button>
            <button
              type="button"
              onClick={() => setPidiendoWhatsapp(true)}
              disabled={items.length === 0}
              className="btn-primary"
            >
              <Icon.send width={16} height={16} />
              Enviar por WhatsApp
            </button>
          </div>
        )}

        {items.length > 0 && (
          <div className="card w-[310px] p-2 space-y-1 max-h-40 overflow-y-auto">
            {items.map((it) => (
              <div key={claveListaItem(it)} className="flex items-center justify-between gap-2 px-1.5 py-1 text-sm">
                <span className="truncate">{etiquetaListaItem(it)}</span>
                <button
                  type="button"
                  onClick={() => onQuitar(it)}
                  className="text-muted hover:text-ocupada p-1 shrink-0"
                >
                  <Icon.trash width={13} height={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// --- Formulario de compra (nueva o editando un borrador) -------------------

function buscarEntidadTexto(insumo) {
  return `${insumo.name} ${insumo.categoria?.name || ''}`.toLowerCase()
}

// Mismo criterio que sinConversionFija en api/src/lib/unidades.js: sin
// factor fijo declarado (ej. "paquete", que no tiene un tamano universal) o
// se compra por conteo pero se cuenta en otra magnitud (ej. lechugas por
// unidad, recetas en gramos). Necesita el catalogo real (con el factor de
// cada unidad) para no duplicar a mano cuales codigos son "paquete"/"unidad".
function sinConversionFija(insumo, unidades) {
  const compra = unidades.find((u) => u.codigo === insumo.unidadCompra)
  const inventario = unidades.find((u) => u.codigo === insumo.unidadInventario)
  if (!compra || !inventario) return false
  if (compra.factor == null) return true
  return compra.magnitud === 'conteo' && inventario.magnitud !== 'conteo'
}

function Migaja({ onCancel, activa, numeroDocumento }) {
  return (
    <div className="flex items-center gap-2 text-sm flex-wrap">
      <button type="button" onClick={onCancel} className="text-muted hover:text-ink">
        Inventario
      </button>
      <Icon.chevronRight width={13} height={13} className="text-muted/50" />
      <button type="button" onClick={onCancel} className="text-muted hover:text-ink">
        Compras
      </button>
      <Icon.chevronRight width={13} height={13} className="text-muted/50" />
      <span className="font-bold text-ink">{activa}</span>
      {numeroDocumento && (
        <span className="text-[10px] font-semibold px-2 py-1 rounded-pill border border-edge bg-raised text-muted">
          {numeroDocumento}
        </span>
      )}
    </div>
  )
}

// --- Medios de pago (compartido entre el formulario, "Recibir mercancía" y
// "Registrar pago") -- varios medios a la vez, igual que el cierre de cuenta
// del POS: cada tarjeta prende/apaga su propia fila, no reemplaza las demas.
// "Otro" es el escape para lo que no esta en el sistema (canje, caja de
// eventos): nunca mueve plata de un turno ni de una cuenta, solo queda la
// nota de que se trato. ------------------------------------------------------

const ICONO_CUENTA = { CAJA: 'cash', BANCO: 'bank', BILLETERA: 'phone' }

function tarjetasPago(shift, cuentasPago) {
  const tarjetas = []
  // Efectivo del turno y "Otro" no tienen un saldo propio que mostrar (el
  // primero es la caja del turno en curso, no una CuentaFinanciera; el
  // segundo ni siquiera mueve plata de una cuenta real) -- `saldo: null`
  // es justo eso: "no aplica", no "cero disponible".
  if (shift?.id) tarjetas.push({ key: 'EFECTIVO_TURNO', metodo: 'EFECTIVO_TURNO', label: 'Efectivo del turno', icon: 'cash', saldo: null })
  for (const c of cuentasPago) {
    tarjetas.push({
      key: `CUENTA:${c.id}`,
      metodo: 'CUENTA_FINANCIERA',
      cuentaFinancieraId: c.id,
      label: c.nombre,
      icon: ICONO_CUENTA[c.tipo] || 'bank',
      saldo: c.saldo != null ? Number(c.saldo) : null,
    })
  }
  tarjetas.push({ key: 'OTRO', metodo: 'OTRO', label: 'Otro', icon: 'tag', saldo: null })
  return tarjetas
}

function errorFilasPago(filas, total) {
  // Antes nunca llegaba vacio aqui: el selector siempre prendia el primer
  // medio solo. Ahora que nadie queda seleccionado por defecto (el operador
  // elige), esto si es un caso real que hay que frenar.
  if (filas.length === 0) return 'Elige al menos un medio de pago'
  for (const f of filas) {
    if (!Number(f.monto) || Number(f.monto) <= 0) return 'Cada medio de pago necesita un monto mayor a cero'
    if (f.metodo === 'OTRO' && !f.nota?.trim()) return 'Escribe de qué se trata el pago "Otro"'
  }
  const suma = filas.reduce((s, f) => s + (Number(f.monto) || 0), 0)
  if (suma > total + 0.01) return 'Los montos asignados superan lo que hay que pagar'
  return ''
}

function filasParaBody(filas) {
  return filas.map((f) => ({
    metodo: f.metodo,
    monto: Number(f.monto),
    ...(f.metodo === 'CUENTA_FINANCIERA' && { cuentaFinancieraId: f.cuentaFinancieraId }),
    ...(f.metodo === 'EFECTIVO_TURNO' && { shiftId: f.shiftId }),
    ...(f.metodo === 'OTRO' && { nota: f.nota?.trim() }),
  }))
}

// Nadie queda seleccionado al entrar: el operador prende a mano el medio
// que de verdad va a usar (antes el primero se prendia solo con todo el
// total adentro, facil de dejar pasar sin fijarse). Cada tarjeta se expande
// inline al activarla, con su propio monto y los atajos "Cubrir resto" /
// "Saldo total" -- ese ultimo solo existe si la tarjeta trae un saldo real
// (CuentaFinanciera; "Efectivo del turno" y "Otro" no tienen uno).
function SelectorMediosPago({
  total,
  shift,
  cuentasPago,
  filas,
  onChange,
  gridClassName = 'grid-cols-1 sm:grid-cols-2',
}) {
  const tarjetas = useMemo(() => tarjetasPago(shift, cuentasPago), [shift, cuentasPago])
  const suma = filas.reduce((s, f) => s + (Number(f.monto) || 0), 0)
  const restante = Math.max(total - suma, 0)
  const sobra = Math.max(suma - total, 0)

  // Con un solo medio activo (el caso mas comun) se mantiene igualado al
  // total: asi cambiar items o el peso real no deja el monto desactualizado.
  // Con varios, el encargado los reparte el mismo a mano. Con ninguno
  // activo esto no hace nada -- no hay fila que sincronizar.
  useEffect(() => {
    if (filas.length === 1 && Number(filas[0].monto) !== total) onChange([{ ...filas[0], monto: String(total) }])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total])

  function alternar(card) {
    const idx = filas.findIndex((f) => f.key === card.key)
    if (idx >= 0) {
      onChange(filas.filter((_, i) => i !== idx))
    } else {
      const pagosRestantes = filas.filter((f) => f.key !== card.key)
      const montoRestante = total - pagosRestantes.reduce((s, f) => s + (Number(f.monto) || 0), 0)
      if (montoRestante <= 0.009) return
      onChange([
        ...filas,
        {
          key: card.key,
          metodo: card.metodo,
          cuentaFinancieraId: card.cuentaFinancieraId,
          shiftId: shift?.id,
          monto: String(restante),
          nota: '',
        },
      ])
    }
  }
  function actualizarFila(key, patch) {
    const otrosPagos = filas.filter((f) => f.key !== key).reduce((s, f) => s + (Number(f.monto) || 0), 0)
    const maximo = Math.max(total - otrosPagos, 0)
    const monto = patch.monto === undefined ? undefined : String(Math.min(Number(patch.monto) || 0, maximo))
    onChange(filas.map((f) => (f.key === key ? { ...f, ...patch, ...(monto !== undefined && { monto }) } : f)))
  }

  return (
    <div className="space-y-3">
      <div className="bg-canvas border border-edge rounded-xl p-3 grid grid-cols-1 min-[460px]:grid-cols-3 gap-3">
        <div>
          <p className="text-[10px] font-bold tracking-wide text-muted uppercase">Total a pagar</p>
          <p className="text-base font-bold mt-0.5">{money(total)}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold tracking-wide text-muted uppercase">Asignado</p>
          <p className="text-base font-bold mt-0.5">{money(suma)}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold tracking-wide text-muted uppercase">{sobra > 0.01 ? 'De más' : 'Pendiente'}</p>
          <p
            className={`text-base font-bold mt-0.5 ${
              sobra > 0.01 ? 'text-ocupada' : restante > 0.01 ? 'text-warningText' : 'text-libre'
            }`}
          >
            {money(sobra > 0.01 ? sobra : restante)}
          </p>
        </div>
      </div>

      <div className={`grid ${gridClassName} gap-3`}>
        {tarjetas.map((card) => {
          const CardIcon = Icon[card.icon]
          const fila = filas.find((f) => f.key === card.key)
          const activa = Boolean(fila)
          const otrosPagos = filas
            .filter((f) => f.key !== card.key)
            .reduce((s, f) => s + (Number(f.monto) || 0), 0)
          const deshabilitada = !activa && (total <= 0 || otrosPagos >= total - 0.009)
          const quedara = activa && card.saldo != null ? card.saldo - (Number(fila.monto) || 0) : null
          return (
            <div
              key={card.key}
              className={`rounded-xl border-2 transition-colors ${activa ? 'border-amber bg-amber/5' : 'border-edge bg-raised'}`}
            >
              <button
                type="button"
                onClick={() => alternar(card)}
                disabled={deshabilitada}
                title={deshabilitada ? 'El total ya está cubierto con los otros medios de pago' : undefined}
                className="w-full flex items-center gap-3 p-3 text-left disabled:cursor-not-allowed disabled:opacity-45"
              >
                <span
                  className={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${
                    activa ? 'bg-amber text-night' : 'bg-canvas text-muted'
                  }`}
                >
                  <CardIcon width={16} height={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-snug">{card.label}</span>
                  {card.saldo != null && <span className="block text-xs text-muted">{money(card.saldo)} disponible</span>}
                </span>
                <span
                  className={`w-5 h-5 rounded-full border-2 grid place-items-center shrink-0 ${
                    activa ? 'bg-amber border-amber text-night' : 'border-edge'
                  }`}
                >
                  {activa && <Icon.check width={11} height={11} strokeWidth={3} />}
                </span>
              </button>

              {activa && (
                <div className="px-3 pb-3 pt-2 border-t border-edge/60 space-y-2" onClick={(e) => e.stopPropagation()}>
                  <label htmlFor={`pago-compra-${card.key}`} className="block text-[11px] font-semibold text-muted">
                    Valor que sale de {card.label}
                  </label>
                  <div className="flex items-center gap-1.5">
                    <MoneyInput
                      className="field h-9 flex-1 min-w-0"
                      value={fila.monto}
                      onChange={(v) => actualizarFila(card.key, { monto: v })}
                      id={`pago-compra-${card.key}`}
                    />
                    <button
                      type="button"
                      onClick={() => actualizarFila(card.key, { monto: String((Number(fila.monto) || 0) + restante) })}
                      disabled={restante <= 0}
                      className="text-[11px] font-semibold px-2 py-1.5 rounded-lg border border-edge text-muted hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
                    >
                      Cubrir resto
                    </button>
                    {card.saldo != null && (
                      <button
                        type="button"
                        onClick={() => actualizarFila(card.key, { monto: String(Math.max(card.saldo, 0)) })}
                        className="text-[11px] font-semibold px-2 py-1.5 rounded-lg border border-edge text-muted hover:text-ink whitespace-nowrap shrink-0"
                      >
                        Saldo total
                      </button>
                    )}
                  </div>
                  {card.metodo === 'OTRO' && (
                    <input
                      className="field h-9"
                      value={fila.nota}
                      onChange={(e) => actualizarFila(card.key, { nota: e.target.value })}
                      placeholder="Ej: canje de mercancía, caja de eventos"
                    />
                  )}
                  {quedara != null && (
                    <p className={`text-xs ${quedara < 0 ? 'text-ocupada' : 'text-muted'}`}>
                      {quedara < 0 ? `Supera el disponible por ${money(-quedara)}` : `Quedará: ${money(quedara)}`}
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {filas.length > 0 && (
        <p
          className={`text-sm font-semibold ${
            sobra > 0.01 ? 'text-ocupada' : restante > 0.01 ? 'text-warningText' : 'text-libre'
          }`}
        >
          {sobra > 0.01 ? `Sobran ${money(sobra)} asignados` : restante > 0.01 ? `Quedan ${money(restante)} a crédito` : 'Cubre el total'}
        </p>
      )}
    </div>
  )
}

export function NuevaCompraModal({ onClose, onCreated }) {
  const { session } = useAuth()
  const [catalogos, setCatalogos] = useState(null)
  const [errorCarga, setErrorCarga] = useState('')

  useEffect(() => {
    let vigente = true
    async function cargarCatalogos() {
      try {
        const [proveedores, insumos, categoriasInsumo, unidades, productos, categoriasProducto] =
          await Promise.all([
            api('/proveedores'),
            api('/insumos'),
            api('/insumo-categorias'),
            api('/insumos/unidades'),
            api('/products'),
            getCategories(session?.tenant.id),
          ])
        if (!vigente) return
        setCatalogos({
          proveedores,
          insumos,
          categoriasInsumo,
          unidades,
          productosStock: productos.filter(
            (producto) => producto.kind === 'STOCK' && producto.variants?.some((variant) => variant.active)
          ),
          categoriasProducto,
        })
      } catch (error) {
        if (vigente) setErrorCarga(error.message || 'No se pudieron cargar los datos para registrar la compra')
      }
    }
    cargarCatalogos()
    return () => {
      vigente = false
    }
  }, [session?.tenant.id])

  function actualizarCatalogo(clave, valor) {
    setCatalogos((actuales) => ({ ...actuales, [clave]: [...actuales[clave], valor] }))
  }

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/70 p-3 sm:p-6 flex items-center justify-center"
      onClick={onClose}
      role="presentation"
    >
      <section
        className="card w-full max-w-7xl max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nueva-compra-titulo"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="shrink-0 flex items-center justify-between gap-4 px-5 py-4 border-b border-edge">
          <h2 id="nueva-compra-titulo" className="text-lg font-bold">Registrar compra</h2>
          <button type="button" className="btn-ghost h-9 w-9 p-0" onClick={onClose} aria-label="Cerrar">
            <Icon.x width={18} height={18} />
          </button>
        </header>
        <div className="overflow-y-auto p-3 sm:p-6">
          {errorCarga ? (
            <div className="text-sm text-ocupada" role="alert">
              {errorCarga}
              <button type="button" className="btn-ghost ml-2" onClick={onClose}>Cerrar</button>
            </div>
          ) : !catalogos ? (
            <p className="py-10 text-center text-muted">Cargando datos de compras…</p>
          ) : (
            <CompraForm
              modal
              proveedores={catalogos.proveedores}
              insumos={catalogos.insumos}
              productosStock={catalogos.productosStock}
              categoriasInsumo={catalogos.categoriasInsumo}
              categoriasProducto={catalogos.categoriasProducto}
              unidades={catalogos.unidades}
              onProveedorCreado={(valor) => actualizarCatalogo('proveedores', valor)}
              onInsumoCreado={(valor) => actualizarCatalogo('insumos', valor)}
              onCategoriaInsumoCreada={(valor) => actualizarCatalogo('categoriasInsumo', valor)}
              onProductoCreado={(valor) => actualizarCatalogo('productosStock', valor)}
              onCreated={onCreated}
              onSaved={onCreated}
              onCancel={onClose}
            />
          )}
        </div>
      </section>
    </div>
  )
}

function CompraForm({
  modal = false,
  compraExistente,
  proveedores,
  insumos,
  productosStock,
  categoriasInsumo,
  categoriasProducto,
  unidades,
  onProveedorCreado,
  onInsumoCreado,
  onCategoriaInsumoCreada,
  onProductoCreado,
  onCreated,
  onSaved,
  onCancel,
}) {
  const esNueva = !compraExistente
  const { shift } = useShift()

  const [proveedorId, setProveedorId] = useState(compraExistente?.proveedorId || '')
  const [agregandoProveedor, setAgregandoProveedor] = useState(false)
  const [nombreProveedorNuevo, setNombreProveedorNuevo] = useState('')
  const [numeroDocumento, setNumeroDocumento] = useState(compraExistente?.numeroDocumento || '')
  const [fecha, setFecha] = useState(
    compraExistente?.fecha ? compraExistente.fecha.slice(0, 10) : isoLocal(new Date())
  )
  const [fechaVencimiento, setFechaVencimiento] = useState(
    compraExistente?.fechaVencimiento ? compraExistente.fechaVencimiento.slice(0, 10) : ''
  )
  const [observaciones, setObservaciones] = useState(compraExistente?.observaciones || '')
  const [facturaUrl, setFacturaUrl] = useState(compraExistente?.facturaUrl || '')
  const [facturaNombre, setFacturaNombre] = useState(compraExistente?.facturaNombre || '')
  const [subiendoFactura, setSubiendoFactura] = useState(false)

  const [items, setItems] = useState(
    (compraExistente?.items || []).map((it) => ({
      insumo: it.insumo || null,
      variant: it.variant || null,
      cantidad: String(it.cantidad),
      precioUnitario: String(it.precioUnitario),
      // El backend solo guarda el costo por unidad (precioUnitario); "costo
      // global" es un modo de ENTRADA nada mas -- una compra ya guardada
      // siempre se vuelve a abrir en modo unitario, con costoGlobal vacio
      // hasta que alguien cambie el switch (ver cambiarModoCosto).
      costoModo: 'unitario',
      costoGlobal: '',
      descuento: it.descuento && Number(it.descuento) > 0 ? String(it.descuento) : '',
      porcentajeImpuesto: it.porcentajeImpuesto && Number(it.porcentajeImpuesto) > 0 ? String(it.porcentajeImpuesto) : '',
      cantidadInventarioReal: it.cantidadInventarioReal != null ? String(it.cantidadInventarioReal) : '',
    }))
  )
  const [buscarInsumo, setBuscarInsumo] = useState('')
  // Nombre con el que se abre el modal de "matricular insumo" (null =
  // cerrado) -- se precarga con lo que ya se escribio en el buscador, para
  // no hacer re-escribir el nombre que ya no encontro coincidencias.
  const [matriculandoInsumo, setMatriculandoInsumo] = useState(null)
  // Mismo criterio, para "crear producto nuevo" -- un insumo y un producto
  // nunca se matriculan a la vez, asi que alcanza con dos banderas simples
  // en vez de una sola con el tipo adentro.
  const [matriculandoProducto, setMatriculandoProducto] = useState(null)
  const [insumosProveedor, setInsumosProveedor] = useState([])

  // El pago de contado es el default; lo que no se asigne a un medio queda a
  // crédito. La recepción y el borrador se autorizan desde la confirmación.
  const [pagarAhora, setPagarAhora] = useState(true)
  const [filasPago, setFilasPago] = useState([])
  const [cuentasPago, setCuentasPago] = useState([])
  const [pagoInicializado, setPagoInicializado] = useState(false)
  const [cargandoCuentasPago, setCargandoCuentasPago] = useState(true)
  const [errorCuentasPago, setErrorCuentasPago] = useState('')
  const [paso, setPaso] = useState(1)
  const [accionConfirmacion, setAccionConfirmacion] = useState(null)
  const [corrigiendoDesdeConfirmacion, setCorrigiendoDesdeConfirmacion] = useState(false)
  const [confirmandoCambios, setConfirmandoCambios] = useState(false)

  const [error, setError] = useState('')
  const [avisoValidacion, setAvisoValidacion] = useState('')
  const proveedorSelectRef = useRef(null)
  const proveedorNuevoRef = useRef(null)
  const buscarItemRef = useRef(null)
  const pagoSelectorRef = useRef(null)
  const camposCompraRef = useRef(new Map())
  const focoAvisoRef = useRef(null)
  const [saving, setSaving] = useState(false)
  // El PIN se pide al revisar el resumen final, tanto para recibir como para
  // guardar un borrador, y la API lo vuelve a verificar al guardar.
  const [confirmandoRecibir, setConfirmandoRecibir] = useState(false)
  const {
    pin,
    setPin,
    valido: pinValido,
    verificando: verificandoPin,
    error: pinError,
    bloqueado: pinBloqueado,
    segundosRestantes: pinSegundosRestantes,
    reset: resetPin,
  } = usePinVerificado()

  useEffect(() => {
    let vigente = true
    api('/compras/cuentas-pago')
      .then((cuentas) => {
        if (vigente) setCuentasPago(cuentas)
      })
      .catch((err) => {
        if (vigente) setErrorCuentasPago(err.message || 'No se pudieron cargar las cuentas de pago')
      })
      .finally(() => {
        if (vigente) setCargandoCuentasPago(false)
      })
    return () => {
      vigente = false
    }
  }, [])

  const proveedorSeleccionado = proveedores.find((p) => p.id === proveedorId)

  // Insumos que este proveedor ya suministra (ver proveedorId en Insumo),
  // para el atajo "Rapidos" -- evita escribir el nombre cuando es alguien a
  // quien ya le compras regularmente.
  useEffect(() => {
    if (!proveedorId) return setInsumosProveedor([])
    api(`/insumos?proveedorId=${proveedorId}`)
      .then(setInsumosProveedor)
      .catch(() => setInsumosProveedor([]))
  }, [proveedorId])

  // Al elegir un proveedor a credito, sugiere la fecha de vencimiento segun
  // sus dias de credito configurados -- el operador la puede ajustar.
  useEffect(() => {
    if (!proveedorSeleccionado || fechaVencimiento) return
    if (proveedorSeleccionado.condicionPago === 'CREDITO' && proveedorSeleccionado.diasCredito) {
      const base = fecha ? new Date(`${fecha}T00:00:00`) : new Date()
      base.setDate(base.getDate() + proveedorSeleccionado.diasCredito)
      setFechaVencimiento(isoLocal(base))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proveedorId])

  // Busca en los dos catalogos a la vez: insumos (receta) y presentaciones
  // de productos de consumo final (cerveza, gaseosa, pan empacado -- lo que
  // no entra a ninguna receta). Una presentacion se nombra "Producto ·
  // Presentacion" para distinguir "Coca-Cola · Lata" de "Coca-Cola · Litro".
  const coincidencias = useMemo(() => {
    const term = buscarInsumo.trim().toLowerCase()
    if (!term) return []
    const insumosAgregados = new Set(items.filter((it) => it.insumo).map((it) => it.insumo.id))
    const variantesAgregadas = new Set(items.filter((it) => it.variant).map((it) => it.variant.id))

    const insumosMatch = insumos
      .filter((i) => buscarEntidadTexto(i).includes(term) && !insumosAgregados.has(i.id))
      .slice(0, 5)
      .map((insumo) => ({ insumo, variant: null }))

    const variantesMatch = []
    for (const producto of productosStock) {
      for (const v of producto.variants || []) {
        if (!v.active || variantesAgregadas.has(v.id)) continue
        if (
          !`${producto.name} ${v.name} ${producto.category?.name || ''} ${producto.category?.parent?.name || ''}`
            .toLowerCase()
            .includes(term)
        )
          continue
        variantesMatch.push({ insumo: null, variant: { ...v, product: producto } })
        if (variantesMatch.length >= 5) break
      }
      if (variantesMatch.length >= 5) break
    }

    return [...insumosMatch, ...variantesMatch]
  }, [buscarInsumo, insumos, productosStock, items])

  const rapidos = useMemo(() => {
    const yaAgregados = new Set(items.filter((it) => it.insumo).map((it) => it.insumo.id))
    return insumosProveedor.filter((i) => !yaAgregados.has(i.id)).slice(0, 4)
  }, [insumosProveedor, items])

  // Estimado inicial de cuanto llega en unidadInventario, para insumos sin
  // conversion fija (ver sinConversionFija) -- el operador lo corrige si lo
  // que de verdad llego fue distinto. No aplica a productos (variant): esos
  // siempre son unidades enteras, sin conversion.
  function estimarCantidadInventarioReal(insumo, cantidad) {
    if (!insumo.cantidadPromedioPorUnidad) return ''
    return String(Math.round((Number(cantidad) || 0) * Number(insumo.cantidadPromedioPorUnidad)))
  }
  function agregarInsumo(insumo) {
    const cantidadInicial = '1'
    setItems((prev) => [
      {
        insumo,
        variant: null,
        cantidad: cantidadInicial,
        precioUnitario: String(insumo.costoCompra || ''),
        costoModo: 'unitario',
        costoGlobal: '',
        descuento: '',
        porcentajeImpuesto: '',
        cantidadInventarioReal: estimarCantidadInventarioReal(insumo, cantidadInicial),
        cantidadInventarioRealManual: false,
      },
      ...prev,
    ])
    setBuscarInsumo('')
  }
  function agregarVariante(variant) {
    setItems((prev) => [
      {
        insumo: null,
        variant,
        cantidad: '1',
        precioUnitario: String(variant.cost || ''),
        costoModo: 'unitario',
        costoGlobal: '',
        descuento: '',
        porcentajeImpuesto: '',
        cantidadInventarioReal: '',
        cantidadInventarioRealManual: false,
      },
      ...prev,
    ])
    setBuscarInsumo('')
  }
  // Deriva el costo por unidad a partir del costo global tecleado (lo que
  // de verdad se pago por toda la linea) y la cantidad -- el unico valor
  // que el backend guarda y que mueve el costo ponderado (ver costeo.js) es
  // precioUnitario, asi que "costo global" nunca deja de ser una forma de
  // escribirlo, no un campo aparte en la compra. Redondeado a pesos enteros
  // porque MoneyInput no admite decimales (el peso colombiano no los usa en
  // el dia a dia de un bar).
  function precioUnitarioDesdeGlobal(costoGlobal, cantidad, anterior) {
    const cant = Number(cantidad) || 0
    if (cant <= 0) return anterior
    return String(Math.round((Number(costoGlobal) || 0) / cant))
  }
  function actualizarCostoGlobal(clave, valor) {
    setItems((prev) =>
      prev.map((it) =>
        claveItemCompra(it) === clave
          ? { ...it, costoGlobal: valor, precioUnitario: precioUnitarioDesdeGlobal(valor, it.cantidad, it.precioUnitario) }
          : it
      )
    )
  }
  // Cambiar de modo no debe mover el numero que ya se ve: al pasar a global
  // se precarga con cantidad x precioUnitario (el mismo total de hoy); al
  // volver a unitario, precioUnitario ya quedo sincronizado por el modo
  // global, no hay que tocarlo.
  function cambiarModoCosto(clave, modo) {
    setItems((prev) =>
      prev.map((it) => {
        if (claveItemCompra(it) !== clave || it.costoModo === modo) return it
        if (modo === 'global') {
          const total = (Number(it.cantidad) || 0) * (Number(it.precioUnitario) || 0)
          return { ...it, costoModo: modo, costoGlobal: total ? String(Math.round(total)) : '' }
        }
        return { ...it, costoModo: modo }
      })
    )
  }
  function actualizarItem(clave, campo, valor) {
    setItems((prev) =>
      prev.map((it) => {
        if (claveItemCompra(it) !== clave) return it
        if (campo === 'cantidadInventarioReal') {
          return { ...it, cantidadInventarioReal: valor, cantidadInventarioRealManual: true }
        }
        if (campo === 'cantidad') {
          const next = { ...it, cantidad: valor }
          if (it.insumo && !it.cantidadInventarioRealManual) {
            next.cantidadInventarioReal = estimarCantidadInventarioReal(it.insumo, valor)
          }
          // En modo global lo que no cambia es el total pagado por la
          // linea: si la cantidad se corrige, el costo por unidad es el que
          // se recalcula, no al reves.
          if (it.costoModo === 'global') {
            next.precioUnitario = precioUnitarioDesdeGlobal(it.costoGlobal, valor, it.precioUnitario)
          }
          return next
        }
        return { ...it, [campo]: valor }
      })
    )
  }
  function sumarCantidad(clave, delta) {
    setItems((prev) =>
      prev.map((it) => {
        if (claveItemCompra(it) !== clave) return it
        const cantidad = String(Math.max(0, (Number(it.cantidad) || 0) + delta))
        const next = {
          ...it,
          cantidad,
          cantidadInventarioReal:
            it.insumo && !it.cantidadInventarioRealManual
              ? estimarCantidadInventarioReal(it.insumo, cantidad)
              : it.cantidadInventarioReal,
        }
        if (it.costoModo === 'global') {
          next.precioUnitario = precioUnitarioDesdeGlobal(it.costoGlobal, cantidad, it.precioUnitario)
        }
        return next
      })
    )
  }
  function quitarItem(clave) {
    setItems((prev) => prev.filter((it) => claveItemCompra(it) !== clave))
  }

  async function guardarProveedorNuevo() {
    const creado = await api('/proveedores', {
      method: 'POST',
      body: { name: nombreProveedorNuevo.trim() },
    })
    onProveedorCreado(creado)
    setProveedorId(creado.id)
    setAgregandoProveedor(false)
    setNombreProveedorNuevo('')
    return creado
  }

  async function crearProveedor() {
    if (!nombreProveedorNuevo.trim()) {
      return mostrarAvisoValidacion('Escribe el nombre del proveedor', 'proveedorNuevo')
    }
    setSaving(true)
    try {
      await guardarProveedorNuevo()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function subirFactura(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setSubiendoFactura(true)
    setError('')
    try {
      const dataUrl = await prepararFactura(file)
      const subida = await api('/compras/factura', { method: 'POST', body: { file: dataUrl, nombre: file.name } })
      setFacturaUrl(subida.facturaUrl)
      setFacturaNombre(subida.facturaNombre || file.name)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubiendoFactura(false)
    }
  }

  const itemsCalculados = useMemo(() => {
    return items.map((it) => {
      const cantidad = Number(it.cantidad) || 0
      const precio = Number(it.precioUnitario) || 0
      const descuento = Number(it.descuento) || 0
      const pctImpuesto = Number(it.porcentajeImpuesto) || 0
      const bruto = cantidad * precio
      const subtotal = Math.max(bruto - descuento, 0)
      const impuesto = subtotal * (pctImpuesto / 100)
      return { ...it, subtotal, impuesto, total: subtotal + impuesto }
    })
  }, [items])

  const totales = itemsCalculados.reduce(
    (acc, it) => ({ subtotal: acc.subtotal + it.subtotal, impuesto: acc.impuesto + it.impuesto, total: acc.total + it.total }),
    { subtotal: 0, impuesto: 0, total: 0 }
  )
  const pagoAsignado = filasPago.reduce((suma, fila) => suma + (Number(fila.monto) || 0), 0)
  const saldoACredito = Math.max(totales.total - pagoAsignado, 0)

  function registrarCampoCompra(clave) {
    return (elemento) => {
      if (elemento) camposCompraRef.current.set(clave, elemento)
      else camposCompraRef.current.delete(clave)
    }
  }

  useEffect(() => {
    if (!esNueva || !pagarAhora || pagoInicializado || cargandoCuentasPago || totales.total <= 0) return
    const tarjetas = tarjetasPago(shift, cuentasPago)
    const tarjeta =
      tarjetas.find((opcion) => opcion.metodo === 'EFECTIVO_TURNO') ||
      tarjetas.find((opcion) => opcion.metodo === 'CUENTA_FINANCIERA') ||
      tarjetas[0]
    if (!tarjeta) return
    setFilasPago([
      {
        key: tarjeta.key,
        metodo: tarjeta.metodo,
        cuentaFinancieraId: tarjeta.cuentaFinancieraId,
        shiftId: shift?.id,
        monto: String(totales.total),
        nota: '',
      },
    ])
    setPagoInicializado(true)
  }, [esNueva, pagarAhora, pagoInicializado, cargandoCuentasPago, totales.total, shift, cuentasPago])

  function errorInfoGeneral() {
    if (agregandoProveedor) {
      return nombreProveedorNuevo.trim() ? '' : 'Escribe el nombre del proveedor'
    }
    if (!proveedorId) return 'Elige un proveedor'
    return ''
  }
  function errorItems() {
    if (items.length === 0) return 'Agrega al menos un insumo o producto a la compra'
    for (const it of items) {
      const nombre = nombreItemCompra(it)
      if (!Number(it.cantidad) || Number(it.cantidad) <= 0) return `La cantidad de "${nombre}" debe ser mayor a cero`
      if (it.precioUnitario === '' || Number(it.precioUnitario) < 0) return `El precio de "${nombre}" no es válido`
    }
    return ''
  }
  // Solo exigido al RECIBIR (sube stock de una): mientras sigue en borrador
  // puede no haberse contado/pesado todavia. Ver sinConversionFija. No aplica
  // a productos (variant): esos no tienen conversion de unidad.
  function errorItemsParaRecibir() {
    const err = errorItems()
    if (err) return err
    for (const it of items) {
      if (
        it.insumo &&
        sinConversionFija(it.insumo, unidades) &&
        (!it.cantidadInventarioReal || Number(it.cantidadInventarioReal) <= 0)
      ) {
        return `Escribe cuánto llegó en total de "${it.insumo.name}" para poder recibirlo`
      }
    }
    return ''
  }

  function mostrarAvisoValidacion(mensaje, campo) {
    setError('')
    setAvisoValidacion(mensaje)
    focoAvisoRef.current = campo || null
  }

  function notificarErrorValidacion(mensaje) {
    mostrarAvisoValidacion(mensaje, campoDeError(mensaje))
  }

  function campoDeError(mensaje) {
    if (/proveedor/i.test(mensaje)) return agregandoProveedor ? 'proveedorNuevo' : 'proveedor'
    if (/insumo o producto/i.test(mensaje)) return 'buscarItem'
    if (/medio de pago|pago "otro"|monto del pago|montos asignados|superar lo que hay que pagar/i.test(mensaje)) {
      return 'pagos'
    }
    const nombre = mensaje.match(/"([^"]+)"/)?.[1]
    const item = items.find((actual) => nombreItemCompra(actual) === nombre)
    if (!item) return null
    const clave = claveItemCompra(item)
    if (/llegó en total/i.test(mensaje)) return `inventario:${clave}`
    if (/cantidad/i.test(mensaje)) return `cantidad:${clave}`
    if (/precio/i.test(mensaje)) return `precio:${clave}`
    return `cantidad:${clave}`
  }

  function cerrarAvisoValidacion() {
    setAvisoValidacion('')
    const campo = focoAvisoRef.current
    focoAvisoRef.current = null
    requestAnimationFrame(() => {
      if (campo === 'proveedor') proveedorSelectRef.current?.focus()
      else if (campo === 'proveedorNuevo') proveedorNuevoRef.current?.focus()
      else if (campo === 'buscarItem') buscarItemRef.current?.focus()
      else if (campo === 'pagos') pagoSelectorRef.current?.querySelector('button:not(:disabled)')?.focus()
      else {
        const elemento = camposCompraRef.current.get(campo)
        if (elemento instanceof HTMLElement && elemento.tagName !== 'INPUT') {
          elemento.querySelector('input')?.focus()
        } else {
          elemento?.focus()
        }
      }
    })
  }
  // Todo lo que "Guardar y recibir mercancía" necesita tener en orden ANTES
  // de dejar abrir el modal de confirmación -- el PIN se revisa aparte, ya
  // adentro del modal (ver confirmarRecibir), porque hasta ese punto no hace
  // falta haberlo escrito todavia.
  function erroresParaRecibir() {
    const errInfo = errorInfoGeneral()
    if (errInfo) return errInfo
    const errI = errorItemsParaRecibir()
    if (errI) return errI
    if (pagarAhora) {
      const errPago = errorFilasPago(filasPago, totales.total)
      if (errPago) return errPago
    }
    return ''
  }

  function construirBody(accion) {
    const body = {
      proveedorId,
      numeroDocumento: numeroDocumento.trim() || null,
      fecha,
      fechaVencimiento: fechaVencimiento || null,
      observaciones: observaciones.trim() || null,
      facturaUrl: facturaUrl || null,
      facturaNombre: facturaNombre || null,
      items: items.map((it) => ({
        ...(it.insumo ? { insumoId: it.insumo.id } : { variantId: it.variant.id }),
        cantidad: Number(it.cantidad),
        precioUnitario: Number(it.precioUnitario),
        descuento: Number(it.descuento) || 0,
        porcentajeImpuesto: Number(it.porcentajeImpuesto) || 0,
        cantidadInventarioReal: it.insumo && it.cantidadInventarioReal ? Number(it.cantidadInventarioReal) : null,
      })),
      accion,
    }
    if (esNueva) body.pin = pin
    if (accion === 'recibir') {
      if (pagarAhora && filasPago.length > 0) body.pagos = filasParaBody(filasPago)
    }
    return body
  }

  async function guardarBorrador() {
    if (esNueva && !pinValido) return setError('Escribe y verifica el código del empleado')
    const errInfo = errorInfoGeneral()
    if (errInfo) return notificarErrorValidacion(errInfo)
    const errI = errorItems()
    if (errI) return notificarErrorValidacion(errI)
    setError('')
    setSaving(true)
    try {
      if (esNueva) {
        const creada = await api('/compras', { method: 'POST', body: construirBody('guardar') })
        setConfirmandoRecibir(false)
        onCreated(creada)
      } else {
        const guardada = await api(`/compras/${compraExistente.id}`, {
          method: 'PATCH',
          body: {
            proveedorId,
            numeroDocumento: numeroDocumento.trim() || null,
            fecha,
            fechaVencimiento: fechaVencimiento || null,
            observaciones: observaciones.trim() || null,
            facturaUrl: facturaUrl || null,
            facturaNombre: facturaNombre || null,
            items: construirBody('guardar').items,
          },
        })
        onSaved(guardada)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Llamada desde el modal de confirmacion: todo lo demas (proveedor, items,
  // medios de pago) ya paso por erroresParaRecibir antes de que el modal
  // pudiera abrirse -- lo unico que falta resolver aqui es el PIN.
  async function recibirCompra() {
    if (!pinValido) return setError('Escribe y verifica el código del empleado')
    setError('')
    setSaving(true)
    try {
      const recibida = esNueva
        ? await api('/compras', { method: 'POST', body: construirBody('recibir') })
        : await api(`/compras/${compraExistente.id}/recibir`, {
            method: 'POST',
            body: { pin, pagos: construirBody('recibir').pagos },
          })
      setConfirmandoRecibir(false)
      setAccionConfirmacion(null)
      ;(onCreated || onSaved)(recibida)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function abrirConfirmarRecibir() {
    const err = erroresParaRecibir()
    if (err) return notificarErrorValidacion(err)
    setError('')
    setAccionConfirmacion('recibir')
    setConfirmandoRecibir(true)
  }
  function cancelarConfirmarRecibir() {
    setConfirmandoRecibir(false)
    setAccionConfirmacion(null)
    setError('')
    resetPin()
  }

  async function continuarAlPago() {
    const err = errorInfoGeneral() || errorItems()
    if (err) return notificarErrorValidacion(err)
    if (corrigiendoDesdeConfirmacion) {
      const errorConfirmacion = validarAccionConfirmada(accionConfirmacion)
      if (errorConfirmacion) return notificarErrorValidacion(errorConfirmacion)
    }

    if (agregandoProveedor) {
      setSaving(true)
      try {
        await guardarProveedorNuevo()
      } catch (errorProveedor) {
        setError(errorProveedor.message)
        return
      } finally {
        setSaving(false)
      }
    }

    setError('')
    if (corrigiendoDesdeConfirmacion) {
      setConfirmandoCambios(true)
      return
    }
    setPaso(2)
  }

  function validarAccionConfirmada(accion) {
    return accion === 'recibir'
      ? erroresParaRecibir()
      : errorInfoGeneral() || errorItems()
  }

  function abrirConfirmacion(accion) {
    const err = validarAccionConfirmada(accion)
    if (err) return notificarErrorValidacion(err)
    setError('')
    setAccionConfirmacion(accion)
    setConfirmandoRecibir(true)
  }

  function corregirDesdeResumen(destino) {
    setConfirmandoRecibir(false)
    setPaso(destino)
    setCorrigiendoDesdeConfirmacion(true)
    setError('')
    resetPin()
  }

  function confirmarCorrecciones() {
    setConfirmandoCambios(false)
    setCorrigiendoDesdeConfirmacion(false)
    setPaso(2)
    setConfirmandoRecibir(true)
  }

  function limpiarCampos() {
    setProveedorId('')
    setNumeroDocumento('')
    setFecha(isoLocal(new Date()))
    setFechaVencimiento('')
    setObservaciones('')
    setFacturaUrl('')
    setFacturaNombre('')
    setItems([])
    setBuscarInsumo('')
    setAumentarStock(true)
    setPagarAhora(true)
    setFilasPago([])
    setPagoInicializado(false)
    setPaso(1)
    setAccionConfirmacion(null)
    setCorrigiendoDesdeConfirmacion(false)
    setConfirmandoCambios(false)
    setConfirmandoRecibir(false)
    setAvisoValidacion('')
    resetPin()
    setError('')
  }

  // El boton "Limpiar campos (Esc)" tambien responde a la tecla de verdad --
  // solo mientras este formulario esta montado.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') limpiarCampos()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={modal ? 'space-y-6' : 'card p-5 md:p-6 space-y-6'}>
      {esNueva && (
        <div className="grid grid-cols-2 gap-3" aria-label="Pasos para registrar la compra">
          {[
            { numero: 1, titulo: 'Proveedor, factura e ítems' },
            { numero: 2, titulo: 'Pago y confirmación' },
          ].map((etapa) => (
            <div
              key={etapa.numero}
              aria-current={paso === etapa.numero ? 'step' : undefined}
              className={`flex items-center gap-3 rounded-xl border px-3 py-3 ${
                paso === etapa.numero ? 'border-amber/50 bg-amber/10 text-ink' : 'border-edge bg-raised text-muted'
              }`}
            >
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  paso === etapa.numero ? 'bg-amber text-night' : 'bg-canvas text-muted'
                }`}
              >
                {etapa.numero}
              </span>
              <span className="text-xs font-semibold sm:text-sm">{etapa.titulo}</span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
          {error}
        </p>
      )}

      <div className={esNueva && paso !== 1 ? 'hidden' : 'space-y-6'}>
      <div className="flex items-center justify-between gap-3 flex-wrap pb-4 border-b border-edge">
        <Migaja
          onCancel={onCancel}
          activa={esNueva ? 'Nueva compra' : 'Editando recepción'}
          numeroDocumento={numeroDocumento}
        />
        <div className="flex items-center gap-2">
          <button type="button" onClick={limpiarCampos} className="btn-ghost text-xs h-9 px-3">
            Limpiar campos <span className="text-muted/60 ml-1">(Esc)</span>
          </button>
          <button
            type="button"
            disabled
            title="Próximamente: importar la factura electrónica XML de la DIAN"
            className="btn-ghost text-xs h-9 px-3 opacity-40 cursor-not-allowed"
          >
            <Icon.receipt width={14} height={14} /> Importar XML / DIAN
          </button>
        </div>
      </div>

      <div className="pb-6 border-b border-edge">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-1">
          <h3 className="text-sm font-bold tracking-wide uppercase flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber inline-block" />
            1. Datos del proveedor y factura
          </h3>
          <p className="text-xs text-muted">Actualiza el costo del insumo y el informe de cuentas por pagar</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr_1fr_1fr] gap-3">
          <div>
            <label className="label">Proveedor habitual</label>
            {agregandoProveedor ? (
              <div className="flex gap-2">
                <input
                  ref={proveedorNuevoRef}
                  className="field flex-1"
                  placeholder="Nombre del proveedor"
                  value={nombreProveedorNuevo}
                  onChange={(e) => setNombreProveedorNuevo(e.target.value)}
                  autoFocus
                />
                <button type="button" onClick={crearProveedor} disabled={saving} className="btn-primary h-10 px-3 text-xs whitespace-nowrap">
                  Crear
                </button>
                <button type="button" onClick={() => setAgregandoProveedor(false)} className="btn-ghost h-10 px-3">
                  <Icon.x width={14} height={14} />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <select
                  ref={proveedorSelectRef}
                  className="field flex-1"
                  value={proveedorId}
                  onChange={(e) => setProveedorId(e.target.value)}
                >
                  <option value="" disabled hidden>
                    Elige un proveedor
                  </option>
                  {proveedores.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setAgregandoProveedor(true)}
                  className="btn-ghost h-10 px-3 text-xs whitespace-nowrap"
                >
                  <Icon.plus width={14} height={14} /> Nuevo
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="label">N° de factura o documento</label>
            <input className="field" value={numeroDocumento} onChange={(e) => setNumeroDocumento(e.target.value)} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="label mb-0">Fecha de recepción</label>
              <div className="flex gap-1">
                <button type="button" onClick={() => setFecha(isoLocal(new Date()))} className="text-[10px] font-semibold text-muted hover:text-ink">
                  Hoy
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const ayer = new Date()
                    ayer.setDate(ayer.getDate() - 1)
                    setFecha(isoLocal(ayer))
                  }}
                  className="text-[10px] font-semibold text-muted hover:text-ink"
                >
                  Ayer
                </button>
              </div>
            </div>
            <SelectorFecha value={fecha} onChange={setFecha} />
          </div>

          <div>
            <label className="label">Vencimiento factura</label>
            <SelectorFecha value={fechaVencimiento} onChange={setFechaVencimiento} placeholder="Sin vencimiento" clearable />
          </div>
        </div>

        <div className="mt-3">
          <label className="label">Factura adjunta</label>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="btn-ghost h-9 px-3 text-xs cursor-pointer">
              {subiendoFactura ? (
                'Subiendo…'
              ) : (
                <>
                  <Icon.receipt width={14} height={14} /> {facturaUrl ? 'Cambiar archivo' : 'Adjuntar factura'}
                </>
              )}
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,application/pdf"
                className="hidden"
                onChange={subirFactura}
                disabled={subiendoFactura}
              />
            </label>
            {facturaUrl && (
              <>
                <a
                  href={facturaUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-amberText hover:underline truncate max-w-[220px]"
                >
                  {facturaNombre || 'Ver archivo'}
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setFacturaUrl('')
                    setFacturaNombre('')
                  }}
                  className="text-muted hover:text-ocupada p-1"
                >
                  <Icon.trash width={14} height={14} />
                </button>
              </>
            )}
          </div>
          <p className="text-[11px] text-muted mt-1">JPG, PNG, GIF o PDF, máximo 1.5 MB.</p>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-sm font-bold tracking-wide uppercase flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber inline-block" />
            2. Insumos y productos
          </h3>
          <span className="text-[10px] font-semibold px-2 py-1 rounded-pill border text-muted border-edge bg-raised">
            El stock sube al recibir, no al guardar borrador
          </span>
        </div>

        {rapidos.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <span className="text-xs text-muted shrink-0">Rápidos:</span>
            {rapidos.map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => agregarInsumo(i)}
                className="text-xs px-2.5 py-1 rounded-pill border border-edge bg-raised hover:border-amber/40 hover:text-ink text-muted transition-colors"
              >
                + {i.name}
              </button>
            ))}
          </div>
        )}

        <div className="relative mb-4">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
            <Icon.search />
          </span>
          <input
            ref={buscarItemRef}
            className="field pl-10"
            placeholder="Buscar insumo o producto para agregar…"
            value={buscarInsumo}
            onChange={(e) => setBuscarInsumo(e.target.value)}
          />
          {coincidencias.length > 0 && (
            <div className="absolute z-10 top-full left-0 right-0 mt-1 card p-1.5 space-y-0.5 shadow-xl max-h-60 overflow-y-auto">
              {coincidencias.map((c) =>
                c.insumo ? (
                  <button
                    key={`i-${c.insumo.id}`}
                    type="button"
                    onClick={() => agregarInsumo(c.insumo)}
                    className="w-full flex items-center justify-between gap-2 text-left px-2.5 py-2 rounded-lg text-sm hover:bg-raised"
                  >
                    <span>{c.insumo.name}</span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-pill border border-edge text-muted shrink-0">
                      Insumo
                    </span>
                  </button>
                ) : (
                  <button
                    key={`v-${c.variant.id}`}
                    type="button"
                    onClick={() => agregarVariante(c.variant)}
                    className="w-full flex items-center justify-between gap-2 text-left px-2.5 py-2 rounded-lg text-sm hover:bg-raised"
                  >
                    <span>
                      {c.variant.product.name} <span className="text-muted">· {c.variant.name}</span>
                    </span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-pill border border-amber/40 text-amberText shrink-0">
                      Producto
                    </span>
                  </button>
                )
              )}
            </div>
          )}
          {buscarInsumo.trim() && coincidencias.length === 0 && (
            <div className="absolute z-10 top-full left-0 right-0 mt-1 card p-3 shadow-xl space-y-2">
              <p className="text-xs text-muted">
                No encontramos insumos ni productos para "{buscarInsumo.trim()}".
              </p>
              <button
                type="button"
                onClick={() => setMatriculandoInsumo(buscarInsumo.trim())}
                className="btn-ghost w-full justify-center text-xs h-9"
              >
                <Icon.plus width={14} height={14} /> Matricular "{buscarInsumo.trim()}" como insumo nuevo
              </button>
              <button
                type="button"
                onClick={() => setMatriculandoProducto(buscarInsumo.trim())}
                className="btn-ghost w-full justify-center text-xs h-9"
              >
                <Icon.plus width={14} height={14} /> Crear "{buscarInsumo.trim()}" como producto nuevo
              </button>
            </div>
          )}
        </div>

        {matriculandoInsumo !== null && (
          <InsumoForm
            nombreInicial={matriculandoInsumo}
            categorias={categoriasInsumo}
            proveedores={proveedores}
            unidades={unidades}
            onClose={() => setMatriculandoInsumo(null)}
            onSaved={(creado) => {
              onInsumoCreado(creado)
              agregarInsumo(creado)
              setMatriculandoInsumo(null)
            }}
            onCategoriaCreada={onCategoriaInsumoCreada}
            onProveedorCreado={onProveedorCreado}
          />
        )}

        {/* Mismo atajo que matricular un insumo, pero para un producto de
            consumo final (cerveza, gaseosa, pan empacado): asi el operador
            no tiene que saber de antemano en que catalogo va lo que esta
            comprando ni salir de la compra para registrarlo en /productos. */}
        {matriculandoProducto !== null && (
          <ProductoForm
            initialName={matriculandoProducto}
            categories={categoriasProducto}
            onClose={() => setMatriculandoProducto(null)}
            onSaved={(creado) => {
              onProductoCreado(creado)
              for (const v of [...(creado.variants || [])].reverse()) {
                agregarVariante({ ...v, product: { id: creado.id, name: creado.name } })
              }
              setMatriculandoProducto(null)
            }}
          />
        )}

        {itemsCalculados.length === 0 ? (
          <p className="text-sm text-muted text-center py-8 border border-dashed border-edge rounded-xl">
            Todavía no hay insumos ni productos. Búscalos arriba y agrégalos a la compra.
          </p>
        ) : (
          <div className="rounded-xl border border-edge overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs text-muted uppercase tracking-wide bg-raised">
                  <th className="py-2.5 px-3 font-semibold w-8">#</th>
                  <th className="py-2.5 px-3 font-semibold">Insumo o producto</th>
                  <th className="py-2.5 px-3 font-semibold">Unidad</th>
                  <th className="py-2.5 px-3 font-semibold">Cantidad</th>
                  <th className="py-2.5 px-3 font-semibold">Costo</th>
                  <th className="py-2.5 px-3 font-semibold">Descuento</th>
                  <th className="py-2.5 px-3 font-semibold">IVA</th>
                  <th className="py-2.5 px-3 font-semibold">Subtotal</th>
                  <th className="py-2.5 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {itemsCalculados.map((it, idx) => {
                  const clave = claveItemCompra(it)
                  return (
                  <Fragment key={clave}>
                  <tr className={idx > 0 ? 'border-t border-edge' : ''}>
                    <td className="py-2 px-3 text-xs text-muted">{String(idx + 1).padStart(2, '0')}</td>
                    <td className="py-2 px-3">
                      <p className="truncate font-medium">{nombreItemCompra(it)}</p>
                      {it.insumo?.codigoInterno && <p className="text-xs text-muted">{it.insumo.codigoInterno}</p>}
                    </td>
                    <td className="py-2 px-3">
                      <span className="text-xs px-2 py-1 rounded-pill border border-edge bg-raised whitespace-nowrap">
                        {it.insumo ? it.insumo.unidadCompra : 'Unidad'}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => sumarCantidad(clave, -1)}
                          className="w-7 h-8 rounded-lg border border-edge text-muted hover:text-ink grid place-items-center shrink-0"
                        >
                          −
                        </button>
                        <input
                          ref={registrarCampoCompra(`cantidad:${clave}`)}
                          type="number"
                          min="0"
                          step={it.insumo ? '0.001' : '1'}
                          className="field h-8 w-16 text-center px-1"
                          value={it.cantidad}
                          onChange={(e) => actualizarItem(clave, 'cantidad', e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => sumarCantidad(clave, 1)}
                          className="w-7 h-8 rounded-lg border border-edge text-muted hover:text-ink grid place-items-center shrink-0"
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex rounded-lg border border-edge overflow-hidden text-[10px] font-semibold mb-1 w-28">
                        <button
                          type="button"
                          onClick={() => cambiarModoCosto(clave, 'unitario')}
                          title="El valor que escribas es el costo de 1 unidad"
                          className={`flex-1 py-0.5 ${it.costoModo === 'global' ? 'text-muted hover:text-ink' : 'bg-amber text-night'}`}
                        >
                          Unidad
                        </button>
                        <button
                          type="button"
                          onClick={() => cambiarModoCosto(clave, 'global')}
                          title="El valor que escribas es el total de toda la línea; el costo por unidad se calcula solo"
                          className={`flex-1 py-0.5 border-l border-edge ${it.costoModo === 'global' ? 'bg-amber text-night' : 'text-muted hover:text-ink'}`}
                        >
                          Total
                        </button>
                      </div>
                      <div ref={registrarCampoCompra(`precio:${clave}`)}>
                        <MoneyInput
                          className="field h-8 w-28"
                          value={it.costoModo === 'global' ? it.costoGlobal : it.precioUnitario}
                          onChange={(v) =>
                            it.costoModo === 'global'
                              ? actualizarCostoGlobal(clave, v)
                              : actualizarItem(clave, 'precioUnitario', v)
                          }
                        />
                      </div>
                      {it.costoModo === 'global' && (
                        <p className="text-[10px] text-muted mt-0.5">{money(Number(it.precioUnitario) || 0)} c/u</p>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      <MoneyInput
                        className="field h-8 w-24"
                        value={it.descuento}
                        onChange={(v) => actualizarItem(clave, 'descuento', v)}
                      />
                    </td>
                    <td className="py-2 px-3">
                      <div className="relative w-16">
                        <input
                          ref={registrarCampoCompra(`inventario:${clave}`)}
                          type="number"
                          min="0"
                          max="100"
                          className="field h-8 w-16 text-center px-1"
                          value={it.porcentajeImpuesto}
                          onChange={(e) => actualizarItem(clave, 'porcentajeImpuesto', e.target.value)}
                        />
                      </div>
                    </td>
                    <td className="py-2 px-3 font-medium whitespace-nowrap">{money(it.total)}</td>
                    <td className="py-2 px-3 text-right">
                      <button type="button" onClick={() => quitarItem(clave)} className="text-muted hover:text-ocupada p-1">
                        <Icon.trash width={15} height={15} />
                      </button>
                    </td>
                  </tr>
                  {it.insumo && sinConversionFija(it.insumo, unidades) && (
                    <tr className="bg-raised/60">
                      <td></td>
                      <td colSpan={8} className="px-3 pb-2.5 pt-0">
                        <div className="flex items-center gap-2 flex-wrap text-xs">
                          <Icon.alert width={13} height={13} className="text-warningText shrink-0" />
                          <span className="text-muted">
                            Se compra por {it.insumo.unidadCompra} y se cuenta en {it.insumo.unidadInventario}. Ingresa la cantidad total recibida; por ejemplo, 4 paquetes de 2.000 g = 8.000 g.
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="field h-7 w-28 text-xs"
                            value={it.cantidadInventarioReal}
                            onChange={(e) => actualizarItem(clave, 'cantidadInventarioReal', e.target.value)}
                            placeholder="0"
                          />
                          <span className="text-muted">{it.insumo.unidadInventario} en total</span>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="bg-raised border border-edge rounded-xl p-4 grid grid-cols-3 gap-4 mt-4">
          <div>
            <p className="text-[10px] font-bold tracking-wide text-muted uppercase">Subtotal</p>
            <p className="text-base font-bold mt-0.5">{money(totales.subtotal)}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold tracking-wide text-muted uppercase">Impuesto</p>
            <p className="text-base font-bold mt-0.5">{money(totales.impuesto)}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold tracking-wide text-muted uppercase">Total</p>
            <p className="text-base font-bold mt-0.5">{money(totales.total)}</p>
          </div>
        </div>

        <div className="mt-4">
          <label className="label">Notas u observaciones del despacho</label>
          <textarea
            className="field resize-none"
            rows={2}
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
          />
        </div>
      </div>
      </div>

      {esNueva && paso === 2 && (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3 flex-wrap border-b border-edge pb-4">
            <div>
              <h3 className="text-base font-bold">Pago y confirmación</h3>
              <p className="mt-1 text-xs text-muted">Puedes dividir el pago entre contado y saldo a crédito.</p>
            </div>
            <button type="button" onClick={() => corregirDesdeResumen(1)} className="btn-ghost h-9 px-3 text-xs">
              <Icon.edit width={14} height={14} /> Corregir proveedor o ítems
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-edge bg-raised p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Proveedor y documento</p>
              <p className="mt-1 text-sm font-semibold">{proveedorSeleccionado?.name || 'Sin proveedor'}</p>
              <p className="text-xs text-muted">
                Factura {numeroDocumento.trim() || 'sin número'} · {formatFecha(fecha)}
              </p>
              {facturaNombre && <p className="mt-1 truncate text-xs text-muted">Adjunto: {facturaNombre}</p>}
            </div>
            <div className="rounded-xl border border-edge bg-raised p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Total de la compra</p>
              <p className="mt-1 text-xl font-bold tabular-nums">{money(totales.total)}</p>
              <p className="text-xs text-muted">{items.length} ítem{items.length === 1 ? '' : 's'} · stock al recibir</p>
            </div>
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <section className="overflow-hidden rounded-xl border border-edge">
              <div className="flex items-center justify-between gap-3 bg-raised px-3 py-2.5">
                <p className="text-xs font-bold">Productos e insumos de esta factura</p>
                <button type="button" onClick={() => corregirDesdeResumen(1)} className="text-xs font-semibold text-amberText hover:underline">
                  Editar
                </button>
              </div>
              <div className="max-h-[min(34rem,55vh)] divide-y divide-edge overflow-y-auto">
                {itemsCalculados.map((item) => (
                  <div key={claveItemCompra(item)} className="flex items-center justify-between gap-4 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{nombreItemCompra(item)}</p>
                      <p className="text-xs text-muted">Cantidad: {item.cantidad}</p>
                    </div>
                    <p className="shrink-0 font-semibold tabular-nums">{money(item.total)}</p>
                  </div>
                ))}
              </div>
            </section>

          <section ref={pagoSelectorRef} className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-bold">¿Cómo se paga esta compra?</h4>
                <p className="mt-1 text-xs text-muted">Por defecto queda contado; cualquier saldo sin asignar será crédito.</p>
              </div>
              {pagarAhora ? (
                <button
                  type="button"
                  onClick={() => {
                    setPagarAhora(false)
                    setFilasPago([])
                    setPagoInicializado(false)
                  }}
                  className="btn-ghost h-9 px-3 text-xs"
                >
                  Dejar todo a crédito
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setPagarAhora(true)
                    setPagoInicializado(false)
                  }}
                  className="btn-ghost h-9 px-3 text-xs"
                >
                  Agregar pago de contado
                </button>
              )}
            </div>

            {errorCuentasPago && (
              <p role="alert" className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warningText">
                {errorCuentasPago}. Elige otro medio disponible o deja la compra a crédito.
              </p>
            )}

            {pagarAhora ? (
              <SelectorMediosPago
                total={totales.total}
                shift={shift}
                cuentasPago={cuentasPago}
                filas={filasPago}
                onChange={setFilasPago}
                gridClassName="grid-cols-1 xl:grid-cols-2"
              />
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">Todo el valor queda a crédito</p>
                  <p className="text-xs text-muted">No se registra ningún desembolso al recibir.</p>
                </div>
                <p className="shrink-0 text-sm font-bold tabular-nums">{money(totales.total)}</p>
              </div>
            )}

          <div className="grid grid-cols-1 gap-3 rounded-xl border border-edge bg-raised p-4 sm:grid-cols-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Total factura</p>
              <p className="mt-1 text-base font-bold tabular-nums">{money(totales.total)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Pago asignado</p>
              <p className="mt-1 text-base font-bold tabular-nums">{money(pagarAhora ? pagoAsignado : 0)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Saldo a crédito</p>
              <p className={`mt-1 text-base font-bold tabular-nums ${saldoACredito > 0 ? 'text-warningText' : 'text-libre'}`}>
                {money(pagarAhora ? saldoACredito : totales.total)}
              </p>
            </div>
          </div>
          </section>
          </div>

          {corrigiendoDesdeConfirmacion && (
            <div className="rounded-xl border border-amber/40 bg-amber/10 px-3 py-2 text-sm text-amberText">
              Termina de revisar los pagos. Después te preguntaremos si confirmas los cambios.
            </div>
          )}
        </div>
      )}

      {!esNueva && <div className="pt-6 border-t border-edge space-y-4">
        <h3 className="text-sm font-bold tracking-wide uppercase flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-amber inline-block" />
          3. Pago y confirmación
        </h3>
        <p className="text-xs text-muted -mt-2">Solo aplica si le das a "Guardar y recibir mercancía" — un borrador no necesita nada de esto.</p>

        <div className="flex gap-2">
          <button type="button" onClick={() => setPagarAhora(false)} className={!pagarAhora ? 'btn-primary flex-1' : 'btn-ghost flex-1'}>
            Dejar a crédito
          </button>
          <button type="button" onClick={() => setPagarAhora(true)} className={pagarAhora ? 'btn-primary flex-1' : 'btn-ghost flex-1'}>
            Pagar ahora
          </button>
        </div>

        {pagarAhora && (
          <div className="space-y-3 bg-raised border border-edge rounded-xl p-3">
            <label className="label">¿De dónde sale la plata?</label>
            <SelectorMediosPago
              total={totales.total}
              shift={shift}
              cuentasPago={cuentasPago}
              filas={filasPago}
              onChange={setFilasPago}
            />
          </div>
        )}

        {!pagarAhora && (
          <div className="bg-raised border border-edge rounded-xl p-3">
            <p className="text-sm text-muted">
              Esta compra queda como cuenta por pagar
              {fechaVencimiento ? ` con vencimiento el ${formatFecha(fechaVencimiento)}` : ''}.
            </p>
          </div>
        )}
      </div>}

      {esNueva ? (
        <div className="flex flex-wrap justify-between gap-3 border-t border-edge pt-4">
          {paso === 1 ? (
            <>
              <button type="button" onClick={onCancel} className="btn-ghost">
                Cancelar
              </button>
              <button type="button" onClick={continuarAlPago} disabled={saving || subiendoFactura} className="btn-primary">
                {corrigiendoDesdeConfirmacion ? 'Terminar correcciones' : 'Continuar al pago'}
                {!corrigiendoDesdeConfirmacion && <Icon.chevronRight width={15} height={15} />}
              </button>
            </>
          ) : corrigiendoDesdeConfirmacion ? (
            <>
              <button type="button" onClick={() => corregirDesdeResumen(1)} className="btn-ghost">
                Corregir proveedor o ítems
              </button>
              <button type="button" onClick={continuarAlPago} disabled={saving} className="btn-primary">
                Terminar correcciones
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setPaso(1)} className="btn-ghost">
                <Icon.chevronLeft width={15} height={15} /> Volver
              </button>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => abrirConfirmacion('guardar')} disabled={saving} className="btn-ghost">
                  Guardar borrador
                </button>
                <button type="button" onClick={() => abrirConfirmacion('recibir')} disabled={saving} className="btn-primary">
                  <Icon.check width={16} height={16} /> Confirmar y recibir mercancía
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={guardarBorrador} disabled={saving} className="btn-ghost">
            {saving ? 'Guardando…' : 'Guardar borrador'}
          </button>
          <button type="button" onClick={abrirConfirmarRecibir} disabled={saving} className="btn-primary">
            <Icon.check width={16} height={16} />
            Guardar y recibir mercancía
          </button>
        </div>
      )}

      {confirmandoRecibir && !esNueva && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={cancelarConfirmarRecibir}>
          <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-sm p-5 space-y-4">
            <h2 className="text-lg font-bold">Confirmar recepción</h2>
            <p className="text-sm text-muted">
              Vas a subir el stock de {items.length} ítem{items.length === 1 ? '' : 's'} por {money(totales.total)}
              {pagarAhora ? '.' : ', y dejarla como cuenta por pagar.'}
            </p>

            <PinField
              pin={pin}
              onChange={setPin}
              verificando={verificandoPin}
              error={pinError}
              bloqueado={pinBloqueado}
              segundosRestantes={pinSegundosRestantes}
              label="PIN del encargado"
              autoFocus
            />

            {error && <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">{error}</p>}

            <div className="flex gap-3 pt-1">
              <button type="button" onClick={cancelarConfirmarRecibir} className="btn-ghost flex-1">
                Cancelar
              </button>
              <button type="button" onClick={recibirCompra} disabled={!pinValido || saving} className="btn-primary flex-1">
                {saving ? 'Recibiendo…' : 'Recibir mercancía'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmandoRecibir && esNueva && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-black/75 p-2 sm:p-5"
          onClick={cancelarConfirmarRecibir}
          role="presentation"
        >
          <section
            onClick={(event) => event.stopPropagation()}
            className="card my-auto flex max-h-[calc(100dvh-1rem)] w-full max-w-4xl flex-col overflow-hidden border-t-4 border-t-libre"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirmar-compra-titulo"
          >
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-edge px-4 py-4 sm:px-6">
              <div className="min-w-0">
                <h2 id="confirmar-compra-titulo" className="text-lg font-bold sm:text-xl">
                  {accionConfirmacion === 'guardar' ? 'Confirmación del borrador' : 'Confirmar pago y recepción'}
                </h2>
                <p className="mt-1 truncate text-sm text-muted">
                  {proveedorSeleccionado?.name || 'Proveedor'} · Factura {numeroDocumento.trim() || 'sin número'}
                </p>
              </div>
              <button type="button" onClick={cancelarConfirmarRecibir} className="btn-ghost h-9 w-9 shrink-0 p-0" aria-label="Cerrar confirmación">
                <Icon.x width={17} height={17} />
              </button>
            </header>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
              <div className="grid gap-3 rounded-xl border border-edge bg-raised p-4 sm:grid-cols-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Total factura</p>
                  <p className="mt-1 text-lg font-bold tabular-nums">{money(totales.total)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Pago asignado</p>
                  <p className="mt-1 text-lg font-bold tabular-nums">{money(pagarAhora ? pagoAsignado : 0)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Saldo a crédito</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-warningText">
                    {money(pagarAhora ? saldoACredito : totales.total)}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr]">
                <section className="overflow-hidden rounded-xl border border-edge">
                  <div className="flex items-center justify-between gap-2 bg-raised px-3 py-2">
                    <h3 className="text-xs font-bold">Ítems de la compra ({items.length})</h3>
                    <button type="button" onClick={() => corregirDesdeResumen(1)} className="text-xs font-semibold text-amberText hover:underline">
                      Corregir
                    </button>
                  </div>
                  <div className="max-h-36 divide-y divide-edge overflow-y-auto">
                    {itemsCalculados.map((item) => (
                      <div key={claveItemCompra(item)} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{nombreItemCompra(item)}</p>
                          <p className="text-xs text-muted">Cantidad: {item.cantidad}</p>
                        </div>
                        <p className="shrink-0 font-semibold tabular-nums">{money(item.total)}</p>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="space-y-2 rounded-xl border border-edge p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-bold">Formas de pago</h3>
                    <button type="button" onClick={() => corregirDesdeResumen(2)} className="text-xs font-semibold text-amberText hover:underline">
                      Corregir
                    </button>
                  </div>
                  {pagarAhora && filasPago.length > 0 ? (
                    <div className="space-y-1.5">
                      {filasPago.map((fila) => {
                        const tarjeta = tarjetasPago(shift, cuentasPago).find((opcion) => opcion.key === fila.key)
                        return (
                          <div key={fila.key} className="flex justify-between gap-3 text-xs">
                            <span className="min-w-0 truncate text-muted">{tarjeta?.label || fila.metodo}</span>
                            <span className="shrink-0 font-semibold tabular-nums">{money(Number(fila.monto) || 0)}</span>
                          </div>
                        )
                      })}
                      <div className="flex justify-between gap-3 border-t border-edge pt-2 text-xs">
                        <span className="text-muted">Saldo pendiente</span>
                        <span className="font-semibold tabular-nums">{money(saldoACredito)}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-warningText">No se desembolsa dinero; el total queda a crédito.</p>
                  )}
                  {fechaVencimiento && (
                    <p className="pt-1 text-xs text-muted">Vence: {formatFecha(fechaVencimiento)}</p>
                  )}
                </section>
              </div>

              {accionConfirmacion === 'guardar' && (
                <p className="rounded-xl border border-edge bg-raised px-3 py-2 text-xs text-muted">
                  Guardar como borrador no mueve inventario ni registra pagos. Los pagos solo se aplican al recibir la mercancía.
                </p>
              )}

              <div className="rounded-xl border border-edge bg-raised p-3 sm:p-4">
                <PinField
                  pin={pin}
                  onChange={setPin}
                  verificando={verificandoPin}
                  error={pinError}
                  bloqueado={pinBloqueado}
                  segundosRestantes={pinSegundosRestantes}
                  label="Código de empleado responsable"
                  autoFocus
                />
              </div>

              {error && <p role="alert" className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">{error}</p>}
            </div>

            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-edge px-4 py-3 sm:px-6">
              <button type="button" onClick={cancelarConfirmarRecibir} className="btn-ghost">
                Cancelar
              </button>
              <button
                type="button"
                onClick={accionConfirmacion === 'guardar' ? guardarBorrador : recibirCompra}
                disabled={!pinValido || saving}
                className="btn-primary min-w-56 justify-center"
              >
                {saving ? 'Guardando…' : accionConfirmacion === 'guardar' ? 'Guardar borrador' : 'Confirmar y recibir'}
              </button>
            </footer>
          </section>
        </div>
      )}

      {confirmandoCambios && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-4" role="presentation">
          <section className="card w-full max-w-md space-y-4 p-5" role="dialog" aria-modal="true" aria-labelledby="confirmar-cambios-compra">
            <h2 id="confirmar-cambios-compra" className="text-lg font-bold">¿Estás seguro de estos cambios?</h2>
            <p className="text-sm text-muted">
              Volverás al resumen de la compra con los datos corregidos. No se guardará ni recibirá nada hasta que confirmes con el código de empleado.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setConfirmandoCambios(false)} className="btn-ghost">
                Seguir corrigiendo
              </button>
              <button type="button" onClick={confirmarCorrecciones} className="btn-primary">
                Sí, continuar
              </button>
            </div>
          </section>
        </div>
      )}

      {avisoValidacion && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4" role="presentation">
          <section
            className="card w-full max-w-md space-y-4 p-5"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="aviso-validacion-compra"
            aria-describedby="aviso-validacion-compra-mensaje"
          >
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-warning/15 text-warningText">
                <Icon.alert width={18} height={18} />
              </span>
              <div>
                <h2 id="aviso-validacion-compra" className="text-base font-bold">Revisa la compra</h2>
                <p id="aviso-validacion-compra-mensaje" className="mt-1 text-sm text-muted">{avisoValidacion}</p>
              </div>
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={cerrarAvisoValidacion} className="btn-primary min-w-28 justify-center">
                Entendido
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

// --- Detalle de una compra existente ----------------------------------------

function CompraDetalle({
  id,
  proveedores,
  insumos,
  productosStock,
  categoriasInsumo,
  categoriasProducto,
  unidades,
  onProveedorCreado,
  onInsumoCreado,
  onCategoriaInsumoCreada,
  onProductoCreado,
  onActualizada,
  onCancel,
}) {
  const [compra, setCompra] = useState(null)
  const [error, setError] = useState('')
  const [editando, setEditando] = useState(false)
  const [modalPago, setModalPago] = useState(false)
  const [modalAnular, setModalAnular] = useState(false)
  const [modalRecibir, setModalRecibir] = useState(false)
  const [subiendoFactura, setSubiendoFactura] = useState(false)
  const [errorFactura, setErrorFactura] = useState('')

  async function cargar() {
    try {
      setCompra(await api(`/compras/${id}`))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function refrescar() {
    await cargar()
    await onActualizada()
  }

  // A diferencia de editar cabecera/items (solo en BORRADOR, via CompraForm),
  // adjuntar la factura no mueve stock ni plata: se puede hacer en cualquier
  // estado, por eso vive aqui y no dentro del formulario de edicion.
  async function subirFactura(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setSubiendoFactura(true)
    setErrorFactura('')
    try {
      const dataUrl = await prepararFactura(file)
      const subida = await api('/compras/factura', { method: 'POST', body: { file: dataUrl, nombre: file.name } })
      await api(`/compras/${compra.id}/factura`, { method: 'PATCH', body: subida })
      await refrescar()
    } catch (err) {
      setErrorFactura(err.message)
    } finally {
      setSubiendoFactura(false)
    }
  }

  async function quitarFactura() {
    setSubiendoFactura(true)
    setErrorFactura('')
    try {
      await api(`/compras/${compra.id}/factura`, { method: 'PATCH', body: { facturaUrl: null } })
      await refrescar()
    } catch (err) {
      setErrorFactura(err.message)
    } finally {
      setSubiendoFactura(false)
    }
  }

  if (error) return <p className="text-sm text-ocupada">{error}</p>
  if (!compra) return <div className="card p-10 text-center text-muted text-sm">Cargando…</div>

  if (editando) {
    return (
      <CompraForm
        compraExistente={compra}
        proveedores={proveedores}
        insumos={insumos}
        productosStock={productosStock}
        categoriasInsumo={categoriasInsumo}
        categoriasProducto={categoriasProducto}
        unidades={unidades}
        onProveedorCreado={onProveedorCreado}
        onInsumoCreado={onInsumoCreado}
        onCategoriaInsumoCreada={onCategoriaInsumoCreada}
        onProductoCreado={onProductoCreado}
        onSaved={async () => {
          setEditando(false)
          await refrescar()
        }}
        onCancel={() => setEditando(false)}
      />
    )
  }

  return (
    <div className="card p-5 md:p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap pb-4 border-b border-edge">
        <Migaja onCancel={onCancel} activa={compra.proveedor.name} numeroDocumento={compra.numeroDocumento} />
        <span
          className={`text-xs font-semibold px-2.5 py-1 rounded-pill border ${
            compra.estado === 'RECIBIDA'
              ? 'text-libre border-libre/40 bg-libre/10'
              : compra.estado === 'ANULADA'
                ? 'text-muted border-edge bg-raised'
                : 'text-warningText border-warning/40 bg-warning/10'
          }`}
        >
          {ESTADO_LABEL[compra.estado]}
        </span>
      </div>

      <p className="text-xs text-muted -mt-3">{formatFecha(compra.fecha)}</p>

      {compra.observaciones && <p className="text-sm text-muted bg-raised border border-edge rounded-xl p-3">{compra.observaciones}</p>}

      <div className="flex items-center gap-2 flex-wrap">
        <label className="btn-ghost h-9 px-3 text-xs cursor-pointer">
          {subiendoFactura ? (
            'Subiendo…'
          ) : (
            <>
              <Icon.receipt width={14} height={14} /> {compra.facturaUrl ? 'Cambiar factura' : 'Adjuntar factura'}
            </>
          )}
          <input
            type="file"
            accept="image/jpeg,image/png,image/gif,application/pdf"
            className="hidden"
            onChange={subirFactura}
            disabled={subiendoFactura}
          />
        </label>
        {compra.facturaUrl && (
          <>
            <a
              href={compra.facturaUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-amberText hover:underline truncate max-w-[220px]"
            >
              {compra.facturaNombre || 'Ver archivo'}
            </a>
            <button type="button" onClick={quitarFactura} disabled={subiendoFactura} className="text-muted hover:text-ocupada p-1">
              <Icon.trash width={14} height={14} />
            </button>
          </>
        )}
        {errorFactura && <p className="text-xs text-ocupada w-full">{errorFactura}</p>}
      </div>

      <div className="rounded-xl border border-edge overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-xs text-muted uppercase tracking-wide bg-raised">
              <th className="py-2.5 px-3 font-semibold">Insumo o producto</th>
              <th className="py-2.5 px-3 font-semibold">Cantidad</th>
              <th className="py-2.5 px-3 font-semibold">Precio unit.</th>
              <th className="py-2.5 px-3 font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {compra.items.map((it, idx) => {
              const imageUrl = it.insumo ? it.insumo.imageUrl : it.variant?.product?.imageUrl
              return (
              <tr key={it.id} className={idx > 0 ? 'border-t border-edge' : ''}>
                <td className="py-2 px-3">
                  <div className="flex items-center gap-2.5">
                    <span className="w-8 h-8 rounded-lg overflow-hidden shrink-0 grid place-items-center bg-canvas border border-edge">
                      {imageUrl ? (
                        <img src={imageUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Icon.box width={14} height={14} className="text-muted" />
                      )}
                    </span>
                    <span className="truncate">{nombreItemCompra(it)}</span>
                  </div>
                </td>
                <td className="py-2 px-3">
                  {it.cantidad} {it.insumo ? it.insumo.unidadCompra : 'unidad(es)'}
                  {it.cantidadInventarioReal != null && (
                    <span className="block text-xs text-muted">
                      {it.cantidadInventarioReal} {it.insumo.unidadInventario} reales
                    </span>
                  )}
                </td>
                <td className="py-2 px-3 text-muted">{money(it.precioUnitario)}</td>
                <td className="py-2 px-3 font-medium">{money(it.total)}</td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="bg-raised border border-edge rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <p className="text-[10px] font-bold tracking-wide text-muted uppercase">Total</p>
          <p className="text-base font-bold mt-0.5">{money(compra.total)}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold tracking-wide text-muted uppercase">Pagado</p>
          <p className="text-base font-bold mt-0.5">{money(compra.totalPagado)}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold tracking-wide text-muted uppercase">Saldo pendiente</p>
          <p className={`text-base font-bold mt-0.5 ${compra.saldoPendiente > 0 ? 'text-ocupada' : ''}`}>
            {money(compra.saldoPendiente)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-bold tracking-wide text-muted uppercase">Estado del pago</p>
          <p className="text-base font-bold mt-0.5">{ESTADO_PAGO_LABEL[compra.estadoPago]}</p>
        </div>
      </div>

      {compra.pagos.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">Pagos registrados</h3>
          <div className="space-y-1.5">
            {compra.pagos.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm bg-raised border border-edge rounded-lg px-3 py-2">
                <div>
                  <p>
                    {p.metodo === 'EFECTIVO_TURNO'
                      ? 'Efectivo de turno'
                      : p.metodo === 'CUENTA_FINANCIERA'
                        ? 'Cuenta financiera'
                        : `Otro${p.nota ? ` · ${p.nota}` : ''}`}
                  </p>
                  <p className="text-xs text-muted">{formatFechaHora(p.createdAt)} · {p.createdBy.name}</p>
                </div>
                <p className="font-semibold">{money(p.monto)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {compra.estado === 'ANULADA' && compra.motivoAnulacion && (
        <p className="text-sm text-muted bg-raised border border-edge rounded-xl p-3">
          Motivo de anulación: {compra.motivoAnulacion}
        </p>
      )}

      <div className="flex gap-2 flex-wrap pt-1">
        {compra.estado === 'BORRADOR' && (
          <>
            <button type="button" onClick={() => setEditando(true)} className="btn-ghost">
              Editar
            </button>
            <button type="button" onClick={() => setModalRecibir(true)} className="btn-primary">
              Recibir mercancía
            </button>
            <button type="button" onClick={() => setModalAnular(true)} className="btn-ghost text-ocupada">
              Anular
            </button>
          </>
        )}
        {compra.estado === 'RECIBIDA' && (
          <>
            {compra.saldoPendiente > 0 && (
              <button type="button" onClick={() => setModalPago(true)} className="btn-primary">
                Registrar pago
              </button>
            )}
            <button
              type="button"
              onClick={() => setModalAnular(true)}
              disabled={compra.pagos.length > 0}
              className="btn-ghost text-ocupada disabled:opacity-40"
              title={compra.pagos.length > 0 ? 'Ya tiene pagos registrados: gestiona el reembolso aparte' : ''}
            >
              Anular
            </button>
          </>
        )}
      </div>

      {modalPago && (
        <PagoModal
          compra={compra}
          onCancel={() => setModalPago(false)}
          onPagado={async () => {
            setModalPago(false)
            await refrescar()
          }}
        />
      )}
      {modalAnular && (
        <AnularModal
          compra={compra}
          onCancel={() => setModalAnular(false)}
          onAnulada={async () => {
            setModalAnular(false)
            await refrescar()
          }}
        />
      )}
      {modalRecibir && (
        <RecibirModal
          compra={compra}
          onCancel={() => setModalRecibir(false)}
          onRecibida={async () => {
            setModalRecibir(false)
            await refrescar()
          }}
        />
      )}
    </div>
  )
}

export function PagoModal({ compra, onCancel, onPagado }) {
  const { shift } = useShift()
  const [cuentasPago, setCuentasPago] = useState([])
  const [filasPago, setFilasPago] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const {
    pin,
    setPin,
    valido: pinValido,
    verificando: verificandoPin,
    error: pinError,
    bloqueado: pinBloqueado,
    segundosRestantes: pinSegundosRestantes,
  } = usePinVerificado()

  useEffect(() => {
    api('/compras/cuentas-pago').then(setCuentasPago).catch(() => setCuentasPago([]))
  }, [])

  const completo = !errorFilasPago(filasPago, compra.saldoPendiente) && filasPago.length > 0 && pinValido

  async function confirmar() {
    setSaving(true)
    setError('')
    try {
      await api(`/compras/${compra.id}/pagos`, {
        method: 'POST',
        body: { pin, pagos: filasParaBody(filasPago) },
      })
      onPagado()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto" onClick={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-6 space-y-5"
      >
        <h2 className="text-lg font-bold">Registrar pago</h2>
        <p className="text-sm text-muted">Saldo pendiente: <span className="font-semibold text-ink">{money(compra.saldoPendiente)}</span></p>

        <label className="label">¿De dónde sale la plata?</label>
        <SelectorMediosPago
          total={compra.saldoPendiente}
          shift={shift}
          cuentasPago={cuentasPago}
          filas={filasPago}
          onChange={setFilasPago}
          gridClassName="grid-cols-1 min-[720px]:grid-cols-2"
        />

        <PinField
          pin={pin}
          onChange={setPin}
          verificando={verificandoPin}
          error={pinError}
          bloqueado={pinBloqueado}
          segundosRestantes={pinSegundosRestantes}
          label="PIN del encargado"
        />

        {error && <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onCancel} className="btn-ghost flex-1">
            Cancelar
          </button>
          <button type="button" onClick={confirmar} disabled={!completo || saving} className="btn-primary flex-1">
            {saving ? 'Registrando…' : 'Registrar pago'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AnularModal({ compra, onCancel, onAnulada }) {
  const [motivo, setMotivo] = useState('')
  const necesitaPin = compra.estado === 'RECIBIDA'
  const {
    pin,
    setPin,
    valido: pinValido,
    verificando: verificandoPin,
    error: pinError,
    bloqueado: pinBloqueado,
    segundosRestantes: pinSegundosRestantes,
  } = usePinVerificado()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function confirmar() {
    setSaving(true)
    setError('')
    try {
      await api(`/compras/${compra.id}/anular`, { method: 'POST', body: { motivo, ...(necesitaPin && { pin }) } })
      onAnulada()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto" onClick={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-6 space-y-5"
      >
        <h2 className="text-lg font-bold">Anular compra</h2>
        <p className="text-sm text-muted">
          {necesitaPin
            ? 'Esto revierte el stock que esta compra le sumó a cada insumo. No se puede deshacer.'
            : 'Este borrador todavía no movió stock ni plata.'}
        </p>

        <div>
          <label className="label">Motivo (opcional)</label>
          <input className="field" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
        </div>

        {necesitaPin && (
          <PinField
            pin={pin}
            onChange={setPin}
            verificando={verificandoPin}
            error={pinError}
            bloqueado={pinBloqueado}
            segundosRestantes={pinSegundosRestantes}
            label="PIN del encargado"
          />
        )}

        {error && <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onCancel} className="btn-ghost flex-1">
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={(necesitaPin && !pinValido) || saving}
            className="btn-danger flex-1"
          >
            {saving ? 'Anulando…' : 'Anular compra'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RecibirModal({ compra, onCancel, onRecibida }) {
  const { shift } = useShift()
  const [cuentasPago, setCuentasPago] = useState([])
  const [pagarAhora, setPagarAhora] = useState(true)
  const [filasPago, setFilasPago] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const {
    pin,
    setPin,
    valido: pinValido,
    verificando: verificandoPin,
    error: pinError,
    bloqueado: pinBloqueado,
    segundosRestantes: pinSegundosRestantes,
  } = usePinVerificado()

  useEffect(() => {
    api('/compras/cuentas-pago').then(setCuentasPago).catch(() => setCuentasPago([]))
  }, [])

  const completo = pinValido && (!pagarAhora || !errorFilasPago(filasPago, Number(compra.total)))

  async function confirmar() {
    setSaving(true)
    setError('')
    try {
      await api(`/compras/${compra.id}/recibir`, {
        method: 'POST',
        body: { pin, ...(pagarAhora && filasPago.length > 0 && { pagos: filasParaBody(filasPago) }) },
      })
      onRecibida()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-sm p-5 space-y-4">
        <h2 className="text-lg font-bold">Recibir mercancía</h2>
        <p className="text-sm text-muted">Sube el stock de cada insumo de esta compra. Total: {money(compra.total)}</p>

        <div className="flex gap-2">
          <button type="button" onClick={() => setPagarAhora(false)} className={!pagarAhora ? 'btn-primary flex-1' : 'btn-ghost flex-1'}>
            A crédito
          </button>
          <button type="button" onClick={() => setPagarAhora(true)} className={pagarAhora ? 'btn-primary flex-1' : 'btn-ghost flex-1'}>
            Pagar ahora
          </button>
        </div>

        {pagarAhora && (
          <SelectorMediosPago
            total={Number(compra.total)}
            shift={shift}
            cuentasPago={cuentasPago}
            filas={filasPago}
            onChange={setFilasPago}
            gridClassName="grid-cols-1 min-[720px]:grid-cols-2"
          />
        )}

        <PinField
          pin={pin}
          onChange={setPin}
          verificando={verificandoPin}
          error={pinError}
          bloqueado={pinBloqueado}
          segundosRestantes={pinSegundosRestantes}
          label="PIN del encargado"
        />

        {error && <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onCancel} className="btn-ghost flex-1">
            Cancelar
          </button>
          <button type="button" onClick={confirmar} disabled={!completo || saving} className="btn-primary flex-1">
            {saving ? 'Recibiendo…' : 'Recibir mercancía'}
          </button>
        </div>
      </div>
    </div>
  )
}
