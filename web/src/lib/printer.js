/**
 * Puente a la impresora termica por USB via Web Serial, sin el dialogo de
 * impresion del navegador: el navegador solo pregunta UNA vez, al emparejar
 * (gesto de usuario obligatorio de la propia API), y esa autorizacion queda
 * recordada por Chrome/Edge para las siguientes visitas — reconectar() la
 * retoma sola, sin volver a preguntar. Si no hay impresora emparejada o el
 * navegador no soporta esto (Safari/Firefox), quien llama cae de vuelta a
 * window.print() — nunca se rompe el flujo existente.
 */
const CLAVE_BAUD = 'licorplus:impresora:baudRate'
const CLAVE_ANCHO = 'licorplus:impresora:ancho'

let puerto = null

export function disponible() {
  return 'serial' in navigator
}

export function anchoColumnas() {
  return Number(localStorage.getItem(CLAVE_ANCHO)) || 32
}

export function setAnchoColumnas(n) {
  localStorage.setItem(CLAVE_ANCHO, String(n))
}

function baudRate() {
  return Number(localStorage.getItem(CLAVE_BAUD)) || 9600
}

export function setBaudRate(n) {
  localStorage.setItem(CLAVE_BAUD, String(n))
}

export function estaConectada() {
  return Boolean(puerto?.writable)
}

// Retoma el puerto ya autorizado antes en esta maquina/navegador, si hay
// uno. getPorts() solo devuelve los que el usuario ya acepto — nunca
// dispara el selector del sistema operativo.
export async function reconectar() {
  if (!disponible() || estaConectada()) return estaConectada()
  try {
    const autorizados = await navigator.serial.getPorts()
    if (autorizados.length === 0) return false
    puerto = autorizados[0]
    if (!puerto.readable) await puerto.open({ baudRate: baudRate() })
    return true
  } catch {
    puerto = null
    return false
  }
}

// Requiere un gesto del usuario (click de un boton): solo aqui el navegador
// muestra su selector de puerto, y solo la primera vez por dispositivo.
export async function emparejar() {
  if (!disponible()) throw new Error('Este navegador no soporta impresion directa (usa Chrome o Edge).')
  const seleccionado = await navigator.serial.requestPort()
  await seleccionado.open({ baudRate: baudRate() })
  puerto = seleccionado
  return true
}

export async function desconectar() {
  try {
    await puerto?.close()
  } catch {
    // ya estaba cerrado
  }
  puerto = null
}

export async function enviar(bytes) {
  if (!estaConectada()) return false
  const writer = puerto.writable.getWriter()
  try {
    await writer.write(bytes)
    return true
  } finally {
    writer.releaseLock()
  }
}

// Intenta reconectar con el puerto ya autorizado (por si la pagina acaba de
// cargar y el modulo todavia no sabe de el) y manda los bytes. Devuelve
// false si no hay impresora — asi quien llama sabe que debe caer a
// window.print().
export async function imprimirSilencioso(bytes) {
  const conectado = estaConectada() || (await reconectar())
  if (!conectado) return false
  return enviar(bytes)
}

// ESC p 0 25 250: pulso en el pin 2 del conector RJ11 del cajon, enganchado
// a la impresora. Codigo pedido por Alejo, estandar en la enorme mayoria de
// impresoras ESC/POS con cajon conectado.
export async function abrirCajon() {
  return imprimirSilencioso(new Uint8Array([0x1b, 0x70, 0x00, 0x19, 0xfa]))
}
