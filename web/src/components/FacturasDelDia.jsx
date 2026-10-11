import { money } from '../lib/api'
import { Icon } from './Icons'

// Lista de cuentas cerradas con su mesa. Se reusa en el turno activo ("ver
// factura" en vivo) y en el detalle de un turno pasado (consumo por mesa).
export default function FacturasDelDia({ facturas, onVer, titulo = 'Facturas de hoy' }) {
  return (
    <section className="card p-5">
      <h2 className="font-semibold mb-1">{titulo}</h2>
      <div>
        {facturas.map((f) => (
          <div key={f.id} className="flex items-center gap-3 py-2.5 border-b border-edge/60 last:border-0">
            <span className="w-10 h-10 rounded-xl bg-raised border border-edge grid place-items-center text-sm font-bold shrink-0">
              {f.tableNumber}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium flex items-center gap-2">
                {f.invoiceNumber && (
                  <span className="text-muted font-mono text-xs">{formatFactura(f.invoiceNumber)}</span>
                )}
                Mesa {f.tableNumber}
                {f.isCourtesy && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber border border-amber/40 bg-amber/10 rounded-pill px-2 py-0.5 shrink-0">
                    <Icon.gift width={11} height={11} />
                    Cortesía
                  </span>
                )}
              </p>
              <p className="text-xs text-muted">
                Abrió {f.openedByName} · {formatHora(f.closedAt)}
              </p>
            </div>
            <span className="font-semibold shrink-0">{money(f.total)}</span>
            <button
              type="button"
              onClick={() => onVer(f.id)}
              aria-label={`Ver factura de la mesa ${f.tableNumber}`}
              className="w-9 h-9 rounded-lg bg-raised border border-edge grid place-items-center text-muted hover:text-amber hover:border-amber/40 transition-colors shrink-0"
            >
              <Icon.receipt width={17} height={17} />
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

function formatHora(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-CO', { timeStyle: 'short' })
}

function formatFactura(n) {
  return `#${String(n).padStart(4, '0')}`
}
