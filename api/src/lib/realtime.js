import { Server } from 'socket.io'
import { verifyToken } from '../middleware/auth.js'

let io = null

// Pre-pedidos: solo el admin de cada bar necesita verlos en vivo, asi que
// cada socket se une al cuarto de su propio tenant (nunca al de otro) y solo
// si su rol es ADMIN. La mesera no se conecta a esto.
function salaAdmin(tenantId) {
  return `tenant:${tenantId}:admin`
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
    if (role === 'ADMIN') socket.join(salaAdmin(tenantId))
  })

  return io
}

export function avisarAdmins(tenantId, event, payload) {
  io?.to(salaAdmin(tenantId)).emit(event, payload)
}
