import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { resizeLogo } from '../lib/image'
import { Icon } from '../components/Icons'
import { useAuth } from '../context/AuthContext'

export default function DatosBar() {
  const navigate = useNavigate()
  const { refreshSession } = useAuth()
  const [tenant, setTenant] = useState(undefined)
  const [saving, setSaving] = useState(false)
  const [subiendoLogo, setSubiendoLogo] = useState(false)
  const [error, setError] = useState('')
  const [guardado, setGuardado] = useState(false)

  useEffect(() => {
    api('/tenant').then(setTenant)
  }, [])

  function set(campo, valor) {
    setTenant((t) => ({ ...t, [campo]: valor }))
  }

  // El logo se sube solo, al elegir el archivo: va a R2 de una vez, no espera
  // al boton Guardar (que solo maneja los campos de texto).
  async function subirLogo(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setSubiendoLogo(true)
    setError('')
    try {
      const webp = await resizeLogo(file)
      const actualizado = await api('/tenant/logo', { method: 'POST', body: { image: webp } })
      setTenant(actualizado)
      await refreshSession()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubiendoLogo(false)
    }
  }

  async function guardar() {
    if (!tenant.name.trim()) return setError('El bar necesita un nombre')
    setError('')
    setSaving(true)
    try {
      await api('/tenant', {
        method: 'PATCH',
        body: {
          name: tenant.name,
          address: tenant.address,
          legalName: tenant.legalName,
          taxId: tenant.taxId,
          taxRegime: tenant.taxRegime,
        },
      })
      await refreshSession()
      setGuardado(true)
      setTimeout(() => setGuardado(false), 2500)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (tenant === undefined) {
    return <div className="p-7 text-muted text-sm">Cargando…</div>
  }

  return (
    <div className="p-5 md:p-7 max-w-[560px] mx-auto space-y-5">
      <button
        onClick={() => navigate('/configuracion')}
        className="text-sm text-muted hover:text-ink flex items-center gap-1.5"
      >
        <Icon.chevronLeft width={16} height={16} />
        Configuración
      </button>

      <header>
        <h1 className="text-2xl font-bold">Datos del bar</h1>
        <p className="text-muted text-sm mt-1">
          Esto aparece en la factura y en el menú lateral. Los datos tributarios son opcionales.
        </p>
      </header>

      {error && (
        <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
          {error}
        </p>
      )}

      <div className="card p-5 space-y-4">
        <div>
          <label className="label">Logo</label>
          <p className="text-xs text-muted mb-2">Máximo 200×70 px. Se convierte a webp automáticamente.</p>
          <div className="flex items-center gap-4">
            <span className="w-[100px] h-[70px] rounded-xl bg-raised border border-edge grid place-items-center overflow-hidden shrink-0">
              {tenant.logoUrl ? (
                <img src={tenant.logoUrl} alt="" className="max-w-full max-h-full object-contain" />
              ) : (
                <span className="w-9 h-9 rounded-lg bg-amber grid place-items-center text-night font-extrabold text-sm">
                  {tenant.name.slice(0, 2).toUpperCase()}
                </span>
              )}
            </span>
            <label className="btn-ghost cursor-pointer">
              {subiendoLogo ? 'Subiendo…' : 'Subir logo'}
              <input type="file" accept="image/*" className="hidden" onChange={subirLogo} disabled={subiendoLogo} />
            </label>
          </div>
        </div>

        <div>
          <label className="label">Nombre del bar</label>
          <input className="field" value={tenant.name} onChange={(e) => set('name', e.target.value)} />
        </div>

        <div>
          <label className="label">Dirección</label>
          <input
            className="field"
            value={tenant.address || ''}
            onChange={(e) => set('address', e.target.value)}
            placeholder="Opcional"
          />
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold">Datos tributarios</h2>
        <p className="text-xs text-muted -mt-2">Si todavía no tienes, déjalos en blanco.</p>

        <div>
          <label className="label">Razón social</label>
          <input
            className="field"
            value={tenant.legalName || ''}
            onChange={(e) => set('legalName', e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">NIT</label>
            <input className="field" value={tenant.taxId || ''} onChange={(e) => set('taxId', e.target.value)} />
          </div>
          <div>
            <label className="label">Régimen</label>
            <input
              className="field"
              value={tenant.taxRegime || ''}
              onChange={(e) => set('taxRegime', e.target.value)}
              placeholder="Ej: régimen simple"
            />
          </div>
        </div>
      </div>

      <button onClick={guardar} disabled={saving} className="btn-primary w-full">
        {saving ? 'Guardando…' : guardado ? 'Guardado ✓' : 'Guardar'}
      </button>
    </div>
  )
}
