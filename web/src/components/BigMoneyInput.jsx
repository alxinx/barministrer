/**
 * Version "protagonista" de MoneyInput: para el unico campo de un modal (ej.
 * base inicial al abrir caja), donde ese monto es lo primero que hay que ver,
 * igual que el numero de mesa es el heroe del plano. Mismo contrato que
 * MoneyInput (value/onChange entregan solo digitos), pero grande, centrado y
 * con el "$" pegado al numero en vez de spans sueltos a los lados.
 */
export default function BigMoneyInput({ value, onChange, autoFocus, id }) {
  const digits = String(value ?? '').replace(/\D/g, '')
  const display = digits ? Number(digits).toLocaleString('es-CO') : ''

  function handleChange(e) {
    onChange(e.target.value.replace(/\D/g, ''))
  }

  return (
    <div
      className="w-full h-24 rounded-2xl border-2 border-edge bg-raised flex items-center justify-center gap-1
                 focus-within:border-amber transition-colors"
    >
      <span className="text-4xl font-extrabold text-ink leading-none">$</span>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck="false"
        autoFocus={autoFocus}
        value={display}
        onChange={handleChange}
        placeholder="0"
        className="bg-transparent text-4xl font-extrabold text-ink leading-none text-center
                   border-0 outline-none ring-0 ring-offset-0 shadow-none appearance-none
                   focus:outline-none focus:ring-0 focus:ring-offset-0
                   focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0
                   placeholder:text-muted min-w-[1ch]"
        style={{ width: `${Math.max(display.length, 1)}ch` }}
      />
    </div>
  )
}
