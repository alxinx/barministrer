import { useState } from 'react'
import { api } from '../lib/api'
import { Icon, zoneIcon } from './Icons'

/**
 * Elegir la mesa destino para trasladar una cuenta abierta (el cliente se
 * cambio de puesto, pero es el mismo pedido). Solo a una mesa libre: fusionar
 * dos cuentas no esta soportado.
 */
export default function TrasladarMesaModal({ order, fromTableId, zones, onClose, onTrasladado }) {
  const [error, setError] = useState('')
  const [moviendo, setMoviendo] = useState(false)

  async function trasladar(tableId) {
    setMoviendo(true)
    setError('')
    try {
      const actualizada = await api(`/orders/${order.id}/table`, { method: 'PATCH', body: { tableId } })
      onTrasladado(actualizada)
    } catch (err) {
      setError(err.message)
      setMoviendo(false)
    }
  }

  const haySitio = zones.some((z) => z.tables.some((t) => t.id !== fromTableId && t.status === 'AVAILABLE'))

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-md p-5 space-y-4 max-h-[85vh] overflow-y-auto"
      >
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Trasladar cuenta a otra mesa</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-ink">
            <Icon.x />
          </button>
        </header>

        {error && (
          <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
            {error}
          </p>
        )}

        {!haySitio && <p className="text-sm text-muted">No hay ninguna mesa disponible para trasladar la cuenta.</p>}

        <div className="space-y-4">
          {zones.map((z) => {
            const libres = z.tables.filter((t) => t.id !== fromTableId && t.status === 'AVAILABLE')
            if (!libres.length) return null
            const I = zoneIcon[z.icon] || Icon.tables
            return (
              <div key={z.id}>
                <p className="label flex items-center gap-1.5">
                  <I /> {z.name}
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {libres.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      disabled={moviendo}
                      onClick={() => trasladar(t.id)}
                      className="h-14 rounded-xl border border-edge bg-raised hover:border-amber
                                 grid place-items-center font-semibold disabled:opacity-40"
                    >
                      {t.number}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
