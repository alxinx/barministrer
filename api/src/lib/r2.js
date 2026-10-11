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
