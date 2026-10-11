import { Server } from 'socket.io'
import { verifyToken } from '../middleware/auth.js'

let io = null

// Pre-pedidos: admin y cajero necesitan verlos en vivo (ambos manejan caja y
// pueden estar pendientes de que llegue la mesera), asi que cada socket se une
// al cuarto de su propio tenant (nunca al de otro) si su rol es uno de esos
// dos. Solo ADMIN puede aprobar y enviar a la barra; eso se valida aparte en
// la ruta, no aqui. La mesera no se conecta a esto.
function salaEncargados(tenantId) {
  return `tenant:${tenantId}:encargados`
}

export function initRealtime(httpServer) {
  io = new Server(httpServer, { cors: { origin: '*' } })

  io.use((socket, next) => {
    try {
      const auth = verifyToken(socket.handshake.auth?.token)
      socket.data.auth = auth
      next()
    } catch {
      next(new Error('No autorizado'))
    }
  })

  io.on('connection', (socket) => {
    const { tenantId, role } = socket.data.auth
    if (role === 'ADMIN' || role === 'CAJERO') socket.join(salaEncargados(tenantId))
  })

  return io
}

export function avisarEncargados(tenantId, event, payload) {
  io?.to(salaEncargados(tenantId)).emit(event, payload)
}
