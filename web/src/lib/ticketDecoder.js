/**
 * El reverso de ticketRaster.js (y del modo texto de escpos.js): toma los
 * bytes ESC/POS que normalmente van al puerto serial y los convierte de
 * vuelta en algo que se puede mostrar en pantalla. Solo se usa cuando el
 * modo simulador esta activo (ver modoSimulador en printer.js) -- para
 * probar el camino completo de impresion (incluido el tramado del logo) sin
 * tener una impresora termica conectada.
 */
const ESC = 0x1b
const GS = 0x1d

// Mismo mapa que CP850 en escpos.js, al reves: solo hace falta para decodificar
// la tirilla de prueba de DatosBar, la unica que todavia sale en modo texto
// (las 5 tirillas reales -- venta, abono, egreso, merma, turno -- van en
// modo imagen por ticketRaster.js).
const CP850_INVERSO = {
  0xa0: 'á', 0x82: 'é', 0xa1: 'í', 0xa2: 'ó', 0xa3: 'ú', 0xa4: 'ñ', 0xa5: 'Ñ',
  0xb5: 'Á', 0x90: 'É', 0xd6: 'Í', 0xe0: 'Ó', 0xe9: 'Ú',
  0x81: 'ü', 0x9a: 'Ü', 0xa8: '¿', 0xad: '¡',
}

function decodificarBandaRaster(bytes, inicio) {
  let i = inicio
  const anchoBytes = bytes[i] | (bytes[i + 1] << 8)
  const filas = bytes[i + 2] | (bytes[i + 3] << 8)
  i += 4
  const datos = bytes.slice(i, i + anchoBytes * filas)
  return { ancho: anchoBytes * 8, anchoBytes, filas, datos, siguiente: i + datos.length }
}

function dibujarBandas(bandas) {
  const ancho = bandas[0].ancho
  const altoTotal = bandas.reduce((s, b) => s + b.filas, 0)
  const canvas = document.createElement('canvas')
  canvas.width = ancho
  canvas.height = altoTotal
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(ancho, altoTotal)

  let filaDestino = 0
  for (const banda of bandas) {
    for (let y = 0; y < banda.filas; y++) {
      for (let x = 0; x < ancho; x++) {
        const negro = (banda.datos[y * banda.anchoBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0
        const idx = ((filaDestino + y) * ancho + x) * 4
        const v = negro ? 0 : 255
        img.data[idx] = v
        img.data[idx + 1] = v
        img.data[idx + 2] = v
        img.data[idx + 3] = 255
      }
    }
    filaDestino += banda.filas
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

function decodificarTexto(bytes) {
  const lineas = []
  let actual = ''
  for (let j = 0; j < bytes.length; j++) {
    const b = bytes[j]
    // Todos los comandos que arma escpos.js son ESC @ (2 bytes) o de 3 bytes
    // (ESC/GS + 2 parametros, ver CMD en ese archivo) -- nunca mas largos.
    if (b === ESC && bytes[j + 1] === 0x40) {
      j += 1
      continue
    }
    if (b === ESC || b === GS) {
      j += 2
      continue
    }
    if (b === 0x0a) {
      lineas.push(actual)
      actual = ''
      continue
    }
    actual += CP850_INVERSO[b] ?? String.fromCharCode(b)
  }
  if (actual.trim()) lineas.push(actual)
  return lineas.filter((l) => l.trim())
}

/**
 * @param {Uint8Array} bytes
 * @returns {{tipo: 'cajon'} | {tipo: 'imagen', dataUrl: string} | {tipo: 'texto', lineas: string[]}}
 */
export function decodificarTicket(bytes) {
  // Pulso del cajon de dinero (ver abrirCajon en printer.js): 5 bytes fijos,
  // nada que dibujar.
  if (bytes.length === 5 && bytes[0] === ESC && bytes[1] === 0x70) {
    return { tipo: 'cajon' }
  }

  // Tirillas largas se mandan en varias franjas GS v 0 (ver PASO_FILAS en
  // ticketRaster.js), nunca una sola: hay que buscarlas todas y apilarlas.
  const bandas = []
  let i = 0
  while (i < bytes.length - 3) {
    if (bytes[i] === GS && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30 && bytes[i + 3] === 0x00) {
      const banda = decodificarBandaRaster(bytes, i + 4)
      bandas.push(banda)
      i = banda.siguiente
    } else {
      i++
    }
  }

  if (bandas.length > 0) return { tipo: 'imagen', dataUrl: dibujarBandas(bandas) }
  return { tipo: 'texto', lineas: decodificarTexto(bytes) }
}
