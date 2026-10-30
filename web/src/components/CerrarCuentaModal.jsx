import { useEffect, useState } from 'react'
import { api, money } from '../lib/api'
import { Icon } from './Icons'
import MoneyInput from './MoneyInput'
import PinInput from './PinInput'

const METHODS = [
  { key: 'EFECTIVO', label: 'Efectivo' },
  { key: 'TRANSFERENCIA', label: 'Transferencia Bancolombia' },
  { key: 'NEQUI', label: 'Nequi' },
  { key: 'DATAFONO', label: 'Datáfono' },
  { key: 'CREDITO', label: 'Crédito (fiado)' },
]

/**
 * Cierra la cuenta: paga en uno o varios medios con cambio si es en efectivo,
 * divide el comprobante entre personas (no cambia lo que se cobra, solo lo
 * que imprime), cortesia o descuento. Ambos switches estan escondidos a
 * proposito: hay que tocar 3 veces el titulo "Cerrar cuenta" para cortesia, o
 * 3 veces "Total a cobrar" para descuento (y ninguno de los dos aparece si el
 * rol no tiene el permiso). Credito solo aparece si hay un cliente vinculado
 * con el credito habilitado: fiar sin saber a quien no tiene sentido. Si el
 * cliente no tiene credito o este fiado deja el saldo por encima del cupo,
 * igual se puede continuar (es decision del encargado, no del codigo) pero
 * pide su PIN para que quede quien autorizo cuando se audite.
 */
export default function CerrarCuentaModal({
  orderId,
  total,
  customer,
  saldoCliente,
  puedeDescuento,
  tableLabel,
  items = [],
  onClose,
  onConfirm,
}) {
  const metodosDisponibles = customer ? METHODS : METHODS.filter((m) => m.key !== 'CREDITO')
  const nombreCliente = customer
    ? [customer.firstName, customer.lastName].filter(Boolean).join(' ') + (customer.alias ? ` (${customer.alias})` : '')
    : null
  const itemsActivos = items.filter((i) => i.status === 'ACTIVE')
  const [desgloseAbierto, setDesgloseAbierto] = useState(false)
  const [splitOpen, setSplitOpen] = useState(false)
  const [splitCount, setSplitCount] = useState(1)
  const [rows, setRows] = useState([{ method: 'EFECTIVO', amount: String(total), tendered: '' }])
  const [clickCount, setClickCount] = useState(0)
  const [courtesy, setCourtesy] = useState(false)
  const [totalClickCount, setTotalClickCount] = useState(0)
  const [discountOpen, setDiscountOpen] = useState(false)
  const [finalValue, setFinalValue] = useState(String(total))
  const [cost, setCost] = useState(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // El costo de la cuenta solo se necesita si de verdad se va a aplicar un
  // descuento: evita el viaje a la base de datos (recetas, presentaciones)
  // cada vez que alguien solo quiere cobrar normal.
  useEffect(() => {
    if (!discountOpen) return
    api(`/orders/${orderId}/cost`).then((r) => setCost(r.cost))
  }, [discountOpen, orderId])

  const descuento = discountOpen ? total - (Number(finalValue) || 0) : 0
  const montoACobrar = discountOpen ? Number(finalValue) || 0 : total
  const perdida = discountOpen && cost !== null && montoACobrar < cost
  const descuentoInvalido = discountOpen && (Number(finalValue) < 0 || Number(finalValue) > total)
  const hayDescuento = discountOpen && descuento > 0

  const sumaPagos = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const restante = montoACobrar - sumaPagos
  const porPersona = montoACobrar / (Number(splitCount) || 1)

  // Igual que el descuento: no se bloquea, pero si el cliente no tiene
  // credito o este fiado deja el saldo por encima del cupo, hace falta el
  // PIN de un encargado para que quede el rastro de quien autorizo.
  const montoCredito = rows
    .filter((r) => r.method === 'CREDITO')
    .reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const limiteCredito = customer?.creditLimit !== null && customer?.creditLimit !== undefined ? Number(customer.creditLimit) : null
  const proyectadoCredito = (Number(saldoCliente) || 0) + montoCredito
  const sinCreditoHabilitado = montoCredito > 0 && !customer?.creditEnabled
  const excedeLimiteCredito = montoCredito > 0 && limiteCredito !== null && proyectadoCredito > limiteCredito
  const necesitaAutorizarCredito = sinCreditoHabilitado || excedeLimiteCredito
  const necesitaPin = hayDescuento || necesitaAutorizarCredito

  function setRow(i, patch) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function addRow() {
    setRows((prev) => [...prev, { method: 'EFECTIVO', amount: restante > 0 ? String(restante) : '', tendered: '' }])
  }
  function removeRow(i) {
    setRows((prev) => prev.filter((_, idx) => idx !== i))
  }

  // Mientras solo haya un medio de pago, lo mas comun, se mantiene igualado
  // al valor a cobrar para que activar el descuento no obligue a ir a editar
  // el monto de ese medio tambien. Si ya hay varios, el cajero los reparte el
  // mismo a mano.
  useEffect(() => {
    if (rows.length === 1) setRow(0, { amount: String(montoACobrar) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [montoACobrar])

  function alternarCourtesy() {
    setCourtesy((v) => {
      if (!v) setDiscountOpen(false)
      return !v
    })
  }

  function alternarDescuento() {
    setDiscountOpen((v) => {
      if (!v) {
        setCourtesy(false)
        setFinalValue(String(total))
      }
      setPin('')
      return !v
    })
  }

  async function confirmar() {
    setError('')
    if (courtesy) {
      setSaving(true)
      try {
        await onConfirm({ courtesy: true, splitCount: Number(splitCount) || 1 })
      } catch (err) {
        setError(err.message)
      } finally {
        setSaving(false)
      }
      return
    }

    if (descuentoInvalido) {
      return setError('El valor a cobrar no puede ser negativo ni mayor al total original')
    }
    if (perdida) {
      return setError('Ese descuento deja la cuenta en pérdida')
    }
    if (necesitaPin && !pin.trim()) {
      return setError(
        hayDescuento && necesitaAutorizarCredito
          ? 'El descuento y el fiado necesitan el PIN de un encargado'
          : hayDescuento
            ? 'El descuento necesita el PIN del encargado'
            : 'Ese fiado necesita el PIN de un encargado para autorizarlo'
      )
    }
    if (restante !== 0) {
      return setError(restante > 0 ? `Faltan ${money(restante)} por asignar` : `Sobran ${money(-restante)} asignados`)
    }

    setSaving(true)
    try {
      await onConfirm({
        payments: rows.map((r) => ({
          method: r.method,
          amount: Number(r.amount) || 0,
          ...(r.method === 'EFECTIVO' && r.tendered ? { tendered: Number(r.tendered) } : {}),
        })),
        splitCount: Number(splitCount) || 1,
        ...(hayDescuento ? { discountAmount: descuento } : {}),
        ...(necesitaPin ? { pin: pin.trim() } : {}),
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`card w-full max-w-md p-5 space-y-5 max-h-[90vh] overflow-y-auto transition-colors ${
          perdida ? 'border-2 border-ocupada' : ''
        }`}
      >
        <header className="flex items-center justify-between">
          <h2 onClick={() => setClickCount((c) => c + 1)} className="text-lg font-bold select-none cursor-default">
            Cerrar cuenta
          </h2>
          <div
            onClick={() => !discountOpen && setTotalClickCount((c) => c + 1)}
            className="text-right select-none cursor-default"
          >
            <p className="text-xs text-muted">{discountOpen ? 'Valor a cobrar' : 'Total a cobrar'}</p>
            {discountOpen ? (
              <MoneyInput
                className="field h-9 w-36 text-right font-bold text-amber"
                value={finalValue}
                onChange={setFinalValue}
                autoFocus
              />
            ) : (
              <p className="text-xl font-bold text-amber leading-tight">{money(total)}</p>
            )}
          </div>
        </header>

        {(tableLabel || nombreCliente) && (
          <div className="-mt-3 text-sm text-muted">
            {tableLabel && <p>{tableLabel}</p>}
            {nombreCliente && (
              <p>
                A nombre de <span className="text-ink font-semibold">{nombreCliente}</span>
              </p>
            )}
          </div>
        )}

        {itemsActivos.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setDesgloseAbierto((v) => !v)}
              className="text-xs font-semibold text-muted hover:text-ink flex items-center gap-1.5"
            >
              <Icon.chevronDown width={14} height={14} className={desgloseAbierto ? 'rotate-180' : ''} />
              Desglose de lo consumido
            </button>
            {desgloseAbierto && (
              <div className="mt-2 bg-raised border border-edge rounded-xl p-3 space-y-1.5 max-h-40 overflow-y-auto">
                {itemsActivos.map((it) => (
                  <div key={it.id} className="flex justify-between gap-2 text-sm">
                    <span className="text-ink">
                      {it.qty} × {it.name}
                      {it.variantName ? ` · ${it.variantName}` : ''}
                    </span>
                    <span className="text-muted shrink-0">{money(Number(it.price) * it.qty)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {discountOpen && (
          <div className="bg-raised border border-edge rounded-xl p-3 space-y-1 text-sm">
            <div className="flex justify-between text-muted">
              <span>Valor original</span>
              <span>{money(total)}</span>
            </div>
            <div className="flex justify-between text-muted">
              <span>Descuento</span>
              <span>{money(Math.max(0, descuento))}</span>
            </div>
          </div>
        )}

        {descuentoInvalido && (
          <p className="text-sm font-semibold text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
            El valor a cobrar no puede ser mayor al valor original de la cuenta ({money(total)}) ni negativo.
          </p>
        )}

        {perdida && !descuentoInvalido && (
          <p className="text-sm font-semibold text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
            Ese descuento deja la cuenta en pérdida: el valor a cobrar queda por debajo de lo que cuestan los
            productos. Baja el descuento para poder cobrar.
          </p>
        )}

        {necesitaAutorizarCredito && (
          <p className="text-sm font-semibold text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
            {sinCreditoHabilitado
              ? `${customer.firstName} no tiene crédito habilitado.`
              : `${customer.firstName} ya superó su límite de crédito: quedaría debiendo ${money(proyectadoCredito)} de un cupo de ${money(limiteCredito)}.`}{' '}
            Para fiarle de todos modos, un encargado tiene que autorizarlo con su PIN.
          </p>
        )}

        {necesitaPin && !perdida && !descuentoInvalido && (
          <div>
            <label className="label text-xs text-center">
              PIN del encargado para autorizar{' '}
              {hayDescuento && necesitaAutorizarCredito
                ? 'el descuento y el fiado'
                : hayDescuento
                  ? 'el descuento'
                  : 'el fiado'}
            </label>
            <PinInput value={pin} onChange={setPin} autoFocus />
          </div>
        )}

        {error && (
          <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
            {error}
          </p>
        )}

        {!courtesy && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="label mb-0">Medios de pago</span>
              <button type="button" onClick={addRow} className="text-xs font-semibold text-amber flex items-center gap-1">
                <Icon.plus width={14} height={14} /> Agregar medio
              </button>
            </div>

            {rows.map((r, i) => {
              const cambio = r.method === 'EFECTIVO' && r.tendered ? Number(r.tendered) - Number(r.amount || 0) : 0
              return (
                <div key={i} className="bg-raised border border-edge rounded-xl p-3 space-y-2.5">
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label className="label text-xs">Medio de pago</label>
                      <select
                        className="field h-9"
                        value={r.method}
                        onChange={(e) => setRow(i, { method: e.target.value, tendered: '' })}
                      >
                        {metodosDisponibles.map((m) => (
                          <option key={m.key} value={m.key}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {rows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        aria-label="Quitar este medio de pago"
                        className="h-9 px-1 text-muted hover:text-ocupada"
                      >
                        <Icon.trash width={16} height={16} />
                      </button>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="label text-xs">Monto con este medio</label>
                      <MoneyInput className="field h-9" value={r.amount} onChange={(v) => setRow(i, { amount: v })} />
                    </div>
                    {r.method === 'EFECTIVO' && (
                      <div className="flex-1">
                        <label className="label text-xs">Recibió en efectivo</label>
                        <MoneyInput
                          className="field h-9"
                          value={r.tendered}
                          onChange={(v) => setRow(i, { tendered: v })}
                          placeholder="Igual al monto"
                        />
                      </div>
                    )}
                  </div>

                  {r.method === 'EFECTIVO' && (
                    <p className="text-xs text-muted">Déjalo vacío si pagó el valor exacto, sin cambio.</p>
                  )}
                  {cambio > 0 && (
                    <p className="text-sm font-semibold text-libre">Devolver {money(cambio)} de cambio</p>
                  )}
                  {r.method === 'CREDITO' && (
                    <p className="text-xs text-amber">Se carga como deuda a {customer.firstName}, no entra a caja.</p>
                  )}
                </div>
              )
            })}

            <p className={`text-sm font-semibold ${restante === 0 ? 'text-libre' : 'text-ocupada'}`}>
              {restante === 0
                ? 'Los pagos cuadran con el total'
                : restante > 0
                  ? `Faltan ${money(restante)} por asignar`
                  : `Sobran ${money(-restante)} asignados`}
            </p>
          </div>
        )}

        {courtesy && (
          <p className="text-sm text-amber border border-amber/30 bg-amber/10 rounded-xl px-3 py-2.5">
            Esta cuenta se cierra como cortesía: no se cobra nada y queda como gasto del turno ("Pago a
            proveedor oficial").
          </p>
        )}

        {!splitOpen ? (
          <button
            type="button"
            onClick={() => setSplitOpen(true)}
            className="text-xs font-semibold text-muted hover:text-ink flex items-center gap-1.5"
          >
            <Icon.users width={14} height={14} />
            Dividir el comprobante entre varias personas
          </button>
        ) : (
          <div className="bg-raised border border-edge rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <label className="label mb-0">Dividir el comprobante entre</label>
              <button
                type="button"
                onClick={() => {
                  setSplitOpen(false)
                  setSplitCount(1)
                }}
                className="text-xs text-muted hover:text-ink"
              >
                Quitar
              </button>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="1"
                className="field w-20 h-9"
                value={splitCount}
                onChange={(e) => setSplitCount(e.target.value)}
              />
              <span className="text-sm text-muted">personas · {money(porPersona)} c/u</span>
            </div>
            <p className="text-xs text-muted">
              Solo cambia lo que imprime el comprobante, no afecta los medios de pago de arriba.
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost flex-1">
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={saving || perdida || descuentoInvalido || (necesitaPin && !pin.trim())}
            className="btn-primary flex-1"
          >
            {saving ? 'Procesando…' : courtesy ? 'Marcar como cortesía' : 'Pagar'}
          </button>
        </div>

        {clickCount >= 3 && (
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs font-semibold text-muted">Cortesía</span>
            <button
              type="button"
              onClick={alternarCourtesy}
              className={`h-7 w-12 rounded-pill relative transition-colors ${
                courtesy ? 'bg-amber' : 'bg-raised border border-edge'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full transition-transform ${
                  courtesy ? 'translate-x-5 bg-night' : 'bg-muted'
                }`}
              />
            </button>
          </div>
        )}

        {totalClickCount >= 3 && puedeDescuento && (
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs font-semibold text-muted">Descuento</span>
            <button
              type="button"
              onClick={alternarDescuento}
              className={`h-7 w-12 rounded-pill relative transition-colors ${
                discountOpen ? 'bg-amber' : 'bg-raised border border-edge'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full transition-transform ${
                  discountOpen ? 'translate-x-5 bg-night' : 'bg-muted'
                }`}
              />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
