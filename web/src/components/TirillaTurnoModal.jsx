import { useEffect } from 'react'
import { money } from '../lib/api'
import { Icon } from './Icons'
import { construirTicketRaster } from '../lib/ticketRaster'
import { imprimirSilencioso } from '../lib/printer'
import ReciboEncabezado from './ReciboEncabezado'
import ReciboPie from './ReciboPie'
import { METHODS, METHOD_LABEL } from '../lib/paymentMethods'

/**
 * Comprobante completo de cierre de turno: mismo patron que ReciboModal y
 * TicketEgresoModal (tirilla visual + raster para impresora termica, con
 * fallback a window.print()). Se usa tanto recien cerrado el turno (autoPrint,
 * ver Caja.jsx) como para reimprimirlo despues desde TurnoDetalle.
 */
export default function TirillaTurnoModal({
  shift,
  sales,
  counts,
  egresos,
  totalEgresos,
  preparados,
  tenant,
  onClose,
  autoPrint = false,
}) {
  const mismaPersona = shift.closedBy && shift.closedBy.id === shift.openedBy.id
  const resumenPreparados = preparados?.resumen || []

  function lineasTicket() {
    const l = [
      { texto: (tenant?.legalName || tenant?.name || 'Barminister').toUpperCase(), centro: true, negrita: true },
      { texto: `Resumen de turno #${String(shift.numero).padStart(4, '0')}`, centro: true },
      { texto: formatFechaCorta(shift.openedAt), centro: true },
      { raya: true },
      { texto: mismaPersona ? `Responsable: ${shift.openedBy.name}` : `Abrió: ${shift.openedBy.name}` },
    ]
    if (!mismaPersona && shift.closedBy) l.push({ texto: `Cerró: ${shift.closedBy.name}` })
    l.push({ texto: `Apertura: ${formatHora(shift.openedAt)}` })
    l.push({ texto: shift.closedAt ? `Cierre: ${formatHora(shift.closedAt)}` : 'Turno todavía abierto' })
    l.push({ raya: true })
    l.push({ texto: 'Ventas por medio de pago', negrita: true })
    METHODS.forEach((m) => l.push({ cols: [m.label, money(sales.byMethod[m.key] || 0)] }))
    l.push({ cols: ['Fiado', money(sales.fiado || 0)] })
    l.push({ cols: ['TOTAL VENDIDO', money(sales.totalVentas)], negrita: true })
    if (counts.length > 0) {
      l.push({ raya: true })
      l.push({ texto: 'Cuadre de caja', negrita: true })
      counts.forEach((c) => {
        l.push({ cols: [METHOD_LABEL[c.method] || c.method, money(c.counted)] })
        l.push({
          texto: `  Esperado ${money(c.expected)} · ${
            c.difference === 0 ? 'Sin dif.' : `${c.difference > 0 ? '+' : ''}${money(c.difference)}`
          }`,
        })
      })
    }
    l.push({ raya: true })
    l.push({ cols: ['Egresos y retiros', `-${money(totalEgresos)}`], negrita: true })
    egresos.forEach((e) => l.push({ cols: [e.reason, `-${money(e.amount)}`] }))
    if (resumenPreparados.length > 0) {
      l.push({ raya: true })
      l.push({ texto: 'Preparados sin recuperar', negrita: true })
      resumenPreparados.forEach((r) => l.push({ cols: [r.nombre, `${r.qty} ${r.unidad}`] }))
    }
    l.push({ raya: true })
    l.push({ texto: `${sales.tickets} ${sales.tickets === 1 ? 'cuenta cerrada' : 'cuentas cerradas'}`, centro: true })
    return l
  }

  async function imprimir() {
    const bytes = await construirTicketRaster(tenant, lineasTicket())
    const ok = await imprimirSilencioso(bytes)
    if (!ok) window.print()
  }

  useEffect(() => {
    if (!autoPrint) return
    const t = setTimeout(imprimir, 150)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrint])

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
      <div className="flex flex-col items-center gap-3 my-auto">
        <div
          id="receipt-print-root"
          className="bg-white text-[#111] w-[310px] p-4 text-xs rounded shadow-xl max-h-[70vh] overflow-y-auto"
          style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
        >
          <ReciboEncabezado tenant={tenant} />
          <div className="text-center space-y-0.5 mt-1">
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

          {resumenPreparados.length > 0 && (
            <>
              <div className="my-2 border-t border-dashed border-black/40" />
              <p className="font-bold">Preparados sin recuperar</p>
              <div className="space-y-0.5 mt-1">
                {resumenPreparados.map((r) => (
                  <div key={`${r.nombre}·${r.unidad}`} className="flex justify-between">
                    <span className="truncate pr-2">{r.nombre}</span>
                    <span className="shrink-0">
                      {r.qty} {r.unidad}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="my-2 border-t border-dashed border-black/40" />
          <p className="text-center">
            {sales.tickets} {sales.tickets === 1 ? 'cuenta cerrada' : 'cuentas cerradas'}
          </p>
          <ReciboPie tenant={tenant} />
        </div>

        <div className="flex gap-2 shrink-0 flex-wrap justify-center">
          <button type="button" onClick={onClose} className="btn-primary">
            Entendido
          </button>
          <button type="button" onClick={imprimir} className="btn-ghost flex items-center gap-2">
            <Icon.printer width={16} height={16} />
            Imprimir
          </button>
        </div>
      </div>
    </div>
  )
}

function formatFechaCorta(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatHora(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })
}
