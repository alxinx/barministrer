import bcrypt from 'bcryptjs'
import { prisma } from './prisma.js'

// Cualquier ADMIN o CAJERO activo del tenant autoriza: el PIN identifica al
// encargado que esta parado ahi, no es una clave unica del tenant. Un solo
// lugar en vez de repetir el mismo chequeo en cada ruta que pide PIN (anular
// un item, descuento, fiado, merma, suspender producto, abrir/cerrar turno,
// y la verificacion en vivo de /auth/verify-pin).
export async function verificarPin(tenantId, pin) {
  const encargados = await prisma.user.findMany({
    where: { tenantId, active: true, role: { in: ['ADMIN', 'CAJERO'] }, pinHash: { not: null } },
  })
  for (const u of encargados) {
    if (await bcrypt.compare(String(pin), u.pinHash)) return u
  }
  return null
}
