import { useEffect } from 'react'
import { money } from '../lib/api'
import { Icon } from './Icons'
import { construirTicket } from '../lib/escpos'
import { imprimirSilencioso } from '../lib/printer'

/**
 * Comprobante de un egreso (retiro o gasto de caja menor): misma tirilla que
 * el recibo de venta, para poder reimprimirlo despues si se extravia. Con
 * impresora emparejada sale directo por USB sin dialogo; si no, cae al
 * window.print() de siempre.
 */
export default function TicketEgresoModal({ egreso, tenantName, onClose, autoPrint = true }) {
  function lineasTicket() {
    return [
      { texto: (tenantName || 'LicorPlus').toUpperCase(), centro: true, negrita: true },
      { texto: egreso.type === 'RETIRO' ? 'Comprobante de retiro' : 'Comprobante de gasto', centro: true },
      { texto: new Date(egreso.createdAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }), centro: true },
      { raya: true },
      { texto: `Motivo: ${egreso.reason}` },
      { raya: true },
      { cols: [egreso.type === 'RETIRO' ? 'RETIRO' : 'GASTO', money(egreso.amount)], negrita: true },
      { raya: true },
      { texto: `Autorizó: ${egreso.authorizedBy?.name}`, centro: true },
    ]
  }

  async function imprimir() {
    const ok = await imprimirSilencioso(construirTicket(lineasTicket()))
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
        <div id="receipt-print-root" className="bg-white text-[#111] w-[310px] p-4 font-mono text-xs rounded shadow-xl">
          <div className="text-center space-y-0.5">
            <p className="font-bold text-sm uppercase">{tenantName || 'LicorPlus'}</p>
            <p className="font-semibold">{egreso.type === 'RETIRO' ? 'Comprobante de retiro' : 'Comprobante de gasto'}</p>
            <p>{new Date(egreso.createdAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</p>
          </div>

          <div className="my-2 border-t border-dashed border-black/40" />

          <p>Motivo: {egreso.reason}</p>

          <div className="my-2 border-t border-dashed border-black/40" />

          <div className="flex justify-between font-bold text-sm">
            <span>{egreso.type === 'RETIRO' ? 'RETIRO' : 'GASTO'}</span>
            <span>{money(egreso.amount)}</span>
          </div>

          <div className="my-2 border-t border-dashed border-black/40" />
          <p className="text-center">Autorizó: {egreso.authorizedBy?.name}</p>
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
