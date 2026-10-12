import { money } from '../lib/api'

const TONOS = {
  amber: 'bg-amber/10 border-amber/40 text-amber',
  ocupada: 'bg-ocupada/10 border-ocupada/40 text-ocupada',
  libre: 'bg-libre/10 border-libre/40 text-libre',
  default: 'bg-raised border-edge text-muted',
}

// Tarjeta de metrica compartida entre los reportes (ventas, utilidad de
// producto, etc.). El tono es semantico, no decorativo: amber para lo
// positivo que ya es acento de la app, ocupada para lo que preocupa
// (egresos), libre para un indicador de salud (margen), default para un dato
// neutro que solo informa.
export default function TarjetaStat({ icon: Ico, label, value, tono = 'default', formato = money }) {
  return (
    <div className="card p-4 flex items-center gap-3">
      <span className={`w-10 h-10 rounded-full grid place-items-center shrink-0 border ${TONOS[tono] || TONOS.default}`}>
        <Ico width={18} height={18} />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted leading-none mb-1">{label}</p>
        <p className="text-lg font-bold leading-none truncate">{formato(value)}</p>
      </div>
    </div>
  )
}
