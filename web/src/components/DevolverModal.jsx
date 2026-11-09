import { useState } from 'react'
import { api } from '../lib/api'
import PinField from './PinField'
import { usePinVerificado } from '../hooks/usePinVerificado'

const GRACIA_MS = 60_000

/**
 * Devolver un producto ya pedido. Dentro del minuto de gracia (desde que el
 * item llego a la cuenta -- orderedAt) es corregir un toque reciente, no
 * devolver algo que ya se sirvio: sin motivo, sin PIN, cualquier rol. Pasado
 * ese minuto hace falta justificar: el admin nunca necesita PIN (ya tiene
 * autoridad plena), cajero y mesero si, con su PROPIO PIN -- no el de un
 * encargado -- para que quede registrado quien lo autorizo sin depender de
 * que haya un admin presente. El servidor vuelve a validar todo esto por su
 * cuenta (ver POST /orders/:id/items/:itemId/void); esto solo decide que
 * pedirle al operador.
 */
export default function DevolverModal({ item, role, onCancel, onDevuelto }) {
  const dentroDeGracia = Date.now() - new Date(item.orderedAt).getTime() < GRACIA_MS
  const necesitaPin = !dentroDeGracia && role !== 'ADMIN'
  const necesitaMotivo = !dentroDeGracia

  const {
    pin,
    setPin,
    valido: pinValido,
    verificando: verificandoPin,
    error: pinError,
    bloqueado: pinBloqueado,
    segundosRestantes: pinSegundosRestantes,
  } = usePinVerificado()
  const [reason, setReason] = useState('')
  // Arranca en 1, no en el total de la linea: si el operador no toca el
  // contador, lo logico es que devuelva una unidad a corregir, no que se
  // lleve de arrastre toda la ronda sin querer -- eso dejaria la linea sin
  // nada activo para seguir corrigiendo despues.
  const [qty, setQty] = useState(1)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const completo = (!necesitaMotivo || reason.trim()) && (!necesitaPin || pinValido)

  async function confirmar() {
    if (!completo) return
    setSaving(true)
    setError('')
    try {
      const body = { qty }
      if (necesitaMotivo) body.reason = reason.trim()
      if (necesitaPin) body.pin = pin
      const updated = await api(`/orders/${item.orderId}/items/${item.id}/void`, { method: 'PATCH', body })
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
          {item.variantName ? ` · ${item.variantName}` : ''}
          {dentroDeGracia
            ? ' — todavía estás a tiempo de corregirlo sin justificar.'
            : necesitaPin
              ? ' — necesita tu PIN y el motivo.'
              : ' — necesita el motivo.'}
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

        {necesitaMotivo && (
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
        )}
        {necesitaPin && (
          <PinField
            pin={pin}
            onChange={setPin}
            verificando={verificandoPin}
            error={pinError}
            bloqueado={pinBloqueado}
            segundosRestantes={pinSegundosRestantes}
            label="Tu PIN"
          />
        )}

        <div className="flex gap-3">
          <button onClick={onCancel} className="btn-ghost flex-1">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={saving || !completo} className="btn-danger flex-1">
            {saving ? 'Devolviendo…' : item.qty > 1 ? `Devolver ${qty}` : 'Devolver'}
          </button>
        </div>
      </div>
    </div>
  )
}
