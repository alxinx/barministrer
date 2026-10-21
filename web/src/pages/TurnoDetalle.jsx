import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, money } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Icon } from '../components/Icons'
import ReciboModal from '../components/ReciboModal'
import TicketEgresoModal from '../components/TicketEgresoModal'
import FacturasDelDia from '../components/FacturasDelDia'
import ResumenVentas from '../components/ResumenVentas'
import CuadreResumen from '../components/CuadreResumen'

export default function TurnoDetalle() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { session } = useAuth()
  const [shift, setShift] = useState(undefined) // undefined = cargando, null = no encontrado
  const [factura, setFactura] = useState(null)
  const [egresoTicket, setEgresoTicket] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api(`/shifts/${id}`)
      .then(setShift)
      .catch((err) => {
        setShift(null)
        setError(err.message)
      })
  }, [id])

  async function verFactura(orderId) {
    try {
      const order = await api(`/orders/${orderId}`)
      setFactura(order)
    } catch (err) {
      setError(err.message)
    }
  }

  if (shift === undefined) {
    return <div className="p-7 text-muted text-sm">Cargando…</div>
  }

  if (!shift) {
    return (
      <div className="p-5 md:p-7 max-w-[900px] mx-auto space-y-4">
        <p className="text-sm text-ocupada">{error || 'Turno no encontrado'}</p>
        <button onClick={() => navigate('/caja')} className="btn-ghost">
          Volver a caja
        </button>
      </div>
    )
  }

  const counts = shift.counts || []
  const egresos = shift.expenses || []
  const totalEgresos = egresos.reduce((s, e) => s + Number(e.amount), 0)
  const sales = shift.sales || {
    byMethod: {},
    fiado: 0,
    totalVentas: 0,
    tickets: 0,
    cortesias: 0,
    abonos: { byMethod: {}, total: 0 },
  }

  return (
    <div className="p-5 md:p-7 max-w-[900px] mx-auto space-y-5">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/caja')}
          aria-label="Volver a caja"
          className="w-9 h-9 rounded-lg bg-raised border border-edge grid place-items-center text-muted hover:text-ink shrink-0"
        >
          <Icon.chevronLeft width={18} height={18} />
        </button>
        <div>
          <h1 className="text-2xl font-bold">Turno del {formatFecha(shift.closedAt || shift.openedAt)}</h1>
          <p className="text-muted text-sm mt-1">
            {shift.openedBy?.name} abrió · {shift.closedBy ? `${shift.closedBy.name} cerró` : 'Todavía abierto'}
          </p>
        </div>
      </header>

      {error && (
        <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
          {error}
        </p>
      )}

      <ResumenVentas titulo="Ventas del turno" sales={sales} heroLabel="Base inicial" heroValue={shift.baseCash} />

      {counts.length > 0 && (
        <section className="card p-5 space-y-3">
          <h2 className="font-semibold">Cuadre de caja</h2>
          <CuadreResumen counts={counts} />
        </section>
      )}

      {shift.facturas?.length > 0 && (
        <FacturasDelDia facturas={shift.facturas} onVer={verFactura} titulo="Consumo por mesa" />
      )}

      <section className="card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Egresos y retiros</h2>
          <span className="text-sm font-semibold text-ocupada">-{money(totalEgresos)}</span>
        </div>

        {egresos.length === 0 ? (
          <p className="text-sm text-muted">No hubo egresos en este turno.</p>
        ) : (
          <div>
            {egresos.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between gap-3 py-2.5 border-b border-edge/60 last:border-0"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{e.reason}</p>
                  <p className="text-xs text-muted">
                    {e.type === 'RETIRO' ? 'Retiro' : 'Gasto'} · {e.authorizedBy?.name}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-semibold text-ocupada">-{money(e.amount)}</span>
                  <button
                    type="button"
                    onClick={() => setEgresoTicket(e)}
                    aria-label="Reimprimir comprobante"
                    className="w-8 h-8 rounded-lg grid place-items-center text-muted hover:text-amber hover:bg-raised transition-colors"
                  >
                    <Icon.receipt width={16} height={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {factura && (
        <ReciboModal
          order={factura}
          splitCount={1}
          tenantName={session?.tenant?.name}
          autoPrint={false}
          onClose={() => setFactura(null)}
        />
      )}

      {egresoTicket && (
        <TicketEgresoModal
          egreso={egresoTicket}
          tenantName={session?.tenant?.name}
          autoPrint={false}
          onClose={() => setEgresoTicket(null)}
        />
      )}
    </div>
  )
}

function formatFecha(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
}
