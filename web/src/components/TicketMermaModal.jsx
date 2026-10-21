import { useEffect } from 'react'
import { money } from '../lib/api'
import { Icon } from './Icons'

/**
 * Comprobante de merma/perdida: misma tirilla que el recibo de venta, para
 * que quede un papel de respaldo igual que cualquier otro movimiento de
 * caja. Se abre sola al registrar la merma.
 */
export default function TicketMermaModal({ merma, tenantName, onClose, autoPrint = true }) {
  useEffect(() => {
    if (!autoPrint) return
    const t = setTimeout(() => window.print(), 150)
    return () => clearTimeout(t)
  }, [autoPrint])

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4">
      <div className="flex flex-col items-center gap-3">
        <div id="receipt-print-root" className="bg-white text-[#111] w-[310px] p-4 font-mono text-xs rounded shadow-xl">
          <div className="text-center space-y-0.5">
            <p className="font-bold text-sm uppercase">{tenantName || 'LicorPlus'}</p>
            <p className="font-semibold">Comprobante de merma</p>
            <p>{new Date(merma.createdAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</p>
          </div>

          <div className="my-2 border-t border-dashed border-black/40" />

          <p>
            Producto: {merma.productName}
            {merma.variantName ? ` · ${merma.variantName}` : ''}
          </p>
          <p>Cantidad: {merma.qty}</p>
          <p>Motivo: {merma.reason}</p>

          <div className="my-2 border-t border-dashed border-black/40" />

          <div className="flex justify-between">
            <span>Costo unitario</span>
            <span>{money(merma.unitCost)}</span>
          </div>
          <div className="flex justify-between font-bold text-sm">
            <span>TOTAL</span>
            <span>{money(merma.total)}</span>
          </div>

          <div className="my-2 border-t border-dashed border-black/40" />
          <p className="text-center">Autorizó: {merma.authorizedBy?.name}</p>
        </div>

        <div className="flex gap-2">
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
