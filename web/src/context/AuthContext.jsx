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

  const isAdmin = session?.user.role === 'ADMIN'

  return (
    <AuthContext.Provider value={{ session, loading, login, logout, isAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
