import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, money } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Icon } from '../components/Icons'
import MoneyInput from '../components/MoneyInput'
import ReciboModal from '../components/ReciboModal'
import FacturasDelDia from '../components/FacturasDelDia'
import ResumenVentas from '../components/ResumenVentas'
import CuadreResumen from '../components/CuadreResumen'
import { METHODS } from '../lib/paymentMethods'

export default function Caja() {
  const { session } = useAuth()
  const [shift, setShift] = useState(undefined) // undefined = cargando, null = sin turno abierto
  const [history, setHistory] = useState([])
  const [tab, setTab] = useState('activo')
  const [error, setError] = useState('')
  const [closing, setClosing] = useState(false)
  const [closedResult, setClosedResult] = useState(null)
  const [factura, setFactura] = useState(null) // pedido completo que se esta viendo, o null

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const [current, past] = await Promise.all([api('/shifts/current'), api('/shifts')])
    setShift(current)
    setHistory(past)
  }

  function show(err) {
    setError(err.message)
    setTimeout(() => setError(''), 4000)
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

  async function verFactura(id) {
    try {
      const order = await api(`/orders/${id}`)
      setFactura(order)
    } catch (err) {
      show(err)
    }
  }

  if (shift === undefined) {
    return <div className="p-7 text-muted text-sm">Cargando…</div>
  }

  return (
    <div className="p-5 md:p-7 max-w-[900px] mx-auto space-y-5">
      <header>
        <h1 className="text-2xl font-bold">Caja</h1>
        <p className="text-muted text-sm mt-1">
          Un turno no es el día calendario: abarca desde que se abre la caja hasta que se cierra,
          aunque cruce la medianoche.
        </p>
      </header>

      {error && (
        <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
          {error}
        </p>
      )}

      {closedResult && <ResumenCierre resultado={closedResult} onCerrar={() => setClosedResult(null)} />}

      {!closedResult && (
        <>
          <div className="flex gap-2">
            <TabButton active={tab === 'activo'} onClick={() => setTab('activo')}>
              Turno actual
            </TabButton>
            <TabButton active={tab === 'historial'} onClick={() => setTab('historial')}>
              Turnos anteriores{history.length > 0 ? ` (${history.length})` : ''}
            </TabButton>
          </div>

          {tab === 'activo' && !shift && <AbrirTurno onAbrir={abrirTurno} />}

          {tab === 'activo' && shift && (
            <TurnoActivo
              shift={shift}
              onAgregarEgreso={agregarEgreso}
              onPedirCierre={() => setClosing(true)}
              onVerFactura={verFactura}
            />
          )}

          {tab === 'historial' && <Historial turnos={history} />}
        </>
      )}

      {closing && <CuadreModal onCancel={() => setClosing(false)} onConfirm={cerrarTurno} />}

      {factura && (
        <ReciboModal
          order={factura}
          splitCount={1}
          tenantName={session?.tenant?.name}
          autoPrint={false}
          onClose={() => setFactura(null)}
        />
      )}
    </div>
  )
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-10 px-4 rounded-xl text-sm font-semibold border transition-colors ${
        active ? 'bg-amber text-night border-amber' : 'bg-surface text-muted border-edge hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

function AbrirTurno({ onAbrir }) {
  const [base, setBase] = useState('')

  return (
    <section className="card p-5 space-y-4">
      <div>
        <h2 className="font-semibold mb-1">Abrir turno</h2>
        <p className="text-sm text-muted">
          Declara la base inicial en efectivo con la que arranca la caja. Eso es lo que se compara
          al cerrar.
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

function TurnoActivo({ shift, onAgregarEgreso, onPedirCierre, onVerFactura }) {
  const egresos = shift.expenses || []
  const totalEgresos = egresos.reduce((s, e) => s + Number(e.amount), 0)
  const sales = shift.sales || { byMethod: {}, fiado: 0, totalVentas: 0, tickets: 0, cortesias: 0 }
  const efectivoEsperado = Number(shift.baseCash) + (sales.byMethod.EFECTIVO || 0) - totalEgresos

  return (
    <>
      <section className="card p-5 space-y-1.5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Turno abierto</h2>
          <span className="text-xs font-semibold text-libre border border-libre/40 bg-libre/10 rounded-pill px-2.5 py-1">
            Abierto
          </span>
        </div>
        <p className="text-sm text-muted">
          Abrió {shift.openedBy?.name} · {formatFecha(shift.openedAt)}
        </p>
        <p className="text-sm text-muted">
          Base inicial: <span className="text-ink font-semibold">{money(shift.baseCash)}</span>
        </p>
      </section>

      <ResumenVentas
        titulo="Movimiento de hoy"
        sales={sales}
        heroLabel="Efectivo esperado en caja"
        heroValue={efectivoEsperado}
      />

      {shift.facturas?.length > 0 && <FacturasDelDia facturas={shift.facturas} onVer={onVerFactura} />}

      <section className="card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Egresos y retiros</h2>
          <span className="text-sm font-semibold text-ocupada">-{money(totalEgresos)}</span>
        </div>

        <EgresoForm onAgregar={onAgregarEgreso} />

        {egresos.length === 0 ? (
          <p className="text-sm text-muted">Todavía no hay egresos en este turno.</p>
        ) : (
          <div>
            {egresos.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between gap-3 py-2.5 border-b border-edge/60 last:border-0"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{e.reason}</p>
                  <p className="text-xs text-muted">
                    {e.type === 'RETIRO' ? 'Retiro' : 'Gasto'} · {e.authorizedBy?.name}
                  </p>
                </div>
                <span className="text-sm font-semibold text-ocupada shrink-0">-{money(e.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <button onClick={onPedirCierre} className="btn-primary w-full">
        Cerrar turno
      </button>
    </>
  )
}

function EgresoForm({ onAgregar }) {
  const [type, setType] = useState('GASTO')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!amount || !reason.trim()) return
    setSaving(true)
    try {
      await onAgregar({ type, amount: Number(amount), reason: reason.trim() })
      setAmount('')
      setReason('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap gap-2 items-end bg-raised border border-edge rounded-xl p-3">
      <div className="flex gap-2">
        <button type="button" onClick={() => setType('GASTO')} className={tipoClass(type === 'GASTO')}>
          Gasto
        </button>
        <button type="button" onClick={() => setType('RETIRO')} className={tipoClass(type === 'RETIRO')}>
          Retiro
        </button>
      </div>
      <div className="flex-1 min-w-[160px]">
        <input
          className="field h-10"
          placeholder="Motivo (ej: hielo, pago domicilio)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <div className="w-32">
        <MoneyInput className="field h-10" placeholder="Monto" value={amount} onChange={setAmount} />
      </div>
      <button type="submit" disabled={saving} className="btn-ghost h-10">
        <Icon.plus width={16} height={16} />
        Agregar
      </button>
    </form>
  )
}

function tipoClass(active) {
  return `h-10 px-3 rounded-xl text-xs font-semibold border transition-colors ${
    active ? 'bg-amber text-night border-amber' : 'bg-surface text-muted border-edge hover:text-ink'
  }`
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
          Cuenta cada medio de pago tal cual lo tienes, sin mirar lo esperado. El sistema calcula
          la diferencia después de que confirmes.
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

function ResumenCierre({ resultado, onCerrar }) {
  const counts = resultado.counts || []
  return (
    <section className="card p-5 space-y-4">
      <div>
        <h2 className="font-semibold mb-1">Turno cerrado</h2>
        <p className="text-sm text-muted">
          Cerró {resultado.closedBy?.name} · {formatFecha(resultado.closedAt)}
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
  )
}

function Historial({ turnos }) {
  const navigate = useNavigate()

  return (
    <section className="card p-5">
      <h2 className="font-semibold mb-3">Turnos anteriores</h2>
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
                onClick={() => navigate(`/caja/turnos/${t.id}`)}
                className="w-full flex items-center gap-3 py-3 px-2 -mx-2 rounded-xl text-left transition-colors hover:bg-raised border-b border-edge/60 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{formatFecha(t.closedAt)}</p>
                  <p className="text-xs text-muted truncate">
                    {t.openedBy?.name} abrió · {t.closedBy?.name} cerró
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

function diffColor(diff) {
  if (diff === 0) return 'text-libre'
  return diff > 0 ? 'text-reservada' : 'text-ocupada'
}

function formatFecha(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
}
