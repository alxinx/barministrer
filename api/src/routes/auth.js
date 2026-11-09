import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'
import { signToken, requireAuth } from '../middleware/auth.js'
import { loginLimiter, pinLimitExcedido, pinIncorrecto } from '../middleware/rateLimit.js'
import { verificarPin } from '../lib/pin.js'

export const authRoutes = Router()

// Los flags de permiso van en la sesion de cualquier rol (no solo admin): el
// frontend los necesita para saber si a ESTE cajero le delegaron catalogo,
// inventario, distribucion o usuarios. No es informacion sensible, son
// booleanos sobre su propio alcance. Los datos de factura (direccion, NIT,
// pie de pagina) tambien van aqui, no solo en GET /tenant (que es solo-admin):
// mesera y cajero imprimen tirillas y las necesitan igual que el admin.
function tenantPublic(tenant) {
  return {
    id: tenant.id,
    name: tenant.name,
    timezone: tenant.timezone,
    logoUrl: tenant.logoUrl,
    address: tenant.address,
    legalName: tenant.legalName,
    taxId: tenant.taxId,
    taxRegime: tenant.taxRegime,
    receiptFooter: tenant.receiptFooter,
    propinaPorcentaje: tenant.propinaPorcentaje,
    propinaPorDefecto: tenant.propinaPorDefecto,
    theme: tenant.theme,
    cajeroEditaCatalogo: tenant.cajeroEditaCatalogo,
    cajeroGestionaInventario: tenant.cajeroGestionaInventario,
    cajeroGestionaDistribucion: tenant.cajeroGestionaDistribucion,
    cajeroGestionaUsuarios: tenant.cajeroGestionaUsuarios,
    cajeroAplicaDescuentos: tenant.cajeroAplicaDescuentos,
    moduloCajasBancos: tenant.moduloCajasBancos,
    moduloCompras: tenant.moduloCompras,
    permiteEliminarProductos: tenant.permiteEliminarProductos,
  }
}

authRoutes.post('/login', loginLimiter, async (req, res) => {
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

// Verificacion en vivo mientras se escribe el PIN: el frontend la llama al
// completar los 5 digitos para habilitar el boton de la accion ANTES de
// mandarla (anular, descuento, fiado, merma, suspender producto, abrir/
// cerrar turno), en vez de dejar que la persona se entere de que esta mal
// hasta despues de confirmar. No ejecuta ninguna accion ni gasta una cuota
// aparte: pasa por el mismo pinLimiter/pinIncorrecto que esas rutas, asi que
// cuenta contra los mismos 3 intentos / 10 minutos (ver middleware/rateLimit.js).
authRoutes.post('/verify-pin', requireAuth, async (req, res) => {
  const { pin } = req.body || {}
  if (!pin?.toString().trim()) return res.status(400).json({ error: 'Escribe el PIN' })

  if (await pinLimitExcedido(req, res)) return
  const encargado = await verificarPin(req.auth.tenantId, pin)
  if (!encargado) return pinIncorrecto(req, res)

  res.json({ ok: true, name: encargado.name })
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
