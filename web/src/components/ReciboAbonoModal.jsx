import { useEffect } from 'react'
import { money } from '../lib/api'
import { Icon } from './Icons'
import { METHOD_LABEL } from '../lib/paymentMethods'

/**
 * Comprobante de abono a credito: misma tirilla que el recibo de venta, pero
 * mas corta (un solo movimiento). Se abre sola al registrar el abono.
 */
export default function ReciboAbonoModal({ payment, customer, tenantName, onClose, autoPrint = true }) {
  useEffect(() => {
    if (!autoPrint) return
    const t = setTimeout(() => window.print(), 150)
    return () => clearTimeout(t)
  }, [autoPrint])

  const nombre = `${customer.firstName} ${customer.lastName || ''}`.trim()

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="flex flex-col items-center gap-3">
        <div id="receipt-print-root" className="bg-white text-[#111] w-[310px] p-4 font-mono text-xs rounded shadow-xl">
          <div className="text-center space-y-0.5">
            <p className="font-bold text-sm uppercase">{tenantName || 'LicorPlus'}</p>
            <p className="font-semibold">Comprobante de abono</p>
            <p>{new Date(payment.createdAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</p>
          </div>

          <div className="my-2 border-t border-dashed border-black/40" />

          <p>Cliente: {nombre}</p>
          {customer.idNumber && <p>Cédula: {customer.idNumber}</p>}
          {payment.note && <p>Nota: {payment.note}</p>}

          <div className="my-2 border-t border-dashed border-black/40" />

          <div className="flex justify-between font-bold text-sm">
            <span>ABONO</span>
            <span>{money(payment.amount)}</span>
          </div>
          <div className="flex justify-between mt-1">
            <span>Medio de pago</span>
            <span>{METHOD_LABEL[payment.method] || payment.method}</span>
          </div>

          <div className="my-2 border-t border-dashed border-black/40" />

          <div className="flex justify-between">
            <span>Saldo restante</span>
            <span className="font-bold">
              {customer.balance <= 0 ? 'Al día' : money(customer.balance)}
            </span>
          </div>

          <div className="my-2 border-t border-dashed border-black/40" />
          <p className="text-center">Atendió: {payment.createdBy?.name}</p>
          <p className="text-center">Gracias por su pago</p>
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
