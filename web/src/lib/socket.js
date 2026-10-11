import { io } from 'socket.io-client'
import { token } from './api'

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000'

let socket = null

// Un solo socket por sesion, autenticado con el mismo token de la API en vez
// de inventar un segundo login. Se conecta una vez y se reusa.
export function getSocket() {
  if (socket) return socket
  socket = io(BASE, { auth: { token: token.get() }, autoConnect: true })
  return socket
}
