import { money } from '../lib/api'
import { METHOD_LABEL } from '../lib/paymentMethods'

// Resultado del conteo ciego por medio de pago: esperado vs. contado. Igual
// justo despues de cerrar el turno y al revisar un turno pasado.
export default function CuadreResumen({ counts }) {
  return (
    <div className="space-y-2">
      {counts.map((c) => (
        <div
          key={c.method}
          className="flex items-center justify-between bg-raised border border-edge rounded-xl px-3 py-2.5"
        >
          <span className="text-sm font-medium">{METHOD_LABEL[c.method] || c.method}</span>
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
  )
}

function diffColor(diff) {
  if (diff === 0) return 'text-libre'
  return diff > 0 ? 'text-reservada' : 'text-ocupada'
}
