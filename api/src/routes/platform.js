import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'
import { signToken, signPlatformToken, requirePlatformAuth } from '../middleware/auth.js'
import { loginLimiter, pinLimiter, estadoPin, bloquearPinManual } from '../middleware/rateLimit.js'
import { avisarTenant } from '../lib/realtime.js'
import { formatearTodo, formatearMovimientos, previsualizarFormateoProductos, ejecutarFormateoProductos } from '../lib/formateoTenant.js'

export const platformAuthRoutes = Router()
export const platformRoutes = Router()

const PERIODS = ['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL']

// El slug queda en la URL/subdominio del bar mas adelante, asi que no puede
// llevar mayusculas, espacios ni caracteres raros.
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

function adminPublic(a) {
  return { id: a.id, name: a.name, email: a.email }
}

platformAuthRoutes.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) {
    return res.status(400).json({ error: 'Escribe tu correo y tu clave' })
  }

  const admin = await prisma.platformAdmin.findUnique({
    where: { email: String(email).toLowerCase().trim() },
  })

  // Mismo mensaje para cuenta inexistente y clave mala: no revelamos que
  // correos de plataforma existen.
  const ok = admin && admin.active && (await bcrypt.compare(password, admin.passwordHash))
  if (!ok) return res.status(401).json({ error: 'Correo o clave incorrectos' })

  res.json({ token: signPlatformToken(admin), admin: adminPublic(admin) })
})

platformAuthRoutes.get('/me', requirePlatformAuth, async (req, res) => {
  const admin = await prisma.platformAdmin.findUnique({ where: { id: req.platformAuth.adminId } })
  if (!admin) return res.status(401).json({ error: 'Sesion invalida' })
  res.json({ admin: adminPublic(admin) })
})

// Lista plana, sin paginacion: mientras sean unos pocos bares esto alcanza,
// paginar antes de tener datos para paginar seria sobre-diseño.
platformRoutes.get('/tenants', requirePlatformAuth, async (_req, res) => {
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      slug: true,
      active: true,
      createdAt: true,
      rentalPlan: { select: { name: true, price: true, period: true } },
      _count: { select: { users: true } },
    },
  })
  res.json(tenants.map((t) => ({ ...t, userCount: t._count.users, _count: undefined })))
})

// Crea el bar y su primer ADMIN juntos: un tenant sin ningun usuario que
// pueda entrar no sirve de nada, asi que no tiene sentido separarlo en dos
// pasos. El PIN es obligatorio aqui (no opcional como al crear un usuario
// normal) porque abrir/cerrar turno ya pide PIN siempre: sin uno, el primer
// admin del bar nuevo no podria ni abrir caja.
platformRoutes.post('/tenants', requirePlatformAuth, async (req, res) => {
  const { name, slug, adminName, adminEmail, adminPassword, adminPin } = req.body || {}

  if (!name?.trim() || !slug?.trim()) {
    return res.status(400).json({ error: 'Nombre y slug del bar son obligatorios' })
  }
  if (!SLUG_RE.test(slug.trim())) {
    return res.status(400).json({ error: 'El slug solo puede tener minusculas, numeros y guiones' })
  }
  if (!adminName?.trim() || !adminEmail?.trim() || !adminPassword) {
    return res.status(400).json({ error: 'Nombre, correo y clave del primer administrador son obligatorios' })
  }
  if (adminPassword.length < 6) {
    return res.status(400).json({ error: 'La clave debe tener minimo 6 caracteres' })
  }
  if (!/^\d{5}$/.test(String(adminPin || ''))) {
    return res.status(400).json({ error: 'El PIN del administrador debe tener exactamente 5 digitos' })
  }

  const passwordHash = await bcrypt.hash(adminPassword, 10)
  const pinHash = await bcrypt.hash(String(adminPin), 10)

  try {
    const { tenant, admin } = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: name.trim(), slug: slug.trim().toLowerCase() },
      })
      const admin = await tx.user.create({
        data: {
          tenantId: tenant.id,
          name: adminName.trim(),
          email: adminEmail.toLowerCase().trim(),
          passwordHash,
          pinHash,
          role: 'ADMIN',
        },
      })
      return { tenant, admin }
    })
    res.status(201).json({
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, active: tenant.active, userCount: 1 },
      admin: adminPublic(admin),
    })
  } catch (e) {
    if (e.code === 'P2002') {
      const target = String(e.meta?.target || '')
      if (target.includes('slug')) return res.status(409).json({ error: 'Ya existe un bar con ese slug' })
      return res.status(409).json({ error: 'Ya existe un usuario con ese correo' })
    }
    throw e
  }
})

function userPublic(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, createdAt: u.createdAt }
}

// Perfil de un bar: datos, plan, su lista de usuarios (userCount cuenta TODOS
// los creados alguna vez, activos o no, a proposito, a diferencia de la
// lista de /usuarios del propio bar que solo opera con los activos) y una
// senal simple de uso real (dias con al menos un pedido en los ultimos 7
// dias) en vez de un numero de logins que hoy no se registra en ningun lado.
platformRoutes.get('/tenants/:id', requirePlatformAuth, async (req, res) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.params.id },
    include: { rentalPlan: true },
  })
  if (!tenant) return res.status(404).json({ error: 'Bar no encontrado' })

  const [users, userCount, pedidosRecientes] = await Promise.all([
    prisma.user.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'asc' } }),
    prisma.user.count({ where: { tenantId: tenant.id } }),
    prisma.order.findMany({
      where: { tenantId: tenant.id, openedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      select: { openedAt: true },
    }),
  ])

  const diasActivosSemana = new Set(pedidosRecientes.map((o) => o.openedAt.toISOString().slice(0, 10))).size

  // Estado del bloqueo de PIN de cada usuario (ver pinLimiter en
  // middleware/rateLimit.js), para que el panel sepa si mostrar "Desbloquear
  // PIN" o "Bloquear PIN" sin que el frontend tenga que adivinar.
  const usersConPin = await Promise.all(
    users.map(async (u) => ({ ...userPublic(u), ...(await estadoPin(u.id)) }))
  )

  res.json({
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    active: tenant.active,
    createdAt: tenant.createdAt,
    rentalPlan: tenant.rentalPlan,
    moduloCajasBancos: tenant.moduloCajasBancos,
    moduloCompras: tenant.moduloCompras,
    permiteEliminarProductos: tenant.permiteEliminarProductos,
    userCount,
    diasActivosSemana,
    users: usersConPin,
  })
})

// Nombre, plan y active: cambiar otras cosas del bar (catalogo, distribucion,
// permisos) es trabajo del propio ADMIN del bar, no de plataforma. active es
// el "suspender": requireAuth y /auth/login ya revisan tenant.active en cada
// request (ver middleware/auth.js y routes/auth.js), asi que apagarlo aqui
// corta el acceso de TODOS los usuarios del bar de una, sin tocar cada
// cuenta una por una.
platformRoutes.patch('/tenants/:id', requirePlatformAuth, async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } })
  if (!tenant) return res.status(404).json({ error: 'Bar no encontrado' })

  const { name, rentalPlanId, active, moduloCajasBancos, moduloCompras, permiteEliminarProductos } = req.body || {}
  const data = {}

  if (name !== undefined) {
    if (!name.trim()) return res.status(400).json({ error: 'El nombre no puede quedar vacio' })
    data.name = name.trim()
  }
  if (rentalPlanId !== undefined) {
    if (rentalPlanId !== null) {
      const plan = await prisma.rentalPlan.findUnique({ where: { id: rentalPlanId } })
      if (!plan) return res.status(400).json({ error: 'Ese plan no existe' })
    }
    data.rentalPlanId = rentalPlanId
  }
  if (active !== undefined) data.active = Boolean(active)
  // Modulos activables: solo plataforma los prende/apaga, nunca el ADMIN del
  // bar (ver Tenant.moduloCajasBancos en schema.prisma).
  if (moduloCajasBancos !== undefined) data.moduloCajasBancos = Boolean(moduloCajasBancos)
  if (moduloCompras !== undefined) data.moduloCompras = Boolean(moduloCompras)
  if (permiteEliminarProductos !== undefined) data.permiteEliminarProductos = Boolean(permiteEliminarProductos)

  const updated = await prisma.tenant.update({ where: { id: tenant.id }, data, include: { rentalPlan: true } })

  // Avisa en vivo a quien tenga sesion abierta en ese bar: un modulo que se
  // apaga mientras alguien lo esta mirando tiene que desaparecer del menu y
  // bloquear la pagina sin que tenga que recargar (ver socket en
  // AuthContext.jsx). Tambien cubre active/name/rentalPlan por si mas
  // adelante algo mas depende de refrescar la sesion en vivo.
  avisarTenant(tenant.id, 'tenant:actualizado', {})

  res.json({
    id: updated.id,
    name: updated.name,
    slug: updated.slug,
    active: updated.active,
    rentalPlan: updated.rentalPlan,
    moduloCajasBancos: updated.moduloCajasBancos,
    moduloCompras: updated.moduloCompras,
    permiteEliminarProductos: updated.permiteEliminarProductos,
  })
})

// Papelera de productos: solo plataforma la ve, ni siquiera el ADMIN del
// propio bar (ver Product.deletedAt en schema.prisma -- eliminar un producto
// nunca es un DELETE real, por eso esto sigue existiendo para recuperarlo).
platformRoutes.get('/tenants/:id/productos-eliminados', requirePlatformAuth, async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } })
  if (!tenant) return res.status(404).json({ error: 'Bar no encontrado' })

  const productos = await prisma.product.findMany({
    where: { tenantId: tenant.id, deletedAt: { not: null } },
    include: { category: { select: { name: true } }, deletedBy: { select: { name: true } } },
    orderBy: { deletedAt: 'desc' },
  })
  res.json(
    productos.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category.name,
      deletedAt: p.deletedAt,
      deletedBy: p.deletedBy?.name || null,
    }))
  )
})

platformRoutes.post('/tenants/:id/productos-eliminados/:productId/restaurar', requirePlatformAuth, async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } })
  if (!tenant) return res.status(404).json({ error: 'Bar no encontrado' })

  const producto = await prisma.product.findFirst({
    where: { id: req.params.productId, tenantId: tenant.id, deletedAt: { not: null } },
  })
  if (!producto) return res.status(404).json({ error: 'Ese producto no está eliminado o no existe' })

  // Vuelve suspendido (active=false), no activo de una: quien restaura desde
  // plataforma no sabe si ese bar todavia lo quiere a la venta tal cual
  // estaba, asi que el ADMIN del bar decide reactivarlo desde /productos
  // igual que con cualquier otra suspension.
  const restaurado = await prisma.product.update({
    where: { id: producto.id },
    data: { deletedAt: null, deletedById: null },
  })
  avisarTenant(tenant.id, 'tenant:actualizado', {})
  res.json({ id: restaurado.id, name: restaurado.name })
})

// Borra el bar de verdad: catalogo, plano, turnos, pedidos, todo (cascada
// por FK, ver onDelete: Cascade en cada modelo con tenantId). A diferencia
// de suspender (active=false), esto no se puede deshacer, asi que exige que
// quien lo pide escriba el slug exacto en el body — no solo un click en un
// modal — como defensa server-side ademas de la confirmacion del frontend.
platformRoutes.delete('/tenants/:id', requirePlatformAuth, async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } })
  if (!tenant) return res.status(404).json({ error: 'Bar no encontrado' })

  const { confirmSlug } = req.body || {}
  if (confirmSlug !== tenant.slug) {
    return res.status(400).json({ error: 'El slug no coincide. Escribelo exactamente para confirmar.' })
  }

  await prisma.tenant.delete({ where: { id: tenant.id } })
  res.status(204).end()
})

// --- Formateo de datos (zona peligrosa, pero reversible-en-el-sentido-de
// "el bar sigue existiendo"): a diferencia de DELETE /tenants/:id esto borra
// SOLO datos operativos de un tenant puntual, nunca el bar ni sus usuarios.
// La palabra "confirmar" en el body es defensa server-side ademas de lo que
// ya exige el frontend (resolver una cuenta + escribirla) -- mismo criterio
// que confirmSlug arriba: la confirmacion real vive aqui, no solo en la UI.
function exigirConfirmacion(req, res) {
  const { confirmPalabra } = req.body || {}
  if (String(confirmPalabra || '').trim().toLowerCase() !== 'confirmar') {
    res.status(400).json({ error: 'Falta confirmar la acción' })
    return false
  }
  return true
}

platformRoutes.post('/tenants/:id/formatear/todo', requirePlatformAuth, async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } })
  if (!tenant) return res.status(404).json({ error: 'Bar no encontrado' })
  if (!exigirConfirmacion(req, res)) return

  await formatearTodo(tenant.id)
  avisarTenant(tenant.id, 'tenant:actualizado', {})
  res.json({ ok: true })
})

platformRoutes.post('/tenants/:id/formatear/movimientos', requirePlatformAuth, async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } })
  if (!tenant) return res.status(404).json({ error: 'Bar no encontrado' })
  if (!exigirConfirmacion(req, res)) return

  await formatearMovimientos(tenant.id)
  avisarTenant(tenant.id, 'tenant:actualizado', {})
  res.json({ ok: true })
})

platformRoutes.get('/tenants/:id/formatear/productos/preview', requirePlatformAuth, async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } })
  if (!tenant) return res.status(404).json({ error: 'Bar no encontrado' })

  const { productos, insumos, recetas } = req.query
  const seleccion = { productos: productos === '1', insumos: insumos === '1', recetas: recetas === '1' }
  if (!seleccion.productos && !seleccion.insumos && !seleccion.recetas) {
    return res.status(400).json({ error: 'Elige al menos una categoría' })
  }

  const preview = await previsualizarFormateoProductos(tenant.id, seleccion)
  res.json(preview)
})

platformRoutes.post('/tenants/:id/formatear/productos', requirePlatformAuth, async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } })
  if (!tenant) return res.status(404).json({ error: 'Bar no encontrado' })
  if (!exigirConfirmacion(req, res)) return

  const { productos, insumos, recetas, modo } = req.body || {}
  if (!productos && !insumos && !recetas) {
    return res.status(400).json({ error: 'Elige al menos una categoría' })
  }
  if (!['conservar', 'borrar'].includes(modo)) {
    return res.status(400).json({ error: 'Falta decidir qué hacer con lo que ya tiene historial' })
  }

  await ejecutarFormateoProductos(tenant.id, {
    productos: Boolean(productos),
    insumos: Boolean(insumos),
    recetas: Boolean(recetas),
    modo,
  })
  avisarTenant(tenant.id, 'tenant:actualizado', {})
  res.json({ ok: true })
})

// Soporte basico desde plataforma: activar/desactivar un usuario del bar
// (ej. empleado que salio y el bar no actuo). Nunca toca clave, PIN ni rol —
// eso sigue siendo solo del ADMIN del propio bar, para no convertir esta
// cuenta de plataforma en una puerta trasera a cualquier cuenta de cualquier
// bar. Misma regla de "no dejar el bar sin ningun admin" que /usuarios.
platformRoutes.patch('/tenants/:tenantId/users/:userId', requirePlatformAuth, async (req, res) => {
  const user = await prisma.user.findFirst({
    where: { id: req.params.userId, tenantId: req.params.tenantId },
  })
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' })

  const { active } = req.body || {}
  if (typeof active !== 'boolean') return res.status(400).json({ error: 'Falta el estado activo' })

  if (user.role === 'ADMIN' && active === false) {
    const otrosAdmins = await prisma.user.count({
      where: { tenantId: user.tenantId, role: 'ADMIN', active: true, id: { not: user.id } },
    })
    if (otrosAdmins === 0) {
      return res.status(400).json({ error: 'Debe quedar al menos un administrador activo' })
    }
  }

  const updated = await prisma.user.update({ where: { id: user.id }, data: { active } })
  res.json(userPublic(updated))
})

// Soporte: levanta el bloqueo de 10 minutos por PINs incorrectos (ver
// pinLimiter en middleware/rateLimit.js) para que la persona pueda volver a
// intentar de inmediato, en vez de esperar el resto del tiempo. La cuota es
// por usuario (keyGenerator: req.auth.userId), asi que solo limpia la de
// este usuario puntual, no la de todo el bar. No toca clave, PIN ni rol.
platformRoutes.post('/tenants/:tenantId/users/:userId/reset-pin-lock', requirePlatformAuth, async (req, res) => {
  const user = await prisma.user.findFirst({
    where: { id: req.params.userId, tenantId: req.params.tenantId },
  })
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' })

  await pinLimiter.resetKey(user.id)
  res.json({ ok: true })
})

// Soporte: fuerza el bloqueo de 10 minutos sin esperar a que falle 3 veces
// (ej. sospecha de que alguien esta probando PINs ajenos en ese dispositivo).
// Mismo mecanismo que el bloqueo automatico, no un flag aparte -- ver
// bloquearPinManual en middleware/rateLimit.js.
platformRoutes.post('/tenants/:tenantId/users/:userId/lock-pin', requirePlatformAuth, async (req, res) => {
  const user = await prisma.user.findFirst({
    where: { id: req.params.userId, tenantId: req.params.tenantId },
  })
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' })

  await bloquearPinManual(user.id)
  res.json({ ok: true })
})

// Soporte entra al panel del bar exactamente como su ADMIN, sin pedirle la
// clave al dueño: firma el mismo JWT de tenant que /auth/login, sobre el
// primer ADMIN activo del bar. No es un rol de "solo lectura" propio -- es
// control real, igual que si el dueño hubiera iniciado sesion el mismo. Si
// el bar esta suspendido, requireAuth lo va a rechazar igual en la siguiente
// request (ver middleware/auth.js), asi que no hay que repetir esa regla aqui.
platformRoutes.post('/tenants/:id/impersonate', requirePlatformAuth, async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } })
  if (!tenant) return res.status(404).json({ error: 'Bar no encontrado' })

  const admin = await prisma.user.findFirst({
    where: { tenantId: tenant.id, role: 'ADMIN', active: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!admin) return res.status(400).json({ error: 'Este bar no tiene ningun administrador activo' })

  res.json({ token: signToken(admin) })
})

// Catalogo de planes de renta: lo que cada bar le paga a Barminister por usar
// la app, no lo que el bar le cobra a sus clientes. Nunca se borra un plan
// (podria estar asignado a un bar en algun reporte futuro), se desactiva
// igual que categorias y productos.
platformRoutes.get('/rental-plans', requirePlatformAuth, async (_req, res) => {
  const plans = await prisma.rentalPlan.findMany({ orderBy: { createdAt: 'asc' } })
  res.json(plans)
})

platformRoutes.post('/rental-plans', requirePlatformAuth, async (req, res) => {
  const { name, price, period } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'El nombre del plan es obligatorio' })
  // >= 0, no solo > 0: un plan de acceso gratuito (ej. "Free") vale $0 a
  // proposito, no es un dato faltante.
  if (!Number.isFinite(Number(price)) || Number(price) < 0) {
    return res.status(400).json({ error: 'El valor no puede ser negativo' })
  }
  if (!PERIODS.includes(period)) return res.status(400).json({ error: 'El periodo no es valido' })

  const plan = await prisma.rentalPlan.create({
    data: { name: name.trim(), price: Math.round(Number(price)), period },
  })
  res.status(201).json(plan)
})

platformRoutes.patch('/rental-plans/:id', requirePlatformAuth, async (req, res) => {
  const plan = await prisma.rentalPlan.findUnique({ where: { id: req.params.id } })
  if (!plan) return res.status(404).json({ error: 'Plan no encontrado' })

  const { name, price, period, active } = req.body || {}
  if (price !== undefined && (!Number.isFinite(Number(price)) || Number(price) < 0)) {
    return res.status(400).json({ error: 'El valor no puede ser negativo' })
  }
  if (period !== undefined && !PERIODS.includes(period)) {
    return res.status(400).json({ error: 'El periodo no es valido' })
  }

  const data = {}
  if (name !== undefined) data.name = name.trim()
  if (price !== undefined) data.price = Math.round(Number(price))
  if (period !== undefined) data.period = period
  if (active !== undefined) data.active = Boolean(active)

  const updated = await prisma.rentalPlan.update({ where: { id: plan.id }, data })
  res.json(updated)
})
