import { prisma } from '../lib/prisma.js'

// A diferencia de requirePermission (middleware/permissions.js), donde ADMIN
// siempre pasa, aqui NINGUN rol pasa si el modulo esta apagado -- no es un
// permiso delegable, es una funcionalidad que el tenant puede no tener
// contratada. Solo la plataforma (super admin) prende este flag.
export function requireModule(flag) {
  return async (req, res, next) => {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.auth.tenantId }, select: { [flag]: true } })
    if (!tenant?.[flag]) {
      return res.status(403).json({ error: 'Este negocio no tiene activado este módulo' })
    }
    next()
  }
}
