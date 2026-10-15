import { money } from '../lib/api'
import { Icon } from './Icons'

/**
 * Detalle de una operacion fiada: a diferencia de la tirilla (ReciboModal, que
 * es para imprimir), esto es para auditar "quien atendio esta mesa y a que
 * hora se despacho cada producto" cuando el cliente reclama el cargo. Un item
 * puede tener un mesero distinto al que abrio la mesa (lo registro otra
 * persona en otra ronda), por eso el responsable va por item y no solo en el
 * encabezado.
 */
export default function ConsumoDetalleModal({ order, onClose }) {
  const items = order.items.filter((i) => i.status === 'ACTIVE')

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Mesa {order.table?.number}</h2>
            <p className="text-xs text-muted mt-0.5">
              Atendió {order.openedBy?.name} · {formatFechaHora(order.closedAt || order.openedAt)}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-muted hover:text-ink">
            <Icon.x width={18} height={18} />
          </button>
        </header>

        {items.length === 0 ? (
          <p className="text-sm text-muted">Esta cuenta no tiene productos activos.</p>
        ) : (
          <div className="space-y-2">
            {items.map((it) => (
              <div key={it.id} className="flex items-center gap-3 py-2 border-b border-edge/60 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {it.qty > 1 && <span className="text-muted">{it.qty}× </span>}
                    {it.name}
                    {it.variantName ? ` · ${it.variantName}` : ''}
                  </p>
                  <p className="text-xs text-muted">
                    {formatHora(it.orderedAt)} · despachado por {it.createdBy?.name || 'desconocido'}
                  </p>
                </div>
                <span className="text-sm font-semibold shrink-0">{money(Number(it.price) * it.qty)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-1 border-t border-edge">
          <span className="font-semibold">Total</span>
          <span className="text-lg font-bold text-amber">{money(order.total)}</span>
        </div>

        <button type="button" onClick={onClose} className="btn-ghost w-full">
          Cerrar
        </button>
      </div>
    </div>
  )
}

function formatHora(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
}

function formatFechaHora(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
}
