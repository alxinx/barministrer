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

// Para devolver un producto pasado el minuto de gracia (ver POST
// /orders/:id/items/:itemId/void): a diferencia de verificarPin, esto NO
// busca entre todos los encargados -- cajero y mesero confirman con su PROPIO
// PIN, sin necesitar que un admin este presente. El admin nunca pasa por
// aqui (nunca necesita PIN para devolver lo suyo).
export async function verificarPinPropio(tenantId, userId, pin) {
  const usuario = await prisma.user.findFirst({
    where: { id: userId, tenantId, active: true, pinHash: { not: null } },
  })
  if (!usuario) return null
  return (await bcrypt.compare(String(pin), usuario.pinHash)) ? usuario : null
}
