// Redimensiona en el navegador antes de subir: la imagen nunca sale grande
// del dispositivo de quien la sube. Ajusta dentro de una caja maxWidth x
// maxHeight sin recortar ni estirar (la proporcion manda), nunca agranda una
// imagen mas chica que la caja.
function resizeImage(file, { maxWidth, maxHeight, format = 'image/jpeg', quality = 0.9, maxBytes = 200_000 }) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)

      let q = quality
      let dataUrl = canvas.toDataURL(format, q)
      while (dataUrl.length * 0.75 > maxBytes && q > 0.3) {
        q -= 0.1
        dataUrl = canvas.toDataURL(format, q)
      }
      resolve(dataUrl)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('No se pudo leer la imagen'))
    }
    img.src = url
  })
}

// Logo del bar: 200x70 maximo, siempre webp. Sube a R2 (api/src/lib/r2.js),
// nunca se guarda el archivo en la base de datos.
export function resizeLogo(file) {
  return resizeImage(file, { maxWidth: 200, maxHeight: 70, format: 'image/webp', quality: 0.9, maxBytes: 150_000 })
}

// Foto de producto: 800x800 maximo, webp. Va a la carpeta global "productos/"
// en R2 (ver CLAUDE.md > Imagenes), no por tenant.
export function resizeProductImage(file) {
  return resizeImage(file, { maxWidth: 800, maxHeight: 800, format: 'image/webp', quality: 0.9, maxBytes: 200_000 })
}
