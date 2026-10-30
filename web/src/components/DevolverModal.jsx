import { useState } from 'react'
import { api } from '../lib/api'
import PinInput from './PinInput'

/**
 * Devolver un producto ya pedido: necesita motivo y el PIN de un encargado.
 * Si la linea tiene mas de una unidad, tambien se puede elegir cuantas
 * devolver -- "se pidieron 3, llegaron 4" se corrige devolviendo 1, sin
 * tener que anular las 4 y volver a mandar 3.
 */
export default function DevolverModal({ item, onCancel, onDevuelto }) {
  const [pin, setPin] = useState('')
  const [reason, setReason] = useState('')
  // Arranca en 1, no en el total de la linea: si el operador no toca el
  // contador, lo logico es que devuelva una unidad a corregir, no que se
  // lleve de arrastre toda la ronda sin querer -- eso dejaria la linea sin
  // nada activo para seguir corrigiendo despues.
  const [qty, setQty] = useState(1)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function confirmar() {
    if (!pin || !reason.trim()) return
    setSaving(true)
    setError('')
    try {
      const updated = await api(`/orders/${item.orderId}/items/${item.id}/void`, {
        method: 'PATCH',
        body: { pin, reason: reason.trim(), qty },
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

        {item.qty > 1 && (
          <div>
            <label className="label">Cantidad a devolver</label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="w-10 h-10 rounded-lg bg-raised border border-edge text-muted hover:text-ink"
                aria-label="Devolver una unidad menos"
              >
                −
              </button>
              <span className="w-10 text-center text-lg font-semibold">{qty}</span>
              <button
                type="button"
                onClick={() => setQty((q) => Math.min(item.qty, q + 1))}
                className="w-10 h-10 rounded-lg bg-raised border border-edge text-muted hover:text-ink"
                aria-label="Devolver una unidad mas"
              >
                +
              </button>
              <span className="text-xs text-muted">de {item.qty} pedidas</span>
            </div>
          </div>
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
            {saving ? 'Verificando…' : item.qty > 1 ? `Devolver ${qty}` : 'Devolver'}
          </button>
        </div>
      </div>
    </div>
  )
}
