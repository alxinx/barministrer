// "Mantener el código para las siguientes 20 transacciones" (cerrar cuenta):
// en vez de pedir el PIN del encargado en cada cobro normal, se recuerda en
// este dispositivo (sessionStorage, se pierde al cerrar la pestaña) y se
// reenvia solo las siguientes 20 veces -- el servidor lo sigue verificando
// contra bcrypt en CADA cierre (ver POST /orders/:id/close), nunca se confia
// en el cliente; esto solo evita volver a TECLEARLO, no el chequeo real.
//
// Nunca cruza operadores: queda atado al userId de la sesion que lo activo.
// Se olvida si: cambia la cuenta logueada, se agotan las 20, alguien toca
// "Cambiar", cierra sesion (ver AuthContext.logout), cierran y vuelven a
// abrir caja (ver Caja.jsx cerrarTurno -- un turno nuevo nunca hereda el
// codigo del anterior), o pasan mas de 12h desde la ultima venta que lo uso
// (turno/dia totalmente distinto, mejor volver a pedirlo). Descuento, fiado
// fuera de cupo y cortesia NUNCA usan esto (ver CerrarCuentaModal): son lo
// bastante sensibles como para pedir el PIN de verdad cada vez, sin importar
// el contador.
const CLAVE = 'licorplus:codigo-recordado'
export const MAX_TRANSACCIONES_RECORDADAS = 20
const MAX_HORAS_INACTIVIDAD = 12

function leer() {
  try {
    const raw = sessionStorage.getItem(CLAVE)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function escribir(valor) {
  try {
    if (valor) sessionStorage.setItem(CLAVE, JSON.stringify(valor))
    else sessionStorage.removeItem(CLAVE)
  } catch {
    // sessionStorage bloqueado (modo privado, etc.): simplemente no se
    // recuerda nada y siempre se vuelve a pedir el PIN. Nunca debe tumbar el
    // cierre de cuenta por esto.
  }
}

export function obtenerCodigoRecordado(userId) {
  const v = leer()
  if (!v || v.userId !== userId || v.remaining <= 0) return null
  if (Date.now() - v.ultimaVenta > MAX_HORAS_INACTIVIDAD * 60 * 60 * 1000) {
    escribir(null)
    return null
  }
  return v
}

export function activarCodigoRecordado(userId, pin, nombre) {
  escribir({ userId, pin, nombre, remaining: MAX_TRANSACCIONES_RECORDADAS, ultimaVenta: Date.now() })
}

export function consumirCodigoRecordado(userId) {
  const v = leer()
  if (!v || v.userId !== userId) return
  const remaining = v.remaining - 1
  // Cada venta que lo usa corre el reloj de las 12h -- no es un cronometro
  // fijo desde que se activo, es "cuanto lleva quieto el negocio".
  escribir(remaining > 0 ? { ...v, remaining, ultimaVenta: Date.now() } : null)
}

export function olvidarCodigoRecordado() {
  escribir(null)
}
