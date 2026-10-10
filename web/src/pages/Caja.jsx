import { useEffect, useState } from 'react'
import { api, money } from '../lib/api'
import { Icon } from '../components/Icons'
import MoneyInput from '../components/MoneyInput'

const METHODS = [
  { key: 'EFECTIVO', label: 'Efectivo' },
  { key: 'NEQUI', label: 'Nequi' },
  { key: 'DAVIPLATA', label: 'Daviplata' },
  { key: 'DATAFONO', label: 'Datáfono' },
]
const METHOD_LABEL = Object.fromEntries(METHODS.map((m) => [m.key, m.label]))

export default function Caja() {
  const [shift, setShift] = useState(undefined) // undefined = cargando, null = sin turno abierto
  const [history, setHistory] = useState([])
  const [error, setError] = useState('')
  const [closing, setClosing] = useState(false)
  const [closedResult, setClosedResult] = useState(null)

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

      {!closedResult && !shift && <AbrirTurno onAbrir={abrirTurno} />}

      {!closedResult && shift && (
        <TurnoActivo shift={shift} onAgregarEgreso={agregarEgreso} onPedirCierre={() => setClosing(true)} />
      )}

      {closing && <CuadreModal onCancel={() => setClosing(false)} onConfirm={cerrarTurno} />}

      {history.length > 0 && <Historial turnos={history} />}
    </div>
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

function TurnoActivo({ shift, onAgregarEgreso, onPedirCierre }) {
  const egresos = shift.expenses || []
  const totalEgresos = egresos.reduce((s, e) => s + Number(e.amount), 0)

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

      <section className="card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Egresos</h2>
          <span className="text-sm text-muted">{money(totalEgresos)}</span>
        </div>

        <EgresoForm onAgregar={onAgregarEgreso} />

        {egresos.length === 0 ? (
          <p className="text-sm text-muted">Todavía no hay egresos en este turno.</p>
        ) : (
          <div className="space-y-2">
            {egresos.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between bg-raised border border-edge rounded-xl px-3 py-2.5"
              >
                <div>
                  <p className="text-sm font-medium">{e.reason}</p>
                  <p className="text-xs text-muted">
                    {e.type === 'RETIRO' ? 'Retiro' : 'Gasto'} · {e.authorizedBy?.name}
                  </p>
                </div>
                <span className="text-sm font-semibold text-ocupada">-{money(e.amount)}</span>
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
  const [counts, setCounts] = useState({ EFECTIVO: '', NEQUI: '', DAVIPLATA: '', DATAFONO: '' })
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
      <div className="space-y-2">
        {counts.map((c) => (
          <div
            key={c.method}
            className="flex items-center justify-between bg-raised border border-edge rounded-xl px-3 py-2.5"
          >
            <span className="text-sm font-medium">{METHOD_LABEL[c.method]}</span>
            <div className="text-right">
              <p className="text-sm">
                <span className="text-muted">Esperado </span>
                <span className="font-semibold">{money(c.expected)}</span>
                <span className="text-muted"> · Contado </span>
                <span className="font-semibold">{money(c.counted)}</span>
              </p>
              <p className={`text-xs font-semibold ${diffColor(c.difference)}`}>
                {c.difference === 0
                  ? 'Sin diferencia'
                  : `${c.difference > 0 ? 'Sobran' : 'Faltan'} ${money(Math.abs(c.difference))}`}
              </p>
            </div>
          </div>
        ))}
      </div>
      <button onClick={onCerrar} className="btn-primary w-full">
        Entendido
      </button>
    </section>
  )
}

function Historial({ turnos }) {
  return (
    <section className="card p-5">
      <h2 className="font-semibold mb-3">Turnos anteriores</h2>
      <div>
        {turnos.map((t) => {
          const efectivo = (t.counts || []).find((c) => c.method === 'EFECTIVO')
          return (
            <div
              key={t.id}
              className="flex items-center justify-between text-sm py-2.5 border-b border-edge/60 last:border-0"
            >
              <div>
                <p className="font-medium">{formatFecha(t.closedAt)}</p>
                <p className="text-xs text-muted">
                  {t.openedBy?.name} abrió · {t.closedBy?.name} cerró
                </p>
              </div>
              {efectivo && (
                <span className={`text-xs font-semibold ${diffColor(efectivo.difference)}`}>
                  {efectivo.difference === 0 ? 'Cuadrado' : money(efectivo.difference)}
                </span>
              )}
            </div>
          )
        })}
      </div>
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
