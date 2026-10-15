import { useRef } from 'react'

// Un solo lugar que dice cuantos digitos tiene el PIN: tanto este input como
// quien valide su formato (UsuarioForm) parten de esta constante en vez de
// repetir el numero cada uno por su lado.
export const PIN_LENGTH = 5
const LARGO = PIN_LENGTH

/**
 * PIN del encargado como casillas individuales (una por digito) en vez de un
 * solo campo de texto: en la barra, de noche, con el celular sucio, es mas
 * facil de teclear y de verificar de un vistazo que se escribio bien. Avanza
 * sola a la siguiente casilla al tipear y retrocede con Backspace sobre una
 * vacia, como cualquier verificacion de codigo.
 */
export default function PinInput({ value, onChange, autoFocus }) {
  const cajasRef = useRef([])

  function cambiar(i, raw) {
    const digito = raw.replace(/\D/g, '').slice(-1)
    const chars = value.split('')
    chars[i] = digito
    onChange(chars.join('').slice(0, LARGO))
    if (digito && i < LARGO - 1) cajasRef.current[i + 1]?.focus()
  }

  function alPresionar(i, e) {
    if (e.key === 'Backspace' && !value[i] && i > 0) cajasRef.current[i - 1]?.focus()
  }

  function pegar(e) {
    const digitos = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, LARGO)
    if (!digitos) return
    e.preventDefault()
    onChange(digitos)
    cajasRef.current[Math.min(digitos.length, LARGO - 1)]?.focus()
  }

  return (
    <div className="flex items-center justify-center gap-2.5" onPaste={pegar}>
      {Array.from({ length: LARGO }, (_, i) => (
        <input
          key={i}
          ref={(el) => (cajasRef.current[i] = el)}
          type="password"
          inputMode="numeric"
          maxLength={1}
          autoFocus={autoFocus && i === 0}
          value={value[i] || ''}
          onChange={(e) => cambiar(i, e.target.value)}
          onKeyDown={(e) => alPresionar(i, e)}
          className="w-11 h-12 text-center text-lg font-bold rounded-xl bg-raised border border-edge
                     text-ink focus:border-amber"
        />
      ))}
    </div>
  )
}
