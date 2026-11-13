import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { platformApi } from '../../lib/platformApi'
import { Icon } from '../../components/Icons'

function formatFecha(iso) {
  return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatTamano(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

// Lista + "hacer backup ahora": el backup diario automatico (ver
// despliegue.md, seccion "Backup diario") y el manual de este boton
// terminan en el mismo bucket privado de R2, asi que salen juntos en una
// sola lista -- el badge distingue de donde salio cada uno.
export default function Backups() {
  const navigate = useNavigate()
  const [backups, setBackups] = useState(null)
  const [error, setError] = useState('')
  const [generando, setGenerando] = useState(false)

  async function cargar() {
    try {
      setError('')
      setBackups(await platformApi('/backups'))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    cargar()
  }, [])

  async function hacerBackupAhora() {
    setGenerando(true)
    setError('')
    try {
      await platformApi('/backups', { method: 'POST' })
      await cargar()
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerando(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between gap-3 mb-8">
          <div>
            <button
              type="button"
              onClick={() => navigate('/plataforma')}
              className="text-sm text-muted hover:text-ink mb-2 flex items-center gap-1"
            >
              <Icon.chevronLeft width={14} height={14} />
              Bares
            </button>
            <h1 className="text-2xl font-bold">Backups</h1>
            <p className="text-sm text-muted mt-1">Copias de la base de datos completa, guardadas en R2.</p>
          </div>
          <button type="button" className="btn-primary" onClick={hacerBackupAhora} disabled={generando}>
            <Icon.cloudSync width={16} height={16} />
            {generando ? 'Generando…' : 'Hacer backup ahora'}
          </button>
        </div>

        {error && (
          <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5 mb-5">
            {error}
          </p>
        )}

        {backups === null && !error && <p className="text-muted text-sm">Cargando…</p>}
        {backups?.length === 0 && <p className="text-muted text-sm">Todavia no hay ningun backup.</p>}

        <div className="space-y-3">
          {backups?.map((b) => (
            <div key={b.nombre} className="card p-4 flex items-center gap-4">
              <span className="w-10 h-10 rounded-xl bg-raised border border-edge grid place-items-center shrink-0 text-amberText">
                <Icon.cloudSync width={18} height={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium flex items-center gap-2 truncate">
                  <span className="truncate font-mono text-sm">{b.nombre}</span>
                  {b.origen === 'MANUAL' ? (
                    <span className="shrink-0 text-[10px] font-bold text-amberText border border-amber/40 bg-amber/10 rounded-pill px-2 py-0.5">
                      Manual
                    </span>
                  ) : (
                    <span className="shrink-0 text-[10px] font-bold text-muted border border-edge bg-raised rounded-pill px-2 py-0.5">
                      Automático
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted mt-0.5">
                  {formatFecha(b.fecha)} · {formatTamano(b.tamano)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
