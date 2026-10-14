// Categorias casi no cambian (solo las toca el admin desde /productos), pero
// varias pantallas las piden por su cuenta cada vez que se montan. Un cache en
// memoria por tenant evita repetir esa llamada al rebotar entre pantallas en
// la misma sesion; se invalida a mano justo despues de guardar una categoria.
import { api } from './api'

let cache = null
let cacheTenantId = null

export function getCategories(tenantId) {
  if (cache && cacheTenantId === tenantId) return cache
  cacheTenantId = tenantId
  cache = api('/categories').catch((err) => {
    cache = null
    throw err
  })
  return cache
}

export function invalidateCategories() {
  cache = null
}
