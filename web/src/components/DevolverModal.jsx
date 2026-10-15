import { useState } from 'react'
import { api } from '../lib/api'
import PinInput from './PinInput'

/** Devolver un producto ya pedido: necesita motivo y el PIN de un encargado. */
export default function DevolverModal({ item, onCancel, onDevuelto }) {
  const [pin, setPin] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function confirmar() {
    if (!pin || !reason.trim()) return
    setSaving(true)
    setError('')
    try {
      const updated = await api(`/orders/${item.orderId}/items/${item.id}/void`, {
        method: 'PATCH',
        body: { pin, reason: reason.trim() },
      })
      onDevuelto(updated)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-sm p-5 space-y-4">
        <h2 className="text-lg font-bold">Devolver producto</h2>
        <p className="text-sm text-muted">
          {item.name}
          {item.variantName ? ` · ${item.variantName}` : ''} — necesita el PIN del encargado.
        </p>

        {error && (
          <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
            {error}
          </p>
        )}

        <div>
          <label className="label">Motivo</label>
          <input
            className="field"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="El cliente no lo pidió"
            autoFocus
          />
        </div>
        <div>
          <label className="label text-center">PIN del encargado</label>
          <PinInput value={pin} onChange={setPin} />
        </div>

        <div className="flex gap-3">
          <button onClick={onCancel} className="btn-ghost flex-1">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={saving || !pin || !reason.trim()} className="btn-danger flex-1">
            {saving ? 'Verificando…' : 'Devolver'}
          </button>
        </div>
      </div>
    </div>
  )
}
