import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, money } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useShift } from '../context/ShiftContext'
import { Icon } from '../components/Icons'
import MoneyInput from '../components/MoneyInput'
import ReciboModal from '../components/ReciboModal'
import CerrarCuentaModal from '../components/CerrarCuentaModal'
import TicketEgresoModal from '../components/TicketEgresoModal'
import ConsumoDetalleModal from '../components/ConsumoDetalleModal'
import CuadreResumen from '../components/CuadreResumen'
import RangoFechas from '../components/RangoFechas'
import { parseISOLocal } from '../lib/fechas'
import { METHODS } from '../lib/paymentMethods'

const PERIODOS = [
  { key: 'hoy', label: 'Hoy' },
  { key: 'ayer', label: 'Ayer' },
  { key: '7d', label: '7 días' },
  { key: '30d', label: '30 días' },
]

const ETIQUETA_VARIACION = {
  hoy: 'vs. ayer',
  ayer: 'vs. antier',
  '7d': 'vs. periodo anterior',
  '30d': 'vs. periodo anterior',
  custom: 'vs. periodo anterior',
}

export default function Caja() {
  const { session, isAdmin } = useAuth()
  const navigate = useNavigate()
  const { shift, setShift } = useShift() // compartido con Nueva venta: un solo fetch por sesion
  const [history, setHistory] = useState([])
  const [error, setError] = useState('')
  const [closing, setClosing] = useState(false)
  const [closedResult, setClosedResult] = useState(null)
  // Flujo de "cerrar turno" con cuentas todavia abiertas: primero se pregunta
  // que hacer con ellas (cobrarlas ya o dejarlas pasar), y si elige cobrarlas
  // se van mostrando una por una hasta que no quede ninguna.
  const [eligiendoCierre, setEligiendoCierre] = useState(null) // cuentas abiertas, mientras se decide
  const [colaCuentas, setColaCuentas] = useState(null) // [...pendientes] mientras se cobran una a una
  const [totalCola, setTotalCola] = useState(0) // tamano original de la cola, para "2 de 5"
  const [factura, setFactura] = useState(null)
  const [detalle, setDetalle] = useState(null)
  const [agregandoEgreso, setAgregandoEgreso] = useState(false)
  const [egresoTicket, setEgresoTicket] = useState(null)

  const [periodo, setPeriodo] = useState('hoy')
  const [rangoCustom, setRangoCustom] = useState(null) // { desde, hasta } (YYYY-MM-DD) | null
  const [movs, setMovs] = useState(null)
  const [cargandoMovs, setCargandoMovs] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('TODOS')

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    setCargandoMovs(true)
    const query = periodo === 'custom' && rangoCustom ? `desde=${rangoCustom.desde}&hasta=${rangoCustom.hasta}` : `modo=${periodo}`
    api(`/shifts/movimientos?${query}`)
      .then(setMovs)
      .finally(() => setCargandoMovs(false))
  }, [periodo, rangoCustom])

  async function load() {
    setHistory(await api('/shifts'))
  }

  function show(err) {
    setError(err.message)
    setTimeout(() => setError(''), 4000)
  }

  function elegirPeriodo(key) {
    setPeriodo(key)
    setRangoCustom(null)
  }

  async function abrirTurno(baseCash) {
    try {
      const nuevo = await api('/shifts', { method: 'POST', body: { baseCash } })
      setShift(nuevo)
    } catch (err) {
      show(err)
    }
  }

  async function agregarEgreso(payload) {
    try {
      const egreso = await api(`/shifts/${shift.id}/expenses`, { method: 'POST', body: payload })
      setShift((prev) => ({ ...prev, expenses: [egreso, ...prev.expenses] }))
      setAgregandoEgreso(false)
    } catch (err) {
      show(err)
    }
  }

  async function cerrarTurno(counts) {
    try {
      const cerrado = await api(`/shifts/${shift.id}/close`, { method: 'POST', body: { counts } })
      setClosing(false)
      setShift(null)
      setClosedResult(cerrado)
      load()
    } catch (err) {
      show(err)
    }
  }

  // Antes de dejar cuadrar el turno, hay que saber si quedan cuentas sin
  // cobrar: si no hay ninguna, directo al cuadre de siempre; si hay, primero
  // se pregunta que hacer con ellas.
  async function iniciarCierreTurno() {
    try {
      const abiertas = await api('/orders/open')
      if (abiertas.length === 0) return setClosing(true)
      setEligiendoCierre(abiertas)
    } catch (err) {
      show(err)
    }
  }

  function cobrarCuentasAbiertas() {
    const cuentas = eligiendoCierre
    setEligiendoCierre(null)
    setTotalCola(cuentas.length)
    setColaCuentas(cuentas)
  }

  function pasarAlSiguienteTurno() {
    setEligiendoCierre(null)
    setClosing(true)
  }

  async function confirmarCuentaDeLaCola(payload) {
    const actual = colaCuentas[0]
    const cerrada = await api(`/orders/${actual.id}/close`, { method: 'POST', body: payload })
    const resto = colaCuentas.slice(1)
    setColaCuentas(resto.length ? resto : null)
    if (!resto.length) setClosing(true)
    return cerrada
  }

  async function verFactura(id) {
    try {
      const order = await api(`/orders/${id}`)
      setFactura(order)
    } catch (err) {
      show(err)
    }
  }

  async function verDetalle(id) {
    try {
      const order = await api(`/orders/${id}`)
      setDetalle(order)
    } catch (err) {
      show(err)
    }
  }

  const rangoParaBoton = useMemo(() => {
    if (periodo === 'custom' && rangoCustom) {
      return { from: parseISOLocal(rangoCustom.desde), to: parseISOLocal(rangoCustom.hasta) }
    }
    return { from: new Date(), to: new Date() }
  }, [periodo, rangoCustom])

  const movimientosVisibles = useMemo(() => {
    if (!movs) return []
    const term = busqueda.trim().toLowerCase()
    return movs.movimientos.filter((m) => {
      if (filtroTipo !== 'TODOS' && m.tipo !== filtroTipo) return false
      if (!term) return true
      return m.descripcion.toLowerCase().includes(term) || m.detalle.toLowerCase().includes(term)
    })
  }, [movs, busqueda, filtroTipo])

  if (shift === undefined) {
    return <div className="p-7 text-muted text-sm">Cargando…</div>
  }

  const egresos = shift?.expenses || []
  const totalEgresos = egresos.reduce((s, e) => s + Number(e.amount), 0)
  const sales = shift?.sales || { byMethod: {}, fiado: 0, totalVentas: 0, tickets: 0, cortesias: 0, devoluciones: 0, abonos: { byMethod: {}, total: 0 } }
  const efectivoEsperado = shift
    ? Number(shift.baseCash) + (sales.byMethod.EFECTIVO || 0) + (sales.abonos.byMethod.EFECTIVO || 0) - totalEgresos
    : 0

  return (
    <div className="p-5 md:p-7 max-w-[1500px] mx-auto">
      <header className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-2xl font-bold">Caja</h1>
          <p className="text-muted text-sm mt-1">Movimientos del día y turnos anteriores.</p>
        </div>
      </header>

      {error && (
        <p className="mb-5 text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
          {error}
        </p>
      )}

      <div className="grid lg:grid-cols-[1fr_360px] gap-5 items-start">
        <section className="space-y-5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {PERIODOS.map((p) => (
              <button
                key={p.key}
                onClick={() => elegirPeriodo(p.key)}
                className={`h-10 px-4 rounded-xl text-sm font-semibold border flex items-center gap-1.5 transition-colors ${
                  periodo === p.key ? 'bg-amber text-night border-amber' : 'bg-surface text-muted border-edge hover:text-ink'
                }`}
              >
                <Icon.calendar width={14} height={14} />
                {p.label}
              </button>
            ))}
            <RangoFechas
              rango={rangoParaBoton}
              activo={periodo === 'custom'}
              labelOcioso="Rango personalizado"
              onElegir={(r) => {
                setPeriodo('custom')
                setRangoCustom(r)
              }}
            />
          </div>

          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <TarjetaCaja
              icon={Icon.chart}
              label="Total ventas"
              value={movs?.totales.totalVentas || 0}
              tono="amber"
              sub={
                movs?.totales.variacion != null && (
                  <span className={`flex items-center gap-1 ${movs.totales.variacion >= 0 ? 'text-libre' : 'text-ocupada'}`}>
                    <Icon.trendArrow
                      width={12}
                      height={12}
                      className={movs.totales.variacion >= 0 ? '' : 'scale-y-[-1]'}
                    />
                    {Math.abs(movs.totales.variacion).toFixed(1)}% {ETIQUETA_VARIACION[periodo]}
                  </span>
                )
              }
            />
            <TarjetaCaja
              icon={Icon.cash}
              label="Efectivo"
              value={movs?.totales.efectivo || 0}
              sub={<span>{porcentaje(movs?.totales.efectivo, movs?.totales.totalVentas)}% del total</span>}
            />
            <TarjetaCaja
              icon={Icon.card}
              label="Tarjeta / Transferencia"
              value={movs?.totales.tarjetaTransferencia || 0}
              sub={<span>{porcentaje(movs?.totales.tarjetaTransferencia, movs?.totales.totalVentas)}% del total</span>}
            />
            <TarjetaCaja
              icon={Icon.undo}
              label="Devoluciones"
              value={movs?.totales.devoluciones || 0}
              tono="ocupada"
              sub={<span>{porcentaje(movs?.totales.devoluciones, movs?.totales.totalVentas)}% del total</span>}
            />
          </div>

          <section className="card overflow-hidden">
            <div className="p-5 pb-4 flex items-center justify-between gap-3 flex-wrap">
              <h2 className="font-semibold flex items-center gap-2">
                <Icon.clipboard width={18} height={18} className="text-muted" />
                Movimientos del periodo
              </h2>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
                    <Icon.search width={16} height={16} />
                  </span>
                  <input
                    className="field h-10 pl-9 w-56"
                    placeholder="Buscar movimiento…"
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                  />
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
                    <Icon.filter width={16} height={16} />
                  </span>
                  <select
                    value={filtroTipo}
                    onChange={(e) => setFiltroTipo(e.target.value)}
                    className="field h-10 pl-9 w-40"
                    aria-label="Filtrar por tipo de movimiento"
                  >
                    <option value="TODOS">Todos</option>
                    <option value="VENTA">Ventas</option>
                    <option value="DEVOLUCION">Devoluciones</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted border-y border-edge">
                    <th className="px-5 py-2.5 text-left font-semibold">Hora</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Tipo</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Descripción</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Detalle</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Método</th>
                    <th className="px-5 py-2.5 text-right font-semibold">Monto</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {movimientosVisibles.map((m) => (
                    <tr
                      key={m.id}
                      onClick={() => verDetalle(m.orderId)}
                      className="border-b border-edge/60 last:border-0 hover:bg-raised/60 cursor-pointer"
                    >
                      <td className="px-5 py-3 text-muted whitespace-nowrap">{formatHora(m.hora)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-pill border ${
                            m.tipo === 'VENTA'
                              ? 'text-libre border-libre/40 bg-libre/10'
                              : 'text-ocupada border-ocupada/40 bg-ocupada/10'
                          }`}
                        >
                          {m.tipo === 'VENTA' ? <Icon.cash width={11} height={11} /> : <Icon.undo width={11} height={11} />}
                          {m.tipo === 'VENTA' ? 'Venta' : 'Devolución'}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium whitespace-nowrap">{m.descripcion}</td>
                      <td className="px-4 py-3 text-muted max-w-xs truncate" title={m.detalle}>
                        {m.detalle}
                      </td>
                      <td className="px-4 py-3 text-muted whitespace-nowrap">{m.metodo || '—'}</td>
                      <td className={`px-5 py-3 text-right font-semibold whitespace-nowrap ${m.monto < 0 ? 'text-ocupada' : ''}`}>
                        {m.monto < 0 ? '-' : ''}
                        {money(Math.abs(m.monto))}
                      </td>
                      <td className="pr-4 text-muted">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            verFactura(m.orderId)
                          }}
                          aria-label="Reimprimir factura"
                          className="w-8 h-8 rounded-lg grid place-items-center hover:text-amber hover:bg-raised transition-colors"
                        >
                          <Icon.receipt width={16} height={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!cargandoMovs && movimientosVisibles.length === 0 && (
                <p className="px-5 py-10 text-center text-muted text-sm">No hay movimientos con ese filtro.</p>
              )}
              {cargandoMovs && <p className="px-5 py-10 text-center text-muted text-sm">Cargando…</p>}
            </div>
          </section>

          {shift && (
            <section className="card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Egresos y retiros de este turno</h2>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-ocupada">-{money(totalEgresos)}</span>
                  <button onClick={() => setAgregandoEgreso(true)} className="btn-ghost h-9 px-3 text-xs">
                    <Icon.plus width={14} height={14} />
                    Agregar
                  </button>
                </div>
              </div>
              {egresos.length === 0 ? (
                <p className="text-sm text-muted">Todavía no hay egresos en este turno.</p>
              ) : (
                <div>
                  {egresos.map((e) => (
                    <div key={e.id} className="flex items-center justify-between gap-3 py-2.5 border-b border-edge/60 last:border-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{e.reason}</p>
                        <p className="text-xs text-muted">
                          {e.type === 'RETIRO' ? 'Retiro' : 'Gasto'} · {e.authorizedBy?.name}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-semibold text-ocupada">-{money(e.amount)}</span>
                        <button
                          type="button"
                          onClick={() => setEgresoTicket(e)}
                          aria-label="Reimprimir comprobante"
                          className="w-8 h-8 rounded-lg grid place-items-center text-muted hover:text-amber hover:bg-raised transition-colors"
                        >
                          <Icon.receipt width={16} height={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </section>

        <aside className="space-y-5">
          {shift ? (
            <TurnoActualCard shift={shift} onPedirCierre={iniciarCierreTurno} />
          ) : (
            <AbrirTurno onAbrir={abrirTurno} />
          )}

          {shift && (
            <ResumenTurnoCard
              shift={shift}
              sales={sales}
              totalEgresos={totalEgresos}
              efectivoEsperado={efectivoEsperado}
              onPedirCierre={iniciarCierreTurno}
            />
          )}

          <TurnosAnterioresCard turnos={history} onVer={(id) => navigate(`/caja/turnos/${id}`)} />
        </aside>
      </div>

      {closedResult && (
        <ResumenCierreModal resultado={closedResult} onCerrar={() => setClosedResult(null)} />
      )}

      {eligiendoCierre && (
        <ElegirCierreModal
          cantidad={eligiendoCierre.length}
          onCobrarlas={cobrarCuentasAbiertas}
          onPasarlas={pasarAlSiguienteTurno}
          onCancel={() => setEligiendoCierre(null)}
        />
      )}

      {colaCuentas && (
        <>
          <div className="fixed top-4 inset-x-0 z-[55] flex justify-center pointer-events-none">
            <span className="bg-night border border-amber/40 text-amber text-xs font-semibold px-3 py-1.5 rounded-pill shadow-lg">
              Cerrando cuentas abiertas · {totalCola - colaCuentas.length + 1} de {totalCola} · mesa{' '}
              {colaCuentas[0].table?.number}
            </span>
          </div>
          <CerrarCuentaModal
            key={colaCuentas[0].id}
            orderId={colaCuentas[0].id}
            total={colaCuentas[0].total}
            customer={colaCuentas[0].customer}
            saldoCliente={0}
            puedeDescuento={isAdmin || (session?.user.role === 'CAJERO' && session?.tenant.cajeroAplicaDescuentos)}
            tableLabel={`Mesa ${colaCuentas[0].table?.number}`}
            items={colaCuentas[0].items}
            onClose={() => setColaCuentas(null)}
            onConfirm={confirmarCuentaDeLaCola}
          />
        </>
      )}

      {closing && <CuadreModal onCancel={() => setClosing(false)} onConfirm={cerrarTurno} />}

      {agregandoEgreso && (
        <EgresoModal onCancel={() => setAgregandoEgreso(false)} onAgregar={agregarEgreso} />
      )}

      {factura && (
        <ReciboModal
          order={factura}
          splitCount={1}
          tenantName={session?.tenant?.name}
          autoPrint={false}
          onClose={() => setFactura(null)}
        />
      )}

      {detalle && <ConsumoDetalleModal order={detalle} onClose={() => setDetalle(null)} />}

      {egresoTicket && (
        <TicketEgresoModal
          egreso={egresoTicket}
          tenantName={session?.tenant?.name}
          autoPrint={false}
          onClose={() => setEgresoTicket(null)}
        />
      )}
    </div>
  )
}

function porcentaje(valor, total) {
  if (!total) return '0,0'
  return ((Math.abs(valor || 0) / total) * 100).toFixed(1).replace('.', ',')
}

const TONOS_CAJA = {
  amber: 'bg-amber/10 border-amber/40 text-amber',
  ocupada: 'bg-ocupada/10 border-ocupada/40 text-ocupada',
  default: 'bg-raised border-edge text-muted',
}

function TarjetaCaja({ icon: Ico, label, value, tono = 'default', sub }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-3 mb-3">
        <span className={`w-10 h-10 rounded-full grid place-items-center shrink-0 border ${TONOS_CAJA[tono]}`}>
          <Ico width={18} height={18} />
        </span>
        <p className="text-xs text-muted">{label}</p>
      </div>
      <p className="text-2xl font-bold leading-none truncate">{money(value)}</p>
      {sub && <p className="text-xs font-semibold mt-2">{sub}</p>}
    </div>
  )
}

// Tarjeta superior del sidebar: quien tiene la caja abierta ahora mismo, y el
// boton de cerrar siempre a mano sin tener que bajar a buscarlo.
function TurnoActualCard({ shift, onPedirCierre }) {
  return (
    <section className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-10 h-10 rounded-xl bg-raised border border-edge grid place-items-center text-amber shrink-0">
            <Icon.calendar width={18} height={18} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-libre flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-libre" />
              Turno actual
            </p>
            <p className="text-sm font-semibold truncate">{shift.openedBy?.name}</p>
            <p className="text-xs text-muted">{formatHora(shift.openedAt)} - ahora</p>
          </div>
        </div>
        <button onClick={onPedirCierre} className="btn-primary h-9 px-3.5 text-xs shrink-0">
          Cerrar turno
        </button>
      </div>
    </section>
  )
}

function ResumenTurnoCard({ shift, sales, totalEgresos, efectivoEsperado, onPedirCierre }) {
  return (
    <section className="card p-5 space-y-4">
      <h2 className="font-semibold flex items-center gap-2">
        <Icon.receipt width={18} height={18} className="text-muted" />
        Resumen del turno
      </h2>
      <div className="space-y-2.5 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted">Apertura de caja</span>
          <span className="font-semibold">{money(shift.baseCash)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted">Ventas del turno</span>
          <span className="font-semibold text-libre">{money(sales.totalVentas)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted">Devoluciones</span>
          <span className={`font-semibold ${sales.devoluciones > 0 ? 'text-ocupada' : ''}`}>
            {money(sales.devoluciones)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted">Egresos y retiros</span>
          <span className={`font-semibold ${totalEgresos > 0 ? 'text-ocupada' : ''}`}>
            {money(totalEgresos)}
          </span>
        </div>
      </div>
      <div className="pt-4 border-t border-edge flex items-center justify-between">
        <span className="text-sm font-semibold">Total en caja</span>
        <span className="text-2xl font-bold text-amber">{money(efectivoEsperado)}</span>
      </div>
      <button onClick={onPedirCierre} className="btn-primary w-full">
        <Icon.cash width={16} height={16} />
        Cerrar turno
      </button>
    </section>
  )
}

function TurnosAnterioresCard({ turnos, onVer }) {
  return (
    <section className="card p-5">
      <h2 className="font-semibold mb-3 flex items-center gap-2">
        <Icon.undo width={18} height={18} className="text-muted" />
        Turnos anteriores
      </h2>
      {turnos.length === 0 ? (
        <p className="text-sm text-muted">Todavía no hay turnos cerrados.</p>
      ) : (
        <div>
          {turnos.map((t) => {
            const efectivo = (t.counts || []).find((c) => c.method === 'EFECTIVO')
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onVer(t.id)}
                className="w-full flex items-center gap-3 py-3 px-2 -mx-2 rounded-xl text-left transition-colors hover:bg-raised border-b border-edge/60 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{formatFechaCorta(t.closedAt)}</p>
                  <p className="text-xs text-muted truncate">
                    {formatHora(t.openedAt)} - {formatHora(t.closedAt)}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold">{money(t.sales?.totalVentas || 0)}</p>
                  {efectivo && (
                    <p className={`text-xs font-semibold ${diffColor(efectivo.difference)}`}>
                      {efectivo.difference === 0 ? 'Cuadrado' : money(efectivo.difference)}
                    </p>
                  )}
                </div>
                <Icon.chevronLeft width={16} height={16} className="rotate-180 text-muted shrink-0" />
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

function AbrirTurno({ onAbrir }) {
  const [base, setBase] = useState('')

  return (
    <section className="card p-5 space-y-4">
      <div>
        <h2 className="font-semibold mb-1">Abrir turno</h2>
        <p className="text-sm text-muted">
          Declara la base inicial en efectivo con la que arranca la caja. Eso es lo que se compara al cerrar.
        </p>
      </div>
      <div>
        <label className="label">Base inicial (efectivo)</label>
        <MoneyInput className="field" value={base} onChange={setBase} />
      </div>
      <button onClick={() => onAbrir(Number(base) || 0)} disabled={base === ''} className="btn-primary w-full">
        Abrir turno con esta base
      </button>
    </section>
  )
}

function EgresoModal({ onCancel, onAgregar }) {
  const [type, setType] = useState('GASTO')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  async function confirmar() {
    if (!amount || !reason.trim()) return
    setSaving(true)
    try {
      await onAgregar({ type, amount: Number(amount), reason: reason.trim() })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-sm p-5 space-y-4">
        <h2 className="text-lg font-bold">Registrar egreso</h2>
        <div className="flex gap-2">
          <button type="button" onClick={() => setType('GASTO')} className={tipoClass(type === 'GASTO')}>
            Gasto
          </button>
          <button type="button" onClick={() => setType('RETIRO')} className={tipoClass(type === 'RETIRO')}>
            Retiro
          </button>
        </div>
        <div>
          <label className="label">Motivo</label>
          <input
            className="field"
            placeholder="Ej: hielo, pago domicilio"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Monto</label>
          <MoneyInput className="field" value={amount} onChange={setAmount} />
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onCancel} className="btn-ghost flex-1">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={!amount || !reason.trim() || saving} className="btn-primary flex-1">
            {saving ? 'Guardando…' : 'Agregar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function tipoClass(active) {
  return `h-10 px-3 rounded-xl text-xs font-semibold border transition-colors flex-1 ${
    active ? 'bg-amber text-night border-amber' : 'bg-surface text-muted border-edge hover:text-ink'
  }`
}

// Primera pregunta al cerrar turno con cuentas todavia abiertas: cobrarlas
// ya mismo (una por una, hasta que no quede ninguna) o dejarlas para quien
// reciba el siguiente turno. Ninguna de las dos bloquea el cierre; solo
// cambia si el cuadre de este turno incluye esa plata o no.
function ElegirCierreModal({ cantidad, onCobrarlas, onPasarlas, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-sm p-5 space-y-4">
        <h2 className="text-lg font-bold">
          {cantidad === 1 ? 'Hay una cuenta abierta' : `Hay ${cantidad} cuentas abiertas`}
        </h2>
        <p className="text-sm text-muted">
          {cantidad === 1
            ? 'Esa mesa todavía no se ha cobrado. ¿Qué quieres hacer con ella antes de cerrar el turno?'
            : 'Esas mesas todavía no se han cobrado. ¿Qué quieres hacer con ellas antes de cerrar el turno?'}
        </p>
        <div className="space-y-2.5 pt-1">
          <button onClick={onCobrarlas} className="btn-primary w-full">
            {cantidad === 1 ? 'Cobrarla ahora' : 'Cobrarlas ahora, una por una'}
          </button>
          <button onClick={onPasarlas} className="btn-ghost w-full">
            Pasarlas al siguiente turno
          </button>
          <p className="text-xs text-muted text-center pt-1">
            El cuadre de este turno solo va a sumar lo que ya se cobró; lo que quede abierto se liquida cuando se
            cierre, en el turno que esté abierto en ese momento.
          </p>
        </div>
        <button onClick={onCancel} className="text-xs text-muted hover:text-ink w-full text-center">
          Cancelar
        </button>
      </div>
    </div>
  )
}

function CuadreModal({ onCancel, onConfirm }) {
  const [counts, setCounts] = useState({ EFECTIVO: '', NEQUI: '', TRANSFERENCIA: '', DATAFONO: '' })
  const [saving, setSaving] = useState(false)
  const completo = METHODS.every((m) => counts[m.key] !== '')

  async function confirmar() {
    setSaving(true)
    try {
      await onConfirm(Object.fromEntries(METHODS.map((m) => [m.key, Number(counts[m.key]) || 0])))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-md p-5 space-y-4">
        <h2 className="text-lg font-bold">Cuadre de caja</h2>
        <p className="text-sm text-muted">
          Cuenta cada medio de pago tal cual lo tienes, sin mirar lo esperado. El sistema calcula la diferencia después
          de que confirmes.
        </p>
        <div className="space-y-3">
          {METHODS.map((m) => (
            <div key={m.key}>
              <label className="label">{m.label}</label>
              <MoneyInput
                className="field"
                value={counts[m.key]}
                onChange={(v) => setCounts((prev) => ({ ...prev, [m.key]: v }))}
              />
            </div>
          ))}
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onCancel} className="btn-ghost flex-1">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={!completo || saving} className="btn-primary flex-1">
            {saving ? 'Cerrando…' : 'Cerrar turno'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ResumenCierreModal({ resultado, onCerrar }) {
  const counts = resultado.counts || []
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <section className="card w-full max-w-md p-5 space-y-4">
        <div>
          <h2 className="font-semibold mb-1">Turno cerrado</h2>
          <p className="text-sm text-muted">
            Cerró {resultado.closedBy?.name} · {formatFechaCorta(resultado.closedAt)} {formatHora(resultado.closedAt)}
          </p>
        </div>
        <div className="flex items-center justify-between pb-1 border-b border-edge">
          <span className="text-sm text-muted">Total vendido</span>
          <span className="text-lg font-bold text-amber">{money(resultado.sales?.totalVentas || 0)}</span>
        </div>
        <CuadreResumen counts={counts} />
        <button onClick={onCerrar} className="btn-primary w-full">
          Entendido
        </button>
      </section>
    </div>
  )
}

function diffColor(diff) {
  if (diff === 0) return 'text-libre'
  return diff > 0 ? 'text-reservada' : 'text-ocupada'
}

function formatFechaCorta(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('es-CO', { weekday: 'short', day: '2-digit', month: 'short' })
}

function formatHora(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })
}
