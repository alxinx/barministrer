/**
 * Input para valores en pesos: muestra separador de miles en tiempo real
 * (140000 -> 140.000) pero entrega solo los digitos por onChange, sin
 * formato, para que el resto del codigo lo siga tratando como numero.
 */
export default function MoneyInput({ value, onChange, className = '', placeholder = '0', autoFocus, id, disabled }) {
  const digits = String(value ?? '').replace(/\D/g, '')
  const display = digits ? Number(digits).toLocaleString('es-CO') : ''

  function handleChange(e) {
    onChange(e.target.value.replace(/\D/g, ''))
  }

  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      className={className}
      value={display}
      onChange={handleChange}
      placeholder={placeholder}
      autoFocus={autoFocus}
      disabled={disabled}
    />
  )
}
