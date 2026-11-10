import { createContext, useContext, useEffect, useState } from 'react'
import { api, token } from '../lib/api'
import { getSocket } from '../lib/socket'
import { olvidarCodigoRecordado } from '../lib/codigoRecordado'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token.get()) return setLoading(false)
    api('/auth/me')
      .then(setSession)
      .catch(() => token.clear())
      .finally(() => setLoading(false))
  }, [])

  async function login(email, password) {
    const data = await api('/auth/login', { method: 'POST', body: { email, password } })
    token.set(data.token)
    setSession({ user: data.user, tenant: data.tenant })
  }

  function logout() {
    token.clear()
    setSession(null)
    // Cerrar sesion siempre vuelve a pedir el codigo de empleado la proxima
    // vez, aunque entre el mismo usuario y no se haya cerrado la pestana
    // (sessionStorage por si solo no distingue eso).
    olvidarCodigoRecordado()
  }

  // Tras editar nombre/logo del bar en /configuracion, la sesion en memoria
  // queda desactualizada (viene del login, no se recalcula sola): se vuelve a
  // pedir /me para que el sidebar refleje el cambio sin tener que recargar.
  async function refreshSession() {
    const data = await api('/auth/me')
    setSession(data)
  }

  // Si plataforma prende/apaga un modulo (u otro dato del tenant) mientras
  // hay sesion abierta, el bar se entera sin recargar: el menu lo oculta solo
  // (Shell ya recalcula visible() con el tenant nuevo) y la pagina del modulo
  // reacciona mostrando ModuloNoDisponible (ver Protegida en App.jsx), ambos
  // porque session.tenant cambio de valor, no por codigo nuevo en cada uno.
  useEffect(() => {
    if (!session) return
    const socket = getSocket()
    const onTenantActualizado = () => refreshSession()
    socket.on('tenant:actualizado', onTenantActualizado)
    return () => socket.off('tenant:actualizado', onTenantActualizado)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(session)])

  // La pestaña dice el nombre del bar mientras alguien tiene sesion abierta
  // (util con varios bares/turnos abiertos en pestanas distintas), y vuelve
  // al nombre de la app cuando no hay sesion.
  useEffect(() => {
    document.title = session?.tenant?.name || 'Barminister'
  }, [session])

  // Tema del tenant (oscuro por defecto): se aplica al <html> para que todos
  // los tokens de color de web/src/index.css cambien de una. Sin sesion
  // (login, plataforma) siempre queda oscuro.
  useEffect(() => {
    const temas = {
      OSCURO: 'dark',
      SEPIA: 'sepia',
      CLARO_LIMA: 'lime',
      OSCURO_OBSIDIANA: 'obsidiana',
    }
    document.documentElement.setAttribute('data-theme', temas[session?.tenant?.theme] || 'dark')
  }, [session])

  const isAdmin = session?.user.role === 'ADMIN'

  return (
    <AuthContext.Provider value={{ session, loading, login, logout, refreshSession, isAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
