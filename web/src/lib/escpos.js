/**
 * Arma los bytes crudos ESC/POS de una tirilla. Separado de printer.js (que
 * solo sabe mandar bytes por el puerto): este archivo solo construye el
 * contenido, para poder ajustarlo sin tocar la conexion.
 */
import { anchoColumnas } from './printer'

const ESC = 0x1b
const GS = 0x1d

const CMD = {
  init: [ESC, 0x40],
  codepageCP850: [ESC, 0x74, 0x02],
  alinearIzquierda: [ESC, 0x61, 0x00],
  alinearCentro: [ESC, 0x61, 0x01],
  negritaOn: [ESC, 0x45, 0x01],
  negritaOff: [ESC, 0x45, 0x00],
  tamanoDoble: [GS, 0x21, 0x11],
  tamanoNormal: [GS, 0x21, 0x00],
  cortar: [GS, 0x56, 0x01],
}

// Tabla minima de acentos/ñ a CP850 (DOS Latino): lo unico que de verdad
// aparece en las tirillas en español. El resto de caracteres ASCII son
// identicos en CP850, asi que no necesitan mapeo.
const CP850 = {
  á: 0xa0, é: 0x82, í: 0xa1, ó: 0xa2, ú: 0xa3, ñ: 0xa4, Ñ: 0xa5,
  Á: 0xb5, É: 0x90, Í: 0xd6, Ó: 0xe0, Ú: 0xe9,
  ü: 0x81, Ü: 0x9a, '¿': 0xa8, '¡': 0xad,
}

function codificar(texto) {
  const bytes = []
  for (const ch of String(texto)) bytes.push(CP850[ch] ?? ch.charCodeAt(0))
  return bytes
}

function dosColumnas(izq, der, ancho) {
  izq = String(izq)
  der = String(der)
  if (izq.length + der.length > ancho) izq = izq.slice(0, Math.max(0, ancho - der.length - 1))
  return izq + ' '.repeat(Math.max(1, ancho - izq.length - der.length)) + der
}

/**
 * `lineas` es una lista declarativa de renglones (cada modal arma la suya,
 * ver ReciboModal/TicketEgresoModal/ReciboAbonoModal/TicketMermaModal, para
 * no repetir este archivo). Tipos:
 *  - { texto, centro?, negrita?, grande? }  renglon normal
 *  - { cols: [izq, der], negrita?, grande? } dos columnas (item/total)
 *  - { raya: true }                          separador del ancho del papel
 *  - { feed: n }                             n renglones en blanco
 */
export function construirTicket(lineas) {
  const ancho = anchoColumnas()
  const bytes = [...CMD.init, ...CMD.codepageCP850]

  const escribir = (texto) => bytes.push(...codificar(texto), 0x0a)

  for (const l of lineas) {
    if (l.raya) {
      escribir('-'.repeat(ancho))
      continue
    }
    if (l.feed) {
      for (let i = 0; i < l.feed; i++) bytes.push(0x0a)
      continue
    }
    bytes.push(...(l.centro ? CMD.alinearCentro : CMD.alinearIzquierda))
    if (l.negrita) bytes.push(...CMD.negritaOn)
    if (l.grande) bytes.push(...CMD.tamanoDoble)
    escribir(l.cols ? dosColumnas(l.cols[0], l.cols[1], ancho) : l.texto)
    if (l.grande) bytes.push(...CMD.tamanoNormal)
    if (l.negrita) bytes.push(...CMD.negritaOff)
  }

  bytes.push(...CMD.alinearIzquierda, 0x0a, 0x0a, 0x0a, ...CMD.cortar)
  return new Uint8Array(bytes)
}
