import { money } from '../lib/api'

/**
 * Barras simples de consumo mensual, sin libreria: son 6 numeros, no hace
 * falta cargar una dependencia de graficas para eso.
 */
export default function ConsumoChart({ data }) {
  const max = Math.max(1, ...data.map((d) => d.total))

  return (
    <div className="flex items-end gap-2.5 h-32">
      {data.map((d) => (
        <div key={d.key} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group">
          <span className="text-[11px] text-muted opacity-0 group-hover:opacity-100 transition-opacity">
            {money(d.total)}
          </span>
          <div
            className={`w-full rounded-md transition-colors ${d.total > 0 ? 'bg-amber/70 group-hover:bg-amber' : 'bg-raised border border-edge'}`}
            style={{ height: d.total > 0 ? `${Math.max(6, (d.total / max) * 96)}px` : '4px' }}
          />
          <span className="text-[11px] text-muted">{d.label}</span>
        </div>
      ))}
    </div>
  )
}
