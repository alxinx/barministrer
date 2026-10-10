import { useEffect, useState } from 'react'
import { api, money } from '../lib/api'
import { Icon } from './Icons'

/**
 * Cuentas ya cerradas de esta mesa. Reusa Order en vez de inventar un log de
 * estados aparte: lo que paso ya queda registrado ahi (quien abrio, quien
 * cerro, cuanto, a nombre de quien).
 */
export default function HistorialMesaModal({ tableId, tableNumber, onClose }) {
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api(`/orders/history/${tableId}`)
      .then(setOrders)
      .catch((err) => setError(err.message))
  }, [tableId])

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-lg p-5 space-y-3 max-h-[85vh] overflow-y-auto"
      >
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Historial de la mesa {tableNumber}</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-ink">
            <Icon.x />
          </button>
        </header>

        {error && (
          <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
            {error}
          </p>
        )}

        {orders === null && !error && <p className="text-sm text-muted">Cargando…</p>}

        {orders?.length === 0 && <p className="text-sm text-muted">Esta mesa todavía no tiene cuentas cerradas.</p>}

        {orders?.map((o) => (
          <div key={o.id} className="bg-raised border border-edge rounded-xl p-3.5 space-y-1">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-semibold">
                {new Date(o.closedAt).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
              <p className="font-bold shrink-0">{o.isCourtesy ? 'Cortesía' : money(o.total)}</p>
            </div>
            <p className="text-xs text-muted">
              Abrió {o.openedBy?.name} · Cerró {o.closedBy?.name}
              {o.customer && ` · A nombre de ${o.customer.firstName}`}
            </p>
            <p className="text-xs text-muted">{o.items.filter((i) => i.status === 'ACTIVE').length} producto(s)</p>
          </div>
        ))}
      </div>
    </div>
  )
}
