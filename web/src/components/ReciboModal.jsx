import { useEffect } from 'react'
import { money } from '../lib/api'
import { Icon } from './Icons'

const METHOD_LABEL = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  NEQUI: 'Nequi',
  DATAFONO: 'Datáfono',
  CREDITO: 'Crédito',
}

/**
 * Tirilla de venta: se abre sola al cerrar una cuenta y dispara la ventana de
 * impresion del navegador de una vez, en la misma pestaña (nunca window.open,
 * eso abriria otra). Se queda en pantalla despues por si hay que reimprimir.
 */
export default function ReciboModal({ order, splitCount, tenantName, onClose, autoPrint = true }) {
  useEffect(() => {
    if (!autoPrint) return
    const t = setTimeout(() => window.print(), 150)
    return () => clearTimeout(t)
  }, [autoPrint])

  const items = order.items.filter((i) => i.status === 'ACTIVE')
  const descuento = Number(order.discountAmount) || 0
  const totalPagado = order.total - descuento
  const porPersona = splitCount > 1 ? totalPagado / splitCount : null
  const montoCredito = order.payments.filter((p) => p.method === 'CREDITO').reduce((s, p) => s + Number(p.amount), 0)
  const cambioTotal = order.payments
    .filter((p) => p.method === 'EFECTIVO' && Number(p.change) > 0)
    .reduce((s, p) => s + Number(p.change), 0)

  // wa.me solo acepta texto plano, no la tirilla visual: arma un resumen
  // equivalente. Si el cliente tiene WhatsApp guardado abre directo su chat;
  // si no, abre el selector de WhatsApp para elegir a quien mandarselo. Los
  // numeros locales (10 digitos) se guardan sin el indicativo de Colombia.
  function enviarPorWhatsapp() {
    const lineas = [
      `*${tenantName || 'LicorPlus'}*`,
      ...(order.invoiceNumber ? [`Factura #${String(order.invoiceNumber).padStart(4, '0')}`] : []),
      `Mesa ${order.table?.number}`,
      '',
      ...items.map(
        (it) => `${it.qty} x ${it.name}${it.variantName ? ` · ${it.variantName}` : ''} - ${money(Number(it.price) * it.qty)}`
      ),
      '',
    ]
    if (descuento > 0) {
      lineas.push(`Subtotal: ${money(order.total)}`, `Descuento: -${money(descuento)}`, `*TOTAL PAGADO: ${money(totalPagado)}*`)
    } else {
      lineas.push(`*TOTAL: ${money(order.total)}*`)
    }
    if (porPersona) lineas.push('', `Dividido entre ${splitCount}: ${money(porPersona)} c/u`)
    lineas.push('', 'Gracias por su visita')

    const digitos = order.customer?.whatsapp?.replace(/\D/g, '') || ''
    const numero = digitos ? (digitos.length === 10 ? `57${digitos}` : digitos) : ''
    const texto = encodeURIComponent(lineas.join('\n'))
    window.open(`https://wa.me/${numero}?text=${texto}`, '_blank')
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
      <div className="flex flex-col items-center gap-3 my-auto">
        <div
          id="receipt-print-root"
          className="bg-white text-[#111] w-[310px] p-4 font-mono text-xs rounded shadow-xl max-h-[65vh] overflow-y-auto"
        >
          <div className="text-center space-y-0.5">
            <p className="font-bold text-sm uppercase">{tenantName || 'LicorPlus'}</p>
            {order.invoiceNumber && <p>Factura #{String(order.invoiceNumber).padStart(4, '0')}</p>}
            <p>Mesa {order.table?.number}</p>
            <p>{new Date(order.closedAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</p>
          </div>

          <div className="my-2 border-t border-dashed border-black/40" />

          <p>
            Cliente:{' '}
            {order.customer ? `${order.customer.firstName} ${order.customer.lastName || ''}`.trim() : 'Consumidor final'}
          </p>
          {order.customer?.alias && <p>Alias: {order.customer.alias}</p>}
          {order.customer?.idNumber && <p>Cédula: {order.customer.idNumber}</p>}

          <div className="my-2 border-t border-dashed border-black/40" />

          <div className="space-y-1">
            {items.flatMap((it) =>
              Array.from({ length: it.qty }, (_, unidad) => (
                <div key={`${it.id}-${unidad}`} className="flex justify-between gap-2">
                  <span className="flex-1">
                    {it.name}
                    {it.variantName ? ` · ${it.variantName}` : ''}
                  </span>
                  <span className="shrink-0">{money(Number(it.price))}</span>
                </div>
              ))
            )}
          </div>

          <div className="my-2 border-t border-dashed border-black/40" />

          {descuento > 0 ? (
            <>
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>{money(order.total)}</span>
              </div>
              <div className="flex justify-between">
                <span>Descuento</span>
                <span>-{money(descuento)}</span>
              </div>
              <div className="flex justify-between font-bold text-sm">
                <span>TOTAL PAGADO</span>
                <span>{money(totalPagado)}</span>
              </div>
            </>
          ) : (
            <div className="flex justify-between font-bold text-sm">
              <span>TOTAL</span>
              <span>{money(order.total)}</span>
            </div>
          )}

          {order.isCourtesy ? (
            <p className="text-center font-bold text-lg my-3 tracking-wide">CORTESÍA</p>
          ) : (
            <>
              <div className="my-2 border-t border-dashed border-black/40" />
              <div className="space-y-1">
                {order.payments.map((p) => (
                  <div key={p.id} className="flex justify-between">
                    <span>{METHOD_LABEL[p.method] || p.method}</span>
                    <span>{money(p.amount)}</span>
                  </div>
                ))}
                {cambioTotal > 0 && (
                  <div className="flex justify-between text-black/70">
                    <span>Cambio</span>
                    <span>{money(cambioTotal)}</span>
                  </div>
                )}
              </div>
              {montoCredito > 0 && <p className="text-center font-bold text-lg my-3 tracking-wide">CRÉDITO</p>}
            </>
          )}

          {porPersona && (
            <>
              <div className="my-2 border-t border-dashed border-black/40" />
              <p>
                Dividido entre {splitCount}: {money(porPersona)} c/u
              </p>
            </>
          )}

          <div className="my-2 border-t border-dashed border-black/40" />
          <p className="text-center">Gracias por su visita</p>
        </div>

        <div className="flex gap-2 shrink-0 flex-wrap justify-center">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cerrar
          </button>
          <button type="button" onClick={enviarPorWhatsapp} className="btn-ghost flex items-center gap-2">
            <Icon.phone width={16} height={16} />
            Enviar por WhatsApp
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
