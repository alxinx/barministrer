import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { platformApi } from '../../lib/platformApi'
import { usePlatformAuth } from '../../context/PlatformAuthContext'
import { Icon } from '../../components/Icons'

function slugify(v) {
  return v
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function formatFecha(iso) {
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function Panel() {
  const { session, logout } = usePlatformAuth()
  const [tenants, setTenants] = useState(null)
  const [error, setError] = useState('')
  const [creando, setCreando] = useState(false)

  async function cargar() {
    try {
      setTenants(await platformApi('/tenants'))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    cargar()
  }, [])

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between gap-3 mb-8">
          <div>
            <h1 className="text-2xl font-bold">Bares en la plataforma</h1>
            <p className="text-sm text-muted mt-1">Conectado como {session?.name}</p>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/plataforma/tarifas" className="btn-ghost">
              Tarifas de renta
            </Link>
            <button type="button" className="btn-primary" onClick={() => setCreando(true)}>
              <Icon.plus width={16} height={16} />
              Nuevo bar
            </button>
            <button type="button" className="btn-ghost" onClick={logout}>
              Salir
            </button>
          </div>
        </div>

        {error && (
          <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5 mb-5">
            {error}
          </p>
        )}

        {tenants === null && !error && <p className="text-muted text-sm">Cargando…</p>}
        {tenants?.length === 0 && <p className="text-muted text-sm">Todavia no hay ningun bar creado.</p>}

        <div className="space-y-3">
          {tenants?.map((t) => (
            <Link
              key={t.id}
              to={`/plataforma/tenants/${t.id}`}
              className="card p-4 flex items-center gap-4 hover:border-amber/40 transition-colors"
            >
              <span className="w-11 h-11 rounded-xl bg-raised border border-edge grid place-items-center shrink-0 text-amberText font-bold">
                {t.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold flex items-center gap-2">
                  {t.name}
                  {t.active ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-libre border border-libre/40 bg-libre/10 rounded-pill px-2 py-0.5">
                      <Icon.check width={10} height={10} />
                      Activo
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-ocupada border border-ocupada/40 bg-ocupada/10 rounded-pill px-2 py-0.5">
                      Inactivo
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted mt-0.5">
                  {t.slug} · creado {formatFecha(t.createdAt)}
                  {t.rentalPlan ? ` · ${t.rentalPlan.name}` : ' · sin plan'}
                </p>
              </div>
              <span className="flex items-center gap-1.5 text-sm text-muted shrink-0">
                <Icon.users width={15} height={15} />
                {t.userCount}
              </span>
            </Link>
          ))}
        </div>
      </div>

      {creando && (
        <NuevoTenantModal
          onClose={() => setCreando(false)}
          onCreado={() => {
            setCreando(false)
            cargar()
          }}
        />
      )}
    </div>
  )
}

function NuevoTenantModal({ onClose, onCreado }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTocado, setSlugTocado] = useState(false)
  const [adminName, setAdminName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminPin, setAdminPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function cambiarNombre(v) {
    setName(v)
    if (!slugTocado) setSlug(slugify(v))
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await platformApi('/tenants', {
        method: 'POST',
        body: { name, slug, adminName, adminEmail, adminPassword, adminPin },
      })
      onCreado()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-md p-6 space-y-5 max-h-[90vh] overflow-y-auto"
      >
        <div>
          <h2 className="text-lg font-bold">Nuevo bar</h2>
          <p className="text-sm text-muted mt-1">Crea el tenant y su primer administrador en un solo paso.</p>
        </div>

        <div className="space-y-4">
          <p className="text-xs font-bold text-muted uppercase tracking-wider">Datos del bar</p>
          <div>
            <label className="label">Nombre</label>
            <input
              className="field"
              value={name}
              onChange={(e) => cambiarNombre(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div>
            <label className="label">Slug</label>
            <input
              className="field font-mono"
              value={slug}
              onChange={(e) => {
                setSlugTocado(true)
                setSlug(e.target.value)
              }}
              placeholder="bar-la-fama"
              required
            />
          </div>
        </div>

        <div className="space-y-4 pt-1 border-t border-edge">
          <p className="text-xs font-bold text-muted uppercase tracking-wider pt-4">Primer administrador</p>
          <div>
            <label className="label">Nombre</label>
            <input className="field" value={adminName} onChange={(e) => setAdminName(e.target.value)} required />
          </div>
          <div>
            <label className="label">Correo</label>
            <input
              type="email"
              className="field"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Clave</label>
              <input
                type="password"
                className="field"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <div>
              <label className="label">PIN (5 digitos)</label>
              <input
                className="field font-mono"
                inputMode="numeric"
                value={adminPin}
                onChange={(e) => setAdminPin(e.target.value.replace(/\D/g, '').slice(0, 5))}
                required
                maxLength={5}
              />
            </div>
          </div>
        </div>

        {error && (
          <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button type="button" className="btn-ghost flex-1" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary flex-1" disabled={busy}>
            {busy ? 'Creando…' : 'Crear bar'}
          </button>
        </div>
      </form>
    </div>
  )
}
