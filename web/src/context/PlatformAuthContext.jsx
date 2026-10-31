import { createContext, useContext, useEffect, useState } from 'react'
import { platformApi, platformToken } from '../lib/platformApi'

const PlatformAuthContext = createContext(null)

export function PlatformAuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!platformToken.get()) return setLoading(false)
    platformApi('/auth/me')
      .then((data) => setSession(data.admin))
      .catch(() => platformToken.clear())
      .finally(() => setLoading(false))
  }, [])

  async function login(email, password) {
    const data = await platformApi('/auth/login', { method: 'POST', body: { email, password } })
    platformToken.set(data.token)
    setSession(data.admin)
  }

  function logout() {
    platformToken.clear()
    setSession(null)
  }

  return (
    <PlatformAuthContext.Provider value={{ session, loading, login, logout }}>
      {children}
    </PlatformAuthContext.Provider>
  )
}

export const usePlatformAuth = () => useContext(PlatformAuthContext)
