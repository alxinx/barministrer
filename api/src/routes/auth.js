import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'
import { signToken, requireAuth } from '../middleware/auth.js'

export const authRoutes = Router()

// Los flags de permiso van en la sesion de cualquier rol (no solo admin): el
// frontend los necesita para saber si a ESTE cajero le delegaron catalogo,
// inventario, distribucion o usuarios. No es informacion sensible, son
// booleanos sobre su propio alcance.
function tenantPublic(tenant) {
  return {
    id: tenant.id,
    name: tenant.name,
    timezone: tenant.timezone,
    logoUrl: tenant.logoUrl,
    cajeroEditaCatalogo: tenant.cajeroEditaCatalogo,
    cajeroGestionaInventario: tenant.cajeroGestionaInventario,
    cajeroGestionaDistribucion: tenant.cajeroGestionaDistribucion,
    cajeroGestionaUsuarios: tenant.cajeroGestionaUsuarios,
  }
}

authRoutes.post('/login', async (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) {
    return res.status(400).json({ error: 'Escribe tu correo y tu clave' })
  }

  const user = await prisma.user.findUnique({
    where: { email: String(email).toLowerCase().trim() },
    include: { tenant: true },
  })

  // Mismo mensaje para usuario inexistente y clave mala: no revelamos cuales
  // correos estan registrados.
  const ok = user && user.active && (await bcrypt.compare(password, user.passwordHash))
  if (!ok) return res.status(401).json({ error: 'Correo o clave incorrectos' })
  if (!user.tenant.active) return res.status(403).json({ error: 'Este bar esta inactivo' })

  res.json({
    token: signToken(user),
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    tenant: tenantPublic(user.tenant),
  })
})

// Devolver un producto ya pedido necesita el PIN del encargado (ADMIN o
// CAJERO), no el de quien esta operando: una mesera puede iniciar la
// devolucion pero necesita que alguien con autoridad la apruebe.
authRoutes.post('/verify-pin', requireAuth, async (req, res) => {
  const { pin } = req.body || {}
  if (!pin?.toString().trim()) return res.status(400).json({ error: 'Escribe el PIN' })

  const encargados = await prisma.user.findMany({
    where: { tenantId: req.auth.tenantId, active: true, role: { in: ['ADMIN', 'CAJERO'] }, pinHash: { not: null } },
  })

  for (const u of encargados) {
    if (await bcrypt.compare(String(pin), u.pinHash)) {
      return res.json({ ok: true, authorizedBy: { id: u.id, name: u.name } })
    }
  }
  res.status(401).json({ error: 'PIN incorrecto' })
})

authRoutes.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.auth.userId },
    include: { tenant: true },
  })
  if (!user) return res.status(401).json({ error: 'Sesion invalida' })
  res.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    tenant: tenantPublic(user.tenant),
  })
})
