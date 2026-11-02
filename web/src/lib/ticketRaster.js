/**
 * Imprime la tirilla como IMAGEN (ESC/POS raster, comando GS v 0) en vez de
 * texto plano (ver escpos.js). Es la unica forma de sacar logo y una fuente
 * real (Arial/Helvetica) en una termica: el modo texto de toda impresora
 * ESC/POS usa la fuente de fabrica quemada en el firmware, no se le puede
 * mandar "Arial" como si fuera una PC. Se dibuja todo en un <canvas>, se
 * trama a blanco y negro, y se manda como bits empacados.
 *
 * Reusa la misma lista declarativa de renglones que ya arma cada tirilla
 * para el modo texto (`lineasTicket()` en ReciboModal/ReciboAbonoModal/
 * TicketEgresoModal/TicketMermaModal) -- un solo lugar que sabe que es cada
 * tipo de renglon ({texto}/{cols}/{raya}/{feed}), nada mas cambia como se
 * dibuja. El primer renglon (nombre del negocio) se salta a proposito: el
 * encabezado con el logo ya lo muestra, mostrarlo dos veces se veria raro.
 */
import { anchoColumnas } from './printer'
import { PIE_PAGINA_SISTEMA } from './brand'

const FUENTE = 'Arial, Helvetica, sans-serif'
const MARGEN = 16

// 203dpi es el estandar de las termicas ESC/POS baratas: 58mm de papel
// imprimible ronda 384px, 80mm ronda 576px. anchoColumnas() (32/48, ver
// DatosBar > Impresora) ya distingue esos dos tamanos de papel, asi que se
// reusa en vez de pedir un ajuste de pixeles aparte.
function anchoPixeles() {
  return anchoColumnas() >= 48 ? 576 : 384
}

// Via fetch() + blob, no Image().src + crossOrigin directo: si el logo ya se
// habia cargado antes en la misma pestaña como <img> normal (ej. la vista
// previa de DatosBar, que no pide CORS), Chrome a veces reusa esa entrada de
// cache para la carga "anonymous" de abajo y la tira por onerror aunque el
// bucket tenga CORS bien puesto -- un logo que cargo perfecto en la vista
// previa fallaba aqui. cache: 'no-store' evita por completo ese problema
// (fuerza una peticion de red nueva), y el blob: URL resultante nunca
// "contamina" el canvas sin importar los headers del origen real.
async function cargarImagen(url) {
  if (!url) return null
  try {
    const res = await fetch(url, { mode: 'cors', cache: 'no-store' })
    if (!res.ok) return null
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    try {
      return await new Promise((resolve) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => resolve(null)
        img.src = objectUrl
      })
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  } catch {
    return null // sin logo nunca bloquea la tirilla
  }
}

function envolver(medidor, texto, fontPx, negrita, anchoUtil) {
  medidor.font = `${negrita ? 'bold ' : ''}${fontPx}px ${FUENTE}`
  const palabras = String(texto).split(' ')
  const filas = []
  let actual = ''
  for (const palabra of palabras) {
    const prueba = actual ? `${actual} ${palabra}` : palabra
    if (medidor.measureText(prueba).width > anchoUtil && actual) {
      filas.push(actual)
      actual = palabra
    } else {
      actual = prueba
    }
  }
  if (actual) filas.push(actual)
  return filas.length ? filas : ['']
}

// Arma la lista de trazos (texto/raya/logo) con su posicion Y ya resuelta.
// Dos pasadas: esta mide todo primero (no se sabe el alto total del ticket
// hasta saber cuantas filas ocupa cada renglon envuelto al ancho del papel),
// la segunda (dibujarCanvas) solo pinta.
async function armarTrazos(tenant, lineas, ancho) {
  const anchoUtil = ancho - MARGEN * 2
  const medidor = document.createElement('canvas').getContext('2d')
  const trazos = []
  let y = 14

  const logo = await cargarImagen(tenant?.logoUrl)
  if (logo) {
    // Mas grande que el limite de 70px de DatosBar (pensado para la vista en
    // pantalla, no para el tramado): con pocos pixeles el punteado de
    // Floyd-Steinberg se ve mas grueso de lo necesario. Mas resolucion de
    // entrada no mejora nada (el logo ya viene limitado a 200x70 al subirlo),
    // pero imprimirlo mas grande SI reparte el mismo punteado en mas area,
    // suavizandolo.
    const altoDestino = Math.min(110, (logo.height / logo.width) * Math.min(280, anchoUtil))
    const anchoDestino = altoDestino * (logo.width / logo.height)
    trazos.push({ tipo: 'logo', img: logo, x: (ancho - anchoDestino) / 2, y, w: anchoDestino, h: altoDestino })
    y += altoDestino + 8
  }

  const nombre = tenant?.legalName || tenant?.name || 'Barminister'
  for (const fila of envolver(medidor, nombre, 18, true, anchoUtil)) {
    trazos.push({ tipo: 'texto', texto: fila, y, fontPx: 18, negrita: true, centro: true })
    y += 23
  }
  if (tenant?.address) {
    for (const fila of envolver(medidor, tenant.address, 13, false, anchoUtil)) {
      trazos.push({ tipo: 'texto', texto: fila, y, fontPx: 13, centro: true })
      y += 17
    }
  }
  const datosFiscales = [tenant?.taxId && `NIT ${tenant.taxId}`, tenant?.taxRegime].filter(Boolean).join(' · ')
  if (datosFiscales) {
    trazos.push({ tipo: 'texto', texto: datosFiscales, y, fontPx: 13, centro: true })
    y += 17
  }
  y += 5
  trazos.push({ tipo: 'raya', y })
  y += 16

  for (const l of lineas.slice(1)) {
    if (l.raya) {
      y += 3
      trazos.push({ tipo: 'raya', y })
      y += 13
      continue
    }
    if (l.feed) {
      y += l.feed * 16
      continue
    }
    const fontPx = l.grande ? 20 : 14
    if (l.cols) {
      trazos.push({ tipo: 'cols', izq: String(l.cols[0]), der: String(l.cols[1]), y, fontPx, negrita: l.negrita })
      y += fontPx + 9
    } else {
      for (const fila of envolver(medidor, l.texto, fontPx, l.negrita, anchoUtil)) {
        trazos.push({ tipo: 'texto', texto: fila, y, fontPx, negrita: l.negrita, centro: l.centro })
        y += fontPx + 9
      }
    }
  }

  y += 6
  trazos.push({ tipo: 'raya', y })
  y += 16
  // Pie propio del negocio (opcional) + la linea de marca, que sale SIEMPRE
  // sin importar que el tenant haya escrito algo o no (ver brand.js: fija en
  // el codigo, no editable desde ningun tenant).
  const pies = [tenant?.receiptFooter, PIE_PAGINA_SISTEMA].filter(Boolean)
  for (const pie of pies) {
    for (const fila of envolver(medidor, pie, 11, false, anchoUtil)) {
      trazos.push({ tipo: 'texto', texto: fila, y, fontPx: 11, centro: true, atenuado: true })
      y += 15
    }
  }
  y += 12

  return { trazos, alto: Math.ceil(y) }
}

async function dibujarCanvas(tenant, lineas) {
  const ancho = anchoPixeles()
  const { trazos, alto } = await armarTrazos(tenant, lineas, ancho)

  const canvas = document.createElement('canvas')
  canvas.width = ancho
  canvas.height = alto
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, ancho, alto)
  ctx.fillStyle = '#000'
  ctx.textBaseline = 'top'

  for (const t of trazos) {
    if (t.tipo === 'logo') {
      ctx.drawImage(t.img, t.x, t.y, t.w, t.h)
    } else if (t.tipo === 'raya') {
      ctx.strokeStyle = '#000'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(MARGEN, t.y)
      ctx.lineTo(ancho - MARGEN, t.y)
      ctx.stroke()
    } else if (t.tipo === 'cols') {
      ctx.font = `${t.negrita ? 'bold ' : ''}${t.fontPx}px ${FUENTE}`
      ctx.textAlign = 'left'
      ctx.fillText(t.izq, MARGEN, t.y)
      ctx.textAlign = 'right'
      ctx.fillText(t.der, ancho - MARGEN, t.y)
    } else {
      ctx.font = `${t.negrita ? 'bold ' : ''}${t.fontPx}px ${FUENTE}`
      ctx.globalAlpha = t.atenuado ? 0.65 : 1
      ctx.textAlign = t.centro ? 'center' : 'left'
      ctx.fillText(t.texto, t.centro ? ancho / 2 : MARGEN, t.y)
      ctx.globalAlpha = 1
    }
  }

  return canvas
}

// Floyd-Steinberg: el logo (y el antialiasing del texto) se ven mucho mejor
// difuminados a 1 bit que con un umbral simple, que deja todo en bloques
// duros sin medios tonos.
function tramar(ctx, ancho, alto) {
  const img = ctx.getImageData(0, 0, ancho, alto)
  const gris = new Float32Array(ancho * alto)
  for (let i = 0; i < ancho * alto; i++) {
    gris[i] = 0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2]
  }
  const negro = new Uint8Array(ancho * alto)
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const i = y * ancho + x
      const viejo = gris[i]
      const nuevo = viejo < 128 ? 0 : 255
      negro[i] = nuevo === 0 ? 1 : 0
      const error = viejo - nuevo
      if (x + 1 < ancho) gris[i + 1] += (error * 7) / 16
      if (y + 1 < alto) {
        if (x > 0) gris[i - 1 + ancho] += (error * 3) / 16
        gris[i + ancho] += (error * 5) / 16
        if (x + 1 < ancho) gris[i + 1 + ancho] += (error * 1) / 16
      }
    }
  }
  return negro
}

const GS = 0x1d
// Franjas de a lo sumo PASO filas por comando GS v 0: tickets largos (cierre
// de turno con muchos egresos, por ejemplo) no caben en el buffer de una
// termica barata si se mandan como una sola imagen gigante.
const PASO_FILAS = 200

function construirRaster(bits, ancho, alto) {
  const anchoBytes = Math.ceil(ancho / 8)
  const bytes = []
  for (let desde = 0; desde < alto; desde += PASO_FILAS) {
    const filas = Math.min(PASO_FILAS, alto - desde)
    const datos = new Uint8Array(anchoBytes * filas)
    for (let y = 0; y < filas; y++) {
      for (let x = 0; x < ancho; x++) {
        if (bits[(desde + y) * ancho + x]) datos[y * anchoBytes + (x >> 3)] |= 0x80 >> (x & 7)
      }
    }
    bytes.push(
      GS, 0x76, 0x30, 0x00,
      anchoBytes & 0xff, (anchoBytes >> 8) & 0xff,
      filas & 0xff, (filas >> 8) & 0xff,
      ...datos
    )
  }
  return bytes
}

/**
 * Punto de entrada: tenant (logoUrl/legalName/name/address/taxId/taxRegime/
 * receiptFooter) + la misma lista declarativa de `lineasTicket()` que ya usa
 * el modo texto -> bytes listos para `imprimirSilencioso()`.
 */
export async function construirTicketRaster(tenant, lineas) {
  let canvas
  try {
    canvas = await dibujarCanvas(tenant, lineas)
    var bits = tramar(canvas.getContext('2d'), canvas.width, canvas.height)
  } catch {
    // Canvas "contaminado": el logo vino de un origen sin CORS habilitado en
    // R2 (hace falta una regla de CORS en el bucket para esto). Se reintenta
    // sin logo en vez de perder toda la tirilla por eso -- igual que ningun
    // otro dato (stock, botellas abiertas), un logo que falla no bloquea.
    canvas = await dibujarCanvas({ ...tenant, logoUrl: null }, lineas)
    bits = tramar(canvas.getContext('2d'), canvas.width, canvas.height)
  }

  return new Uint8Array([
    0x1b, 0x40, // init
    ...construirRaster(bits, canvas.width, canvas.height),
    0x0a, 0x0a, 0x0a,
    GS, 0x56, 0x01, // cortar
  ])
}
