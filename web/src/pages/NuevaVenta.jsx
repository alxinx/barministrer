import { useEffect, useMemo, useRef, useState } from 'react'
import { api, money } from '../lib/api'
import { getSocket } from '../lib/socket'
import { useAuth } from '../context/AuthContext'
import { useShift } from '../context/ShiftContext'
import FloorPlan from '../components/FloorPlan'
import MoneyInput from '../components/MoneyInput'
import CerrarCuentaModal from '../components/CerrarCuentaModal'
import DevolverModal from '../components/DevolverModal'
import ConfirmModal from '../components/ConfirmModal'
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
  const { shift, setShift } = useShift() // compartido con Caja: un solo fetch por sesion
  const [avisoVisto, setAvisoVisto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [cerrando, setCerrando] = useState(false)
  const [devolviendo, setDevolviendo] = useState(null) // item a devolver
  const [eliminandoPrePedido, setEliminandoPrePedido] = useState(null) // item PENDING a quitar, a confirmar
  const [borrandoPrePedido, setBorrandoPrePedido] = useState(false)
  const [vinculando, setVinculando] = useState(false) // modal de cliente de la mesa
  const [clienteDetalle, setClienteDetalle] = useState(null) // saldo real del cliente vinculado
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [justSent, setJustSent] = useState(false) // confirmacion en la tarjeta, no un aviso aparte
  const [popular, setPopular] = useState([]) // [{productId, qty}] mas pedido en la zona activa
  const [menu, setMenu] = useState(null) // {table, x, y} del clic derecho sobre una mesa
  const [seleccionMultiple, setSeleccionMultiple] = useState(() => new Set()) // mesas elegidas para fusionar
  const [menuMultiple, setMenuMultiple] = useState(null) // {tableIds, x, y} del clic derecho sobre la seleccion
  const [fusionando, setFusionando] = useState(false)
  const [trasladando, setTrasladando] = useState(null) // {order, fromTableId} en traslado
  const [historial, setHistorial] = useState(null) // mesa cuyo historial se esta viendo
  const [recibo, setRecibo] = useState(null) // {order, splitCount} de la ultima cuenta cerrada, para la tirilla
  const [prePedidos, setPrePedidos] = useState([]) // cola de pre-pedidos esperando que el admin los envie
  const [enviandoPrePedido, setEnviandoPrePedido] = useState(false)
  const [ahora, setAhora] = useState(() => Date.now()) // tick para refrescar "hace Xm" sin recargar nada
  const [vuelos, setVuelos] = useState([]) // clones animados "volando" del producto tocado a la cuenta
  // "Ya enviado" (lo facturado) y "Por enviar" (la ronda nueva) en pestanas
  // separadas cuando hay de los dos: apiladas, las dos listas empujan
  // productos sugeridos fuera de pantalla igual que pasaba antes del tope de
  // 3 filas. Arranca en "enviados" (lo que ya tiene la mesa al abrirla) y
  // salta sola a "porEnviar" en cuanto se toca el primer producto nuevo.
  const [pestanaCuenta, setPestanaCuenta] = useState('enviados')
  const [hayMasPorEnviar, setHayMasPorEnviar] = useState(false) // "por enviar" desbordo sus 3 filas visibles, hay mas abajo
  const [hayMasArribaPorEnviar, setHayMasArribaPorEnviar] = useState(false) // se hizo scroll: quedaron productos tapados arriba

  // abrirVincular crea la cuenta antes de saber si el usuario de verdad va a
  // asociar un cliente; si en ese tiempo ya cambio de mesa, esta referencia es
  // lo que permite notar que la mesa activa ya no es la misma.
  const tableRef = useRef(null)
  useEffect(() => {
    tableRef.current = table
  }, [table])

  // Con pocas lineas "por enviar" cabe todo; con muchas, empuja productos
  // sugeridos fuera de pantalla y toca bajar para seguir agregando. Se tapa
  // la lista a 3 filas (ver abajo) y esto detecta si quedo algo mas abajo sin
  // ver, para mostrar la flecha de scroll.
  const porEnviarRef = useRef(null)
  useEffect(() => {
    const el = porEnviarRef.current
    if (!el) {
      setHayMasPorEnviar(false)
      setHayMasArribaPorEnviar(false)
      return
    }
    const check = () => {
      setHayMasPorEnviar(el.scrollHeight - el.scrollTop - el.clientHeight > 1)
      setHayMasArribaPorEnviar(el.scrollTop > 1)
    }
    check()
    el.addEventListener('scroll', check)
    return () => el.removeEventListener('scroll', check)
  }, [lines])

  // Tarjeta de destino del "vuelo" al agregar un producto.
  const cuentaCardRef = useRef(null)

  useEffect(() => {
    api('/zones').then((z) => {
      setZones(z)
      setActiveZone(z[0]?.id || null)
    })
    api('/products').then(setProducts)
  }, [])

  // El numerito de "ocupadas" sobre cada zona es de todo el equipo, no solo
  // de quien lo mira: si otra persona abre o cierra una mesa desde su propio
  // celular, esto se entera por socket en vez de obligar a refrescar la
  // pagina para que el plano deje de mentir.
  useEffect(() => {
    const socket = getSocket()
    function onMesasActualizadas() {
      recargarZonas()
    }
    socket.on('mesas:actualizadas', onMesasActualizadas)
    return () => socket.off('mesas:actualizadas', onMesasActualizadas)
  }, [])

  const esAdmin = session?.user.role === 'ADMIN'
  const esEncargado = esAdmin || session?.user.role === 'CAJERO'
  const puedeDescuento = esAdmin || (session?.user.role === 'CAJERO' && session?.tenant.cajeroAplicaDescuentos)

  // Admin y cajero ven la cola de pre-pedidos (el cajero se entera pero no
  // aprueba): trae lo que ya estaba esperando al entrar (el socket solo avisa
  // de lo que pasa despues de conectarse) y se suscribe a lo que llegue o se
  // resuelva en vivo.
  useEffect(() => {
    if (!esEncargado) return
    api('/orders/pending').then(setPrePedidos).catch(() => {})

    const socket = getSocket()
    function onNuevo(p) {
      setPrePedidos((prev) => {
        const existente = prev.find((x) => x.orderId === p.orderId)
        if (!existente) return [...prev, p]
        // Otra ronda sobre la misma cuenta: se junta con la que ya esperaba.
        const meseras = [...new Set([...existente.meseras, ...p.meseras])]
        return prev.map((x) => (x.orderId === p.orderId ? { ...x, meseras } : x))
      })
    }
    function onEnviado({ orderId }) {
      setPrePedidos((prev) => prev.filter((p) => p.orderId !== orderId))
    }
    socket.on('pre-pedido:nuevo', onNuevo)
    socket.on('pre-pedido:enviado', onEnviado)
    // Mismo efecto que "enviado" sobre la cola: si ya no queda nada
    // pendiente en esa mesa, el aviso desaparece igual.
    socket.on('pre-pedido:cancelado', onEnviado)
    return () => {
      socket.off('pre-pedido:nuevo', onNuevo)
      socket.off('pre-pedido:enviado', onEnviado)
      socket.off('pre-pedido:cancelado', onEnviado)
    }
  }, [esEncargado])

  // Refresca el "hace Xm" de la cola sin depender de que llegue otro evento.
  useEffect(() => {
    if (!esEncargado || prePedidos.length === 0) return
    const id = setInterval(() => setAhora(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [esEncargado, prePedidos.length])

  // Cambiar de mesa o de zona es cambiar de contexto: la busqueda de la mesa
  // anterior no tiene por que seguir filtrando la de esta.
  useEffect(() => {
    setLines([])
    setSearch('')
    setPestanaCuenta('enviados')
    if (table) api(`/orders/by-table/${table.id}`).then(setOrder)
    else setOrder(null)
  }, [table?.id])

  // Primer producto de una ronda nueva: salta a la pestana "Por enviar" para
  // que el vuelo del producto aterrice en algo visible, en vez de quedar
  // detras de "Ya enviado" sin que se note que se agrego.
  const lineasPreviasRef = useRef(0)
  useEffect(() => {
    if (lineasPreviasRef.current === 0 && lines.length > 0) setPestanaCuenta('porEnviar')
    lineasPreviasRef.current = lines.length
  }, [lines.length])

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
  const itemsPendientes = order?.items?.filter((i) => i.status === 'PENDING') || []
  const itemsEnviados = order?.items?.filter((i) => i.status !== 'PENDING') || []

  const pendingTableIds = useMemo(() => new Set(prePedidos.map((p) => p.tableId)), [prePedidos])
  const elapsedByTable = useMemo(
    () => Object.fromEntries(prePedidos.map((p) => [p.tableId, `hace ${minutosDesde(p.since, ahora)}m`])),
    [prePedidos, ahora]
  )

  // Mesas fusionadas temporalmente en la zona activa (principal y satelites):
  // solo para pintar el link visual, la cuenta compartida ya la resuelve el
  // backend sin que esto importe.
  const linkedIds = useMemo(() => {
    const ids = new Set()
    for (const t of zone?.tables || []) {
      if (t.groupId) {
        ids.add(t.id)
        ids.add(t.groupId)
      }
    }
    return ids
  }, [zone])

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

  // Vuelo visual del producto tocado hasta la tarjeta de "Cuenta de la mesa":
  // nada de estado real, solo un clon que recorre la distancia y desaparece,
  // para que agregar no se sienta invisible cuando hay que bajar a ver la
  // cuenta. sourceEl es el boton tocado (no el evento: con varios taps
  // seguidos un SyntheticEvent reciclado ya no sirve para medir posicion).
  function lanzarVuelo(product, sourceEl) {
    if (!sourceEl || !cuentaCardRef.current) return
    const from = sourceEl.getBoundingClientRect()
    const to = cuentaCardRef.current.getBoundingClientRect()
    const id = `${Date.now()}-${Math.random()}`
    setVuelos((prev) => [
      ...prev,
      {
        id,
        imageUrl: product.imageUrl,
        color: product.category.color,
        inicial: product.name.slice(0, 2).toUpperCase(),
        fromX: from.left + from.width / 2 - 18,
        fromY: from.top + from.height / 2 - 18,
        toX: to.left + 24,
        toY: to.top + 24,
      },
    ])
    setTimeout(() => setVuelos((prev) => prev.filter((v) => v.id !== id)), 550)
  }

  function agregar(product, sourceEl) {
    lanzarVuelo(product, sourceEl)
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
                imageUrl: product.imageUrl,
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
              imageUrl: product.imageUrl,
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

  // El admin aprueba el pre-pedido que dejo la mesera: recien ahi los items
  // pasan a activos, suman al total y quedan listos para la barra.
  async function enviarPrePedido() {
    setEnviandoPrePedido(true)
    setError('')
    try {
      const actualizada = await api(`/orders/${order.id}/send`, { method: 'POST' })
      setOrder(actualizada)
      recargarZonas()
    } catch (err) {
      show(err)
    } finally {
      setEnviandoPrePedido(false)
    }
  }

  function manejarDevuelto() {
    setDevolviendo(null)
    api(`/orders/${order.id}`).then(setOrder)
  }

  // Quitar una linea del pre-pedido antes de enviarla a la barra: todavia es
  // un borrador, por eso solo pide confirmar (sin PIN ni motivo, a
  // diferencia de devolver algo ya servido).
  async function eliminarPrePedido() {
    if (!eliminandoPrePedido) return
    setBorrandoPrePedido(true)
    try {
      const actualizada = await api(`/orders/${order.id}/items/${eliminandoPrePedido.id}`, { method: 'DELETE' })
      setOrder(actualizada)
      setEliminandoPrePedido(null)
    } catch (err) {
      show(err)
    } finally {
      setBorrandoPrePedido(false)
    }
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
    const tableIdAlAbrir = table.id
    if (!order) {
      try {
        const nueva = await api('/orders', { method: 'POST', body: { tableId: table.id } })
        recargarZonas()
        // Si mientras se creaba la cuenta el usuario ya selecciono otra mesa,
        // no le metemos encima el estado ni el modal de la mesa anterior.
        if (tableRef.current?.id !== tableIdAlAbrir) return
        setOrder(nueva)
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

  // Saltar desde la cola de pre-pedidos directo a la mesa que lo mando,
  // aunque este en otra zona.
  function irAMesa(p) {
    setActiveZone(p.zoneId)
    const z = zones.find((zz) => zz.id === p.zoneId)
    const t = z?.tables.find((tt) => tt.id === p.tableId)
    if (t) setTable(t)
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

  // --- Fusionar mesas temporalmente (cuenta grande repartida en varias) ----
  // Ctrl+clic o arrastrar un recuadro va armando este set; clic derecho sobre
  // alguna de las elegidas abre el menu para confirmar. Separarlas de nuevo
  // no hace falta: se sueltan solas al cerrar esa cuenta (ver backend).
  function alternarSeleccionMultiple(id) {
    setSeleccionMultiple((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function elegirRango(ids) {
    setSeleccionMultiple(new Set(ids))
  }

  function abrirMenuMultiple(ids, e) {
    if (ids.length < 2) return
    setMenuMultiple({ tableIds: ids, x: e.clientX, y: e.clientY })
  }

  async function fusionarMesas(tableIds) {
    setFusionando(true)
    try {
      await api('/tables/group', { method: 'POST', body: { tableIds } })
      setSeleccionMultiple(new Set())
      notify('Mesas fusionadas')
      recargarZonas()
    } catch (err) {
      show(err)
    } finally {
      setFusionando(false)
    }
  }

  async function separarMesas(tableIds) {
    setFusionando(true)
    try {
      await api('/tables/ungroup', { method: 'POST', body: { tableIds } })
      setSeleccionMultiple(new Set())
      setMenuMultiple(null)
      notify('Mesas separadas')
      recargarZonas()
    } catch (err) {
      show(err)
    } finally {
      setFusionando(false)
    }
  }

  // Si todo lo seleccionado ya es la MISMA fusion activa, el clic derecho
  // ofrece separarlas en vez de fusionarlas de nuevo (lo cual fallaria igual
  // del lado del servidor, pero asi el menu dice lo que de verdad va a pasar).
  function esMismaFusionActiva(ids) {
    const mesas = ids.map((id) => zone?.tables.find((t) => t.id === id)).filter(Boolean)
    if (mesas.length !== ids.length) return false
    const anclas = new Set(mesas.map((t) => t.groupId || t.id))
    if (anclas.size !== 1) return false
    const anclaId = [...anclas][0]
    const miembros = zone.tables.filter((t) => t.id === anclaId || t.groupId === anclaId).length
    return miembros >= 2
  }

  const menuItemsMultiple = menuMultiple
    ? esMismaFusionActiva(menuMultiple.tableIds)
      ? [
          {
            label: fusionando ? 'Separando…' : `Separar ${menuMultiple.tableIds.length} mesas de la fusión`,
            disabled: fusionando,
            onClick: () => separarMesas(menuMultiple.tableIds),
          },
        ]
      : [
          {
            label: fusionando ? 'Fusionando…' : `Fusionar ${menuMultiple.tableIds.length} mesas`,
            disabled: fusionando,
            onClick: () => fusionarMesas(menuMultiple.tableIds),
          },
        ]
    : []

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
        ...(linkedIds.has(menu.table.id)
          ? [{ label: 'Separar de la fusión', onClick: () => separarMesas([menu.table.id]) }]
          : []),
        { divider: true },
        {
          label: 'Historial',
          onClick: () => setHistorial(menu.table),
        },
      ]
    : []

  // Contenido de "Por enviar": se usa tal cual con o sin pestanas (cuando no
  // hay nada ya facturado, no hace falta separar nada y esto va directo).
  const listaPorEnviar =
    lines.length === 0 ? (
      <p className="text-sm text-muted">Nada agregado todavía. Toca un producto de abajo para empezar una ronda nueva.</p>
    ) : (
      <>
        <div className="relative">
          <ul ref={porEnviarRef} className="space-y-2.5 max-h-32 overflow-y-auto scroll-smooth pr-1">
            {lines.map((l) => (
              <li key={l.key} className="flex items-center gap-3">
                <span
                  className="w-9 h-9 rounded-lg shrink-0 grid place-items-center overflow-hidden text-[11px] font-bold text-night"
                  style={!l.imageUrl ? { background: l.color } : undefined}
                >
                  {l.imageUrl ? (
                    <img src={l.imageUrl} alt="" loading="lazy" className="w-full h-full object-contain" />
                  ) : (
                    l.name.slice(0, 2).toUpperCase()
                  )}
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

          {/* Degradado de continuidad (no clicable) + una insignia ambar
              rellena encima, centrada para no taparle los botones +/-
              a la fila del borde: un icono suelto sin fondo se pierde
              contra el plano en una noche llena. Arriba o abajo segun
              de que lado quedo tapado algo al hacer scroll. */}
          {hayMasArribaPorEnviar && (
            <div className="pointer-events-none absolute top-0 inset-x-0 h-7 bg-gradient-to-b from-surface to-transparent rounded-t-xl" />
          )}
          {hayMasPorEnviar && (
            <div className="pointer-events-none absolute bottom-0 inset-x-0 h-7 bg-gradient-to-t from-surface to-transparent rounded-b-xl" />
          )}
          {hayMasArribaPorEnviar && (
            <button
              type="button"
              onClick={() => porEnviarRef.current?.scrollBy({ top: -100, behavior: 'smooth' })}
              aria-label="Ver productos anteriores"
              className="absolute top-0.5 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-amber text-night
                         shadow-lg shadow-amber/50 grid place-items-center animate-bounce"
            >
              <Icon.chevronDown width={16} height={16} className="rotate-180" />
            </button>
          )}
          {hayMasPorEnviar && (
            <button
              type="button"
              onClick={() => porEnviarRef.current?.scrollBy({ top: 100, behavior: 'smooth' })}
              aria-label="Ver más productos por enviar"
              className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-amber text-night
                         shadow-lg shadow-amber/50 grid place-items-center animate-bounce"
            >
              <Icon.chevronDown width={16} height={16} />
            </button>
          )}
        </div>
        <div className="flex items-baseline justify-between mt-4 pt-4 border-t border-edge">
          <span className="text-muted text-sm">Nuevo</span>
          <span className="text-xl font-bold">{money(total)}</span>
        </div>
      </>
    )

  return (
    <div className="p-5 md:p-7 max-w-[1500px] mx-auto">
      {vuelos.map((v) => (
        <span
          key={v.id}
          aria-hidden
          className="fixed z-50 top-0 left-0 w-9 h-9 rounded-lg grid place-items-center overflow-hidden
                     text-[11px] font-bold text-night pointer-events-none animate-vuelo-agregar"
          style={{
            '--vuelo-from': `translate(${v.fromX}px, ${v.fromY}px)`,
            '--vuelo-to': `translate(${v.toX}px, ${v.toY}px) scale(0.35)`,
            background: !v.imageUrl ? v.color : undefined,
          }}
        >
          {v.imageUrl ? <img src={v.imageUrl} alt="" className="w-full h-full object-contain" /> : v.inicial}
        </span>
      ))}

      <header className="mb-6">
        <h1 className="text-2xl font-bold">POS y pedidos</h1>
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
                  onClick={() => {
                    setActiveZone(z.id)
                    setSeleccionMultiple(new Set())
                  }}
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
            // El clic derecho (reservar, cerrar, liquidar, fusionar) es para
            // quien administra el salon, no para quien solo toma pedidos: la
            // mesera sigue abriendo mesas con clic normal, pero no le
            // aparece el menu de contexto ni la seleccion multiple.
            onContextMenu={esEncargado ? (t, e) => setMenu({ table: t, x: e.clientX, y: e.clientY }) : undefined}
            pendingIds={esEncargado ? pendingTableIds : undefined}
            elapsedByTable={esEncargado ? elapsedByTable : undefined}
            multiSelectable={esEncargado}
            selectedIds={seleccionMultiple}
            onToggleSelect={alternarSeleccionMultiple}
            onSelectRange={elegirRango}
            onMultiContextMenu={abrirMenuMultiple}
            linkedIds={linkedIds}
          />

          <div className="flex items-center gap-4 flex-wrap mt-4 text-xs text-muted">
            {estados.map((e) => (
              <span key={e.key} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${e.dot}`} />
                {e.label}
              </span>
            ))}
            {seleccionMultiple.size > 0 && (
              <span className="flex items-center gap-2 ml-auto text-amber font-semibold">
                {seleccionMultiple.size} mesa{seleccionMultiple.size > 1 ? 's' : ''} seleccionada
                {seleccionMultiple.size > 1 ? 's' : ''} · clic derecho para fusionar
                <button
                  type="button"
                  onClick={() => setSeleccionMultiple(new Set())}
                  className="text-muted hover:text-ink underline font-normal"
                >
                  limpiar
                </button>
              </span>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          {esEncargado && prePedidos.length > 0 && (
            <section className="card p-4 space-y-2.5 border-amber/40 animate-pre-pedido-buzz">
              <h2 className="font-semibold flex items-center gap-2">
                <Icon.bell width={18} height={18} className="text-amber" />
                Pre-pedidos esperando envío
              </h2>
              {prePedidos.map((p) => {
                // Entre mas lleva esperando, mas urgente se ve: de un tono
                // casi negro a rojo en 5 minutos (el CSS hace el crawl solo,
                // sincronizado con animationDelay negativo), y pasado ese
                // punto se cambia el brillo suave por la variante
                // estroboscopica para que sea imposible no notarla.
                const antiguedad = antiguedadMs(p.since, ahora)
                const esCritico = antiguedad >= PRE_PEDIDO_CRITICO_MS
                return (
                  <button
                    key={p.orderId}
                    type="button"
                    onClick={() => irAMesa(p)}
                    style={!esCritico ? { animationDelay: `-${antiguedad}ms` } : undefined}
                    className={`w-full flex items-center gap-3 border rounded-xl px-3 py-2.5 text-left transition-colors
                                ${
                                  esCritico
                                    ? 'border-ocupada animate-pre-pedido-critico'
                                    : 'bg-amber/10 border-amber/40 hover:border-amber animate-pre-pedido-urgencia'
                                }`}
                  >
                    <span className="w-10 h-10 rounded-xl bg-night border border-amber/40 grid place-items-center text-amber font-bold shrink-0">
                      {p.tableNumber}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {p.zoneName} · {p.meseras.join(', ') || 'Sin registrar'}
                      </p>
                      <p className="text-xs text-amber/80">hace {minutosDesde(p.since, ahora)}m</p>
                    </div>
                  </button>
                )
              })}
            </section>
          )}

          {/* Debajo de "lg" (donde el plano y la cuenta dejan de ir lado a
              lado) tocar una mesa despliega esto como un panel desde la
              derecha, en vez de empujarlo mas abajo: evita que el operador
              tenga que bajar para ver que puede pedir. */}
          {table && (
            <div className="lg:hidden fixed inset-0 z-30 bg-black/60" onClick={() => setTable(null)} />
          )}
          <div
            className={`fixed inset-y-0 right-0 z-40 w-full max-w-sm bg-night p-4 overflow-y-auto shadow-2xl
                         space-y-4 transition-transform duration-300
                         ${table ? 'translate-x-0' : 'translate-x-full'}
                         lg:static lg:translate-x-0 lg:z-auto lg:w-auto lg:max-w-none lg:bg-transparent
                         lg:p-0 lg:shadow-none lg:space-y-4`}
          >
            <button
              type="button"
              onClick={() => setTable(null)}
              className="lg:hidden flex items-center gap-1.5 text-sm text-muted hover:text-ink"
            >
              <Icon.chevronLeft width={16} height={16} />
              Volver al plano
            </button>

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
          <div ref={cuentaCardRef} className={`card p-4 ${justSent ? 'animate-card-confirm' : ''}`}>
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

            {order?.openedBy && (
              <p className="text-xs text-muted mb-3">
                Abrió {order.openedBy.name} · {formatHora(order.openedAt)}
              </p>
            )}

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

            {itemsPendientes.length > 0 && (
              <div className="space-y-2.5 mb-4 bg-amber/10 border border-amber/40 rounded-xl p-3">
                <p className="text-xs font-semibold text-amber flex items-center gap-1.5">
                  <Icon.bell width={14} height={14} />
                  Pre-pedido de {[...new Set(itemsPendientes.map((i) => i.createdBy?.name).filter(Boolean))].join(', ') || 'la mesera'}
                </p>
                {itemsPendientes.map((it) => (
                  <div key={it.id} className="flex items-center gap-3">
                    <ItemThumb item={it} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {it.name}
                        {it.variantName ? ` · ${it.variantName}` : ''}
                        {it.qty > 1 ? ` ×${it.qty}` : ''}
                      </p>
                      <p className="text-xs text-muted">
                        {formatHora(it.orderedAt)} · {money(it.price)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEliminandoPrePedido(it)}
                      aria-label={`Eliminar ${it.name} del pre-pedido`}
                      className="text-muted hover:text-ocupada shrink-0 p-1"
                    >
                      <Icon.trash width={16} height={16} />
                    </button>
                  </div>
                ))}
                {esEncargado ? (
                  <button
                    onClick={enviarPrePedido}
                    disabled={enviandoPrePedido}
                    className="btn-primary w-full mt-1"
                  >
                    {enviandoPrePedido ? 'Enviando…' : 'Enviar pre-pedido a la barra'}
                  </button>
                ) : (
                  <p className="text-xs text-amber/80">Esperando que el administrador o cajero lo envíe a la barra.</p>
                )}
              </div>
            )}

            {itemsEnviados.length > 0 ? (
              <div className="mb-4">
                {/* Ya facturado + ronda nueva en pestanas: apiladas, las dos
                    listas empujan productos sugeridos fuera de pantalla con
                    cuentas largas. Sin nada enviado todavia no hay que
                    separar de nada, asi que "Por enviar" va directo abajo. */}
                <div className="flex gap-1 mb-3 p-1 rounded-lg bg-raised border border-edge">
                  <button
                    type="button"
                    onClick={() => setPestanaCuenta('enviados')}
                    className={`flex-1 h-8 rounded-md text-xs font-semibold transition-colors ${
                      pestanaCuenta === 'enviados' ? 'bg-amber text-night' : 'text-muted hover:text-ink'
                    }`}
                  >
                    Ya enviado
                  </button>
                  <button
                    type="button"
                    onClick={() => setPestanaCuenta('porEnviar')}
                    className={`flex-1 h-8 rounded-md text-xs font-semibold transition-colors ${
                      pestanaCuenta === 'porEnviar' ? 'bg-amber text-night' : 'text-muted hover:text-ink'
                    }`}
                  >
                    Por enviar{lines.length > 0 ? ` (${lines.length})` : ''}
                  </button>
                </div>

                {pestanaCuenta === 'enviados' ? (
                  <div className="space-y-2.5">
                    {itemsEnviados.map((it) => (
                      <div key={it.id} className="flex items-center gap-3">
                        <ItemThumb item={it} />
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
                ) : (
                  listaPorEnviar
                )}
              </div>
            ) : (
              lines.length > 0 && (
                <>
                  <p className="label">Por enviar</p>
                  {listaPorEnviar}
                </>
              )
            )}

            {lines.length > 0 && (
              <button
                onClick={enviarPedido}
                className="btn-primary w-full mt-4"
                disabled={!table || !turnoAbierto || enviando}
                title={!turnoAbierto ? 'No hay un turno abierto' : undefined}
              >
                {enviando ? 'Enviando…' : esAdmin ? 'Enviar pedido a la barra' : 'Enviar pre-pedido'}
              </button>
            )}

            {puedeCobrar && order && itemsActivos.length > 0 && (
              <button onClick={() => setCerrando(true)} className="btn bg-ocupada text-white hover:bg-ocupada/90 w-full mt-4">
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
                // Agotado es un aviso, nunca un bloqueo: cualquier rol lo sigue
                // pudiendo agregar (si llega a faltar en la barra se marca
                // sobreconsumo, no se pierde la venta). Solo aplica a
                // presentaciones selladas; un shot no tiene stock propio.
                const agotado = v && v.stock <= 0
                return (
                  <button
                    key={p.id}
                    onClick={(e) => agregar(p, e.currentTarget)}
                    style={{ borderColor: agotado ? undefined : p.category.color }}
                    className={`grupo-cenefa flex items-center gap-2.5 text-left p-2.5 rounded-xl border
                               hover:bg-surface transition-colors ${
                                 agotado ? 'bg-ocupada/10 border-ocupada' : 'bg-raised'
                               }`}
                  >
                    <span
                      className="w-10 h-10 rounded-lg grid place-items-center shrink-0 overflow-hidden"
                      style={!p.imageUrl ? { background: agotado ? undefined : p.category.color } : undefined}
                    >
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt="" loading="lazy" className="w-full h-full object-contain" />
                      ) : (
                        <span className={`font-bold text-xs ${agotado ? 'text-ocupada' : 'text-night'}`}>
                          {p.name.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <NombreCenefa text={p.name} className="text-sm font-semibold leading-tight" />
                      <p className="text-xs text-muted mt-0.5 truncate">
                        {p.kind === 'PREPARED' ? 'Shot' : v.name}
                        {v?.volumeMl ? ` · ${v.volumeMl} ml` : ''}
                        {agotado ? <span className="text-ocupada font-semibold"> · Agotado</span> : null}
                      </p>
                      <p className="text-sm font-bold mt-1">{money(price)}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
          </>
          )}
          </div>
        </aside>
      </div>

      {cerrando && (
        <CerrarCuentaModal
          orderId={order.id}
          total={order.total}
          customer={order.customer}
          saldoCliente={clienteDetalle?.balance ?? 0}
          puedeDescuento={puedeDescuento}
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

      {eliminandoPrePedido && (
        <ConfirmModal
          title="Eliminar del pre-pedido"
          message={`"${eliminandoPrePedido.name}${
            eliminandoPrePedido.variantName ? ` · ${eliminandoPrePedido.variantName}` : ''
          }" todavía no se envió a la barra. Se quita de la cuenta, no se puede deshacer.`}
          confirmLabel={borrandoPrePedido ? 'Eliminando…' : 'Eliminar'}
          onCancel={() => setEliminandoPrePedido(null)}
          onConfirm={eliminarPrePedido}
        />
      )}

      {menu && <TableContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}

      {menuMultiple && (
        <TableContextMenu
          x={menuMultiple.x}
          y={menuMultiple.y}
          items={menuItemsMultiple}
          onClose={() => setMenuMultiple(null)}
        />
      )}

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

// Miniatura de un item ya en el pedido (pendiente o enviado): la foto real
// del producto si existe, o las iniciales si no. A diferencia de "lines"
// (la ronda nueva), el item congelado no guarda el color de la categoria,
// asi que el respaldo es neutro en vez de ese color.
function ItemThumb({ item }) {
  return (
    <span className="w-9 h-9 rounded-lg shrink-0 grid place-items-center overflow-hidden bg-raised border border-edge text-[11px] font-bold text-muted">
      {item.product?.imageUrl ? (
        <img src={item.product.imageUrl} alt="" loading="lazy" className="w-full h-full object-contain" />
      ) : (
        item.name.slice(0, 2).toUpperCase()
      )}
    </span>
  )
}

// Nombre de producto sugerido mas largo que la tarjeta: en vez de dejarlo
// cortado con "...", se desliza como una cenefa al pasar el cursor para que
// se pueda leer completo sin agrandar la tarjeta. Mide una sola vez si el
// texto de verdad se pasa de su caja (si no, se queda con el truncado normal
// y ni siquiera monta la animacion).
function NombreCenefa({ text, className }) {
  const cajaRef = useRef(null)
  const textoRef = useRef(null)
  const [desborda, setDesborda] = useState(false)
  const [duracion, setDuracion] = useState(1.5)

  useEffect(() => {
    function medir() {
      const caja = cajaRef.current
      const texto = textoRef.current
      if (!caja || !texto) return
      // texto es un <span> inline: scrollWidth no sirve ahi (los elementos
      // inline reportan 0), por eso el ancho real sale de getBoundingClientRect.
      const anchoTexto = texto.getBoundingClientRect().width
      const sobra = anchoTexto - caja.clientWidth
      setDesborda(sobra > 2)
      // Velocidad fija (px/seg), no duracion fija: un nombre largo no se debe
      // sentir mas lento que uno corto, los dos cruzan a la misma velocidad.
      if (sobra > 2) setDuracion(Math.max(1, (anchoTexto + 24) / 90))
    }
    // La fuente (Archivo, self-hosteada) carga con font-display:swap: medir
    // apenas monta usa todavia la fuente de reemplazo, mas angosta, y puede
    // decir "cabe" cuando en realidad no cabe con la fuente real. document
    // .fonts.ready espera a que ya este puesta la de verdad antes de medir.
    medir()
    document.fonts?.ready.then(medir)
  }, [text])

  if (!desborda) {
    return (
      <p ref={cajaRef} className={`${className} truncate`}>
        <span ref={textoRef}>{text}</span>
      </p>
    )
  }

  return (
    <p ref={cajaRef} className={`${className} overflow-hidden whitespace-nowrap`}>
      <span className="cenefa-pista inline-flex gap-6" style={{ animationDuration: `${duracion}s` }}>
        <span ref={textoRef}>{text}</span>
        <span aria-hidden="true">{text}</span>
      </span>
    </p>
  )
}

function formatHora(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
}

function minutosDesde(iso, ahora) {
  return Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 60000))
}

// Ventana de "negro a rojo" del pre-pedido sin enviar: a los 5 minutos ya
// esta critico. El crawl de color lo hace el CSS solo (animation-delay
// negativo = lo que ya lleva esperando), esto solo decide cuando saltar a
// la variante estroboscopica.
const PRE_PEDIDO_CRITICO_MS = 5 * 60 * 1000
function antiguedadMs(iso, ahora) {
  return Math.min(PRE_PEDIDO_CRITICO_MS, Math.max(0, ahora - new Date(iso).getTime()))
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
