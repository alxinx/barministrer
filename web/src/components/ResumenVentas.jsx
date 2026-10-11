import { money } from '../lib/api'
import { Icon } from './Icons'
import { METHODS } from '../lib/paymentMethods'

// Mismo bloque de ventas en el turno activo ("Movimiento de hoy") y en el
// detalle de un turno cerrado ("Ventas del turno"). Solo cambia el segundo
// numero hero: efectivo esperado en caja vs. base inicial declarada.
export default function ResumenVentas({ titulo, sales, heroLabel, heroValue }) {
  return (
    <section className="card p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{titulo}</h2>
        <span className="text-sm text-muted">
          {sales.tickets} {sales.tickets === 1 ? 'cuenta cerrada' : 'cuentas cerradas'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <p className="text-xs text-muted mb-1">Total vendido</p>
          <p className="text-[28px] font-bold text-amber leading-none">{money(sales.totalVentas)}</p>
        </div>
        <div>
          <p className="text-xs text-muted mb-1">{heroLabel}</p>
          <p className="text-[28px] font-bold leading-none">{money(heroValue)}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2.5 pt-4 border-t border-edge">
        {METHODS.map((m) => {
          const MethodIcon = Icon[m.icon]
          return (
            <div
              key={m.key}
              className="flex items-center gap-2.5 bg-raised border border-edge rounded-xl pl-2.5 pr-3.5 py-2"
            >
              <span className="w-9 h-9 rounded-full bg-night border border-edge grid place-items-center text-muted shrink-0">
                <MethodIcon width={18} height={18} />
              </span>
              <div>
                <p className="text-[11px] text-muted leading-none">{m.label}</p>
                <p className="text-sm font-semibold leading-tight">{money(sales.byMethod[m.key] || 0)}</p>
              </div>
            </div>
          )
        })}

        <div className="flex items-center gap-2.5 bg-raised border border-edge rounded-xl pl-2.5 pr-3.5 py-2">
          <span className="w-9 h-9 rounded-full bg-night border border-edge grid place-items-center text-muted shrink-0">
            <Icon.clipboard width={18} height={18} />
          </span>
          <div>
            <p className="text-[11px] text-muted leading-none">Fiado</p>
            <p className="text-sm font-semibold leading-tight">{money(sales.fiado)}</p>
          </div>
        </div>

        {sales.abonos?.total > 0 && (
          <div className="flex items-center gap-2.5 bg-raised border border-edge rounded-xl pl-2.5 pr-3.5 py-2">
            <span className="w-9 h-9 rounded-full bg-night border border-edge grid place-items-center text-muted shrink-0">
              <Icon.receipt width={18} height={18} />
            </span>
            <div>
              <p className="text-[11px] text-muted leading-none">Abonos recibidos</p>
              <p className="text-sm font-semibold leading-tight">{money(sales.abonos.total)}</p>
            </div>
          </div>
        )}

        {sales.cortesias > 0 && (
          <div className="flex items-center gap-2.5 bg-amber/10 border border-amber/30 rounded-xl pl-2.5 pr-3.5 py-2">
            <span className="w-9 h-9 rounded-full bg-amber/15 border border-amber/40 grid place-items-center text-amber shrink-0">
              <Icon.gift width={18} height={18} />
            </span>
            <div>
              <p className="text-[11px] text-amber/80 leading-none">
                {sales.cortesias === 1 ? 'Cortesía' : 'Cortesías'}
              </p>
              <p className="text-sm font-semibold leading-tight">{sales.cortesias}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
