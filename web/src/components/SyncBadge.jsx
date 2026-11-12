// Indicador de operaciones offline encoladas pendientes de sincronizar.
// Solo aparece cuando el agente está activo (GET /api/agent/status responde)
// y hay mutaciones esperando. En modo cloud directo (sin agente) no se muestra.
import { useEffect, useState } from 'react'
import { Icon } from './Icons'

const BASE = import.meta.env.VITE_API_URL || ''

async function fetchStatus() {
  try {
    const res = await fetch(`${BASE}/api/agent/status`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export default function SyncBadge() {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    fetchStatus().then(setStatus)
    const id = setInterval(() => fetchStatus().then(setStatus), 30_000)
    return () => clearInterval(id)
  }, [])

  if (!status) return null

  if (!status.online) {
    return (
      <span
        title="El agente no tiene conexión con la nube"
        className="inline-flex items-center gap-1 text-xs font-medium text-ocupada bg-ocupada/10 border border-ocupada/30 rounded-full px-2 py-0.5"
      >
        <Icon.wifiOff width={12} height={12} />
        Sin conexión
      </span>
    )
  }

  if (status.pendingSync > 0) {
    return (
      <span
        title={`${status.pendingSync} operación(es) guardada(s) offline. Se enviarán automáticamente.`}
        className="inline-flex items-center gap-1 text-xs font-medium text-amberText bg-amber/10 border border-amber/30 rounded-full px-2 py-0.5"
      >
        <Icon.cloudSync width={12} height={12} />
        {status.pendingSync} pendiente{status.pendingSync !== 1 ? 's' : ''}
      </span>
    )
  }

  return null
}
