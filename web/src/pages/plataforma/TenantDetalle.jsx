import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { platformApi } from '../../lib/platformApi'
import { money, token } from '../../lib/api'
import { Icon } from '../../components/Icons'

const PERIODO_LABEL = { MENSUAL: 'Mensual', TRIMESTRAL: 'Trimestral', SEMESTRAL: 'Semestral', ANUAL: 'Anual' }

const ROLE_LABEL = { ADMIN: 'Administrador', CAJERO: 'Cajero', MESERO: 'Mesero' }

function formatFecha(iso) {
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Confirmacion de dos pasos para cualquier formateo: resolver una cuenta
// simple + escribir la palabra "confirmar". El backend vuelve a exigir esa
// palabra en el body (ver exigirConfirmacion en routes/platform.js) -- esto
// de aqui es para que a nadie se le vaya el dedo con un click de mas, no la
// unica barrera.
function ModalConfirmacionFormateo({ titulo, descripcion, textoBoton, onConfirmar, onCancelar, ejecutando, error }) {
  const [a] = useState(() => 1 + Math.floor(Math.random() * 8))
  const [b] = useState(() => 1 + Math.floor(Math.random() * 8))
  const [respuesta, setRespuesta] = useState('')
  const [palabra, setPalabra] = useState('')

  const listo = Number(respuesta) === a + b && palabra.trim().toLowerCase() === 'confirmar'

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => !ejecutando && onCancelar()}>
      <div className="card w-full max-w-md p-6 space-y-4 border-ocupada/30" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-ocupada">{titulo}</h2>
        <p className="text-sm text-muted">{descripcion}</p>

        <div>
          <label className="label">¿Cuánto es {a} + {b}?</label>
          <input
            className="field font-mono"
            inputMode="numeric"
            value={respuesta}
            onChange={(e) => setRespuesta(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className="label">
            Escribe <span className="font-mono text-ink">confirmar</span>
          </label>
          <input className="field font-mono" value={palabra} onChange={(e) => setPalabra(e.target.value)} />
        </div>

        {error && (
          <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">{error}</p>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button type="button" className="btn-ghost flex-1" onClick={onCancelar} disabled={ejecutando}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn-danger flex-1"
            onClick={() => onConfirmar(palabra)}
            disabled={!listo || ejecutando}
          >
            {ejecutando ? 'Un momento…' : textoBoton}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TenantDetalle() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [tenant, setTenant] = useState(null)
  const [plans, setPlans] = useState(null)
  const [name, setName] = useState('')
  const [rentalPlanId, setRentalPlanId] = useState('')
  const [saving, setSaving] = useState(false)
  const [guardado, setGuardado] = useState(false)
  const [error, setError] = useState('')
  const [userBusyId, setUserBusyId] = useState(null)
  const [confirmando, setConfirmando] = useState(false)
  const [togglingActive, setTogglingActive] = useState(false)
  const [eliminando, setEliminando] = useState(false)
  const [confirmSlug, setConfirmSlug] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [entrando, setEntrando] = useState(false)
  const [togglingModulo, setTogglingModulo] = useState(false)

  // Formateo: 'todo' y 'movimientos' van directo a confirmar. 'productos' es
  // un flujo propio (elegir categorias -> ver preview -> elegir que hacer
  // con lo que tiene historial -> confirmar), asi que confirmando guarda
  // cual de los tres se esta por ejecutar (o null) y prodSeleccion/prodPreview
  // solo aplican a ese ultimo.
  const [confirmandoFormateo, setConfirmandoFormateo] = useState(null) // 'todo' | 'movimientos' | 'productos' | null
  const [formateando, setFormateando] = useState(false)
  const [errorFormateo, setErrorFormateo] = useState('')
  const [formateoOk, setFormateoOk] = useState('')
  const [prodSeleccion, setProdSeleccion] = useState({ productos: false, insumos: false, recetas: false })
  const [prodPreview, setProdPreview] = useState(null)
  const [prodModo, setProdModo] = useState('conservar')
  const [cargandoPreview, setCargandoPreview] = useState(false)
  const [errorPreview, setErrorPreview] = useState('')
  // Papelera de productos (ver Product.deletedAt): solo plataforma la ve y
  // puede restaurar de ahi -- ni siquiera el ADMIN del propio bar llega a
  // esto desde /productos, a proposito (ver permiteEliminarProductos arriba).
  const [productosEliminados, setProductosEliminados] = useState([])
  const [restaurandoId, setRestaurandoId] = useState(null)
  const [restaurado, setRestaurado] = useState('')

  async function cargar() {
    try {
      const [t, p, pe] = await Promise.all([
        platformApi(`/tenants/${id}`),
        platformApi('/rental-plans'),
        platformApi(`/tenants/${id}/productos-eliminados`),
      ])
      setTenant(t)
      setPlans(p)
      setName(t.name)
      setRentalPlanId(t.rentalPlan?.id || '')
      setProductosEliminados(pe)
    } catch (err) {
      setError(err.message)
    }
  }

  async function restaurarProducto(productId) {
    setRestaurandoId(productId)
    setError('')
    try {
      await platformApi(`/tenants/${id}/productos-eliminados/${productId}/restaurar`, { method: 'POST' })
      setProductosEliminados((prev) => prev.filter((p) => p.id !== productId))
      setRestaurado('Restaurado como suspendido: el admin del bar lo reactiva cuando quiera desde /productos.')
      setTimeout(() => setRestaurado(''), 5000)
    } catch (err) {
      setError(err.message)
    } finally {
      setRestaurandoId(null)
    }
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function guardar(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setGuardado(false)
    try {
      const updated = await platformApi(`/tenants/${id}`, {
        method: 'PATCH',
        body: { name, rentalPlanId: rentalPlanId || null },
      })
      setTenant((t) => ({ ...t, name: updated.name, rentalPlan: updated.rentalPlan }))
      setGuardado(true)
      setTimeout(() => setGuardado(false), 2000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Suspender apaga tenant.active: requireAuth y /auth/login lo revisan en
  // cada request (ver middleware/auth.js), asi que esto corta el acceso de
  // TODOS los usuarios del bar de una, sin tener que desactivarlos uno a
  // uno. Reactivar es el mismo toggle al reves.
  async function confirmarSuspension() {
    setTogglingActive(true)
    setError('')
    try {
      const updated = await platformApi(`/tenants/${id}`, { method: 'PATCH', body: { active: !tenant.active } })
      setTenant((t) => ({ ...t, active: updated.active }))
      setConfirmando(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setTogglingActive(false)
    }
  }

  // A diferencia de suspender, esto borra el bar de verdad (catalogo, plano,
  // turnos, pedidos, todo) por cascada de FK. No hay vuelta atras, por eso
  // exige escribir el slug exacto -- el backend lo vuelve a revisar, esto no
  // es solo una proteccion visual.
  async function confirmarEliminacion() {
    setDeleting(true)
    setDeleteError('')
    try {
      await platformApi(`/tenants/${id}`, { method: 'DELETE', body: { confirmSlug } })
      navigate('/plataforma')
    } catch (err) {
      setDeleteError(err.message)
    } finally {
      setDeleting(false)
    }
  }

  // Abre el panel del bar en otra pestaña con la sesion de su ADMIN (control
  // real, no solo lectura). setForNewTab (ver lib/api.js) pasa el token por
  // sessionStorage, no localStorage: asi esta pestaña nueva arranca con su
  // propia sesion sin pisar la de ninguna otra pestaña con otro tenant que ya
  // estuviera abierta (ese era el bug: abrir un segundo bar hacia que el
  // primero terminara mostrando los datos y el tema del segundo).
  async function entrarAlPanel() {
    setEntrando(true)
    setError('')
    try {
      const { token: tenantToken } = await platformApi(`/tenants/${id}/impersonate`, { method: 'POST' })
      token.setForNewTab(tenantToken)
      window.open('/', '_blank')
    } catch (err) {
      setError(err.message)
    } finally {
      setEntrando(false)
    }
  }

  // Modulos activables: solo plataforma los prende/apaga segun lo que el bar
  // pago o solicito (ver Tenant.moduloCajasBancos). El ADMIN del bar nunca
  // puede tocar esto desde su propia /configuracion.
  async function toggleModulo(campo) {
    setTogglingModulo(true)
    setError('')
    try {
      const updated = await platformApi(`/tenants/${id}`, { method: 'PATCH', body: { [campo]: !tenant[campo] } })
      setTenant((t) => ({ ...t, [campo]: updated[campo] }))
    } catch (err) {
      setError(err.message)
    } finally {
      setTogglingModulo(false)
    }
  }

  async function verPreviewProductos() {
    setCargandoPreview(true)
    setErrorPreview('')
    setProdPreview(null)
    try {
      const params = new URLSearchParams()
      if (prodSeleccion.productos) params.set('productos', '1')
      if (prodSeleccion.insumos) params.set('insumos', '1')
      if (prodSeleccion.recetas) params.set('recetas', '1')
      const preview = await platformApi(`/tenants/${id}/formatear/productos/preview?${params}`)
      setProdPreview(preview)
      setProdModo('conservar')
    } catch (err) {
      setErrorPreview(err.message)
    } finally {
      setCargandoPreview(false)
    }
  }

  async function ejecutarFormateo(confirmPalabra) {
    setFormateando(true)
    setErrorFormateo('')
    try {
      if (confirmandoFormateo === 'todo') {
        await platformApi(`/tenants/${id}/formatear/todo`, { method: 'POST', body: { confirmPalabra } })
        setFormateoOk('Se formateó todo el bar. El plano, los usuarios y los datos del negocio quedaron intactos.')
      } else if (confirmandoFormateo === 'movimientos') {
        await platformApi(`/tenants/${id}/formatear/movimientos`, { method: 'POST', body: { confirmPalabra } })
        setFormateoOk('Se formatearon los movimientos. El catálogo, los clientes y las cuentas quedaron intactos.')
      } else if (confirmandoFormateo === 'productos') {
        await platformApi(`/tenants/${id}/formatear/productos`, {
          method: 'POST',
          body: { ...prodSeleccion, modo: prodModo, confirmPalabra },
        })
        setFormateoOk('Se formatearon los productos/insumos/recetas elegidos.')
        setProdSeleccion({ productos: false, insumos: false, recetas: false })
        setProdPreview(null)
      }
      setConfirmandoFormateo(null)
      setTimeout(() => setFormateoOk(''), 5000)
    } catch (err) {
      setErrorFormateo(err.message)
    } finally {
      setFormateando(false)
    }
  }

  async function toggleUsuario(u) {
    setUserBusyId(u.id)
    setError('')
    try {
      await platformApi(`/tenants/${id}/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } })
      cargar()
    } catch (err) {
      setError(err.message)
    } finally {
      setUserBusyId(null)
    }
  }

  // Soporte: segun si el usuario ya esta bloqueado (ver estadoPin en
  // api/src/middleware/rateLimit.js, viene en u.bloqueado desde /tenants/:id),
  // levanta el bloqueo de 10 minutos por PINs incorrectos para que pueda
  // volver a intentar de inmediato, o lo fuerza a mano (ej. sospecha de que
  // alguien esta probando PINs ajenos). Recarga despues para reflejar el
  // estado real que quedo en el servidor, no uno optimista local.
  async function togglePin(u) {
    setUserBusyId(u.id)
    setError('')
    try {
      const accion = u.bloqueado ? 'reset-pin-lock' : 'lock-pin'
      await platformApi(`/tenants/${id}/users/${u.id}/${accion}`, { method: 'POST' })
      await cargar()
    } catch (err) {
      setError(err.message)
    } finally {
      setUserBusyId(null)
    }
  }

  if (!tenant) {
    return (
      <div className="p-10">
        {error ? (
          <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
            {error}
          </p>
        ) : (
          <p className="text-muted text-sm">Cargando…</p>
        )}
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <button
          type="button"
          onClick={() => navigate('/plataforma')}
          className="text-sm text-muted hover:text-ink mb-5 flex items-center gap-1"
        >
          <Icon.chevronLeft width={14} height={14} />
          Bares
        </button>

        <div className="flex items-center gap-3 mb-8">
          <span className="w-12 h-12 rounded-xl bg-raised border border-edge grid place-items-center shrink-0 text-amberText font-bold text-lg">
            {tenant.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              {tenant.name}
              {tenant.active ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-libre border border-libre/40 bg-libre/10 rounded-pill px-2 py-0.5">
                  <Icon.check width={10} height={10} />
                  Activo
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-ocupada border border-ocupada/40 bg-ocupada/10 rounded-pill px-2 py-0.5">
                  Suspendido
                </span>
              )}
            </h1>
            <p className="text-sm text-muted mt-0.5">
              {tenant.slug} · creado {formatFecha(tenant.createdAt)}
            </p>
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={entrarAlPanel}
            disabled={entrando || !tenant.active}
            title={!tenant.active ? 'Reactiva el plan para poder entrar' : undefined}
          >
            {entrando ? 'Entrando…' : 'Entrar al panel'}
          </button>
          <button
            type="button"
            className={tenant.active ? 'btn-danger' : 'btn-ghost'}
            onClick={() => setConfirmando(true)}
          >
            {tenant.active ? 'Suspender plan' : 'Reactivar plan'}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-8">
          <div className="card p-4">
            <p className="text-xs text-muted">Usuarios creados</p>
            <p className="text-2xl font-bold mt-1">{tenant.userCount}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-muted">Uso esta semana</p>
            <p className="text-2xl font-bold mt-1">{tenant.diasActivosSemana} de 7 dias</p>
          </div>
        </div>

        <form onSubmit={guardar} className="card p-5 space-y-4 mb-8">
          <h2 className="font-semibold">Datos del bar</h2>
          <div>
            <label className="label">Nombre</label>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <label className="label">Plan de renta</label>
            <select className="field" value={rentalPlanId} onChange={(e) => setRentalPlanId(e.target.value)}>
              <option value="">Sin plan asignado</option>
              {plans?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {money(p.price)} · {PERIODO_LABEL[p.period]}
                  {!p.active ? ' (inactivo)' : ''}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Guardando…' : guardado ? 'Guardado ✓' : 'Guardar cambios'}
          </button>
        </form>

        <div className="card p-5">
          <h2 className="font-semibold mb-4">Usuarios del bar</h2>
          <div className="space-y-1">
            {tenant.users.map((u) => (
              <div key={u.id} className="flex items-center gap-3 py-2.5 border-b border-edge/60 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium flex items-center gap-2">
                    {u.name}
                    {!u.active && (
                      <span className="inline-flex items-center text-[10px] font-bold text-muted border border-edge bg-raised rounded-pill px-2 py-0.5">
                        Inactivo
                      </span>
                    )}
                    {u.bloqueado && (
                      <span className="inline-flex items-center text-[10px] font-bold text-ocupada border border-ocupada/40 bg-ocupada/10 rounded-pill px-2 py-0.5">
                        PIN bloqueado · {Math.ceil(u.segundosRestantes / 60)} min
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted mt-0.5">
                    {u.email} · {ROLE_LABEL[u.role]}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => togglePin(u)}
                  disabled={userBusyId === u.id}
                  title={
                    u.bloqueado
                      ? 'Levanta el bloqueo para que pueda intentar de nuevo ya mismo'
                      : 'Bloquea el PIN de este usuario por 10 minutos (ej. sospecha de que alguien esta probando PINs ajenos)'
                  }
                >
                  {u.bloqueado ? 'Desbloquear PIN' : 'Bloquear PIN'}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => toggleUsuario(u)}
                  disabled={userBusyId === u.id}
                >
                  {u.active ? 'Desactivar' : 'Activar'}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5 mt-8">
          <h2 className="font-semibold mb-1">Módulos</h2>
          <p className="text-sm text-muted mb-4">
            Funcionalidades que este bar tiene contratadas. El administrador del bar no puede prenderlas ni
            apagarlas desde su propia configuración.
          </p>
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium">Cajas y bancos</p>
              <p className="text-xs text-muted mt-0.5">Cajas virtuales, bancos/billeteras, traslados y egresos de dinero</p>
            </div>
            <button
              type="button"
              className={tenant.moduloCajasBancos ? 'btn-primary' : 'btn-ghost'}
              onClick={() => toggleModulo('moduloCajasBancos')}
              disabled={togglingModulo}
            >
              {tenant.moduloCajasBancos ? 'Activado' : 'Desactivado'}
            </button>
          </div>
          <div className="flex items-center justify-between py-2 border-t border-edge mt-2 pt-4">
            <div>
              <p className="text-sm font-medium">Compras y proveedores</p>
              <p className="text-xs text-muted mt-0.5">Registrar compras de insumos, recibir mercancía y cuentas por pagar</p>
            </div>
            <button
              type="button"
              className={tenant.moduloCompras ? 'btn-primary' : 'btn-ghost'}
              onClick={() => toggleModulo('moduloCompras')}
              disabled={togglingModulo}
            >
              {tenant.moduloCompras ? 'Activado' : 'Desactivado'}
            </button>
          </div>
          <div className="flex items-center justify-between py-2 border-t border-edge mt-2 pt-4">
            <div>
              <p className="text-sm font-medium">Eliminar productos</p>
              <p className="text-xs text-muted mt-0.5">
                Deja que el ADMIN del bar elimine un producto del todo (no solo suspenderlo). Solo plataforma
                puede restaurarlo después.
              </p>
            </div>
            <button
              type="button"
              className={tenant.permiteEliminarProductos ? 'btn-primary' : 'btn-ghost'}
              onClick={() => toggleModulo('permiteEliminarProductos')}
              disabled={togglingModulo}
            >
              {tenant.permiteEliminarProductos ? 'Activado' : 'Desactivado'}
            </button>
          </div>
        </div>

        {productosEliminados.length > 0 && (
          <div className="card p-5 mt-8">
            <h2 className="font-semibold mb-1">Productos eliminados</h2>
            <p className="text-sm text-muted mb-4">
              El ADMIN del bar ya no los ve en /productos. Restaurarlos los devuelve suspendidos, no activos: el
              bar decide reactivarlos cuando quiera.
            </p>

            {restaurado && (
              <p className="text-sm text-libre border border-libre/30 bg-libre/10 rounded-xl px-3 py-2.5 mb-4">
                {restaurado}
              </p>
            )}

            <div className="space-y-1">
              {productosEliminados.map((p) => (
                <div key={p.id} className="flex items-center gap-3 py-2.5 border-b border-edge/60 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-muted mt-0.5">
                      {p.category} · eliminado {formatFecha(p.deletedAt)}
                      {p.deletedBy ? ` por ${p.deletedBy}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost shrink-0"
                    onClick={() => restaurarProducto(p.id)}
                    disabled={restaurandoId === p.id}
                  >
                    {restaurandoId === p.id ? 'Restaurando…' : 'Restaurar'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="card p-5 mt-8 border-amber/30">
          <h2 className="font-semibold">Formatear datos</h2>
          <p className="text-sm text-muted mt-1 mb-4">
            Borra datos operativos de {tenant.name} sin tocar el bar en sí: nunca afecta a los demás bares, nunca
            borra usuarios ni los datos del negocio (nombre, logo, configuración), y nunca borra el plano (mesas y
            zonas).
          </p>

          {formateoOk && (
            <p className="text-sm text-libre border border-libre/30 bg-libre/10 rounded-xl px-3 py-2.5 mb-4">
              {formateoOk}
            </p>
          )}
          {errorFormateo && !confirmandoFormateo && (
            <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5 mb-4">
              {errorFormateo}
            </p>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between py-2 border-b border-edge/60">
              <div>
                <p className="text-sm font-medium">1. Formatear todo</p>
                <p className="text-xs text-muted mt-0.5">
                  Ventas, turnos, inventario, catálogo, compras, caja, clientes — todo lo operativo.
                </p>
              </div>
              <button
                type="button"
                className="btn-danger shrink-0"
                onClick={() => {
                  setErrorFormateo('')
                  setConfirmandoFormateo('todo')
                }}
              >
                Formatear todo
              </button>
            </div>

            <div className="py-3 border-b border-edge/60">
              <p className="text-sm font-medium">2. Formatear productos</p>
              <p className="text-xs text-muted mt-0.5 mb-3">Elige qué parte del catálogo quieres vaciar.</p>
              <div className="flex flex-wrap gap-4 mb-3">
                {[
                  ['productos', 'Todos los productos'],
                  ['insumos', 'Todos los insumos'],
                  ['recetas', 'Todas las recetas'],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={prodSeleccion[key]}
                      onChange={(e) => {
                        setProdSeleccion((s) => ({ ...s, [key]: e.target.checked }))
                        setProdPreview(null)
                      }}
                    />
                    {label}
                  </label>
                ))}
              </div>

              <button
                type="button"
                className="btn-ghost text-sm"
                onClick={verPreviewProductos}
                disabled={
                  cargandoPreview || (!prodSeleccion.productos && !prodSeleccion.insumos && !prodSeleccion.recetas)
                }
              >
                {cargandoPreview ? 'Revisando…' : 'Ver qué se va a borrar'}
              </button>

              {errorPreview && <p className="text-sm text-ocupada mt-2">{errorPreview}</p>}

              {prodPreview && (
                <div className="mt-3 p-4 rounded-lg bg-raised border border-edge space-y-3">
                  {prodPreview.productos && (
                    <p className="text-sm">
                      <strong>Productos:</strong> {prodPreview.productos.libres} sin historial (se borran siempre),{' '}
                      {prodPreview.productos.conHistorial} con historial.
                    </p>
                  )}
                  {prodPreview.insumos && (
                    <p className="text-sm">
                      <strong>Insumos:</strong> {prodPreview.insumos.libres} sin historial (se borran siempre),{' '}
                      {prodPreview.insumos.conHistorial} con historial.
                    </p>
                  )}
                  {prodPreview.recetas && (
                    <p className="text-sm">
                      <strong>Recetas:</strong> {prodPreview.recetas.libres} sin historial (se borran siempre),{' '}
                      {prodPreview.recetas.conHistorial} con historial.
                    </p>
                  )}

                  {(() => {
                    const totalConHistorial =
                      (prodPreview.productos?.conHistorial || 0) +
                      (prodPreview.insumos?.conHistorial || 0) +
                      (prodPreview.recetas?.conHistorial || 0)
                    const ordenes = (prodPreview.productos?.ordenesAfectadas || 0) + (prodPreview.recetas?.ordenesAfectadas || 0)
                    const compras = (prodPreview.productos?.comprasAfectadas || 0) + (prodPreview.insumos?.comprasAfectadas || 0)
                    if (totalConHistorial === 0) return null
                    return (
                      <div className="pt-2 border-t border-edge space-y-2">
                        <p className="text-sm text-muted">
                          {totalConHistorial} elemento(s) ya tienen una venta, una compra o una receta enganchada.
                          ¿Qué hacer con ellos?
                        </p>
                        <label className="flex items-start gap-2 text-sm cursor-pointer">
                          <input
                            type="radio"
                            name="prodModo"
                            checked={prodModo === 'conservar'}
                            onChange={() => setProdModo('conservar')}
                            className="mt-0.5"
                          />
                          <span>Conservar su historial (se saltan, solo se borra lo nunca usado)</span>
                        </label>
                        <label className="flex items-start gap-2 text-sm cursor-pointer">
                          <input
                            type="radio"
                            name="prodModo"
                            checked={prodModo === 'borrar'}
                            onChange={() => setProdModo('borrar')}
                            className="mt-0.5"
                          />
                          <span>
                            Borrar todo — también borra {ordenes} pedido(s) y {compras} compra(s) COMPLETOS (con
                            todas sus otras líneas), no solo la línea de este producto/insumo/receta
                          </span>
                        </label>
                      </div>
                    )
                  })()}

                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => {
                      setErrorFormateo('')
                      setConfirmandoFormateo('productos')
                    }}
                  >
                    Formatear lo elegido
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium">3. Formatear movimientos</p>
                <p className="text-xs text-muted mt-0.5">
                  Ventas, turnos, compras y movimientos financieros. El catálogo, los clientes y las cuentas quedan
                  intactos (el stock en cache vuelve a 0).
                </p>
              </div>
              <button
                type="button"
                className="btn-danger shrink-0"
                onClick={() => {
                  setErrorFormateo('')
                  setConfirmandoFormateo('movimientos')
                }}
              >
                Formatear movimientos
              </button>
            </div>
          </div>
        </div>

        <div className="card p-5 mt-8 border-ocupada/30">
          <h2 className="font-semibold text-ocupada">Zona peligrosa</h2>
          <p className="text-sm text-muted mt-1 mb-4">
            Borra {tenant.name} por completo: catalogo, plano, turnos, pedidos, todo. No se puede deshacer.
          </p>
          <button
            type="button"
            className="btn-danger"
            onClick={() => {
              setConfirmSlug('')
              setDeleteError('')
              setEliminando(true)
            }}
          >
            Eliminar bar definitivamente
          </button>
        </div>
      </div>

      {confirmando && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => !togglingActive && setConfirmando(false)}
        >
          <div className="card w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold">{tenant.active ? 'Suspender plan' : 'Reactivar plan'}</h2>
            <p className="text-sm text-muted">
              {tenant.active
                ? `Nadie en ${tenant.name} va a poder entrar al sistema hasta que reactives el plan, ni siquiera el administrador. Las ventas ya cerradas y los datos no se tocan.`
                : `${tenant.name} vuelve a poder entrar normalmente, con los mismos usuarios y datos de antes.`}
            </p>
            <div className="flex items-center gap-3 pt-1">
              <button type="button" className="btn-ghost flex-1" onClick={() => setConfirmando(false)} disabled={togglingActive}>
                Cancelar
              </button>
              <button
                type="button"
                className={tenant.active ? 'btn-danger flex-1' : 'btn-primary flex-1'}
                onClick={confirmarSuspension}
                disabled={togglingActive}
              >
                {togglingActive ? 'Un momento…' : tenant.active ? 'Si, suspender' : 'Si, reactivar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmandoFormateo && (
        <ModalConfirmacionFormateo
          titulo={
            confirmandoFormateo === 'todo'
              ? `Formatear todo en ${tenant.name}`
              : confirmandoFormateo === 'movimientos'
              ? `Formatear movimientos en ${tenant.name}`
              : `Formatear productos en ${tenant.name}`
          }
          descripcion={
            confirmandoFormateo === 'todo'
              ? 'Esto borra todas las ventas, turnos, inventario, catálogo, compras, caja y clientes de este bar. No hay forma de recuperarlo. El plano, los usuarios y los datos del negocio quedan intactos.'
              : confirmandoFormateo === 'movimientos'
              ? 'Esto borra todas las ventas, turnos, compras y movimientos financieros de este bar. No hay forma de recuperarlo. El catálogo, los clientes y las cuentas quedan intactos.'
              : prodModo === 'borrar'
              ? 'Esto borra lo elegido Y los pedidos/compras completos que lo referencian. No hay forma de recuperarlo.'
              : 'Esto borra lo elegido que nunca se usó. Lo que ya tiene historial se conserva intacto.'
          }
          textoBoton={confirmandoFormateo === 'todo' ? 'Formatear todo' : 'Formatear'}
          onConfirmar={(palabra) => ejecutarFormateo(palabra)}
          onCancelar={() => !formateando && setConfirmandoFormateo(null)}
          ejecutando={formateando}
          error={errorFormateo}
        />
      )}

      {eliminando && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => !deleting && setEliminando(false)}
        >
          <div className="card w-full max-w-sm p-6 space-y-4 border-ocupada/30" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-ocupada">Eliminar {tenant.name} definitivamente</h2>
            <p className="text-sm text-muted">
              Esto borra el catalogo, el plano, los turnos, los pedidos y los usuarios de este bar. No hay forma de
              recuperarlo despues, ni siquiera desde la base de datos.
            </p>
            <div>
              <label className="label">
                Escribe <span className="font-mono text-ink">{tenant.slug}</span> para confirmar
              </label>
              <input
                className="field font-mono"
                value={confirmSlug}
                onChange={(e) => setConfirmSlug(e.target.value)}
                autoFocus
              />
            </div>

            {deleteError && (
              <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
                {deleteError}
              </p>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                className="btn-ghost flex-1"
                onClick={() => setEliminando(false)}
                disabled={deleting}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-danger flex-1"
                onClick={confirmarEliminacion}
                disabled={deleting || confirmSlug !== tenant.slug}
              >
                {deleting ? 'Eliminando…' : 'Eliminar definitivamente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
