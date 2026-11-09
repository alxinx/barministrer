import { useEffect, useState } from 'react'
import { money } from '../lib/api'
import { Icon } from './Icons'
import { construirTicketRaster } from '../lib/ticketRaster'
import { imprimirSilencioso, abrirCajon } from '../lib/printer'
import ReciboEncabezado from './ReciboEncabezado'
import ReciboPie from './ReciboPie'

const METHOD_LABEL = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  NEQUI: 'Nequi',
  DATAFONO: 'Datáfono',
  CREDITO: 'Crédito',
}

// Si el pago quedo ligado a un banco/billetera real (modulo de Cajas y
// bancos), la factura muestra esa cuenta por su nombre, no solo el metodo
// generico -- es la unica forma de que el dueno pueda conciliar un pago
// contra su extracto real.
function etiquetaPago(p) {
  const base = METHOD_LABEL[p.method] || p.method
  return p.cuentaFinanciera ? `${base} · ${p.cuentaFinanciera.nombre}` : base
}

/**
 * Tirilla de venta: se abre sola al cerrar una cuenta. Si hay una impresora
 * termica emparejada (ver DatosBar > Impresora) sale directo por USB sin
 * ningun dialogo; si no, cae al window.print() de siempre. Se queda en
 * pantalla despues por si hay que reimprimir.
 */
export default function ReciboModal({ order, splitCount, tenant, onClose, autoPrint = true }) {
  const items = order.items.filter((i) => i.status === 'ACTIVE')
  const descuento = Number(order.discountAmount) || 0
  const propina = Number(order.tipAmount) || 0
  const totalPagado = order.total - descuento + propina
  const porPersona = splitCount > 1 ? totalPagado / splitCount : null
  const mesero = order.openedBy?.name
  const montoCredito = order.payments.filter((p) => p.method === 'CREDITO').reduce((s, p) => s + Number(p.amount), 0)
  const cambioTotal = order.payments
    .filter((p) => p.method === 'EFECTIVO' && Number(p.change) > 0)
    .reduce((s, p) => s + Number(p.change), 0)

  // Mismo contenido que la tirilla visual de abajo, pero como lista
  // declarativa para la impresora termica (ver web/src/lib/escpos.js).
  function lineasTicket() {
    const l = [
      { texto: (tenant?.legalName || tenant?.name || 'Barminister').toUpperCase(), centro: true, negrita: true },
    ]
    if (order.invoiceNumber) l.push({ texto: `Factura #${String(order.invoiceNumber).padStart(4, '0')}`, centro: true })
    l.push({ cols: [`Mesa ${order.table?.number}`, mesero || ''] })
    l.push({
      texto: new Date(order.closedAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }),
      centro: true,
    })
    l.push({ raya: true })
    l.push({
      texto: `Cliente: ${
        order.customer ? `${order.customer.firstName} ${order.customer.lastName || ''}`.trim() : 'Consumidor final'
      }`,
    })
    if (order.customer?.alias) l.push({ texto: `Alias: ${order.customer.alias}` })
    if (order.customer?.idNumber) l.push({ texto: `Cédula: ${order.customer.idNumber}` })
    l.push({ raya: true })
    // Una linea por producto (cantidad x nombre -> total de esa linea), no
    // una por unidad: mas facil de leer con cantidades altas, y es el mismo
    // formato que ya usa el mensaje de WhatsApp (ver mensajeWhatsapp abajo).
    items.forEach((it) => {
      l.push({
        cols: [`${it.qty} x ${it.name}${it.variantName ? ` · ${it.variantName}` : ''}`, money(Number(it.price) * it.qty)],
      })
    })
    l.push({ raya: true })
    // Impuestos: pendiente (cada tenant podra configurar el que le aplique
    // por ley, ver CLAUDE.md). Cuando exista, su linea va aqui, entre
    // Subtotal y Descuento/Propina.
    if (descuento > 0 || propina > 0) {
      l.push({ cols: ['Subtotal', money(order.total)] })
      if (descuento > 0) l.push({ cols: ['Descuento', `-${money(descuento)}`] })
      if (propina > 0) l.push({ cols: ['Propina', `+${money(propina)}`] })
    }
    l.push({ cols: ['TOTAL A PAGAR', money(totalPagado)], negrita: true })
    if (order.isCourtesy) {
      l.push({ feed: 1 }, { texto: 'CORTESÍA', centro: true, negrita: true, grande: true }, { feed: 1 })
    } else {
      l.push({ raya: true })
      order.payments.forEach((p) => {
        l.push({ cols: [etiquetaPago(p), money(p.amount)] })
        if (p.referencia) l.push({ texto: `  Comprobante: ${p.referencia}` })
      })
      if (cambioTotal > 0) l.push({ cols: ['Cambio', money(cambioTotal)] })
      if (montoCredito > 0) l.push({ feed: 1 }, { texto: 'CRÉDITO', centro: true, negrita: true, grande: true }, { feed: 1 })
    }
    if (porPersona) {
      l.push({ raya: true })
      l.push({ texto: `Dividido entre ${splitCount}: ${money(porPersona)} c/u` })
    }
    l.push({ raya: true })
    l.push({ texto: 'Gracias por su visita', centro: true })
    return l
  }

  // Si hay impresora emparejada sale directo, sin dialogo del navegador. Si
  // ademas hubo pago en efectivo, el cajon se abre solo detras del tiquete —
  // es el unico caso real donde hay que tocar plata en ese momento.
  async function imprimir() {
    const bytes = await construirTicketRaster(tenant, lineasTicket())
    const ok = await imprimirSilencioso(bytes)
    if (!ok) {
      window.print()
      return
    }
    if (order.payments.some((p) => p.method === 'EFECTIVO')) await abrirCajon()
  }

  useEffect(() => {
    if (!autoPrint) return
    const t = setTimeout(imprimir, 150)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrint])

  // Se pregunta el numero en vez de mandar directo: el cliente vinculado
  // puede no tener WhatsApp guardado (o no ser el que recibe la factura), asi
  // que se precarga el que haya pero siempre se deja editar. Vacio abre el
  // selector de contactos de WhatsApp en vez de un chat puntual.
  const [pidiendoWhatsapp, setPidiendoWhatsapp] = useState(false)
  const [numeroWhatsapp, setNumeroWhatsapp] = useState(order.customer?.whatsapp || '')

  // wa.me solo acepta texto plano, no la tirilla visual: arma un resumen
  // equivalente. Los numeros locales (10 digitos) se guardan sin el
  // indicativo de Colombia, asi que se le agrega aqui.
  function mensajeWhatsapp() {
    const lineas = [
      `*${tenant?.legalName || tenant?.name || 'Barminister'}*`,
      ...(order.invoiceNumber ? [`Factura #${String(order.invoiceNumber).padStart(4, '0')}`] : []),
      `Mesa ${order.table?.number}`,
      '',
      ...items.map(
        (it) => `${it.qty} x ${it.name}${it.variantName ? ` · ${it.variantName}` : ''} - ${money(Number(it.price) * it.qty)}`
      ),
      '',
    ]
    if (descuento > 0 || propina > 0) {
      lineas.push(`Subtotal: ${money(order.total)}`)
      if (descuento > 0) lineas.push(`Descuento: -${money(descuento)}`)
      if (propina > 0) lineas.push(`Propina: +${money(propina)}`)
    }
    lineas.push(`*TOTAL A PAGAR: ${money(totalPagado)}*`)
    if (porPersona) lineas.push('', `Dividido entre ${splitCount}: ${money(porPersona)} c/u`)
    lineas.push('', 'Gracias por su visita')
    return lineas.join('\n')
  }

  function confirmarEnvioWhatsapp() {
    const digitos = numeroWhatsapp.replace(/\D/g, '')
    const numero = digitos ? (digitos.length === 10 ? `57${digitos}` : digitos) : ''
    const texto = encodeURIComponent(mensajeWhatsapp())
    window.open(`https://wa.me/${numero}?text=${texto}`, '_blank')
    setPidiendoWhatsapp(false)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
      <div className="flex flex-col items-center gap-3 my-auto">
        <div
          id="receipt-print-root"
          className="bg-white text-[#111] w-[310px] p-4 text-xs rounded shadow-xl max-h-[65vh] overflow-y-auto"
          style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
        >
          <ReciboEncabezado tenant={tenant} />
          <div className="text-center space-y-0.5 mt-1">
            {order.invoiceNumber && <p>Factura #{String(order.invoiceNumber).padStart(4, '0')}</p>}
            <p>{new Date(order.closedAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</p>
          </div>
          <div className="flex justify-between mt-1">
            <span>Mesa {order.table?.number}</span>
            {mesero && <span>{mesero}</span>}
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
            {items.map((it) => (
              <div key={it.id} className="flex justify-between gap-2">
                <span className="flex-1">
                  {it.qty} x {it.name}
                  {it.variantName ? ` · ${it.variantName}` : ''}
                </span>
                <span className="shrink-0">{money(Number(it.price) * it.qty)}</span>
              </div>
            ))}
          </div>

          <div className="my-2 border-t border-dashed border-black/40" />

          {/* Impuestos: pendiente (cada tenant podra configurar el que le
              aplique por ley, ver CLAUDE.md). Cuando exista, su linea va
              aqui, entre Subtotal y Descuento/Propina. */}
          {(descuento > 0 || propina > 0) && (
            <>
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>{money(order.total)}</span>
              </div>
              {descuento > 0 && (
                <div className="flex justify-between">
                  <span>Descuento</span>
                  <span>-{money(descuento)}</span>
                </div>
              )}
              {propina > 0 && (
                <div className="flex justify-between">
                  <span>Propina</span>
                  <span>+{money(propina)}</span>
                </div>
              )}
            </>
          )}
          <div className="flex justify-between font-bold text-sm">
            <span>TOTAL A PAGAR</span>
            <span>{money(totalPagado)}</span>
          </div>

          {order.isCourtesy ? (
            <p className="text-center font-bold text-lg my-3 tracking-wide">CORTESÍA</p>
          ) : (
            <>
              <div className="my-2 border-t border-dashed border-black/40" />
              <div className="space-y-1">
                {order.payments.map((p) => (
                  <div key={p.id}>
                    <div className="flex justify-between">
                      <span>{etiquetaPago(p)}</span>
                      <span>{money(p.amount)}</span>
                    </div>
                    {p.referencia && <p className="text-black/50 text-[10px]">Comprobante: {p.referencia}</p>}
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
          <ReciboPie tenant={tenant} />
        </div>

        <div className="flex gap-2 shrink-0 flex-wrap justify-center">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cerrar
          </button>
          <button type="button" onClick={() => setPidiendoWhatsapp(true)} className="btn-ghost flex items-center gap-2">
            <Icon.phone width={16} height={16} />
            Enviar por WhatsApp
          </button>
          <button type="button" onClick={imprimir} className="btn-primary flex items-center gap-2">
            <Icon.printer width={16} height={16} />
            Imprimir
          </button>
        </div>
      </div>

      {pidiendoWhatsapp && (
        <div
          className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
          onClick={() => setPidiendoWhatsapp(false)}
        >
          <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-sm p-5 space-y-4">
            <h2 className="text-lg font-bold">Enviar por WhatsApp</h2>
            <div>
              <label className="label">Número de WhatsApp</label>
              <input
                type="tel"
                className="field"
                value={numeroWhatsapp}
                onChange={(e) => setNumeroWhatsapp(e.target.value)}
                placeholder="Ej: 300 123 4567"
                autoFocus
              />
              <p className="text-xs text-muted mt-1.5">
                Si no aparece en los contactos de WhatsApp, escríbelo aquí. Déjalo vacío para elegir el chat desde
                WhatsApp.
              </p>
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setPidiendoWhatsapp(false)} className="btn-ghost flex-1">
                Cancelar
              </button>
              <button onClick={confirmarEnvioWhatsapp} className="btn-primary flex-1">
                Enviar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
