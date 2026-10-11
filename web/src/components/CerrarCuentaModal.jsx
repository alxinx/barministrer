import { useState } from 'react'
import { money } from '../lib/api'
import { Icon } from './Icons'
import MoneyInput from './MoneyInput'

const METHODS = [
  { key: 'EFECTIVO', label: 'Efectivo' },
  { key: 'TRANSFERENCIA', label: 'Transferencia Bancolombia' },
  { key: 'NEQUI', label: 'Nequi' },
  { key: 'DATAFONO', label: 'Datáfono' },
  { key: 'CREDITO', label: 'Crédito (fiado)' },
]

/**
 * Cierra la cuenta: paga en uno o varios medios con cambio si es en efectivo,
 * divide el comprobante entre personas (no cambia lo que se cobra, solo lo
 * que imprime), o cortesia. El switch de cortesia esta escondido a proposito:
 * hay que tocar 3 veces el titulo "Cerrar cuenta" para que aparezca. Credito
 * solo aparece si hay un cliente vinculado con el credito habilitado: fiar
 * sin saber a quien no tiene sentido.
 */
export default function CerrarCuentaModal({ total, customer, onClose, onConfirm }) {
  const metodosDisponibles = customer?.creditEnabled ? METHODS : METHODS.filter((m) => m.key !== 'CREDITO')
  const [splitOpen, setSplitOpen] = useState(false)
  const [splitCount, setSplitCount] = useState(1)
  const [rows, setRows] = useState([{ method: 'EFECTIVO', amount: String(total), tendered: '' }])
  const [clickCount, setClickCount] = useState(0)
  const [courtesy, setCourtesy] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const sumaPagos = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const restante = total - sumaPagos
  const porPersona = total / (Number(splitCount) || 1)

  function setRow(i, patch) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function addRow() {
    setRows((prev) => [...prev, { method: 'EFECTIVO', amount: restante > 0 ? String(restante) : '', tendered: '' }])
  }
  function removeRow(i) {
    setRows((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function confirmar() {
    setError('')
    if (courtesy) {
      setSaving(true)
      try {
        await onConfirm({ courtesy: true, splitCount: Number(splitCount) || 1 })
      } catch (err) {
        setError(err.message)
      } finally {
        setSaving(false)
      }
      return
    }

    if (restante !== 0) {
      return setError(restante > 0 ? `Faltan ${money(restante)} por asignar` : `Sobran ${money(-restante)} asignados`)
    }

    setSaving(true)
    try {
      await onConfirm({
        payments: rows.map((r) => ({
          method: r.method,
          amount: Number(r.amount) || 0,
          ...(r.method === 'EFECTIVO' && r.tendered ? { tendered: Number(r.tendered) } : {}),
        })),
        splitCount: Number(splitCount) || 1,
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-md p-5 space-y-5 max-h-[90vh] overflow-y-auto"
      >
        <header className="flex items-center justify-between">
          <h2
            onClick={() => setClickCount((c) => c + 1)}
            className="text-lg font-bold select-none cursor-default"
          >
            Cerrar cuenta
          </h2>
          <div className="text-right">
            <p className="text-xs text-muted">Total a cobrar</p>
            <p className="text-xl font-bold text-amber leading-tight">{money(total)}</p>
          </div>
        </header>

        {error && (
          <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
            {error}
          </p>
        )}

        {!courtesy && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="label mb-0">Medios de pago</span>
              <button type="button" onClick={addRow} className="text-xs font-semibold text-amber flex items-center gap-1">
                <Icon.plus width={14} height={14} /> Agregar medio
              </button>
            </div>

            {rows.map((r, i) => {
              const cambio = r.method === 'EFECTIVO' && r.tendered ? Number(r.tendered) - Number(r.amount || 0) : 0
              return (
                <div key={i} className="bg-raised border border-edge rounded-xl p-3 space-y-2.5">
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label className="label text-xs">Medio de pago</label>
                      <select
                        className="field h-9"
                        value={r.method}
                        onChange={(e) => setRow(i, { method: e.target.value, tendered: '' })}
                      >
                        {metodosDisponibles.map((m) => (
                          <option key={m.key} value={m.key}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {rows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        aria-label="Quitar este medio de pago"
                        className="h-9 px-1 text-muted hover:text-ocupada"
                      >
                        <Icon.trash width={16} height={16} />
                      </button>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="label text-xs">Monto con este medio</label>
                      <MoneyInput className="field h-9" value={r.amount} onChange={(v) => setRow(i, { amount: v })} />
                    </div>
                    {r.method === 'EFECTIVO' && (
                      <div className="flex-1">
                        <label className="label text-xs">Recibió en efectivo</label>
                        <MoneyInput
                          className="field h-9"
                          value={r.tendered}
                          onChange={(v) => setRow(i, { tendered: v })}
                          placeholder="Igual al monto"
                        />
                      </div>
                    )}
                  </div>

                  {r.method === 'EFECTIVO' && (
                    <p className="text-xs text-muted">Déjalo vacío si pagó el valor exacto, sin cambio.</p>
                  )}
                  {cambio > 0 && (
                    <p className="text-sm font-semibold text-libre">Devolver {money(cambio)} de cambio</p>
                  )}
                  {r.method === 'CREDITO' && (
                    <p className="text-xs text-amber">Se carga como deuda a {customer.firstName}, no entra a caja.</p>
                  )}
                </div>
              )
            })}

            <p className={`text-sm font-semibold ${restante === 0 ? 'text-libre' : 'text-ocupada'}`}>
              {restante === 0
                ? 'Los pagos cuadran con el total'
                : restante > 0
                  ? `Faltan ${money(restante)} por asignar`
                  : `Sobran ${money(-restante)} asignados`}
            </p>
          </div>
        )}

        {courtesy && (
          <p className="text-sm text-amber border border-amber/30 bg-amber/10 rounded-xl px-3 py-2.5">
            Esta cuenta se cierra como cortesía: no se cobra nada y queda como gasto del turno ("Pago a
            proveedor oficial").
          </p>
        )}

        {!splitOpen ? (
          <button
            type="button"
            onClick={() => setSplitOpen(true)}
            className="text-xs font-semibold text-muted hover:text-ink flex items-center gap-1.5"
          >
            <Icon.users width={14} height={14} />
            Dividir el comprobante entre varias personas
          </button>
        ) : (
          <div className="bg-raised border border-edge rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <label className="label mb-0">Dividir el comprobante entre</label>
              <button
                type="button"
                onClick={() => {
                  setSplitOpen(false)
                  setSplitCount(1)
                }}
                className="text-xs text-muted hover:text-ink"
              >
                Quitar
              </button>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="1"
                className="field w-20 h-9"
                value={splitCount}
                onChange={(e) => setSplitCount(e.target.value)}
              />
              <span className="text-sm text-muted">personas · {money(porPersona)} c/u</span>
            </div>
            <p className="text-xs text-muted">
              Solo cambia lo que imprime el comprobante, no afecta los medios de pago de arriba.
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost flex-1">
            Cancelar
          </button>
          <button type="button" onClick={confirmar} disabled={saving} className="btn-primary flex-1">
            {saving ? 'Procesando…' : courtesy ? 'Marcar como cortesía' : 'Pagar'}
          </button>
        </div>

        {clickCount >= 3 && (
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs font-semibold text-muted">Cortesía</span>
            <button
              type="button"
              onClick={() => setCourtesy((v) => !v)}
              className={`h-7 w-12 rounded-pill relative transition-colors ${
                courtesy ? 'bg-amber' : 'bg-raised border border-edge'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full transition-transform ${
                  courtesy ? 'translate-x-5 bg-night' : 'bg-muted'
                }`}
              />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
