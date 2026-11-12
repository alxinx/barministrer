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
