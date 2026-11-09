// Cliente separado del de tenant (lib/api.js): token distinto, base distinta
// (/api/platform) y redirige a /plataforma/entrar en vez de /entrar. Nunca
// comparten storage para que cerrar sesion de un lado no toque el otro.
const BASE = import.meta.env.VITE_API_URL || ''

const TOKEN_KEY = 'licorplus.platform.token'

export const platformToken = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

export async function platformApi(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}/api/platform${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(platformToken.get() && { Authorization: `Bearer ${platformToken.get()}` }),
    },
    ...(body && { body: JSON.stringify(body) }),
  })

  if (res.status === 401) {
    platformToken.clear()
    window.location.href = '/plataforma/entrar'
    throw new Error('Sesion expirada')
  }

  if (res.status === 204) return null

  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'No se pudo completar la accion')
  return data
}
