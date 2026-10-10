import { useEffect, useMemo, useState } from 'react'
import { api, money } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import FloorPlan from '../components/FloorPlan'
import MoneyInput from '../components/MoneyInput'
import CerrarCuentaModal from '../components/CerrarCuentaModal'
import DevolverModal from '../components/DevolverModal'
import VincularClienteModal from '../components/VincularClienteModal'
import TableContextMenu from '../components/TableContextMenu'
import TrasladarMesaModal from '../components/TrasladarMesaModal'
import HistorialMesaModal from '../components/HistorialMesaModal'
import ReciboModal from '../components/ReciboModal'
import { Icon, zoneIcon } from '../components/Icons'

const estados = [
  { key: 'AVAILABLE', label: 'Disponible', dot: 'bg-libre' },
  { key: 'RESERVED', label: 'Reservada', dot: 'bg-reservada' },
  { key: 'OCCUPIED', label: 'Ocupada', dot: 'bg-ocupada' },
  { key: 'CLOSED', label: 'Cerrada', dot: 'bg-muted' },
]

export default function NuevaVenta() {
  const { session } = useAuth()
  const [zones, setZones] = useState([])
  const [activeZone, setActiveZone] = useState(null)
  const [table, setTable] = useState(null)
  const [order, setOrder] = useState(null) // cuenta abierta de la mesa, si hay
  const [products, setProducts] = useState([])
  const [search, setSearch] = useState('')
  const [lines, setLines] = useState([]) // nueva ronda, aun no enviada
  const [shift, setShift] = useState(undefined) // undefined = cargando, null = sin turno abierto
  const [avisoVisto, setAvisoVisto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [cerrando, setCerrando] = useState(false)
  const [devolviendo, setDevolviendo] = useState(null) // item a devolver
  const [vinculando, setVinculando] = useState(false) // modal de cliente de la mesa
  const [clienteDetalle, setClienteDetalle] = useState(null) // saldo real del cliente vinculado
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [justSent, setJustSent] = useState(false) // confirmacion en la tarjeta, no un aviso aparte
  const [popular, setPopular] = useState([]) // [{productId, qty}] mas pedido en la zona activa
  const [menu, setMenu] = useState(null) // {table, x, y} del clic derecho sobre una mesa
  const [trasladando, setTrasladando] = useState(null) // {order, fromTableId} en traslado
  const [historial, setHistorial] = useState(null) // mesa cuyo historial se esta viendo
  const [recibo, setRecibo] = useState(null) // {order, splitCount} de la ultima cuenta cerrada, para la tirilla

  useEffect(() => {
    api('/zones').then((z) => {
      setZones(z)
      setActiveZone(z[0]?.id || null)
    })
    api('/products').then(setProducts)
    api('/shifts/current').then(setShift)
  }, [])

  // Cambiar de mesa o de zona es cambiar de contexto: la busqueda de la mesa
  // anterior no tiene por que seguir filtrando la de esta.
  useEffect(() => {
    setLines([])
    setSearch('')
    if (table) api(`/orders/by-table/${table.id}`).then(setOrder)
    else setOrder(null)
  }, [table?.id])

  useEffect(() => {
    setSearch('')
    if (activeZone) api(`/products/popular?zoneId=${activeZone}`).then(setPopular)
  }, [activeZone])

  // El saldo real (deuda previa) vive en el modulo de clientes, no en la
  // cuenta: hay que traerlo aparte para avisar si se esta acercando al tope.
  useEffect(() => {
    if (order?.customer?.id) api(`/customers/${order.customer.id}`).then(setClienteDetalle)
    else setClienteDetalle(null)
  }, [order?.customer?.id])

  const zone = zones.find((z) => z.id === activeZone)
  // Toda venta va atada a un turno: sin uno abierto no hay donde registrarla,
  // asi que no se deja ni intentar el envio.
  const turnoAbierto = Boolean(shift)
  const puedeAbrirTurno = ['ADMIN', 'CAJERO'].includes(session?.user.role)
  const puedeCobrar = ['ADMIN', 'CAJERO'].includes(session?.user.role)
  // Una mesa cerrada no recibe pedidos: hay que abrirla primero.
  const mesaCerrada = table?.status === 'CLOSED'

  // Alerta de credito: lo que ya debe de antes + lo que lleva en esta cuenta,
  // contra el 90% de su limite. Sin limite (sin tope) no hay nada que avisar.
  const alertaCredito = useMemo(() => {
    if (!clienteDetalle?.creditEnabled || !clienteDetalle.creditLimit) return null
    const limite = Number(clienteDetalle.creditLimit)
    const proyectado = Number(clienteDetalle.balance) + (order?.total || 0)
    if (proyectado < limite * 0.9) return null
    return { proyectado, limite }
  }, [clienteDetalle, order?.total])

  // Sugeridos: los que mas se piden en ESTA zona van primero (la barra no pide
  // lo mismo que el salon). Sin historial todavia, se quedan en el orden del
  // catalogo en vez de desaparecer.
  const sugeridos = useMemo(() => {
    const term = search.trim().toLowerCase()
    const rango = new Map(popular.map((p, i) => [p.productId, i]))
    return products
      .filter((p) => p.available && (p.kind === 'PREPARED' ? p.recipe : p.variants.some((v) => v.active)))
      .filter((p) => !term || p.name.toLowerCase().includes(term))
      .sort((a, b) => (rango.get(a.id) ?? Infinity) - (rango.get(b.id) ?? Infinity))
      .slice(0, 8)
  }, [products, search, popular])

  const total = lines.reduce((sum, l) => sum + Number(l.price) * l.qty, 0)
  const itemsActivos = order?.items?.filter((i) => i.status === 'ACTIVE') || []

  async function recargarZonas() {
    setZones(await api('/zones'))
  }

  function show(err) {
    setError(err.message)
    setTimeout(() => setError(''), 4000)
  }
  function notify(msg) {
    setNotice(msg)
    setTimeout(() => setNotice(''), 2500)
  }

  function agregar(product) {
    if (product.kind === 'PREPARED') {
      if (!product.recipe) return
      const key = `product:${product.id}`
      setLines((prev) =>
        prev.find((l) => l.key === key)
          ? prev.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l))
          : [
              ...prev,
              {
                key,
                productId: product.id,
                variantId: null,
                name: product.name,
                variantName: null,
                color: product.category.color,
                price: product.recipe.price,
                qty: 1,
              },
            ]
      )
      return
    }

    const variant = product.variants.find((v) => v.active)
    if (!variant) return
    const key = `variant:${variant.id}`
    setLines((prev) =>
      prev.find((l) => l.key === key)
        ? prev.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l))
        : [
            ...prev,
            {
              key,
              productId: product.id,
              variantId: variant.id,
              name: product.name,
              variantName: variant.name,
              color: product.category.color,
              price: variant.price,
              qty: 1,
            },
          ]
    )
  }

  function cambiarCantidad(key, delta) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0))
  }

  async function abrirTurnoInline(baseCash) {
    const nuevo = await api('/shifts', { method: 'POST', body: { baseCash } })
    setShift(nuevo)
  }

  // Enviar pedido a la barra: si la mesa no tiene cuenta abierta se crea una;
  // si ya tiene, esta ronda se suma a la misma cuenta, no abre otra.
  async function enviarPedido() {
    setEnviando(true)
    setError('')
    try {
      let actual = order
      if (!actual) {
        actual = await api('/orders', { method: 'POST', body: { tableId: table.id } })
      }
      const items = lines.map((l) => (l.variantId ? { variantId: l.variantId, qty: l.qty } : { productId: l.productId, qty: l.qty }))
      const actualizada = await api(`/orders/${actual.id}/items`, { method: 'POST', body: { items } })
      setOrder(actualizada)
      setLines([])
      setJustSent(true)
      setTimeout(() => setJustSent(false), 1300)
      recargarZonas()
    } catch (err) {
      show(err)
    } finally {
      setEnviando(false)
    }
  }

  function manejarDevuelto() {
    setDevolviendo(null)
    api(`/orders/${order.id}`).then(setOrder)
  }

  async function cerrarCuenta(payload) {
    const cerrada = await api(`/orders/${order.id}/close`, { method: 'POST', body: payload })
    setCerrando(false)
    setRecibo({ order: cerrada, splitCount: payload.splitCount || 1 })
    setOrder(null)
    setTable(null)
    recargarZonas()
  }

  // Doble clic en la tarjeta de la mesa: si todavia no hay cuenta abierta, se
  // abre una (vacia) para poder asociarle un cliente desde ya, antes incluso
  // de pedir algo.
  async function abrirVincular() {
    if (!table || mesaCerrada) return
    if (!order) {
      try {
        const nueva = await api('/orders', { method: 'POST', body: { tableId: table.id } })
        setOrder(nueva)
        recargarZonas()
      } catch (err) {
        return show(err)
      }
    }
    setVinculando(true)
  }

  function manejarVinculado(actualizada) {
    setOrder(actualizada)
    setVinculando(false)
  }

  // Clic derecho sobre una mesa: acciones rapidas sin tener que entrar primero
  // a la cuenta. Cambiar el estado es operacion, cualquier rol puede hacerlo.
  async function cambiarEstadoMesa(t, status) {
    try {
      await api(`/tables/${t.id}`, { method: 'PATCH', body: { status } })
      recargarZonas()
      setTable((prev) => (prev?.id === t.id ? { ...prev, status } : prev))
    } catch (err) {
      show(err)
    }
  }

  // Una mesa cerrada no recibe pedidos hasta que se abre de nuevo.
  function abrirMesa(t) {
    return cambiarEstadoMesa(t, 'AVAILABLE')
  }

  async function liquidarDesdeMenu(t) {
    try {
      const actual = await api(`/orders/by-table/${t.id}`)
      if (!actual) return show({ message: 'Esa mesa no tiene una cuenta abierta' })
      setTable(t)
      setOrder(actual)
      setCerrando(true)
    } catch (err) {
      show(err)
    }
  }

  async function abrirTraslado(t) {
    try {
      const actual = await api(`/orders/by-table/${t.id}`)
      if (!actual) return show({ message: 'Esa mesa no tiene una cuenta abierta' })
      setTrasladando({ order: actual, fromTableId: t.id })
    } catch (err) {
      show(err)
    }
  }

  function manejarTrasladado() {
    const eraLaMesaActual = table?.id === trasladando?.fromTableId
    setTrasladando(null)
    if (eraLaMesaActual) {
      setTable(null)
      setOrder(null)
    }
    notify('Cuenta trasladada')
    recargarZonas()
  }

  const menuItems = menu
    ? [
        // Cerrada no deja hacer nada mas hasta abrirla: por eso va primero y
        // suelta el resto de opciones (reservar, ocupar) mientras tanto.
        ...(menu.table.status === 'CLOSED'
          ? [{ label: 'Abrir mesa', onClick: () => abrirMesa(menu.table) }, { divider: true }]
          : []),
        {
          label: menu.table.status === 'RESERVED' ? 'Ya está reservada' : 'Reservar',
          disabled: menu.table.status === 'RESERVED' || menu.table.status === 'CLOSED',
          onClick: () => cambiarEstadoMesa(menu.table, 'RESERVED'),
        },
        {
          label: menu.table.status === 'OCCUPIED' ? 'Marcar disponible' : 'Marcar ocupada',
          disabled: menu.table.status === 'CLOSED',
          onClick: () =>
            cambiarEstadoMesa(menu.table, menu.table.status === 'OCCUPIED' ? 'AVAILABLE' : 'OCCUPIED'),
        },
        {
          label: menu.table.status === 'CLOSED' ? 'Ya está cerrada' : 'Cerrada',
          disabled: menu.table.status === 'CLOSED',
          onClick: () => cambiarEstadoMesa(menu.table, 'CLOSED'),
        },
        { divider: true },
        {
          label: 'Liquidar cuenta',
          disabled: !puedeCobrar || menu.table.status !== 'OCCUPIED',
          onClick: () => liquidarDesdeMenu(menu.table),
        },
        {
          label: 'Trasladar cuenta a otra mesa',
          disabled: menu.table.status !== 'OCCUPIED',
          onClick: () => abrirTraslado(menu.table),
        },
        { divider: true },
        {
          label: 'Historial',
          onClick: () => setHistorial(menu.table),
        },
      ]
    : []

  return (
    <div className="p-5 md:p-7 max-w-[1500px] mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Nueva venta</h1>
      </header>

      {error && (
        <p className="mb-4 text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
          {error}
        </p>
      )}
      {notice && (
        <p className="mb-4 text-sm text-amber border border-amber/30 bg-amber/10 rounded-xl px-3 py-2.5">
          {notice}
        </p>
      )}

      {shift !== undefined && !turnoAbierto && !avisoVisto && (
        <SinTurnoOverlay
          puedeAbrirTurno={puedeAbrirTurno}
          onDismiss={() => setAvisoVisto(true)}
          onAbrir={abrirTurnoInline}
        />
      )}

      <div className="grid lg:grid-cols-[1fr_380px] gap-5 items-start">
        <section>
          <div className="flex gap-2 flex-wrap mb-4">
            {zones.map((z) => {
              const I = zoneIcon[z.icon] || Icon.tables
              const abiertas = z.tables.filter((t) => t.status === 'OCCUPIED').length
              return (
                <button
                  key={z.id}
                  onClick={() => setActiveZone(z.id)}
                  className={`relative flex items-center gap-2 h-11 px-4 rounded-xl text-sm font-semibold border transition-colors ${
                    z.id === activeZone
                      ? 'bg-amber text-night border-amber'
                      : 'bg-surface text-muted border-edge hover:text-ink'
                  }`}
                >
                  <I />
                  {z.name}
                  {abiertas > 0 && (
                    <span
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-ocupada text-ink
                                 text-[10px] font-bold grid place-items-center border-2 border-night"
                    >
                      {abiertas}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <FloorPlan
            zone={zone}
            selectedId={table?.id}
            onSelect={(_kind, item) => setTable(item)}
            onContextMenu={(t, e) => setMenu({ table: t, x: e.clientX, y: e.clientY })}
          />

          <div className="flex gap-4 flex-wrap mt-4 text-xs text-muted">
            {estados.map((e) => (
              <span key={e.key} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${e.dot}`} />
                {e.label}
              </span>
            ))}
          </div>
        </section>

        <aside className="space-y-4">
          <div className="card p-4 select-none" onDoubleClick={abrirVincular}>
            {table ? (
              <div className="flex items-baseline gap-3">
                <span className="text-mesa text-amber">{table.number}</span>
                <div>
                  <p className="font-semibold">{zone?.name}</p>
                  <p className="text-sm text-muted">{table.seats} puestos</p>
                  {!mesaCerrada && (
                    <p className="text-xs text-muted/70 mt-0.5">Doble clic para asociar un cliente</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">Toca una mesa del plano para abrir su cuenta.</p>
            )}
          </div>

          {mesaCerrada ? (
            <div className="card p-4 text-center space-y-3">
              <p className="text-sm text-muted">
                Esta mesa está cerrada. Ábrela para poder agregar pedidos.
              </p>
              <button onClick={() => abrirMesa(table)} className="btn-primary w-full">
                Abrir mesa
              </button>
            </div>
          ) : (
          <>
          <div className={`card p-4 ${justSent ? 'animate-card-confirm' : ''}`}>
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              Cuenta de la mesa
              {justSent && (
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-libre/15 animate-check-pop">
                  <svg viewBox="0 0 24 24" className="w-3 h-3">
                    <path
                      d="M5 13l4 4L19 7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      pathLength="1"
                      strokeDasharray="1"
                      strokeDashoffset="1"
                      className="text-libre animate-check-draw"
                    />
                  </svg>
                </span>
              )}
            </h2>

            {order?.customer && (
              <p className="text-sm text-muted mb-3">
                A nombre de{' '}
                <span className="text-ink font-semibold">
                  {order.customer.firstName} {order.customer.lastName}
                </span>
                {order.customer.alias && ` (${order.customer.alias})`}
              </p>
            )}

            {alertaCredito && (
              <p className="mb-3 text-sm text-reservada border border-reservada/30 bg-reservada/10 rounded-xl px-3 py-2.5">
                {order.customer.firstName} va en {money(alertaCredito.proyectado)} de su límite de{' '}
                {money(alertaCredito.limite)} ({Math.round((alertaCredito.proyectado / alertaCredito.limite) * 100)}%
                entre lo que debe y lo que lleva aquí).
              </p>
            )}

            {!order && lines.length === 0 && (
              <p className="text-sm text-muted">
                Nada agregado todavía. Toca un producto de abajo para empezar el pedido.
              </p>
            )}

            {order?.items.length > 0 && (
              <div className="space-y-2.5 mb-4">
                {order.items.map((it) => (
                  <div key={it.id} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-medium truncate ${it.status === 'VOIDED' ? 'line-through text-muted' : ''}`}>
                        {it.name}
                        {it.variantName ? ` · ${it.variantName}` : ''}
                        {it.qty > 1 ? ` ×${it.qty}` : ''}
                      </p>
                      <p className="text-xs text-muted">
                        {formatHora(it.orderedAt)} · {money(it.price)}
                        {it.status === 'VOIDED' && ` · Devuelto: ${it.voidReason}`}
                      </p>
                    </div>
                    {it.status === 'ACTIVE' && (
                      <button
                        onClick={() => setDevolviendo(it)}
                        className="text-xs font-semibold text-ocupada hover:underline shrink-0"
                      >
                        Devolver
                      </button>
                    )}
                  </div>
                ))}
                <div className="flex items-baseline justify-between pt-3 border-t border-edge">
                  <span className="text-muted text-sm">Ya enviado</span>
                  <span className="font-semibold">{money(order.total)}</span>
                </div>
              </div>
            )}

            {lines.length > 0 && (
              <>
                <p className="label">Por enviar</p>
                <ul className="space-y-2.5">
                  {lines.map((l) => (
                    <li key={l.key} className="flex items-center gap-3">
                      <span
                        className="w-9 h-9 rounded-lg shrink-0 grid place-items-center text-[11px] font-bold text-night"
                        style={{ background: l.color }}
                      >
                        {l.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{l.name}</p>
                        <p className="text-xs text-muted">
                          {l.variantName || 'Shot'} · {money(l.price)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => cambiarCantidad(l.key, -1)}
                          className="w-8 h-8 rounded-lg bg-raised border border-edge text-muted hover:text-ink"
                          aria-label={`Quitar uno de ${l.name}`}
                        >
                          −
                        </button>
                        <span className="w-6 text-center text-sm font-semibold">{l.qty}</span>
                        <button
                          onClick={() => cambiarCantidad(l.key, 1)}
                          className="w-8 h-8 rounded-lg bg-raised border border-edge text-muted hover:text-ink"
                          aria-label={`Agregar uno de ${l.name}`}
                        >
                          +
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="flex items-baseline justify-between mt-4 pt-4 border-t border-edge">
                  <span className="text-muted text-sm">Nuevo</span>
                  <span className="text-xl font-bold">{money(total)}</span>
                </div>
              </>
            )}

            {lines.length > 0 && (
              <button
                onClick={enviarPedido}
                className="btn-primary w-full mt-4"
                disabled={!table || !turnoAbierto || enviando}
                title={!turnoAbierto ? 'No hay un turno abierto' : undefined}
              >
                {enviando ? 'Enviando…' : 'Enviar pedido a la barra'}
              </button>
            )}

            {puedeCobrar && order && itemsActivos.length > 0 && (
              <button onClick={() => setCerrando(true)} className="btn-ghost w-full mt-4">
                Cerrar cuenta · {money(order.total)}
              </button>
            )}
          </div>

          <div className="card p-4">
            <h2 className="font-semibold mb-3">Productos sugeridos</h2>
            <div className="relative mb-3">
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
            <div className="grid grid-cols-2 gap-2">
              {sugeridos.map((p) => {
                const v = p.kind === 'STOCK' ? p.variants.find((x) => x.active) : null
                const price = p.kind === 'PREPARED' ? p.recipe.price : v.price
                return (
                  <button
                    key={p.id}
                    onClick={() => agregar(p)}
                    className="text-left p-3 rounded-xl bg-raised border border-edge
                               hover:border-amber transition-colors"
                  >
                    <span
                      className="block w-full h-1 rounded-pill mb-2.5"
                      style={{ background: p.category.color }}
                    />
                    <p className="text-sm font-semibold leading-tight">{p.name}</p>
                    <p className="text-xs text-muted mt-0.5">
                      {p.kind === 'PREPARED' ? 'Shot' : v.name}
                      {v?.volumeMl ? ` · ${v.volumeMl} ml` : ''}
                    </p>
                    <p className="text-sm font-bold mt-1.5">{money(price)}</p>
                  </button>
                )
              })}
            </div>
          </div>
          </>
          )}
        </aside>
      </div>

      {cerrando && (
        <CerrarCuentaModal
          total={order.total}
          customer={order.customer}
          onClose={() => setCerrando(false)}
          onConfirm={cerrarCuenta}
        />
      )}

      {vinculando && order && (
        <VincularClienteModal order={order} onClose={() => setVinculando(false)} onVinculado={manejarVinculado} />
      )}

      {devolviendo && (
        <DevolverModal item={devolviendo} onCancel={() => setDevolviendo(null)} onDevuelto={manejarDevuelto} />
      )}

      {menu && <TableContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}

      {trasladando && (
        <TrasladarMesaModal
          order={trasladando.order}
          fromTableId={trasladando.fromTableId}
          zones={zones}
          onClose={() => setTrasladando(null)}
          onTrasladado={manejarTrasladado}
        />
      )}

      {historial && (
        <HistorialMesaModal
          tableId={historial.id}
          tableNumber={historial.number}
          onClose={() => setHistorial(null)}
        />
      )}

      {recibo && (
        <ReciboModal
          order={recibo.order}
          splitCount={recibo.splitCount}
          tenantName={session?.tenant?.name}
          onClose={() => setRecibo(null)}
        />
      )}
    </div>
  )
}

function formatHora(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
}

function SinTurnoOverlay({ puedeAbrirTurno, onDismiss, onAbrir }) {
  const [showForm, setShowForm] = useState(false)

  return (
    <div className="fixed inset-0 z-50 backdrop-blur-md bg-night/50 flex items-center justify-center p-4">
      <div className="flex flex-col items-center gap-3 text-center max-w-xs">
        <button
          onClick={() => puedeAbrirTurno && setShowForm(true)}
          disabled={!puedeAbrirTurno}
          className="w-20 h-20 rounded-full bg-raised border border-edge shadow-xl grid place-items-center
                     text-4xl transition-transform disabled:cursor-default enabled:hover:scale-105"
        >
          🔒
        </button>
        <div>
          <h2 className="text-lg font-bold">No hay un turno abierto</h2>
          <p className="text-sm text-muted mt-1">
            {puedeAbrirTurno
              ? 'Toca el candado para abrir caja y enviar pedidos.'
              : 'Avísale al cajero que abra caja antes de enviar pedidos.'}
          </p>
        </div>
        <button onClick={onDismiss} className="text-xs font-semibold text-muted hover:text-ink underline mt-1">
          Seguir sin turno
        </button>
      </div>

      {showForm && <AbrirTurnoModal onCancel={() => setShowForm(false)} onAbrir={onAbrir} />}
    </div>
  )
}

function AbrirTurnoModal({ onCancel, onAbrir }) {
  const [base, setBase] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function confirmar() {
    setSaving(true)
    setError('')
    try {
      await onAbrir(Number(base) || 0)
      onCancel()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">Abrir caja</h2>
        <p className="text-sm text-muted">Declara la base inicial en efectivo para abrir el turno.</p>

        {error && (
          <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
            {error}
          </p>
        )}

        <div>
          <label className="label">Base inicial (efectivo)</label>
          <MoneyInput className="field" value={base} onChange={setBase} autoFocus />
        </div>
        <div className="flex gap-3">
          <button onClick={onCancel} className="btn-ghost flex-1">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={base === '' || saving} className="btn-primary flex-1">
            {saving ? 'Abriendo…' : 'Abrir turno'}
          </button>
        </div>
      </div>
    </div>
  )
}
