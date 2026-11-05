import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { api, money } from '../lib/api'
import { Icon } from '../components/Icons'
import MoneyInput from '../components/MoneyInput'
import PinField from '../components/PinField'
import RangoFechas from '../components/RangoFechas'
import SelectorFecha from '../components/SelectorFecha'
import InsumoForm from '../components/InsumoForm'
import ReciboEncabezado from '../components/ReciboEncabezado'
import ReciboPie from '../components/ReciboPie'
import { usePinVerificado } from '../hooks/usePinVerificado'
import { useShift } from '../context/ShiftContext'
import { useAuth } from '../context/AuthContext'
import { parseISOLocal, calcularRangoDias, isoLocal } from '../lib/fechas'
import { prepararFactura } from '../lib/image'
import { construirTicketRaster } from '../lib/ticketRaster'
import { imprimirSilencioso } from '../lib/printer'

const ESTADO_LABEL = { BORRADOR: 'Borrador', RECIBIDA: 'Recibida', ANULADA: 'Anulada' }
const ESTADO_PAGO_LABEL = { PENDIENTE: 'Pendiente', PARCIAL: 'Pago parcial', PAGADA: 'Pagada' }
const FILTROS = [
  { key: 'todas', label: 'Todas' },
  { key: 'BORRADOR', label: 'Borrador' },
  { key: 'RECIBIDA', label: 'Recibidas' },
  { key: 'CON_SALDO', label: 'Con saldo' },
]

function formatFecha(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('es-CO', { dateStyle: 'medium' })
}
function formatFechaHora(iso) {
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
function diasParaVencer(fechaVencimiento) {
  if (!fechaVencimiento) return null
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const venc = parseISOLocal(fechaVencimiento.slice(0, 10))
  return Math.round((venc - hoy) / 86400000)
}
function resumenItems(items) {
  if (!items || items.length === 0) return 'Sin insumos'
  if (items.length === 1) return items[0].insumo.name
  return `${items[0].insumo.name} + ${items.length - 1} más`
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
        return (
          <button
            key={i.id}
            type="button"
            onClick={() => onToggle(i.id)}
            className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors ${
              agregado ? 'border-amber/50 bg-amber/10' : 'border-ocupada/30 bg-ocupada/5 hover:border-ocupada/50'
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
                <p className="text-xs text-ocupada font-medium mt-0.5">
                  De esto {nRecetas === 1 ? 'depende' : 'dependen'} {nRecetas} {nRecetas === 1 ? 'receta' : 'recetas'} 😰
                </p>
              )}
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-bold text-ocupada whitespace-nowrap">
                {i.stock} {nombreUnidad(i.unidadInventario, unidades)}
              </p>
              <p className="text-[10px] text-muted">mínimo {i.stockMinimo}</p>
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
    const [p, i, c, u, prod] = await Promise.all([
      api('/proveedores'),
      api('/insumos'),
      api('/insumo-categorias'),
      api('/insumos/unidades'),
      api('/products'),
    ])
    setProveedores(p)
    setInsumos(i)
    setCategoriasInsumo(c)
    setUnidades(u)
    setRecetas(prod.filter((pr) => pr.kind === 'PREPARED'))
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

  // Mismo criterio que "Stock bajo" en Insumos.jsx: solo cuenta si el insumo
  // declaro un minimo (stockMinimo null = nunca se configuro, no avisa).
  const insumosStockBajo = useMemo(
    () => insumos.filter((i) => i.active && i.stockMinimo != null && i.stock <= i.stockMinimo),
    [insumos]
  )

  // Cuantas recetas distintas usan cada insumo -- para que la alerta de
  // stock bajo deje claro cuales son urgentes de verdad, no solo un numero.
  const recetasPorInsumo = useMemo(() => {
    const mapa = new Map()
    for (const receta of recetas) {
      const idsUnicos = new Set((receta.recipe?.items || []).filter((it) => it.insumoId).map((it) => it.insumoId))
      for (const id of idsUnicos) mapa.set(id, (mapa.get(id) || 0) + 1)
    }
    return mapa
  }, [recetas])

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
                  filtro === f.key ? 'bg-amber text-night border-amber' : 'bg-raised text-muted border-edge hover:text-ink'
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
                    ? { label: 'Editando recepción', cls: 'text-amberText border-amber/40 bg-amber/10' }
                    : { label: 'Borrador guardado', cls: 'text-muted border-edge bg-raised' }
                }
                if (c.estado === 'ANULADA') return { label: 'Anulada', cls: 'text-muted border-edge bg-raised' }
                if (c.saldoPendiente > 0) return { label: 'Saldo pendiente', cls: 'text-ocupada border-ocupada/40 bg-ocupada/10' }
                return { label: 'Recibida completa', cls: 'text-libre border-libre/40 bg-libre/10' }
              })()
              const dias = c.estado === 'RECIBIDA' && c.saldoPendiente > 0 ? diasParaVencer(c.fechaVencimiento) : null
              const tagDerecha =
                c.estado === 'BORRADOR'
                  ? { label: 'Sin confirmar', cls: 'text-amberText' }
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
                className="xl:hidden fixed right-0 top-1/2 -translate-y-1/2 z-40 bg-ocupada text-white
                           rounded-l-xl px-1.5 py-3 shadow-lg flex flex-col items-center gap-1"
              >
                <Icon.alert width={16} height={16} />
                <span className="text-[10px] font-bold">{insumosStockBajo.length}</span>
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
        ) : (
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
                {selectedId === 'new' ? (
                  <CompraForm
                    proveedores={proveedores}
                    insumos={insumos}
                    categoriasInsumo={categoriasInsumo}
                    unidades={unidades}
                    onProveedorCreado={(p) => setProveedores((prev) => [...prev, p])}
                    onInsumoCreado={onInsumoCreado}
                    onCategoriaInsumoCreada={onCategoriaInsumoCreada}
                    onCreated={async (compra) => {
                      await recargarTodo()
                      setSelectedId(compra.id)
                    }}
                    onCancel={() => setSelectedId(undefined)}
                  />
                ) : (
                  <CompraDetalle
                    key={selected}
                    id={selected}
                    proveedores={proveedores}
                    insumos={insumos}
                    categoriasInsumo={categoriasInsumo}
                    unidades={unidades}
                    onProveedorCreado={(p) => setProveedores((prev) => [...prev, p])}
                    onInsumoCreado={onInsumoCreado}
                    onCategoriaInsumoCreada={onCategoriaInsumoCreada}
                    onActualizada={recargarTodo}
                    onCancel={() => setSelectedId(undefined)}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {verListaCompra && (
        <ListaCompraModal
          items={listaCompra}
          unidades={unidades}
          tenant={session?.tenant}
          onQuitar={toggleEnListaCompra}
          onClose={() => setVerListaCompra(false)}
        />
      )}
    </div>
  )
}

// --- Lista de compras (recordatorio de insumos a pedir, ver toggle en
// ListaStockBajo) -- imprime como tirilla (misma via que el resto del POS:
// termica si hay, si no window.print()) o manda un resumen por WhatsApp. ---

function ListaCompraModal({ items, unidades, tenant, onQuitar, onClose }) {
  const [pidiendoWhatsapp, setPidiendoWhatsapp] = useState(false)
  const [numeroWhatsapp, setNumeroWhatsapp] = useState('')

  function lineasTicket() {
    return [
      { texto: (tenant?.legalName || tenant?.name || 'Barminister').toUpperCase(), centro: true, negrita: true },
      { texto: 'Lista de compras', centro: true },
      { texto: new Date().toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }), centro: true },
      { raya: true },
      ...items.map((it) => ({
        texto: `${it.insumo.name}${it.insumo.proveedor ? ` (${it.insumo.proveedor.name})` : ''}`,
      })),
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
      ...items.map((it) => `• ${it.insumo.name}${it.insumo.proveedor ? ` (${it.insumo.proveedor.name})` : ''}`),
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
            items.map((it) => (
              <p key={it.insumoId}>
                {it.insumo.name}
                {it.insumo.proveedor ? ` (${it.insumo.proveedor.name})` : ''}
              </p>
            ))
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
              <div key={it.insumoId} className="flex items-center justify-between gap-2 px-1.5 py-1 text-sm">
                <span className="truncate">{it.insumo.name}</span>
                <button
                  type="button"
                  onClick={() => onQuitar(it.insumoId)}
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
  if (shift?.id) tarjetas.push({ key: 'EFECTIVO_TURNO', metodo: 'EFECTIVO_TURNO', label: 'Efectivo del turno', icon: 'cash' })
  for (const c of cuentasPago) {
    tarjetas.push({
      key: `CUENTA:${c.id}`,
      metodo: 'CUENTA_FINANCIERA',
      cuentaFinancieraId: c.id,
      label: c.nombre,
      icon: ICONO_CUENTA[c.tipo] || 'bank',
    })
  }
  tarjetas.push({ key: 'OTRO', metodo: 'OTRO', label: 'Otro', icon: 'tag' })
  return tarjetas
}

function errorFilasPago(filas, total) {
  if (filas.length === 0) return ''
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

function SelectorMediosPago({ total, shift, cuentasPago, filas, onChange }) {
  const tarjetas = useMemo(() => tarjetasPago(shift, cuentasPago), [shift, cuentasPago])
  const suma = filas.reduce((s, f) => s + (Number(f.monto) || 0), 0)
  const restante = total - suma

  // Arranca cubriendo todo con el primer medio disponible, igual que el POS
  // cuando solo hay un medio -- el monto nunca empieza vacío.
  useEffect(() => {
    if (filas.length === 0 && tarjetas.length > 0) {
      const primera = tarjetas[0]
      onChange([
        {
          key: primera.key,
          metodo: primera.metodo,
          cuentaFinancieraId: primera.cuentaFinancieraId,
          shiftId: shift?.id,
          monto: String(total),
          nota: '',
        },
      ])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tarjetas.length])

  // Con un solo medio activo (el caso mas comun) se mantiene igualado al
  // total: asi cambiar items o el peso real no deja el monto desactualizado.
  // Con varios, el encargado los reparte el mismo a mano.
  useEffect(() => {
    if (filas.length === 1 && Number(filas[0].monto) !== total) onChange([{ ...filas[0], monto: String(total) }])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total])

  function alternar(card) {
    const idx = filas.findIndex((f) => f.key === card.key)
    if (idx >= 0) {
      if (filas.length === 1) return
      onChange(filas.filter((_, i) => i !== idx))
    } else {
      if (restante <= 0) return
      onChange([
        ...filas,
        {
          key: card.key,
          metodo: card.metodo,
          cuentaFinancieraId: card.cuentaFinancieraId,
          shiftId: shift?.id,
          monto: String(Math.max(restante, 0)),
          nota: '',
        },
      ])
    }
  }
  function actualizarFila(key, patch) {
    onChange(filas.map((f) => (f.key === key ? { ...f, ...patch } : f)))
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {tarjetas.map((card) => {
          const CardIcon = Icon[card.icon]
          const activa = filas.some((f) => f.key === card.key)
          const deshabilitada = !activa && restante <= 0
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => alternar(card)}
              disabled={deshabilitada}
              className={`flex items-center gap-2.5 p-2.5 rounded-xl border-2 text-left transition-colors ${
                activa ? 'border-amber bg-amber/10' : 'border-edge bg-raised hover:border-muted'
              } ${deshabilitada ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              <span
                className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ${
                  activa ? 'bg-amber text-night' : 'bg-canvas text-muted'
                }`}
              >
                <CardIcon width={16} height={16} />
              </span>
              <span className="text-sm font-semibold truncate">{card.label}</span>
            </button>
          )
        })}
      </div>

      {filas.map((f) => {
        const card = tarjetas.find((c) => c.key === f.key)
        return (
          <div key={f.key} className="bg-raised border border-edge rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted">{card?.label}</p>
              {filas.length > 1 && (
                <button
                  type="button"
                  onClick={() => onChange(filas.filter((x) => x.key !== f.key))}
                  className="text-muted hover:text-ocupada"
                >
                  <Icon.trash width={14} height={14} />
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="label text-xs">Monto</label>
                <MoneyInput className="field h-9" value={f.monto} onChange={(v) => actualizarFila(f.key, { monto: v })} />
              </div>
              {f.metodo === 'OTRO' && (
                <div className="flex-1">
                  <label className="label text-xs">¿De qué se trata?</label>
                  <input
                    className="field h-9"
                    value={f.nota}
                    onChange={(e) => actualizarFila(f.key, { nota: e.target.value })}
                    placeholder="Ej: canje de mercancía, caja de eventos"
                  />
                </div>
              )}
            </div>
          </div>
        )
      })}

      <p className={`text-sm font-semibold ${suma > total + 0.01 ? 'text-ocupada' : restante > 0.01 ? 'text-amberText' : 'text-libre'}`}>
        {suma > total + 0.01
          ? `Sobran ${money(suma - total)} asignados`
          : restante > 0.01
            ? `Quedan ${money(restante)} a crédito`
            : 'Cubre el total'}
      </p>
    </div>
  )
}

function CompraForm({
  compraExistente,
  proveedores,
  insumos,
  categoriasInsumo,
  unidades,
  onProveedorCreado,
  onInsumoCreado,
  onCategoriaInsumoCreada,
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
      insumo: it.insumo,
      cantidad: String(it.cantidad),
      precioUnitario: String(it.precioUnitario),
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
  const [insumosProveedor, setInsumosProveedor] = useState([])

  // Recibir mercancia sube stock de una (ver api/src/routes/compras.js); este
  // checkbox decide entre esa accion ('recibir') o dejarla en BORRADOR
  // ('guardar', no mueve nada todavia) -- mismo par de acciones que ya existia,
  // ahora expuesto como un solo control en vez de dos botones separados.
  const [aumentarStock, setAumentarStock] = useState(true)
  // Pagar ahora es el default: la mayoria de compras se liquidan al
  // recibirlas, no al credito. filasPago soporta varios medios a la vez
  // (ver SelectorMediosPago), cada uno con su propio monto -- lo que no se
  // asigne a ningun medio queda como saldo pendiente (credito parcial).
  const [pagarAhora, setPagarAhora] = useState(true)
  const [filasPago, setFilasPago] = useState([])
  const [cuentasPago, setCuentasPago] = useState([])

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
    reset: resetPin,
  } = usePinVerificado()

  useEffect(() => {
    api('/compras/cuentas-pago').then(setCuentasPago).catch(() => setCuentasPago([]))
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

  const coincidencias = useMemo(() => {
    const term = buscarInsumo.trim().toLowerCase()
    if (!term) return []
    const yaAgregados = new Set(items.map((it) => it.insumo.id))
    return insumos.filter((i) => buscarEntidadTexto(i).includes(term) && !yaAgregados.has(i.id)).slice(0, 6)
  }, [buscarInsumo, insumos, items])

  const rapidos = useMemo(() => {
    const yaAgregados = new Set(items.map((it) => it.insumo.id))
    return insumosProveedor.filter((i) => !yaAgregados.has(i.id)).slice(0, 4)
  }, [insumosProveedor, items])

  // Estimado inicial de cuanto llega en unidadInventario, para insumos sin
  // conversion fija (ver sinConversionFija) -- el operador lo corrige si lo
  // que de verdad llego fue distinto.
  function estimarCantidadInventarioReal(insumo, cantidad) {
    if (!insumo.cantidadPromedioPorUnidad) return ''
    return String(Math.round((Number(cantidad) || 0) * Number(insumo.cantidadPromedioPorUnidad)))
  }
  function agregarInsumo(insumo) {
    const cantidadInicial = '1'
    setItems((prev) => [
      ...prev,
      {
        insumo,
        cantidad: cantidadInicial,
        precioUnitario: String(insumo.costoCompra || ''),
        descuento: '',
        porcentajeImpuesto: '',
        cantidadInventarioReal: estimarCantidadInventarioReal(insumo, cantidadInicial),
        cantidadInventarioRealManual: false,
      },
    ])
    setBuscarInsumo('')
  }
  function actualizarItem(insumoId, campo, valor) {
    setItems((prev) =>
      prev.map((it) => {
        if (it.insumo.id !== insumoId) return it
        if (campo === 'cantidadInventarioReal') {
          return { ...it, cantidadInventarioReal: valor, cantidadInventarioRealManual: true }
        }
        if (campo === 'cantidad' && !it.cantidadInventarioRealManual) {
          return { ...it, cantidad: valor, cantidadInventarioReal: estimarCantidadInventarioReal(it.insumo, valor) }
        }
        return { ...it, [campo]: valor }
      })
    )
  }
  function sumarCantidad(insumoId, delta) {
    setItems((prev) =>
      prev.map((it) => {
        if (it.insumo.id !== insumoId) return it
        const cantidad = String(Math.max(0, (Number(it.cantidad) || 0) + delta))
        return {
          ...it,
          cantidad,
          cantidadInventarioReal: it.cantidadInventarioRealManual
            ? it.cantidadInventarioReal
            : estimarCantidadInventarioReal(it.insumo, cantidad),
        }
      })
    )
  }
  function quitarItem(insumoId) {
    setItems((prev) => prev.filter((it) => it.insumo.id !== insumoId))
  }

  async function crearProveedor() {
    if (!nombreProveedorNuevo.trim()) return
    try {
      const creado = await api('/proveedores', { method: 'POST', body: { name: nombreProveedorNuevo.trim() } })
      onProveedorCreado(creado)
      setProveedorId(creado.id)
      setAgregandoProveedor(false)
      setNombreProveedorNuevo('')
    } catch (err) {
      setError(err.message)
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

  function errorInfoGeneral() {
    if (!proveedorId) return 'Elige un proveedor'
    return ''
  }
  function errorItems() {
    if (items.length === 0) return 'Agrega al menos un insumo a la compra'
    for (const it of items) {
      if (!Number(it.cantidad) || Number(it.cantidad) <= 0) return `La cantidad de "${it.insumo.name}" debe ser mayor a cero`
      if (it.precioUnitario === '' || Number(it.precioUnitario) < 0) return `El precio de "${it.insumo.name}" no es válido`
    }
    return ''
  }
  // Solo exigido al RECIBIR (sube stock de una): mientras sigue en borrador
  // puede no haberse contado/pesado todavia. Ver sinConversionFija.
  function errorItemsParaRecibir() {
    const err = errorItems()
    if (err) return err
    for (const it of items) {
      if (sinConversionFija(it.insumo, unidades) && (!it.cantidadInventarioReal || Number(it.cantidadInventarioReal) <= 0)) {
        return `Escribe cuánto llegó en total de "${it.insumo.name}" para poder recibirlo`
      }
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
        insumoId: it.insumo.id,
        cantidad: Number(it.cantidad),
        precioUnitario: Number(it.precioUnitario),
        descuento: Number(it.descuento) || 0,
        porcentajeImpuesto: Number(it.porcentajeImpuesto) || 0,
        cantidadInventarioReal: it.cantidadInventarioReal ? Number(it.cantidadInventarioReal) : null,
      })),
      accion,
    }
    if (accion === 'recibir') {
      body.pin = pin
      if (pagarAhora && filasPago.length > 0) body.pagos = filasParaBody(filasPago)
    }
    return body
  }

  async function guardarBorrador() {
    const errInfo = errorInfoGeneral()
    if (errInfo) return setError(errInfo)
    const errI = errorItems()
    if (errI) return setError(errI)
    setError('')
    setSaving(true)
    try {
      if (esNueva) {
        const creada = await api('/compras', { method: 'POST', body: construirBody('guardar') })
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

  async function recibirCompra() {
    const errInfo = errorInfoGeneral()
    if (errInfo) return setError(errInfo)
    const errI = errorItemsParaRecibir()
    if (errI) return setError(errI)
    if (pagarAhora) {
      const errPago = errorFilasPago(filasPago, totales.total)
      if (errPago) return setError(errPago)
      if (!pinValido) return setError('Escribe el PIN del encargado')
    } else if (!pinValido) {
      return setError('Escribe el PIN del encargado')
    }
    setError('')
    setSaving(true)
    try {
      const recibida = esNueva
        ? await api('/compras', { method: 'POST', body: construirBody('recibir') })
        : await api(`/compras/${compraExistente.id}/recibir`, {
            method: 'POST',
            body: { pin, pagos: construirBody('recibir').pagos },
          })
      ;(onCreated || onSaved)(recibida)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function guardar() {
    return aumentarStock ? recibirCompra() : guardarBorrador()
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
    <div className="card p-5 md:p-6 space-y-6">
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

      {error && (
        <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">{error}</p>
      )}

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
                  className="field flex-1"
                  placeholder="Nombre del proveedor"
                  value={nombreProveedorNuevo}
                  onChange={(e) => setNombreProveedorNuevo(e.target.value)}
                  autoFocus
                />
                <button type="button" onClick={crearProveedor} className="btn-primary h-10 px-3 text-xs whitespace-nowrap">
                  Crear
                </button>
                <button type="button" onClick={() => setAgregandoProveedor(false)} className="btn-ghost h-10 px-3">
                  <Icon.x width={14} height={14} />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <select className="field flex-1" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
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
            2. Insumos, materia prima y empaques
          </h3>
          <span
            className={`text-[10px] font-semibold px-2 py-1 rounded-pill border ${
              aumentarStock ? 'text-libre border-libre/40 bg-libre/10' : 'text-muted border-edge bg-raised'
            }`}
          >
            {aumentarStock ? 'Stock auto-incrementable' : 'No mueve stock (borrador)'}
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
            className="field pl-10"
            placeholder="Buscar insumo para agregar…"
            value={buscarInsumo}
            onChange={(e) => setBuscarInsumo(e.target.value)}
          />
          {coincidencias.length > 0 && (
            <div className="absolute z-10 top-full left-0 right-0 mt-1 card p-1.5 space-y-0.5 shadow-xl max-h-60 overflow-y-auto">
              {coincidencias.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => agregarInsumo(i)}
                  className="w-full flex items-center justify-between gap-2 text-left px-2.5 py-2 rounded-lg text-sm hover:bg-raised"
                >
                  <span>{i.name}</span>
                  <span className="text-xs text-muted">{i.unidadCompra}</span>
                </button>
              ))}
            </div>
          )}
          {buscarInsumo.trim() && coincidencias.length === 0 && (
            <div className="absolute z-10 top-full left-0 right-0 mt-1 card p-3 shadow-xl space-y-2">
              <p className="text-xs text-muted">
                No encontramos insumos para "{buscarInsumo.trim()}".
              </p>
              <button
                type="button"
                onClick={() => setMatriculandoInsumo(buscarInsumo.trim())}
                className="btn-ghost w-full justify-center text-xs h-9"
              >
                <Icon.plus width={14} height={14} /> Matricular "{buscarInsumo.trim()}" como insumo nuevo
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

        {itemsCalculados.length === 0 ? (
          <p className="text-sm text-muted text-center py-8 border border-dashed border-edge rounded-xl">
            Todavía no hay insumos. Búscalos arriba y agrégalos a la compra.
          </p>
        ) : (
          <div className="rounded-xl border border-edge overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs text-muted uppercase tracking-wide bg-raised">
                  <th className="py-2.5 px-3 font-semibold w-8">#</th>
                  <th className="py-2.5 px-3 font-semibold">Insumo / Descripción</th>
                  <th className="py-2.5 px-3 font-semibold">Unidad</th>
                  <th className="py-2.5 px-3 font-semibold">Cantidad</th>
                  <th className="py-2.5 px-3 font-semibold">Costo unitario</th>
                  <th className="py-2.5 px-3 font-semibold">Descuento</th>
                  <th className="py-2.5 px-3 font-semibold">IVA</th>
                  <th className="py-2.5 px-3 font-semibold">Subtotal</th>
                  <th className="py-2.5 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {itemsCalculados.map((it, idx) => (
                  <Fragment key={it.insumo.id}>
                  <tr className={idx > 0 ? 'border-t border-edge' : ''}>
                    <td className="py-2 px-3 text-xs text-muted">{String(idx + 1).padStart(2, '0')}</td>
                    <td className="py-2 px-3">
                      <p className="truncate font-medium">{it.insumo.name}</p>
                      {it.insumo.codigoInterno && <p className="text-xs text-muted">{it.insumo.codigoInterno}</p>}
                    </td>
                    <td className="py-2 px-3">
                      <span className="text-xs px-2 py-1 rounded-pill border border-edge bg-raised whitespace-nowrap">
                        {it.insumo.unidadCompra}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => sumarCantidad(it.insumo.id, -1)}
                          className="w-7 h-8 rounded-lg border border-edge text-muted hover:text-ink grid place-items-center shrink-0"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          className="field h-8 w-16 text-center px-1"
                          value={it.cantidad}
                          onChange={(e) => actualizarItem(it.insumo.id, 'cantidad', e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => sumarCantidad(it.insumo.id, 1)}
                          className="w-7 h-8 rounded-lg border border-edge text-muted hover:text-ink grid place-items-center shrink-0"
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      <MoneyInput
                        className="field h-8 w-28"
                        value={it.precioUnitario}
                        onChange={(v) => actualizarItem(it.insumo.id, 'precioUnitario', v)}
                      />
                    </td>
                    <td className="py-2 px-3">
                      <MoneyInput
                        className="field h-8 w-24"
                        value={it.descuento}
                        onChange={(v) => actualizarItem(it.insumo.id, 'descuento', v)}
                      />
                    </td>
                    <td className="py-2 px-3">
                      <div className="relative w-16">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          className="field h-8 w-16 text-center px-1"
                          value={it.porcentajeImpuesto}
                          onChange={(e) => actualizarItem(it.insumo.id, 'porcentajeImpuesto', e.target.value)}
                        />
                      </div>
                    </td>
                    <td className="py-2 px-3 font-medium whitespace-nowrap">{money(it.total)}</td>
                    <td className="py-2 px-3 text-right">
                      <button type="button" onClick={() => quitarItem(it.insumo.id)} className="text-muted hover:text-ocupada p-1">
                        <Icon.trash width={15} height={15} />
                      </button>
                    </td>
                  </tr>
                  {sinConversionFija(it.insumo, unidades) && (
                    <tr className="bg-raised/60">
                      <td></td>
                      <td colSpan={8} className="px-3 pb-2.5 pt-0">
                        <div className="flex items-center gap-2 flex-wrap text-xs">
                          <Icon.alert width={13} height={13} className="text-amberText shrink-0" />
                          <span className="text-muted">
                            Se compra por {it.insumo.unidadCompra} pero se cuenta en {it.insumo.unidadInventario}: ¿cuánto llegó en total?
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="field h-7 w-28 text-xs"
                            value={it.cantidadInventarioReal}
                            onChange={(e) => actualizarItem(it.insumo.id, 'cantidadInventarioReal', e.target.value)}
                            placeholder="0"
                          />
                          <span className="text-muted">{it.insumo.unidadInventario} en total</span>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
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

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 items-start mt-4">
          <div>
            <label className="label">Notas u observaciones del despacho</label>
            <textarea
              className="field resize-none"
              rows={2}
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm pt-6 whitespace-nowrap">
            <input type="checkbox" checked={aumentarStock} onChange={(e) => setAumentarStock(e.target.checked)} />
            Aumentar stock automáticamente al guardar
          </label>
        </div>
      </div>

      {aumentarStock && (
        <div className="pt-6 border-t border-edge space-y-4">
          <h3 className="text-sm font-bold tracking-wide uppercase flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber inline-block" />
            3. Pago y confirmación
          </h3>

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

              <PinField
                pin={pin}
                onChange={setPin}
                verificando={verificandoPin}
                error={pinError}
                bloqueado={pinBloqueado}
                segundosRestantes={pinSegundosRestantes}
                label="PIN del encargado"
              />
            </div>
          )}

          {!pagarAhora && (
            <div className="bg-raised border border-edge rounded-xl p-3">
              <p className="text-sm text-muted">
                Esta compra queda como cuenta por pagar
                {fechaVencimiento ? ` con vencimiento el ${formatFecha(fechaVencimiento)}` : ''}. Pídele el PIN al
                encargado para confirmar que la mercancía llegó.
              </p>
              <div className="mt-3">
                <PinField
                  pin={pin}
                  onChange={setPin}
                  verificando={verificandoPin}
                  error={pinError}
                  bloqueado={pinBloqueado}
                  segundosRestantes={pinSegundosRestantes}
                  label="PIN del encargado"
                />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end pt-2">
        <button type="button" onClick={guardar} disabled={saving} className="btn-primary">
          <Icon.check width={16} height={16} />
          {saving ? 'Guardando…' : aumentarStock ? 'Guardar y recibir mercancía' : 'Guardar como borrador'}
        </button>
      </div>
    </div>
  )
}

// --- Detalle de una compra existente ----------------------------------------

function CompraDetalle({
  id,
  proveedores,
  insumos,
  categoriasInsumo,
  unidades,
  onProveedorCreado,
  onInsumoCreado,
  onCategoriaInsumoCreada,
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
        categoriasInsumo={categoriasInsumo}
        unidades={unidades}
        onProveedorCreado={onProveedorCreado}
        onInsumoCreado={onInsumoCreado}
        onCategoriaInsumoCreada={onCategoriaInsumoCreada}
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
                : 'text-amberText border-amber/40 bg-amber/10'
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
              <th className="py-2.5 px-3 font-semibold">Insumo</th>
              <th className="py-2.5 px-3 font-semibold">Cantidad</th>
              <th className="py-2.5 px-3 font-semibold">Precio unit.</th>
              <th className="py-2.5 px-3 font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {compra.items.map((it, idx) => (
              <tr key={it.id} className={idx > 0 ? 'border-t border-edge' : ''}>
                <td className="py-2 px-3">
                  <div className="flex items-center gap-2.5">
                    <span className="w-8 h-8 rounded-lg overflow-hidden shrink-0 grid place-items-center bg-canvas border border-edge">
                      {it.insumo.imageUrl ? (
                        <img src={it.insumo.imageUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Icon.box width={14} height={14} className="text-muted" />
                      )}
                    </span>
                    <span className="truncate">{it.insumo.name}</span>
                  </div>
                </td>
                <td className="py-2 px-3">
                  {it.cantidad} {it.insumo.unidadCompra}
                  {it.cantidadInventarioReal != null && (
                    <span className="block text-xs text-muted">
                      {it.cantidadInventarioReal} {it.insumo.unidadInventario} reales
                    </span>
                  )}
                </td>
                <td className="py-2 px-3 text-muted">{money(it.precioUnitario)}</td>
                <td className="py-2 px-3 font-medium">{money(it.total)}</td>
              </tr>
            ))}
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

function PagoModal({ compra, onCancel, onPagado }) {
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
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-sm p-5 space-y-4">
        <h2 className="text-lg font-bold">Registrar pago</h2>
        <p className="text-sm text-muted">Saldo pendiente: <span className="font-semibold text-ink">{money(compra.saldoPendiente)}</span></p>

        <label className="label">¿De dónde sale la plata?</label>
        <SelectorMediosPago
          total={compra.saldoPendiente}
          shift={shift}
          cuentasPago={cuentasPago}
          filas={filasPago}
          onChange={setFilasPago}
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
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-sm p-5 space-y-4">
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
