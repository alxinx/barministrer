const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000'

const TOKEN_KEY = 'licorplus.token'

export const token = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token.get() && { Authorization: `Bearer ${token.get()}` }),
    },
    ...(body && { body: JSON.stringify(body) }),
  })

  if (res.status === 401) {
    token.clear()
    window.location.href = '/entrar'
    throw new Error('Sesion expirada')
  }

  if (res.status === 204) return null

  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'No se pudo completar la accion')
  return data
}

export const money = (value) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0)
