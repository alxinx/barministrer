import { randomUUID } from 'crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

// R2 es compatible con la API de S3: mismo cliente, solo cambia el endpoint.
// Las credenciales viven unicamente aqui, por variables de entorno, nunca
// llegan al frontend.
const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
})

async function subirArchivo(key, buffer, contentType) {
  await client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000',
    })
  )
  return `${process.env.R2_PUBLIC_URL}/${key}`
}

// Sube el logo de un tenant y devuelve su URL publica. La key siempre es la
// misma por tenant (sobreescribe el logo anterior en vez de acumular
// versiones huerfanas que nadie borra).
export async function subirLogo(tenantId, buffer, contentType = 'image/webp') {
  const url = await subirArchivo(`tenants/${tenantId}/logo.webp`, buffer, contentType)
  // Cache-bust: el nombre no cambia entre subidas, asi que sin esto el
  // navegador seguiria mostrando el logo viejo desde su propio cache.
  return `${url}?v=${Date.now()}`
}

// Fotos de producto: carpeta global "productos/", no por tenant. La imagen
// de una marca comercial (Corona, Aguila, Poker) vive una sola vez y varios
// bares la pueden referenciar, por eso cada subida es un archivo nuevo con
// key aleatoria en vez de sobreescribir algo fijo.
export async function subirImagenProducto(buffer, contentType = 'image/webp') {
  return subirArchivo(`productos/${randomUUID()}.webp`, buffer, contentType)
}

// Fotos de insumo: misma logica que la de producto, carpeta propia
// "insumos/" para no mezclar las dos carpetas en R2.
export async function subirImagenInsumo(buffer, contentType = 'image/webp') {
  return subirArchivo(`insumos/${randomUUID()}.webp`, buffer, contentType)
}

// Factura de una compra (foto o PDF escaneado del documento del proveedor):
// carpeta por tenant, a diferencia de las fotos de producto/insumo que son
// globales -- esto es un soporte contable privado del bar, no una imagen
// comercial compartida. Tampoco se recomprime a webp como esas: un PDF no se
// puede, y una foto de factura pierde legibilidad de los numeros si se
// aprieta demasiado (ver resizeFacturaImage en web/src/lib/image.js, que ya
// la deja liviana sin pasarla por webp).
export async function subirFacturaCompra(tenantId, buffer, contentType, extension) {
  return subirArchivo(`facturas/${tenantId}/${randomUUID()}.${extension}`, buffer, contentType)
}

// facturaUrl viaja de vuelta al cliente y luego el cliente la manda de
// vuelta al guardar la compra (igual que imageUrl en productos/insumos):
// sin esto, cualquiera podria mandar "javascript:..." como facturaUrl y
// que se ejecute cuando otro usuario del mismo tenant le de clic al botón
// de factura. Solo se acepta lo que de verdad salio de subirFacturaCompra.
export function esUrlDeFactura(url) {
  if (!url) return true // null/"" es "sin factura", valido
  return typeof url === 'string' && url.startsWith(`${process.env.R2_PUBLIC_URL}/facturas/`)
}
