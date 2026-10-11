import jwt from 'jsonwebtoken'

const SECRET = process.env.JWT_SECRET || 'dev-secret'

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
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Falta el token de sesion' })

  try {
    const payload = jwt.verify(token, SECRET)
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
