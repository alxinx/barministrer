import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { Icon } from '../components/Icons'

const PERMISOS = [
  {
    key: 'cajeroEditaCatalogo',
    titulo: 'Cajero puede editar el catálogo',
    descripcion: 'Categorías, productos y presentaciones. Hoy solo lo toca el administrador.',
  },
  {
    key: 'cajeroGestionaInventario',
    titulo: 'Cajero puede gestionar inventario',
    descripcion: 'Registrar entradas de stock y movimientos.',
  },
  {
    key: 'cajeroGestionaDistribucion',
    titulo: 'Cajero puede mover mesas y zonas',
    descripcion: 'Editar el plano: crear, mover o redimensionar mesas y zonas.',
  },
  {
    key: 'cajeroGestionaUsuarios',
    titulo: 'Cajero puede gestionar usuarios',
    descripcion:
      'Crear, editar y desactivar meseras y cajeros. Nunca puede crear ni tocar otra cuenta de administrador, así se lo active.',
  },
]

export default function Permisos() {
  const navigate = useNavigate()
  const [tenant, setTenant] = useState(undefined)
  const [error, setError] = useState('')

  useEffect(() => {
    api('/tenant').then(setTenant)
  }, [])

  async function alternar(key) {
    const valor = !tenant[key]
    setTenant((t) => ({ ...t, [key]: valor }))
    setError('')
    try {
      await api('/tenant', { method: 'PATCH', body: { [key]: valor } })
    } catch (err) {
      setError(err.message)
      setTenant((t) => ({ ...t, [key]: !valor }))
    }
  }

  if (tenant === undefined) {
    return <div className="p-7 text-muted text-sm">Cargando…</div>
  }

  return (
    <div className="p-5 md:p-7 max-w-[640px] mx-auto space-y-5">
      <button
        onClick={() => navigate('/configuracion')}
        className="text-sm text-muted hover:text-ink flex items-center gap-1.5"
      >
        <Icon.chevronLeft width={16} height={16} />
        Configuración
      </button>

      <header>
        <h1 className="text-2xl font-bold">Permisos</h1>
        <p className="text-muted text-sm mt-1">
          Por defecto, todo esto es solo tuyo. Actívalo únicamente si quieres delegárselo al cajero.
        </p>
      </header>

      {error && (
        <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
          {error}
        </p>
      )}

      <div className="card divide-y divide-edge">
        {PERMISOS.map((p) => (
          <div key={p.key} className="flex items-center gap-4 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{p.titulo}</p>
              <p className="text-xs text-muted mt-0.5">{p.descripcion}</p>
            </div>
            <button
              type="button"
              onClick={() => alternar(p.key)}
              aria-label={p.titulo}
              className={`h-7 w-12 rounded-pill relative transition-colors shrink-0 ${
                tenant[p.key] ? 'bg-amber' : 'bg-raised border border-edge'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full transition-transform ${
                  tenant[p.key] ? 'translate-x-5 bg-night' : 'bg-muted'
                }`}
              />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
