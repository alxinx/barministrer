import { prisma } from '../lib/prisma.js'

// ADMIN siempre tiene el permiso. Los demas roles en `roles` solo lo tienen
// si el dueno del bar prendio ese flag puntual para su tenant (ver
// Tenant.cajero*). Por defecto todos los flags estan en false, asi que el
// comportamiento no cambia hasta que alguien lo active desde
// /configuracion/permisos.
export async function tienePermiso(auth, flag, roles = ['CAJERO']) {
  if (auth.role === 'ADMIN') return true
  if (!roles.includes(auth.role)) return false
  const tenant = await prisma.tenant.findUnique({ where: { id: auth.tenantId }, select: { [flag]: true } })
  return Boolean(tenant?.[flag])
}

export function requirePermission(flag, roles = ['CAJERO']) {
  return async (req, res, next) => {
    if (await tienePermiso(req.auth, flag, roles)) return next()
    res.status(403).json({ error: 'Tu rol no permite esta accion' })
  }
}
