import { useEffect } from 'react'
import { money } from '../lib/api'
import { Icon } from './Icons'
import { construirTicketRaster } from '../lib/ticketRaster'
import { imprimirSilencioso } from '../lib/printer'
import ReciboEncabezado from './ReciboEncabezado'
import ReciboPie from './ReciboPie'

/**
 * Comprobante de un movimiento del modulo de Cajas y bancos que NO viene de
 * una venta ni de un abono a fiado (esos reimprimen su propia factura/
 * comprobante, ver CajasBancos.jsx): ingreso o egreso manual de una cuenta,
 * o cualquiera de las 2 patas de un traslado. Misma tirilla y mismo flujo de
 * impresion que el resto de comprobantes de la app.
 */
export default function TicketMovimientoModal({ movimiento, cuenta, tenant, onClose, autoPrint = true }) {
  const esTraslado = Boolean(movimiento.trasladoId)
  const titulo = esTraslado ? 'Comprobante de traslado' : movimiento.tipo === 'EGRESO' ? 'Comprobante de egreso' : 'Comprobante de ingreso'

  function lineasTicket() {
    return [
      { texto: (tenant?.legalName || tenant?.name || 'Barminister').toUpperCase(), centro: true, negrita: true },
      { texto: titulo, centro: true },
      { texto: new Date(movimiento.createdAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }), centro: true },
      { raya: true },
      { texto: `Cuenta: ${cuenta.nombre}` },
      { texto: `Concepto: ${movimiento.concepto}` },
      { raya: true },
      { cols: [movimiento.tipo, money(movimiento.valor)], negrita: true },
      { raya: true },
      { texto: `Autorizó: ${movimiento.createdBy?.name}`, centro: true },
    ]
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
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4">
      <div className="flex flex-col items-center gap-3">
        <div
          id="receipt-print-root"
          className="bg-white text-[#111] w-[310px] p-4 text-xs rounded shadow-xl"
          style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
        >
          <ReciboEncabezado tenant={tenant} />
          <div className="text-center space-y-0.5 mt-1">
            <p className="font-semibold">{titulo}</p>
            <p>{new Date(movimiento.createdAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</p>
          </div>

          <div className="my-2 border-t border-dashed border-black/40" />

          <p>Cuenta: {cuenta.nombre}</p>
          <p>Concepto: {movimiento.concepto}</p>

          <div className="my-2 border-t border-dashed border-black/40" />

          <div className="flex justify-between font-bold text-sm">
            <span>{movimiento.tipo}</span>
            <span>{money(movimiento.valor)}</span>
          </div>

          <div className="my-2 border-t border-dashed border-black/40" />
          <p className="text-center">Autorizó: {movimiento.createdBy?.name}</p>
          <ReciboPie tenant={tenant} />
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cerrar
          </button>
          <button type="button" onClick={imprimir} className="btn-primary flex items-center gap-2">
            <Icon.printer width={16} height={16} />
            Imprimir
          </button>
        </div>
      </div>
    </div>
  )
}
