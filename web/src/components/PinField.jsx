import PinInput from './PinInput'

function formatTiempo(segundos) {
  const m = Math.floor(segundos / 60)
  const s = String(segundos % 60).padStart(2, '0')
  return `${m}:${s}`
}

// Casillas de PIN + el estado de su verificacion en vivo (usePinVerificado):
// el error de "PIN incorrecto" aparece pegado al mismo campo, no en un
// cartel aparte en otra parte del modal. Si se agotaron los intentos, las
// casillas desaparecen del todo -- no tiene caso dejarlas si no se puede
// escribir nada -- y se reemplazan por una caja con la cuenta regresiva real
// hasta que se levante el bloqueo.
export default function PinField({
  pin,
  onChange,
  verificando,
  error,
  label = 'PIN del encargado',
  autoFocus,
  bloqueado,
  segundosRestantes,
}) {
  if (bloqueado) {
    return (
      <div className="rounded-xl border border-ocupada/40 bg-ocupada/10 px-4 py-3.5 text-center space-y-1.5">
        <p className="text-lg font-bold tabular-nums text-ocupada">{formatTiempo(segundosRestantes)}</p>
        <p className="text-sm font-semibold text-ocupada">
          Esta función está bloqueada por intentos de PIN incorrectos
        </p>
        <p className="text-xs text-ocupada/80">
          Si necesitas desbloquearla antes, comunícate con servicio al cliente.
        </p>
      </div>
    )
  }

  return (
    <div>
      <label className="label text-center">{label}</label>
      <PinInput value={pin} onChange={onChange} autoFocus={autoFocus} />
      {verificando && <p className="text-xs text-muted text-center mt-1.5">Verificando…</p>}
      {error && <p className="text-xs font-semibold text-ocupada text-center mt-1.5">{error}</p>}
    </div>
  )
}
