import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireRole } from '../middleware/auth.js'
import { subirLogo } from '../lib/r2.js'

export const tenantRoutes = Router()

// Ver y editar los datos del bar y los permisos especiales es configuracion
// pura: siempre ADMIN real, nunca delegable. Delegar esto permitiria que un
// cajero con un permiso puntual se otorgara mas permisos a si mismo.
const soloAdmin = requireRole('ADMIN')

// logoUrl no va aqui: solo se asigna desde POST /tenant/logo, que lo sube a
// R2 primero. Aceptarlo aqui como texto suelto dejaria guardar cualquier URL
// externa sin pasar por esa subida.
const CAMPOS_DATOS = ['name', 'address', 'legalName', 'taxId', 'taxRegime']
const CAMPOS_PERMISOS = [
  'cajeroEditaCatalogo',
  'cajeroGestionaInventario',
  'cajeroGestionaDistribucion',
  'cajeroGestionaUsuarios',
  'cajeroAplicaDescuentos',
]
const CAMPOS_BOOLEANOS = [...CAMPOS_PERMISOS, 'autoEnviarPedido']

tenantRoutes.get('/tenant', soloAdmin, async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.auth.tenantId } })
  res.json(tenant)
})

tenantRoutes.patch('/tenant', soloAdmin, async (req, res) => {
  const data = {}
  for (const campo of [...CAMPOS_DATOS, ...CAMPOS_BOOLEANOS]) {
    if (req.body[campo] === undefined) continue
    data[campo] = CAMPOS_BOOLEANOS.includes(campo) ? Boolean(req.body[campo]) : req.body[campo]
  }
  if (data.name !== undefined) {
    if (!data.name.trim()) return res.status(400).json({ error: 'El bar necesita un nombre' })
    data.name = data.name.trim()
  }

  const tenant = await prisma.tenant.update({ where: { id: req.auth.tenantId }, data })
  res.json(tenant)
})

// El navegador ya redujo la imagen a 200x70 max y la convirtio a webp (ver
// web/src/lib/image.js); aqui solo se decodifica el data URI y se sube a R2.
// Nunca se guarda el archivo en la base de datos, solo la URL resultante.
tenantRoutes.post('/tenant/logo', soloAdmin, async (req, res) => {
  const { image } = req.body || {}
  const match = /^data:image\/webp;base64,(.+)$/.exec(image || '')
  if (!match) return res.status(400).json({ error: 'El logo debe venir en formato webp' })

  const buffer = Buffer.from(match[1], 'base64')
  if (buffer.length > 300_000) {
    return res.status(400).json({ error: 'El logo quedo mas grande de lo esperado, intenta con otra imagen' })
  }

  const logoUrl = await subirLogo(req.auth.tenantId, buffer)
  const tenant = await prisma.tenant.update({ where: { id: req.auth.tenantId }, data: { logoUrl } })
  res.json(tenant)
})
