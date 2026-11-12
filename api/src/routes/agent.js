import { Router } from 'express'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'
import { enviarCorreo } from '../lib/ses.js'
import { renderCorreoCodigoHtml, renderCorreoCodigoTexto } from '../lib/correoCodigo.js'

// Rutas publicas del instalador/agente de sincronizacion offline (ver
// contexto-sincronizacion-offline.md). No usan requireAuth ni
// requirePlatformAuth -- el propio token del agente ES la credencial; nadie
// tiene una sesion de usuario ni de plataforma en este flujo. apiLimiter ya
// aplica por estar montadas bajo /api (ver server.js).
export const agentRoutes = Router()

// Middleware interno para las rutas autenticadas del agente (heartbeat, sync).
// El token se pasa en Authorization: Bearer <token_plano>; se hashea aqui
// igual que en /activar para buscar el registro. Solo pasa si esta ACTIVO.
async function agentAuth(req, res, next) {
  const auth = req.headers.authorization || ''
  const plain = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null
  if (!plain) return res.status(401).json({ error: 'Token requerido' })

  const agentToken = await prisma.agentToken.findUnique({
    where: { tokenHash: hashToken(plain) },
  })
  if (!agentToken || agentToken.status !== 'ACTIVO') {
    return res.status(401).json({ error: 'Token inválido o revocado' })
  }

  req.agentToken = agentToken
  next()
}

const CODIGO_TTL_MS = 10 * 60 * 1000 // 10 minutos
const MAX_INTENTOS = 5

function hashToken(plain) {
  return crypto.createHash('sha256').update(String(plain)).digest('hex')
}

function generarCodigo() {
  return String(crypto.randomInt(0, 100000)).padStart(5, '0')
}

function ofuscarCorreo(email) {
  return email.replace(/^(.{2}).+(@.+)$/, '$1***$2')
}

// Paso 1: pegar el token. Valida que exista, no este revocado/bloqueado, y
// que ningun otro equipo lo tenga ya reclamado (ver doc: nunca dos equipos
// vigentes a la vez). Si todo eso pasa, manda el codigo de 5 digitos al
// primer ADMIN activo del tenant -- tambien sirve para reenviarlo, mientras
// el token siga DISPONIBLE.
agentRoutes.post('/activar', async (req, res) => {
  const { token } = req.body || {}
  if (!token) return res.status(400).json({ error: 'Falta el token' })

  const agentToken = await prisma.agentToken.findUnique({ where: { tokenHash: hashToken(token) } })

  if (!agentToken || agentToken.status === 'REVOCADO' || agentToken.status === 'BLOQUEADO') {
    return res.status(400).json({ error: 'Token inválido' })
  }
  // Ya reclamado por otro equipo: se corta aqui, sin mandar codigo -- no hay
  // nada que verificar, y mandar un codigo igual filtraria a quien no
  // deberia avanzar que este token existe y a que correo esta ligado.
  if (agentToken.status === 'ACTIVO') {
    return res.status(400).json({ error: 'Este token ya está en uso en otro equipo. Contacta a servicio al cliente.' })
  }

  // Primer ADMIN activo (ver CLAUDE.md: orden total con id como desempate,
  // igual que el resto de paginacion del proyecto). Si el original se
  // desactivo, cae al siguiente admin activo mas antiguo.
  const adminPrincipal = await prisma.user.findFirst({
    where: { tenantId: agentToken.tenantId, role: 'ADMIN', active: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  if (!adminPrincipal) {
    return res.status(400).json({ error: 'Este bar no tiene ningún administrador activo para verificar el código' })
  }

  const codigo = generarCodigo()
  const verificationCodeHash = await bcrypt.hash(codigo, 10)

  await prisma.agentToken.update({
    where: { id: agentToken.id },
    data: { verificationCodeHash, verificationCodeExpiresAt: new Date(Date.now() + CODIGO_TTL_MS) },
  })

  try {
    await enviarCorreo({
      to: adminPrincipal.email,
      subject: 'Código para activar la sincronización offline',
      text: renderCorreoCodigoTexto({ codigo, minutos: 10 }),
      html: renderCorreoCodigoHtml({ codigo, minutos: 10 }),
    })
  } catch (err) {
    return res.status(502).json({ error: 'No se pudo enviar el código por correo. Intenta de nuevo en un momento.' })
  }

  res.json({ ok: true, enviadoA: ofuscarCorreo(adminPrincipal.email) })
})

// Paso 2: confirmar el codigo. Si acierta, reclama el token para ESTE
// equipo (status ACTIVO). Si falla, suma al contador acumulado -- nunca se
// reinicia al pedir un codigo nuevo -- y a los 5 lo quema (BLOQUEADO): hay
// que pedir un token nuevo a servicio tecnico, no otro codigo con este
// mismo token (ver doc).
agentRoutes.post('/confirmar', async (req, res) => {
  const { token, codigo, deviceLabel } = req.body || {}
  if (!token || !codigo) return res.status(400).json({ error: 'Falta el token o el código' })

  const agentToken = await prisma.agentToken.findUnique({ where: { tokenHash: hashToken(token) } })
  if (!agentToken || agentToken.status !== 'DISPONIBLE') {
    return res.status(400).json({ error: 'Token inválido' })
  }
  if (!agentToken.verificationCodeHash || !agentToken.verificationCodeExpiresAt) {
    return res.status(400).json({ error: 'Todavía no se ha solicitado un código para este token' })
  }
  if (agentToken.verificationCodeExpiresAt < new Date()) {
    return res.status(400).json({ error: 'El código venció. Solicita uno nuevo.' })
  }

  const correcto = await bcrypt.compare(String(codigo), agentToken.verificationCodeHash)
  if (!correcto) {
    const intentos = agentToken.failedAttempts + 1
    const bloqueado = intentos >= MAX_INTENTOS
    await prisma.agentToken.update({
      where: { id: agentToken.id },
      data: {
        failedAttempts: intentos,
        ...(bloqueado && { status: 'BLOQUEADO', verificationCodeHash: null, verificationCodeExpiresAt: null }),
      },
    })
    if (bloqueado) {
      return res.status(400).json({ error: 'Superaste los intentos permitidos. Pide un token nuevo a servicio técnico.' })
    }
    return res.status(400).json({ error: `Código incorrecto. Intentos restantes: ${MAX_INTENTOS - intentos}` })
  }

  await prisma.agentToken.update({
    where: { id: agentToken.id },
    data: {
      status: 'ACTIVO',
      claimedAt: new Date(),
      lastContactAt: new Date(),
      deviceLabel: deviceLabel ? String(deviceLabel).slice(0, 191) : null,
      verificationCodeHash: null,
      verificationCodeExpiresAt: null,
    },
  })

  res.json({ ok: true, tenantId: agentToken.tenantId })
})

// Latido: el daemon llama esto periodicamente para actualizar lastContactAt.
// Si el token fue revocado, el agentAuth ya rechaza antes de llegar aqui.
agentRoutes.post('/heartbeat', agentAuth, async (req, res) => {
  await prisma.agentToken.update({
    where: { id: req.agentToken.id },
    data: { lastContactAt: new Date() },
  })
  res.json({ ok: true })
})

// Sincronizacion completa del tenant: devuelve todo lo que el daemon necesita
// para operar offline. Es una foto completa (no diferencial por ahora); el
// daemon la llama al activarse y cada vez que reconecta.
// Se excluyen tablas de modulos opcionales (cajas/bancos, compras) y de
// plataforma -- el daemon no los necesita para la operacion de venta.
agentRoutes.get('/sync', agentAuth, async (req, res) => {
  const tenantId = req.agentToken.tenantId

  await prisma.agentToken.update({
    where: { id: req.agentToken.id },
    data: { lastContactAt: new Date() },
  })

  const [tenant, users, categories, products, zones, tables, elements, customers, shifts, orders, orderItems] =
    await Promise.all([
      prisma.tenant.findUnique({ where: { id: tenantId } }),

      // passwordHash incluido: el daemon necesita autenticar usuarios offline.
      // El SQLite va cifrado con SQLCipher (ver doc), asi que el riesgo
      // es equivalente al de tener acceso fisico al equipo.
      prisma.user.findMany({
        where: { tenantId },
        select: {
          id: true, tenantId: true, name: true, email: true,
          passwordHash: true, pinHash: true, role: true, active: true,
        },
      }),

      prisma.category.findMany({ where: { tenantId } }),

      // Productos con variantes y receta anidadas para aplanarlos en SQLite.
      prisma.product.findMany({
        where: { tenantId, deletedAt: null },
        include: {
          variants: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
          recipe: { include: { items: true } },
        },
      }),

      prisma.zone.findMany({ where: { tenantId } }),
      prisma.barTable.findMany({ where: { tenantId } }),
      prisma.layoutElement.findMany({ where: { tenantId } }),
      prisma.customer.findMany({ where: { tenantId } }),

      // Solo el turno abierto -- el daemon no puede abrir/cerrar turnos.
      prisma.shift.findMany({ where: { tenantId, status: 'OPEN' } }),

      // Cuentas abiertas al momento del sync: el daemon las retoma.
      prisma.order.findMany({ where: { tenantId, status: 'OPEN' } }),

      // Items de cuentas abiertas (todos los estados, no solo ACTIVE, para
      // mostrar el historial completo de la mesa -- igual que hace el frontend).
      prisma.orderItem.findMany({
        where: { tenantId, order: { status: 'OPEN' } },
      }),
    ])

  res.json({ tenant, users, categories, products, zones, tables, elements, customers, shifts, orders, orderItems })
})
