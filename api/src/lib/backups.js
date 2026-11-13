import { spawn } from 'child_process'
import { createReadStream, createWriteStream } from 'fs'
import { stat, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

// Cliente SEPARADO del de r2.js (ese apunta a R2_BUCKET, publico, sirve
// fotos/logos). Este apunta a un bucket privado dedicado solo a backups,
// con sus propias credenciales acotadas a ese bucket -- un dump de la base
// trae hashes de contraseña/PIN y datos de clientes, no puede vivir en un
// bucket con acceso publico (ver despliegue.md, seccion "Backup diario").
const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_BACKUPS_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_BACKUPS_SECRET_ACCESS_KEY,
  },
})

const BUCKET = process.env.R2_BACKUPS_BUCKET
// Mismo prefijo que usa el backup diario del servidor (ver
// ops/backup/backup-diario.sh) -- asi los manuales y los automaticos salen
// en una sola lista, sin duplicar logica de donde buscar.
const PREFIX = 'db/'

export async function listarBackups() {
  const res = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX }))
  return (res.Contents || [])
    .filter((o) => o.Key !== PREFIX)
    .map((o) => ({
      nombre: o.Key.slice(PREFIX.length),
      tamano: o.Size,
      fecha: o.LastModified,
      origen: o.Key.includes('_manual_') ? 'MANUAL' : 'AUTOMATICO',
    }))
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
}

function marcaDeTiempo() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

// A diferencia del backup diario del servidor (corre AFUERA del
// contenedor, con `docker exec` sobre licorplus_db -- ver
// ops/backup/backup-diario.sh -- y ahi si usa el mysqldump real de
// MySQL 8), este corre DENTRO del contenedor de la API, conectandose por
// red a "db" con el mismo usuario de la app (DATABASE_URL) -- no con el
// root, que ni siquiera llega a este contenedor. La imagen Alpine solo
// trae mariadb-dump (bajo el nombre mysqldump): no acepta
// --set-gtid-purged, por eso no se usa aqui -- ese flag solo evita
// sentencias de GTID en el dump real, no hace falta para un backup simple
// de una sola base. La contraseña va por MYSQL_PWD, nunca en el argv del
// proceso (ahi si quedaria visible para cualquiera con acceso a /proc en
// el contenedor).
export async function crearBackupAhora() {
  const db = new URL(process.env.DATABASE_URL)
  const nombre = `licorplus_manual_${marcaDeTiempo()}.sql`
  const archivoTmp = path.join(tmpdir(), nombre)

  await new Promise((resolve, reject) => {
    const destino = createWriteStream(archivoTmp)
    const proc = spawn(
      'mysqldump',
      [
        '-h',
        db.hostname,
        '-P',
        db.port || '3306',
        '-u',
        decodeURIComponent(db.username),
        '--single-transaction',
        decodeURIComponent(db.pathname.slice(1)),
      ],
      { env: { ...process.env, MYSQL_PWD: decodeURIComponent(db.password) } }
    )
    let stderr = ''
    proc.stderr.on('data', (d) => {
      stderr += d
    })
    proc.stdout.pipe(destino)
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`mysqldump fallo (codigo ${code}): ${stderr.slice(0, 300)}`))
    })
  })

  try {
    const { size } = await stat(archivoTmp)
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: `${PREFIX}${nombre}`,
        Body: createReadStream(archivoTmp),
        ContentLength: size,
        ContentType: 'application/sql',
      })
    )
    return { nombre, tamano: size, fecha: new Date(), origen: 'MANUAL' }
  } finally {
    await unlink(archivoTmp).catch(() => {})
  }
}
