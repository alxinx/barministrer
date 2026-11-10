import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { PIN_LENGTH } from '../components/PinInput'

// Verifica el PIN de forma asincronica en cuanto se completan los 5 digitos,
// contra /auth/verify-pin (mismo chequeo y misma cuota de intentos que la
// accion real que lo necesita -- ver api/src/routes/auth.js). El boton de la
// accion debe quedar deshabilitado mientras `valido` no sea true: nunca se
// manda la accion con un PIN que el backend ya rechazo o que todavia no
// termino de verificar.
export function usePinVerificado({ soloUsuarioActual = false } = {}) {
  const [pin, setPin] = useState('')
  const [verificando, setVerificando] = useState(false)
  const [valido, setValido] = useState(false)
  const [nombre, setNombre] = useState('') // nombre del encargado que el PIN identifico, para mostrarlo (ver "codigo recordado")
  const [error, setError] = useState('')
  // Momento (epoch ms) en el que se levanta el bloqueo por intentos
  // agotados. Vive aparte de `error` porque mientras este activo la UI
  // cambia por completo (ver PinField): no tiene caso seguir mostrando las
  // casillas si no se puede escribir nada hasta que pase el tiempo.
  const [bloqueadoHasta, setBloqueadoHasta] = useState(null)
  const [segundosRestantes, setSegundosRestantes] = useState(0)

  // Cuenta regresiva en vivo mientras haya un bloqueo activo: se recalcula
  // contra el reloj real (no solo resta 1 cada segundo) para no desfasarse
  // si la pestana queda en segundo plano un rato.
  useEffect(() => {
    if (!bloqueadoHasta) return setSegundosRestantes(0)
    function tick() {
      const restante = Math.max(0, Math.ceil((bloqueadoHasta - Date.now()) / 1000))
      setSegundosRestantes(restante)
      if (restante === 0) setBloqueadoHasta(null)
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [bloqueadoHasta])

  useEffect(() => {
    setValido(false)
    setNombre('')
    setError('')
    if (pin.length !== PIN_LENGTH || bloqueadoHasta) return

    let cancelado = false
    setVerificando(true)
    // Pequeno debounce: si la persona borra y vuelve a escribir rapido (ej.
    // se equivoco en el ultimo digito), no dispara una verificacion por cada
    // intento intermedio.
    const timer = setTimeout(async () => {
      try {
        const res = await api('/auth/verify-pin', {
          method: 'POST',
          body: { pin, soloUsuarioActual },
        })
        if (!cancelado) {
          setValido(true)
          setNombre(res.name || '')
        }
      } catch (err) {
        if (cancelado) return
        if (err.status === 429 && typeof err.segundosRestantes === 'number') {
          setBloqueadoHasta(Date.now() + err.segundosRestantes * 1000)
        } else {
          setError(err.message)
        }
      } finally {
        if (!cancelado) setVerificando(false)
      }
    }, 250)

    return () => {
      cancelado = true
      clearTimeout(timer)
    }
  }, [pin, bloqueadoHasta, soloUsuarioActual])

  function reset() {
    setPin('')
    setValido(false)
    setNombre('')
    setError('')
    setBloqueadoHasta(null)
  }

  return {
    pin,
    setPin,
    valido,
    nombre,
    verificando,
    error,
    bloqueado: Boolean(bloqueadoHasta),
    segundosRestantes,
    reset,
  }
}
