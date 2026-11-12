// Ruta relativa: el dev server la reenvia a la API (ver proxy en vite.config.js).
// Si se fija VITE_API_URL explicitamente (ej. una build de produccion sin ese
// proxy), esa URL absoluta gana.
const BASE = import.meta.env.VITE_API_URL || ''

const TOKEN_KEY = 'licorplus.token'

// localStorage es por origen, no por pestaña: por eso el login normal lo usa
// (el celular de la caja queda logueado todo el dia aunque se recargue o se
// reinicie el navegador). Pero por esa misma razon, escribir ahi la sesion
// de un tenant distinto (ver plataforma/tenants/:id "Entrar al panel")
// pisaria la sesion de CUALQUIER otra pestaña con otro tenant ya abierta en
// el mismo navegador -- eso fue el bug: abrir el panel de un segundo bar
// hacia que el primero, en su propia pestaña, terminara mostrando los datos
// (y el tema) del segundo en su siguiente peticion.
//
// get() revisa primero sessionStorage, que SI es por pestaña, con una
// excepcion: una pestaña nueva abierta con window.open() desde el mismo
// origen arranca con una COPIA del sessionStorage de quien la abrio en ese
// instante, que de ahi en adelante queda independiente (no se vuelve a
// compartir ni hacia adelante ni hacia atras). setForNewTab() usa eso a
// proposito para que cada "Entrar al panel" le pase su propio token solo a
// la pestaña que abre, sin tocar la sesion de la pestaña actual ni la de
// ninguna otra ya abierta.
export const token = {
  get: () => sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY),
  set: (t) => {
    sessionStorage.removeItem(TOKEN_KEY)
    localStorage.setItem(TOKEN_KEY, t)
  },
  setForNewTab: (t) => sessionStorage.setItem(TOKEN_KEY, t),
  clear: () => {
    sessionStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(TOKEN_KEY)
  },
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

  // 202 con queued:true viene del agente offline cuando encoló la mutación.
  // Se trata como un error para que el caller no use datos inexistentes
  // (ej. data.id undefined), pero con err.queued=true para que la UI pueda
  // mostrar un aviso ambar en vez de rojo — la operación SÍ fue guardada.
  if (res.status === 202 && data?.queued) {
    const err = new Error(
      data.message || 'Sin conexión. La operación fue guardada y se enviará al reconectar.',
    )
    err.queued = true
    err.offline = true
    err.status = 202
    throw err
  }

  if (!res.ok) {
    // El status y el resto del body (ej. segundosRestantes del bloqueo de
    // PIN) viajan con el error para quien los necesite distinguir de un
    // error generico, sin que cada caller tenga que repetir el fetch.
    const err = new Error(data.error || 'No se pudo completar la accion')
    err.status = res.status
    Object.assign(err, data)
    throw err
  }
  return data
}

export const money = (value) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0)
