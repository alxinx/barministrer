import { createContext, useContext, useEffect, useState } from 'react'
import { api, token } from '../lib/api'

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
  }

  // Tras editar nombre/logo del bar en /configuracion, la sesion en memoria
  // queda desactualizada (viene del login, no se recalcula sola): se vuelve a
  // pedir /me para que el sidebar refleje el cambio sin tener que recargar.
  async function refreshSession() {
    const data = await api('/auth/me')
    setSession(data)
  }

  const isAdmin = session?.user.role === 'ADMIN'

  return (
    <AuthContext.Provider value={{ session, loading, login, logout, refreshSession, isAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
