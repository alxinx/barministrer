import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, money } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Icon } from '../components/Icons'
import ReciboModal from '../components/ReciboModal'
import TicketEgresoModal from '../components/TicketEgresoModal'
import FacturasDelDia from '../components/FacturasDelDia'
import { METHODS, METHOD_LABEL } from '../lib/paymentMethods'

export default function TurnoDetalle() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { session } = useAuth()
  const [shift, setShift] = useState(undefined) // undefined = cargando, null = no encontrado
  const [factura, setFactura] = useState(null)
  const [egresoTicket, setEgresoTicket] = useState(null)
  const [mostrarTirilla, setMostrarTirilla] = useState(false)
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
  const facturas = shift.facturas || []
  const totalEgresos = egresos.reduce((s, e) => s + Number(e.amount), 0)
  const sales = shift.sales || {
    byMethod: {},
    fiado: 0,
    totalVentas: 0,
    tickets: 0,
    cortesias: 0,
    abonos: { byMethod: {}, total: 0 },
  }

  // Esperado de efectivo ya viene calculado del cuadre si el turno cerro; si
  // sigue abierto se estima en vivo con la misma formula (base + cobros -
  // retiros) para que la tarjeta muestre algo mientras tanto.
  const efectivoCount = counts.find((c) => c.method === 'EFECTIVO')
  const totalTeorico = efectivoCount
    ? efectivoCount.expected
    : Number(shift.baseCash) + (sales.byMethod.EFECTIVO || 0) + (sales.abonos?.byMethod?.EFECTIVO || 0) - totalEgresos
  const discrepancia = counts.length ? counts.reduce((s, c) => s + c.difference, 0) : null
  const mismaPersona = shift.closedBy && shift.closedBy.id === shift.openedBy.id

  const subVentas =
    sales.tickets === 0
      ? 'Sin cuentas cerradas'
      : sales.tickets === 1
        ? `1 cuenta cerrada${facturas[0] ? ` (Mesa ${String(facturas[0].tableNumber).padStart(2, '0')})` : ''}`
        : `${sales.tickets} cuentas cerradas`

  return (
    <div className="p-5 md:p-7 max-w-[1200px] mx-auto space-y-5">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => navigate('/caja')}
            aria-label="Volver a caja"
            className="w-9 h-9 rounded-lg bg-raised border border-edge grid place-items-center text-muted hover:text-ink shrink-0 mt-0.5"
          >
            <Icon.chevronLeft width={18} height={18} />
          </button>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-2xl font-bold">Turno del {formatFechaCorta(shift.openedAt)}</h1>
              {shift.status === 'CLOSED' ? (
                <EstadoPill tono="libre" label="Cierre completado" />
              ) : (
                <EstadoPill tono="amber" label="Turno abierto" />
              )}
              <span className="text-xs font-mono text-muted border border-edge rounded-pill px-2.5 py-1">
                Turno #{String(shift.numero).padStart(4, '0')}
              </span>
            </div>
            <p className="text-muted text-sm mt-1.5 flex items-center gap-x-3 gap-y-1 flex-wrap">
              <span className="flex items-center gap-1.5">
                <Icon.users width={14} height={14} />
                {mismaPersona
                  ? `Responsable: ${shift.openedBy.name}`
                  : `Abrió ${shift.openedBy.name}${shift.closedBy ? ` · Cerró ${shift.closedBy.name}` : ''}`}
              </span>
              <span className="flex items-center gap-1.5">
                <Icon.clock width={14} height={14} />
                Apertura: {formatHora(shift.openedAt)}
                {shift.closedAt ? ` → Cierre: ${formatHora(shift.closedAt)}` : ' — en curso'}
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={() => setMostrarTirilla(true)} className="btn-ghost h-10 px-4 text-sm">
            <Icon.printer width={16} height={16} />
            Imprimir tirilla
          </button>
          <button
            type="button"
            disabled
            title="Reportes en PDF: próximamente"
            className="btn-ghost h-10 px-4 text-sm opacity-40 cursor-not-allowed"
          >
            <Icon.download width={16} height={16} />
            Exportar PDF
          </button>
        </div>
      </header>

      {error && (
        <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
          {error}
        </p>
      )}

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard icon={Icon.cash} tono="amber" label="VENTAS DEL TURNO" value={sales.totalVentas} sub={subVentas} />
        <StatCard icon={Icon.lock} label="BASE INICIAL APERTURA" value={shift.baseCash} sub="Monto asignado al inicio" />
        <StatCard
          icon={Icon.clipboard}
          label="TOTAL TEÓRICO EN CAJA"
          value={totalTeorico}
          sub={`Base (${moneyCorta(shift.baseCash)}) + Ventas efectivo (${moneyCorta(sales.byMethod.EFECTIVO || 0)})`}
        />
        <StatCard
          icon={Icon.alert}
          tono={discrepancia == null ? 'default' : discrepancia === 0 ? 'libre' : 'ocupada'}
          label="DISCREPANCIA / BALANCE"
          value={discrepancia ?? 0}
          sub={
            discrepancia == null
              ? 'Pendiente de cuadrar'
              : discrepancia === 0
                ? 'Caja cuadrada'
                : discrepancia < 0
                  ? 'Faltante por conciliar en arqueo'
                  : 'Sobrante por conciliar en arqueo'
          }
        />
      </div>

      <VentasPorMedioCard sales={sales} />

      {counts.length > 0 && <ConciliacionCard counts={counts} baseCash={shift.baseCash} />}

      <div className="grid lg:grid-cols-[1fr_360px] gap-5 items-start">
        <FacturasDelDia
          facturas={facturas}
          onVer={verFactura}
          titulo="Consumo por mesa"
          subtitulo="Detalle de comandas y cuentas cerradas en el turno"
        />
        <EgresosCard egresos={egresos} totalEgresos={totalEgresos} shiftId={shift.id} onVerTicket={setEgresoTicket} />
      </div>

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

      {mostrarTirilla && (
        <TirillaTurnoModal
          shift={shift}
          sales={sales}
          counts={counts}
          egresos={egresos}
          totalEgresos={totalEgresos}
          tenantName={session?.tenant?.name}
          onClose={() => setMostrarTirilla(false)}
        />
      )}
    </div>
  )
}

function EstadoPill({ tono, label }) {
  const tonos = {
    libre: 'text-libre border-libre/30 bg-libre/10',
    amber: 'text-amber border-amber/30 bg-amber/10',
  }
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-pill px-2.5 py-1 border ${tonos[tono]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${tono === 'libre' ? 'bg-libre' : 'bg-amber'}`} />
      {label}
    </span>
  )
}

const STAT_TONOS = {
  default: { badge: 'bg-raised border-edge text-muted', texto: '', card: '' },
  amber: { badge: 'bg-amber/10 border-amber/40 text-amber', texto: 'text-amber', card: '' },
  libre: { badge: 'bg-libre/10 border-libre/40 text-libre', texto: 'text-libre', card: '' },
  ocupada: { badge: 'bg-ocupada/10 border-ocupada/40 text-ocupada', texto: 'text-ocupada', card: 'border-ocupada/40 bg-ocupada/5' },
}

function StatCard({ icon: Ico, label, value, sub, tono = 'default' }) {
  const t = STAT_TONOS[tono]
  return (
    <div className={`card p-4 ${t.card}`}>
      <div className="flex items-center justify-between mb-3">
        <p className={`text-[11px] font-semibold tracking-wide ${tono === 'ocupada' ? 'text-ocupada' : 'text-muted'}`}>{label}</p>
        <span className={`w-8 h-8 rounded-full grid place-items-center border shrink-0 ${t.badge}`}>
          <Ico width={15} height={15} />
        </span>
      </div>
      <p className={`text-2xl font-bold leading-none ${t.texto}`}>{money(value)}</p>
      {sub && <p className="text-xs text-muted mt-1.5">{sub}</p>}
    </div>
  )
}

// Desglose de ventas por medio de pago, con el porcentaje de cada uno sobre
// el total: fiado entra aqui como un medio mas (aunque no se cuenta a
// ciegas al cerrar, si es parte de lo vendido), abonos y cortesias solo
// aparecen si hubo alguno, para no llenar la tarjeta de ceros.
function VentasPorMedioCard({ sales }) {
  const metodos = [
    ...METHODS.map((m) => ({ key: m.key, label: m.label, icon: m.icon, monto: sales.byMethod[m.key] || 0 })),
    { key: 'CREDITO', label: 'Fiado / Crédito', icon: 'clipboard', monto: sales.fiado || 0 },
  ]
  const total = sales.totalVentas || 0

  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold">Ventas por medio de pago</h2>
          <p className="text-xs text-muted mt-0.5">Distribución de ingresos cobrados en el periodo</p>
        </div>
        <span className="text-xs font-mono text-muted border border-edge rounded-pill px-2.5 py-1 shrink-0">
          Total: {money(total)} COP
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2.5">
        {metodos.map((m) => {
          const MethodIcon = Icon[m.icon]
          const pct = total > 0 ? Math.round((m.monto / total) * 100) : 0
          return (
            <div key={m.key} className="bg-raised border border-edge rounded-xl p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="w-8 h-8 rounded-full bg-night border border-edge grid place-items-center text-muted shrink-0">
                  <MethodIcon width={15} height={15} />
                </span>
                {pct > 0 && (
                  <span className="text-[10px] font-bold text-amber bg-amber/10 border border-amber/30 rounded-pill px-1.5 py-0.5">
                    {pct}%
                  </span>
                )}
              </div>
              <div>
                <p className="text-[11px] text-muted leading-none">{m.label}</p>
                <p className="text-sm font-semibold mt-1 leading-tight">{money(m.monto)}</p>
              </div>
            </div>
          )
        })}
      </div>
      {(sales.abonos?.total > 0 || sales.cortesias > 0) && (
        <div className="flex flex-wrap gap-2.5 pt-1">
          {sales.abonos?.total > 0 && (
            <div className="flex items-center gap-2.5 bg-raised border border-edge rounded-xl pl-2.5 pr-3.5 py-2">
              <span className="w-9 h-9 rounded-full bg-night border border-edge grid place-items-center text-muted shrink-0">
                <Icon.receipt width={16} height={16} />
              </span>
              <div>
                <p className="text-[11px] text-muted leading-none">Abonos recibidos</p>
                <p className="text-sm font-semibold leading-tight">{money(sales.abonos.total)}</p>
              </div>
            </div>
          )}
          {sales.cortesias > 0 && (
            <div className="flex items-center gap-2.5 bg-amber/10 border border-amber/30 rounded-xl pl-2.5 pr-3.5 py-2">
              <span className="w-9 h-9 rounded-full bg-amber/15 border border-amber/40 grid place-items-center text-amber shrink-0">
                <Icon.gift width={16} height={16} />
              </span>
              <div>
                <p className="text-[11px] text-amber/80 leading-none">{sales.cortesias === 1 ? 'Cortesía' : 'Cortesías'}</p>
                <p className="text-sm font-semibold leading-tight">{sales.cortesias}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// Comparativo esperado-vs-contado del cuadre ciego, el mismo "counts" que ya
// queda congelado al cerrar el turno (ver POST /shifts/:id/close) -- esto
// solo lo presenta como tabla, no recalcula nada nuevo.
function ConciliacionCard({ counts, baseCash }) {
  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold">Cuadre de caja & conciliación</h2>
          <p className="text-xs text-muted mt-0.5">Comparativo entre valores calculados por sistema y conteo físico del cajero</p>
        </div>
        <span className="text-xs text-muted flex items-center gap-1.5 shrink-0">
          <Icon.clipboard width={13} height={13} />
          Esperado = Base + Cobros − Retiros
        </span>
      </div>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm min-w-[500px]">
          <thead>
            <tr className="text-[11px] text-muted border-b border-edge uppercase tracking-wide">
              <th className="px-1 py-2 text-left font-semibold">Método</th>
              <th className="px-3 py-2 text-right font-semibold">Esperado sistema</th>
              <th className="px-3 py-2 text-right font-semibold">Contado / declarado</th>
              <th className="px-1 py-2 text-right font-semibold">Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {counts.map((c) => (
              <tr key={c.method} className="border-b border-edge/60 last:border-0">
                <td className="px-1 py-3 align-top">
                  <span className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.method === 'EFECTIVO' ? 'bg-amber' : 'bg-edge'}`} />
                    <span className="font-medium">{METHOD_LABEL[c.method] || c.method}</span>
                  </span>
                  {c.method === 'EFECTIVO' && (
                    <p className="text-[11px] text-muted ml-3.5">Incluye base de apertura ({money(baseCash)})</p>
                  )}
                </td>
                <td className="px-3 py-3 text-right align-top">{money(c.expected)}</td>
                <td className="px-3 py-3 text-right align-top font-semibold">{money(c.counted)}</td>
                <td className="px-1 py-3 text-right align-top">
                  <DiffPill diff={c.difference} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function DiffPill({ diff }) {
  if (diff === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-libre border border-libre/30 bg-libre/10 rounded-pill px-2 py-1 whitespace-nowrap">
        <Icon.check width={11} height={11} />
        Sin diferencia
      </span>
    )
  }
  const falta = diff < 0
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-bold rounded-pill px-2 py-1 border whitespace-nowrap ${
        falta ? 'text-ocupada border-ocupada/30 bg-ocupada/10' : 'text-reservada border-reservada/30 bg-reservada/10'
      }`}
    >
      {falta ? '↓' : '↑'} {falta ? 'Faltan' : 'Sobran'} {money(Math.abs(diff))}
    </span>
  )
}

function EgresosCard({ egresos, totalEgresos, shiftId, onVerTicket }) {
  return (
    <section className="card p-5 flex flex-col">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Egresos & retiros</h2>
        <span className={`text-sm font-semibold shrink-0 ${totalEgresos > 0 ? 'text-ocupada' : 'text-muted'}`}>
          -{money(totalEgresos)}
        </span>
      </div>
      <p className="text-xs text-muted mt-0.5 mb-4">Gastos menores y salidas</p>

      {egresos.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-6">
          <span className="w-12 h-12 rounded-full bg-raised border border-edge grid place-items-center text-muted mb-3">
            <Icon.clipboard width={20} height={20} />
          </span>
          <p className="text-sm font-semibold">No hubo egresos registrados</p>
          <p className="text-xs text-muted mt-1 max-w-[220px]">
            No se realizaron compras a caja menor ni retiros de efectivo durante este turno.
          </p>
        </div>
      ) : (
        <div className="flex-1">
          {egresos.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-3 py-2.5 border-b border-edge/60 last:border-0">
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
                  onClick={() => onVerTicket(e)}
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

      <div className="flex items-center justify-between pt-3 mt-3 border-t border-edge text-xs">
        <span className="text-muted font-mono">Turno {shiftId.slice(0, 8)}</span>
        <span className="text-libre font-semibold flex items-center gap-1">
          <Icon.check width={12} height={12} />
          Registrado
        </span>
      </div>
    </section>
  )
}

// Ticket termico con el cierre del turno, para que el cajero se lo lleve
// impreso en la entrega de caja -- mismo patron que la tirilla de venta
// (ReciboModal) y el comprobante de egreso (TicketEgresoModal): id fijo
// "receipt-print-root" que el CSS de impresion ya sabe mostrar solo.
function TirillaTurnoModal({ shift, sales, counts, egresos, totalEgresos, tenantName, onClose }) {
  const mismaPersona = shift.closedBy && shift.closedBy.id === shift.openedBy.id

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
      <div className="flex flex-col items-center gap-3 my-auto">
        <div
          id="receipt-print-root"
          className="bg-white text-[#111] w-[310px] p-4 font-mono text-xs rounded shadow-xl max-h-[70vh] overflow-y-auto"
        >
          <div className="text-center space-y-0.5">
            <p className="font-bold text-sm uppercase">{tenantName || 'LicorPlus'}</p>
            <p>Resumen de turno #{String(shift.numero).padStart(4, '0')}</p>
            <p>{formatFechaCorta(shift.openedAt)}</p>
          </div>

          <div className="my-2 border-t border-dashed border-black/40" />

          <p>{mismaPersona ? `Responsable: ${shift.openedBy.name}` : `Abrió: ${shift.openedBy.name}`}</p>
          {!mismaPersona && shift.closedBy && <p>Cerró: {shift.closedBy.name}</p>}
          <p>Apertura: {formatHora(shift.openedAt)}</p>
          <p>{shift.closedAt ? `Cierre: ${formatHora(shift.closedAt)}` : 'Turno todavía abierto'}</p>

          <div className="my-2 border-t border-dashed border-black/40" />

          <p className="font-bold">Ventas por medio de pago</p>
          <div className="space-y-0.5 mt-1">
            {METHODS.map((m) => (
              <div key={m.key} className="flex justify-between">
                <span>{m.label}</span>
                <span>{money(sales.byMethod[m.key] || 0)}</span>
              </div>
            ))}
            <div className="flex justify-between">
              <span>Fiado</span>
              <span>{money(sales.fiado || 0)}</span>
            </div>
          </div>
          <div className="flex justify-between font-bold text-sm mt-1.5">
            <span>TOTAL VENDIDO</span>
            <span>{money(sales.totalVentas)}</span>
          </div>

          {counts.length > 0 && (
            <>
              <div className="my-2 border-t border-dashed border-black/40" />
              <p className="font-bold">Cuadre de caja</p>
              <div className="space-y-1 mt-1">
                {counts.map((c) => (
                  <div key={c.method}>
                    <div className="flex justify-between">
                      <span>{METHOD_LABEL[c.method] || c.method}</span>
                      <span>{money(c.counted)}</span>
                    </div>
                    <div className="flex justify-between text-black/60">
                      <span>Esperado {money(c.expected)}</span>
                      <span>{c.difference === 0 ? 'Sin dif.' : `${c.difference > 0 ? '+' : ''}${money(c.difference)}`}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="my-2 border-t border-dashed border-black/40" />
          <div className="flex justify-between font-bold">
            <span>Egresos y retiros</span>
            <span>-{money(totalEgresos)}</span>
          </div>
          {egresos.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {egresos.map((e) => (
                <div key={e.id} className="flex justify-between text-black/70">
                  <span className="truncate pr-2">{e.reason}</span>
                  <span className="shrink-0">-{money(e.amount)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="my-2 border-t border-dashed border-black/40" />
          <p className="text-center">
            {sales.tickets} {sales.tickets === 1 ? 'cuenta cerrada' : 'cuentas cerradas'}
          </p>
        </div>

        <div className="flex gap-2 shrink-0 flex-wrap justify-center">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cerrar
          </button>
          <button type="button" onClick={() => window.print()} className="btn-primary flex items-center gap-2">
            <Icon.printer width={16} height={16} />
            Imprimir
          </button>
        </div>
      </div>
    </div>
  )
}

function moneyCorta(v) {
  const miles = Math.round((Number(v) || 0) / 1000)
  return `$${miles.toLocaleString('es-CO')}k`
}

function formatFechaCorta(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatHora(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })
}
