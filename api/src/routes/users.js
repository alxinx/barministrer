import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'
import { requireRole } from '../middleware/auth.js'

export const userRoutes = Router()

const adminOnly = requireRole('ADMIN')
const ROLES = ['ADMIN', 'CAJERO', 'MESERO']

// Nunca se devuelve passwordHash/pinHash: son hashes, pero no hay razon para
// que salgan de la API. tienePin le dice al frontend si ya hay PIN configurado
// sin revelar el hash.
function toPublic(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active,
    tienePin: Boolean(u.pinHash),
    createdAt: u.createdAt,
  }
}

function pinInvalido(pin) {
  return pin !== undefined && pin !== null && pin !== '' && !/^\d{4}$/.test(String(pin))
}

// Gestionar usuarios es configuracion: solo ADMIN, igual que catalogo,
// inventario y distribucion.
userRoutes.get('/users', adminOnly, async (req, res) => {
  const users = await prisma.user.findMany({
    where: { tenantId: req.auth.tenantId },
    orderBy: { name: 'asc' },
  })
  res.json(users.map(toPublic))
})

userRoutes.post('/users', adminOnly, async (req, res) => {
  const { name, email, password, role, pin } = req.body || {}
  if (!name?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ error: 'Nombre, correo y clave son obligatorios' })
  }
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'El rol no es valido' })
  if (password.length < 6) return res.status(400).json({ error: 'La clave debe tener minimo 6 caracteres' })
  if (pinInvalido(pin)) return res.status(400).json({ error: 'El PIN debe tener exactamente 4 digitos' })

  try {
    const user = await prisma.user.create({
      data: {
        tenantId: req.auth.tenantId,
        name: name.trim(),
        email: email.toLowerCase().trim(),
        passwordHash: await bcrypt.hash(password, 10),
        pinHash: pin ? await bcrypt.hash(String(pin), 10) : null,
        role,
      },
    })
    res.status(201).json(toPublic(user))
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'Ya existe un usuario con ese correo' })
    throw e
  }
})

userRoutes.patch('/users/:id', adminOnly, async (req, res) => {
  const user = await prisma.user.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } })
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' })

  const { name, email, role, active, password, pin } = req.body || {}
  if (role !== undefined && !ROLES.includes(role)) {
    return res.status(400).json({ error: 'El rol no es valido' })
  }
  if (password !== undefined && password !== '' && password.length < 6) {
    return res.status(400).json({ error: 'La clave debe tener minimo 6 caracteres' })
  }
  if (pinInvalido(pin)) return res.status(400).json({ error: 'El PIN debe tener exactamente 4 digitos' })

  // No dejar el bar sin ningun admin activo: seria un candado que nadie puede
  // abrir, ni siquiera para revertir el propio cambio.
  const dejaDeSerAdmin = user.role === 'ADMIN' && ((role && role !== 'ADMIN') || active === false)
  if (dejaDeSerAdmin) {
    const otrosAdmins = await prisma.user.count({
      where: { tenantId: req.auth.tenantId, role: 'ADMIN', active: true, id: { not: user.id } },
    })
    if (otrosAdmins === 0) {
      return res.status(400).json({ error: 'Debe quedar al menos un administrador activo' })
    }
  }

  const data = {}
  if (name !== undefined) data.name = name.trim()
  if (email !== undefined) data.email = email.toLowerCase().trim()
  if (role !== undefined) data.role = role
  if (active !== undefined) data.active = Boolean(active)
  if (password) data.passwordHash = await bcrypt.hash(password, 10)
  if (pin !== undefined) data.pinHash = pin ? await bcrypt.hash(String(pin), 10) : null

  try {
    const updated = await prisma.user.update({ where: { id: user.id }, data })
    res.json(toPublic(updated))
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'Ya existe un usuario con ese correo' })
    throw e
  }
})
