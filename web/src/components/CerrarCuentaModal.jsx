import { useEffect, useState } from 'react'
import { api, money } from '../lib/api'
import { Icon } from './Icons'
import MoneyInput from './MoneyInput'
import PinField from './PinField'
import { usePinVerificado } from '../hooks/usePinVerificado'
import { useCuentasPago } from '../hooks/useCuentasPago'

// Tarjetas de metodo fijas (ver tarjeta "Finalizar Venta" de referencia que
// trajo Alejo): Transferencia es una sola tarjeta que cubre banco Y
// billetera -- cual de los dos metodos reales se manda (TRANSFERENCIA o
// NEQUI) lo decide el pill de cuenta que se elija debajo, nunca el cajero
// directamente. Credito solo aparece si hay cliente vinculado (ver abajo).
const METHOD_CARDS = [
  { key: 'EFECTIVO', label: 'Efectivo', subtitle: 'Pago físico', icon: 'cash' },
  { key: 'TRANSFERENCIA', label: 'Transferencia', subtitle: 'Bancos y billeteras', icon: 'bank' },
  { key: 'DATAFONO', label: 'Datáfono', subtitle: 'Pago con tarjeta', icon: 'card' },
  { key: 'CREDITO', label: 'Crédito', subtitle: 'Fiado', icon: 'clipboard' },
]

// La tarjeta "Transferencia" cubre tanto TRANSFERENCIA (banco) como NEQUI
// (billetera): una fila cae bajo esa tarjeta sea cual sea el que tenga.
function tarjetaDeMetodo(method) {
  return method === 'NEQUI' ? 'TRANSFERENCIA' : method
}

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
  const cuentasPago = useCuentasPago()
  const tarjetasDisponibles = customer ? METHOD_CARDS : METHOD_CARDS.filter((c) => c.key !== 'CREDITO')
  const nombreCliente = customer
    ? [customer.firstName, customer.lastName].filter(Boolean).join(' ') + (customer.alias ? ` (${customer.alias})` : '')
    : null
  const itemsActivos = items.filter((i) => i.status === 'ACTIVE')
  const [desgloseAbierto, setDesgloseAbierto] = useState(false)
  const [splitOpen, setSplitOpen] = useState(false)
  const [splitCount, setSplitCount] = useState(1)
  const [rows, setRows] = useState([{ method: 'EFECTIVO', amount: String(total), tendered: '', referencia: '' }])
  const [clickCount, setClickCount] = useState(0)
  const [courtesy, setCourtesy] = useState(false)
  const [totalClickCount, setTotalClickCount] = useState(0)
  const [discountOpen, setDiscountOpen] = useState(false)
  const [finalValue, setFinalValue] = useState(String(total))
  const [cost, setCost] = useState(null)
  // Solo importa cuando hay cuentas registradas: controla si se ven los
  // pills de bancos/billeteras dentro de la propia tarjeta "Transferencia"
  // (ver tarjetasDisponibles abajo). Sin cuentas, esa tarjeta vuelve a
  // comportarse como una mas (prende/apaga un campo generico).
  const [transferenciaExpandida, setTransferenciaExpandida] = useState(false)
  const {
    pin,
    setPin,
    valido: pinValido,
    verificando: verificandoPin,
    error: pinError,
    bloqueado: pinBloqueado,
    segundosRestantes: pinSegundosRestantes,
    reset: resetPin,
  } = usePinVerificado()
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
  function removeRow(i) {
    setRows((prev) => prev.filter((_, idx) => idx !== i))
  }
  // Cada tarjeta es un interruptor para su campo GENERICO (sin cuenta real
  // ligada): tocarla prende/apaga ese campo, asi que combinar efectivo +
  // transferencia es tocar las dos tarjetas, no reemplazar una por otra.
  // Nunca toca las filas que ya tienen una cuenta especifica elegida por
  // pill (ver agregarFilaCuenta) -- esas se quitan una por una con su propio
  // boton. Siempre tiene que quedar al menos un medio activo, y no se puede
  // agregar un medio nuevo si ya no falta nada por asignar (ver restante).
  function alternarMetodo(card) {
    // Con cuentas registradas, la tarjeta "Transferencia" no agrega nada por
    // si sola: solo abre/cierra sus pills (ver tarjetasDisponibles abajo).
    if (card.key === 'TRANSFERENCIA' && cuentasPago.length > 0) {
      setTransferenciaExpandida((v) => !v)
      return
    }
    const idx = rows.findIndex((r) => tarjetaDeMetodo(r.method) === card.key && !r.cuentaFinancieraId)
    if (idx >= 0) {
      if (rows.length === 1) return
      removeRow(idx)
    } else {
      if (restante <= 0) return
      setRows((prev) => [
        ...prev,
        { method: card.key, amount: restante > 0 ? String(restante) : '0', tendered: '', referencia: '' },
      ])
    }
  }
  // Cada clic en un pill SUMA una fila nueva, nunca reemplaza una existente:
  // un cliente puede pagar parte con Nequi, parte con una cuenta de
  // Bancolombia y parte con otra cuenta de Bancolombia -- son 3 vouchers
  // distintos, 3 filas distintas, aunque dos caigan en el mismo banco.
  function agregarFilaCuenta(cuenta) {
    if (restante <= 0) return
    setRows((prev) => [
      ...prev,
      {
        method: cuenta.tipo === 'BILLETERA' ? 'NEQUI' : 'TRANSFERENCIA',
        cuentaFinancieraId: cuenta.id,
        amount: restante > 0 ? String(restante) : '0',
        tendered: '',
        referencia: '',
      },
    ])
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
      resetPin()
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
    if (necesitaPin && !pinValido) {
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
          ...(r.cuentaFinancieraId ? { cuentaFinancieraId: r.cuentaFinancieraId } : {}),
          ...(r.referencia?.trim() ? { referencia: r.referencia.trim() } : {}),
        })),
        splitCount: Number(splitCount) || 1,
        ...(hayDescuento ? { discountAmount: descuento } : {}),
        ...(necesitaPin ? { pin } : {}),
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
        className={`card w-full max-w-lg p-5 space-y-5 max-h-[90vh] overflow-y-auto transition-colors ${
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
                className="field h-9 w-36 text-right font-bold text-amberText"
                value={finalValue}
                onChange={setFinalValue}
                autoFocus
              />
            ) : (
              <p className="text-xl font-bold text-amberText leading-tight">{money(total)}</p>
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
          <PinField
            pin={pin}
            onChange={setPin}
            verificando={verificandoPin}
            error={pinError}
            bloqueado={pinBloqueado}
            segundosRestantes={pinSegundosRestantes}
            autoFocus
            label={`PIN del encargado para autorizar ${
              hayDescuento && necesitaAutorizarCredito
                ? 'el descuento y el fiado'
                : hayDescuento
                  ? 'el descuento'
                  : 'el fiado'
            }`}
          />
        )}

        {error && (
          <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
            {error}
          </p>
        )}

        {!courtesy && (
          <div className="space-y-3">
            <label className="label mb-0">Medios de pago</label>

            {/* Cada tarjeta prende/apaga su propio campo -- tocar una segunda
                no reemplaza la primera, las combina. Si no queda nada por
                asignar, una tarjeta todavia apagada no se puede prender
                (quitar o bajar un monto existente la vuelve a habilitar). */}
            <div className="grid grid-cols-2 gap-2">
              {tarjetasDisponibles.map((card) => {
                const CardIcon = Icon[card.icon]
                const esTransferenciaConCuentas = card.key === 'TRANSFERENCIA' && cuentasPago.length > 0
                const activa = esTransferenciaConCuentas
                  ? transferenciaExpandida || rows.some((r) => tarjetaDeMetodo(r.method) === 'TRANSFERENCIA')
                  : rows.some((r) => tarjetaDeMetodo(r.method) === card.key)
                // Deshabilitada solo si tocarla agregaria un medio nuevo (no
                // esta activa, no es el acordeon de transferencia) y ya no
                // falta nada por pagar.
                const deshabilitada = !activa && !esTransferenciaConCuentas && restante <= 0

                return (
                  <button
                    key={card.key}
                    type="button"
                    onClick={() => alternarMetodo(card)}
                    disabled={deshabilitada}
                    className={`flex items-center gap-2.5 p-2.5 rounded-xl border-2 text-left transition-colors ${
                      activa ? 'border-amber bg-amber/10' : 'border-edge bg-raised hover:border-muted'
                    } ${deshabilitada ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    <span
                      className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ${
                        activa ? 'bg-amber text-night' : 'bg-night/30 text-muted'
                      }`}
                    >
                      <CardIcon width={16} height={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{card.label}</p>
                      <p className="text-[11px] text-muted truncate">{card.subtitle}</p>
                    </span>
                    {esTransferenciaConCuentas && (
                      <Icon.chevronDown
                        width={14}
                        height={14}
                        className={`shrink-0 transition-transform ${transferenciaExpandida ? 'rotate-180' : ''}`}
                      />
                    )}
                  </button>
                )
              })}
            </div>

            {/* El detalle de Transferencia (pills + una linea por cuenta
                elegida, con su monto y su comprobante juntos) vive en esta
                misma zona de abajo, junto a los demas medios -- nunca
                metido entre la tarjeta de Transferencia y la de Datafono en
                la grilla de arriba. */}
            {cuentasPago.length > 0 &&
              (transferenciaExpandida || rows.some((r) => tarjetaDeMetodo(r.method) === 'TRANSFERENCIA')) && (
                <div className="bg-raised border border-edge rounded-xl p-3 space-y-2.5">
                  <p className="text-xs font-semibold text-muted">Transferencia</p>
                  <div className="flex flex-wrap gap-1.5">
                    {cuentasPago.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => agregarFilaCuenta(c)}
                        disabled={restante <= 0}
                        className={`px-2.5 py-1 rounded-pill text-xs font-semibold border border-edge text-muted hover:text-ink hover:border-muted transition-colors ${
                          restante <= 0 ? 'opacity-40 cursor-not-allowed' : ''
                        }`}
                      >
                        + {c.nombre}
                      </button>
                    ))}
                  </div>

                  {rows.map((r, i) =>
                    tarjetaDeMetodo(r.method) !== 'TRANSFERENCIA' ? null : (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-xs font-medium text-muted w-20 shrink-0 truncate">
                          {cuentasPago.find((c) => c.id === r.cuentaFinancieraId)?.nombre}
                        </span>
                        <MoneyInput
                          className="field h-9 flex-1 min-w-0"
                          value={r.amount}
                          onChange={(v) => setRow(i, { amount: v })}
                          placeholder="Monto"
                        />
                        <input
                          className="field h-9 flex-1 min-w-0"
                          value={r.referencia || ''}
                          onChange={(e) => setRow(i, { referencia: e.target.value })}
                          placeholder="Nº comprobante"
                        />
                        <button
                          type="button"
                          onClick={() => removeRow(i)}
                          aria-label="Quitar esta transferencia"
                          className="text-muted hover:text-ocupada shrink-0"
                        >
                          <Icon.trash width={15} height={15} />
                        </button>
                      </div>
                    )
                  )}
                </div>
              )}

            {rows.map((r, i) => {
              // Las filas de transferencia con cuenta real ya se muestran
              // dentro de su propia tarjeta (arriba); aqui solo van
              // efectivo, datafono, credito, y transferencia generica (solo
              // existe sin ningun banco/billetera registrado).
              if (tarjetaDeMetodo(r.method) === 'TRANSFERENCIA' && cuentasPago.length > 0) return null
              const card = METHOD_CARDS.find((c) => c.key === tarjetaDeMetodo(r.method))
              const esTransferencia = tarjetaDeMetodo(r.method) === 'TRANSFERENCIA'
              const cambio = r.method === 'EFECTIVO' && r.tendered ? Number(r.tendered) - Number(r.amount || 0) : 0
              return (
                <div key={i} className="bg-raised border border-edge rounded-xl p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted">{card?.label}</p>
                    {rows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        aria-label="Quitar este medio de pago"
                        className="text-muted hover:text-ocupada"
                      >
                        <Icon.trash width={15} height={15} />
                      </button>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="label text-xs">{esTransferencia ? 'Monto' : 'Monto con este medio'}</label>
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
                    {esTransferencia && (
                      <div className="flex-1">
                        <label className="label text-xs">Nº comprobante (opcional)</label>
                        <input
                          className="field h-9"
                          value={r.referencia || ''}
                          onChange={(e) => setRow(i, { referencia: e.target.value })}
                          placeholder="Ej: 123456789"
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
                    <p className="text-xs text-amberText">Se carga como deuda a {customer.firstName}, no entra a caja.</p>
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
          <p className="text-sm text-amberText border border-amber/30 bg-amber/10 rounded-xl px-3 py-2.5">
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
            disabled={saving || perdida || descuentoInvalido || (necesitaPin && !pinValido)}
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
