import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma.js'

// Sin JWT_SECRET el servidor no arranca, nunca firma con un valor por
// defecto: ese fallback era un secreto publico (cualquiera pudo leer este
// archivo) con el que se podia forjar un token de ADMIN de cualquier tenant.
// Mejor que la app truene a que funcione mal en silencio.
const SECRET = process.env.JWT_SECRET
if (!SECRET) {
  throw new Error('Falta JWT_SECRET en el entorno. Definelo antes de arrancar la API.')
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, tenantId: user.tenantId, role: user.role, name: user.name },
    SECRET,
    { expiresIn: '12h' }
  )
}

// Mismo verify que requireAuth, para autenticar la conexion de websocket con
// el mismo token de sesion en vez de inventar un segundo mecanismo de login.
export function verifyToken(token) {
  const payload = jwt.verify(token, SECRET)
  return { userId: payload.sub, tenantId: payload.tenantId, role: payload.role, name: payload.name }
}

/**
 * Inyecta req.auth = { userId, tenantId, role }.
 * El tenantId SIEMPRE sale del token, nunca del body ni del query. Esa es la
 * unica barrera que impide que un bar lea los datos de otro.
 *
 * Tambien revisa que el usuario (y su tenant) sigan activos: el token dura
 * hasta 12h, y desactivar a alguien (empleado que sale, sospecha de PIN)
 * tiene que cortarle el acceso de una, no dejarlo entrar con la sesion vieja
 * hasta que el token expire solo.
 */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Falta el token de sesion' })

  try {
    const payload = jwt.verify(token, SECRET)
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { active: true, tenant: { select: { active: true } } },
    })
    if (!user?.active || !user.tenant.active) {
      return res.status(401).json({ error: 'La sesion expiro. Vuelve a entrar.' })
    }
    req.auth = {
      userId: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
      name: payload.name,
    }
    next()
  } catch {
    res.status(401).json({ error: 'La sesion expiro. Vuelve a entrar.' })
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'Tu rol no permite esta accion' })
    }
    next()
  }
}
