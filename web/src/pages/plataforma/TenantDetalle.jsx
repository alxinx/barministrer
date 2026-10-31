import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { platformApi } from '../../lib/platformApi'
import { money } from '../../lib/api'
import { Icon } from '../../components/Icons'

const PERIODO_LABEL = { MENSUAL: 'Mensual', TRIMESTRAL: 'Trimestral', SEMESTRAL: 'Semestral', ANUAL: 'Anual' }

const ROLE_LABEL = { ADMIN: 'Administrador', CAJERO: 'Cajero', MESERO: 'Mesero' }

function formatFecha(iso) {
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
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

  async function cargar() {
    try {
      const [t, p] = await Promise.all([platformApi(`/tenants/${id}`), platformApi('/rental-plans')])
      setTenant(t)
      setPlans(p)
      setName(t.name)
      setRentalPlanId(t.rentalPlan?.id || '')
    } catch (err) {
      setError(err.message)
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
                  </p>
                  <p className="text-xs text-muted mt-0.5">
                    {u.email} · {ROLE_LABEL[u.role]}
                  </p>
                </div>
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
