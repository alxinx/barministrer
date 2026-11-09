import { useEffect, useState } from 'react'
import { api, money } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Icon } from '../components/Icons'
import MoneyInput from '../components/MoneyInput'
import PinField from '../components/PinField'
import RangoFechas from '../components/RangoFechas'
import ReciboModal from '../components/ReciboModal'
import ReciboAbonoModal from '../components/ReciboAbonoModal'
import TicketMovimientoModal from '../components/TicketMovimientoModal'
import { usePinVerificado } from '../hooks/usePinVerificado'
import { parseISOLocal, calcularRangoDias } from '../lib/fechas'
import {
  nuevoLibro,
  escribirTitulo,
  escribirEncabezados,
  autoAjustarColumnas,
  descargarLibro,
  FORMATO_MONEDA,
} from '../lib/excel'

const TIPO_LABEL = { CAJA: 'Caja', BANCO: 'Banco', BILLETERA: 'Billetera' }

function formatFechaHora(iso) {
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function CajasBancos() {
  const { session } = useAuth()
  const [cuentas, setCuentas] = useState(null)
  const [seleccionadaId, setSeleccionadaId] = useState(null)
  const [detalle, setDetalle] = useState(null)
  const [error, setError] = useState('')
  const [modalNuevaCuenta, setModalNuevaCuenta] = useState(false)
  const [modalEditarCuenta, setModalEditarCuenta] = useState(false)
  const [modalMovimiento, setModalMovimiento] = useState(null) // 'INGRESO' | 'EGRESO' | null
  const [modalTraslado, setModalTraslado] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [rango, setRango] = useState(null) // {desde, hasta} (YYYY-MM-DD) | null = todo el historial

  // Lo que se reimprime: a lo sumo uno de los tres a la vez.
  const [reciboVenta, setReciboVenta] = useState(null)
  const [reciboAbono, setReciboAbono] = useState(null)
  const [ticketMovimiento, setTicketMovimiento] = useState(null)

  async function cargarCuentas() {
    try {
      const data = await api('/cajas-bancos/cuentas')
      setCuentas(data)
      if (!seleccionadaId && data.length) setSeleccionadaId(data[0].id)
      return data
    } catch (err) {
      setError(err.message)
      return []
    }
  }

  async function cargarDetalle(id) {
    if (!id) return setDetalle(null)
    try {
      const params = new URLSearchParams()
      if (busqueda.trim()) params.set('search', busqueda.trim())
      if (rango) {
        params.set('desde', rango.desde)
        params.set('hasta', rango.hasta)
      }
      const qs = params.toString()
      const data = await api(`/cajas-bancos/cuentas/${id}${qs ? `?${qs}` : ''}`)
      setDetalle(data)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    cargarCuentas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pequeno debounce en el buscador: no dispara una consulta por cada tecla.
  useEffect(() => {
    const t = setTimeout(() => cargarDetalle(seleccionadaId), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionadaId, busqueda, rango])

  async function recargarTodo() {
    await cargarCuentas()
    await cargarDetalle(seleccionadaId)
  }

  // Reimprime el documento al que el movimiento esta amarrado: si nacio de
  // cobrar una venta o un abono a fiado, esa factura/comprobante real; si es
  // un ingreso/egreso manual o un traslado de este modulo, su propio
  // comprobante (ver TicketMovimientoModal).
  async function reimprimir(m) {
    setError('')
    try {
      if (m.orderPayment) {
        const order = await api(`/orders/${m.orderPayment.orderId}`)
        setReciboVenta(order)
      } else if (m.customerPayment) {
        const customer = await api(`/customers/${m.customerPayment.customerId}`)
        const payment = customer.payments.find((p) => p.id === m.customerPaymentId)
        setReciboAbono({ payment, customer })
      } else {
        setTicketMovimiento({ movimiento: m, cuenta: detalle })
      }
    } catch (err) {
      setError(err.message)
    }
  }

  async function exportarExcel() {
    if (!detalle) return
    const workbook = nuevoLibro()
    const sheet = workbook.addWorksheet('Movimientos')
    escribirTitulo(
      sheet,
      {
        titulo: `Movimientos · ${detalle.nombre}`,
        subtitulo: rango ? `${rango.desde} a ${rango.hasta}` : 'Todo el historial',
      },
      5
    )
    escribirEncabezados(sheet, ['Fecha', 'Tipo', 'Concepto', 'Autor', 'Valor'], 4)
    for (const m of detalle.movimientos) {
      sheet.addRow([
        formatFechaHora(m.createdAt),
        m.tipo,
        m.concepto,
        m.createdBy.name,
        m.tipo === 'INGRESO' ? Number(m.valor) : -Number(m.valor),
      ])
    }
    sheet.getColumn(5).numFmt = FORMATO_MONEDA
    autoAjustarColumnas(sheet, { desde: 4 })
    const slug = detalle.nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    await descargarLibro(workbook, `movimientos-${slug}.xlsx`)
  }

  if (!cuentas) {
    return <div className="p-10 text-sm text-muted">Cargando…</div>
  }

  const rangoCalendario = rango
    ? { from: parseISOLocal(rango.desde), to: parseISOLocal(rango.hasta) }
    : calcularRangoDias(30)

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Cajas y bancos</h1>
          <button type="button" className="btn-primary" onClick={() => setModalNuevaCuenta(true)}>
            <Icon.plus width={16} height={16} />
            Nueva cuenta
          </button>
        </div>

        {error && (
          <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5 mb-4">
            {error}
          </p>
        )}

        <div className="grid grid-cols-[280px_1fr] gap-5">
          <div className="space-y-2">
            {cuentas.length === 0 && (
              <p className="text-sm text-muted card p-4">Todavía no hay cajas ni bancos creados.</p>
            )}
            {cuentas.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSeleccionadaId(c.id)}
                className={`card p-3.5 w-full text-left ${c.id === seleccionadaId ? 'border-amber' : ''}`}
              >
                <p className="text-sm font-semibold flex items-center gap-2">
                  <Icon.bank width={14} height={14} className="text-muted shrink-0" />
                  {c.nombre}
                </p>
                <p className="text-xs text-muted mt-0.5">{TIPO_LABEL[c.tipo]}</p>
                <p className="text-lg font-bold mt-1.5 tabular-nums">{money(c.saldo)}</p>
              </button>
            ))}
          </div>

          <div>
            {!detalle ? (
              <p className="text-sm text-muted card p-6">Selecciona una cuenta para ver su movimiento.</p>
            ) : (
              <div className="card p-5">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h2 className="text-lg font-bold">{detalle.nombre}</h2>
                    <p className="text-xs text-muted">
                      {TIPO_LABEL[detalle.tipo]}
                      {detalle.numeroCuenta && ` · Nº ${detalle.numeroCuenta}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-2xl font-bold tabular-nums">{money(detalle.saldo)}</p>
                    <button
                      type="button"
                      onClick={() => setModalEditarCuenta(true)}
                      className="p-1.5 text-muted hover:text-ink transition-colors"
                      title="Editar cuenta"
                    >
                      <Icon.gear width={16} height={16} />
                    </button>
                  </div>
                </div>

                <div className="flex gap-2 mb-5">
                  <button type="button" className="btn-ghost flex-1" onClick={() => setModalMovimiento('INGRESO')}>
                    Registrar ingreso
                  </button>
                  <button type="button" className="btn-ghost flex-1" onClick={() => setModalMovimiento('EGRESO')}>
                    Registrar egreso
                  </button>
                  <button type="button" className="btn-primary flex-1" onClick={() => setModalTraslado(true)}>
                    Trasladar
                  </button>
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-sm font-semibold text-muted flex-1">Movimientos</h3>
                  <div className="relative w-44">
                    <Icon.search width={14} height={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                    <input
                      className="field h-9 pl-8 text-xs"
                      placeholder="Buscar concepto…"
                      value={busqueda}
                      onChange={(e) => setBusqueda(e.target.value)}
                    />
                  </div>
                  <RangoFechas
                    rango={rangoCalendario}
                    activo={Boolean(rango)}
                    labelOcioso="Todas las fechas"
                    onElegir={setRango}
                  />
                  {rango && (
                    <button
                      type="button"
                      onClick={() => setRango(null)}
                      className="text-xs text-muted hover:text-ink underline"
                    >
                      Limpiar
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={exportarExcel}
                    disabled={detalle.movimientos.length === 0}
                    className="btn-ghost h-9 px-3 text-xs flex items-center gap-1.5 disabled:opacity-40"
                  >
                    <Icon.download width={14} height={14} />
                    Exportar
                  </button>
                </div>

                <div className="space-y-0.5">
                  {detalle.movimientos.length === 0 && (
                    <p className="text-sm text-muted py-2">
                      {busqueda || rango ? 'Nada coincide con el filtro.' : 'Esta cuenta todavía no tiene movimientos.'}
                    </p>
                  )}
                  {detalle.movimientos.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between py-2.5 border-b border-edge/60 last:border-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate flex items-center gap-1.5">
                          {m.trasladoId && <Icon.swap width={13} height={13} className="text-muted shrink-0" />}
                          {m.concepto}
                        </p>
                        <p className="text-xs text-muted mt-0.5">
                          {formatFechaHora(m.createdAt)} · {m.createdBy.name}
                        </p>
                      </div>
                      <div className="flex items-center gap-2.5 shrink-0">
                        <p
                          className={`text-sm font-bold tabular-nums ${m.tipo === 'INGRESO' ? 'text-libre' : 'text-ocupada'}`}
                        >
                          {m.tipo === 'INGRESO' ? '+' : '-'}
                          {money(m.valor)}
                        </p>
                        <button
                          type="button"
                          onClick={() => reimprimir(m)}
                          className="p-1.5 text-muted hover:text-ink transition-colors"
                          title="Reimprimir comprobante"
                        >
                          <Icon.printer width={15} height={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {modalNuevaCuenta && (
        <NuevaCuentaModal
          onCancel={() => setModalNuevaCuenta(false)}
          onCreada={async (cuenta) => {
            setModalNuevaCuenta(false)
            await cargarCuentas()
            setSeleccionadaId(cuenta.id)
          }}
        />
      )}

      {modalEditarCuenta && detalle && (
        <EditarCuentaModal
          cuenta={detalle}
          onCancel={() => setModalEditarCuenta(false)}
          onGuardado={async () => {
            setModalEditarCuenta(false)
            await recargarTodo()
          }}
          onDesactivada={async () => {
            setModalEditarCuenta(false)
            setSeleccionadaId(null)
            setDetalle(null)
            await cargarCuentas()
          }}
        />
      )}

      {modalMovimiento && detalle && (
        <MovimientoModal
          tipo={modalMovimiento}
          cuenta={detalle}
          onCancel={() => setModalMovimiento(null)}
          onRegistrado={async (movimiento) => {
            setModalMovimiento(null)
            await recargarTodo()
            setTicketMovimiento({ movimiento, cuenta: detalle })
          }}
        />
      )}

      {modalTraslado && detalle && (
        <TrasladoModal
          cuentaOrigen={detalle}
          cuentas={cuentas}
          onCancel={() => setModalTraslado(false)}
          onCreado={async (traslado, destino) => {
            setModalTraslado(false)
            await recargarTodo()
            setTicketMovimiento({
              cuenta: detalle,
              movimiento: {
                tipo: 'EGRESO',
                valor: traslado.valor,
                concepto: `Traslado a ${destino.nombre}`,
                createdAt: traslado.createdAt,
                createdBy: traslado.createdBy,
                trasladoId: traslado.id,
              },
            })
          }}
        />
      )}

      {reciboVenta && (
        <ReciboModal order={reciboVenta} splitCount={1} tenant={session?.tenant} onClose={() => setReciboVenta(null)} />
      )}
      {reciboAbono && (
        <ReciboAbonoModal
          payment={reciboAbono.payment}
          customer={reciboAbono.customer}
          tenant={session?.tenant}
          onClose={() => setReciboAbono(null)}
        />
      )}
      {ticketMovimiento && (
        <TicketMovimientoModal
          movimiento={ticketMovimiento.movimiento}
          cuenta={ticketMovimiento.cuenta}
          tenant={session?.tenant}
          onClose={() => setTicketMovimiento(null)}
        />
      )}
    </div>
  )
}

function NuevaCuentaModal({ onCancel, onCreada }) {
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState('CAJA')
  const [codigoEntidadFinanciera, setCodigoEntidadFinanciera] = useState('')
  const [numeroCuenta, setNumeroCuenta] = useState('')
  const [catalogo, setCatalogo] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api('/cajas-bancos/catalogo-entidades').then(setCatalogo)
  }, [])

  const completo = nombre.trim() && (tipo === 'CAJA' || (codigoEntidadFinanciera && numeroCuenta.trim()))

  async function confirmar() {
    setSaving(true)
    setError('')
    try {
      const cuenta = await api('/cajas-bancos/cuentas', {
        method: 'POST',
        body: {
          nombre,
          tipo,
          codigoEntidadFinanciera: tipo === 'CAJA' ? undefined : codigoEntidadFinanciera,
          numeroCuenta: tipo === 'CAJA' ? undefined : numeroCuenta,
        },
      })
      onCreada(cuenta)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-sm p-5 space-y-4">
        <h2 className="text-lg font-bold">Nueva cuenta</h2>

        <div>
          <label className="label">Tipo</label>
          <div className="flex gap-2">
            {Object.entries(TIPO_LABEL).map(([valor, label]) => (
              <button
                key={valor}
                type="button"
                className={tipo === valor ? 'btn-primary flex-1' : 'btn-ghost flex-1'}
                onClick={() => {
                  setTipo(valor)
                  setCodigoEntidadFinanciera('')
                  setNumeroCuenta('')
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Nombre</label>
          <input
            className="field"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder={tipo === 'CAJA' ? 'Caja de nómina' : 'Bancolombia ahorros'}
            autoFocus
          />
        </div>

        {tipo !== 'CAJA' && (
          <>
            <div>
              <label className="label">Entidad</label>
              <select
                className="field"
                value={codigoEntidadFinanciera}
                onChange={(e) => setCodigoEntidadFinanciera(e.target.value)}
              >
                <option value="">Selecciona…</option>
                {catalogo
                  ?.filter((e) => e.tipo === tipo)
                  .map((e) => (
                    <option key={e.codigo} value={e.codigo}>
                      {e.nombre}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="label">Número de {tipo === 'BANCO' ? 'cuenta' : 'billetera'}</label>
              <input
                className="field"
                value={numeroCuenta}
                onChange={(e) => setNumeroCuenta(e.target.value)}
                placeholder="1234567890"
                inputMode="numeric"
              />
            </div>
          </>
        )}

        {error && (
          <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onCancel} className="btn-ghost flex-1">
            Cancelar
          </button>
          <button type="button" onClick={confirmar} disabled={!completo || saving} className="btn-primary flex-1">
            {saving ? 'Creando…' : 'Crear cuenta'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Solo el nombre se puede editar -- el tipo, el banco/billetera y el numero
// de cuenta quedan fijos para siempre (ver PATCH en api/src/routes/
// cajasBancos.js). Desactivar vive aqui mismo, igual que categorias/usuarios.
function EditarCuentaModal({ cuenta, onCancel, onGuardado, onDesactivada }) {
  const [nombre, setNombre] = useState(cuenta.nombre)
  const [saving, setSaving] = useState(false)
  const [desactivando, setDesactivando] = useState(false)
  const [error, setError] = useState('')

  async function guardar() {
    setSaving(true)
    setError('')
    try {
      await api(`/cajas-bancos/cuentas/${cuenta.id}`, { method: 'PATCH', body: { nombre } })
      onGuardado()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function desactivar() {
    setDesactivando(true)
    setError('')
    try {
      await api(`/cajas-bancos/cuentas/${cuenta.id}`, { method: 'PATCH', body: { active: false } })
      onDesactivada()
    } catch (err) {
      setError(err.message)
      setDesactivando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-sm p-5 space-y-4">
        <h2 className="text-lg font-bold">Editar cuenta</h2>

        <div>
          <label className="label">Nombre</label>
          <input className="field" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
        </div>

        {cuenta.tipo !== 'CAJA' && (
          <p className="text-xs text-muted">
            {TIPO_LABEL[cuenta.tipo]}
            {cuenta.numeroCuenta && ` · Nº ${cuenta.numeroCuenta}`} — el tipo y el número no se pueden cambiar
            después de creada la cuenta.
          </p>
        )}

        {error && (
          <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onCancel} className="btn-ghost flex-1">
            Cancelar
          </button>
          <button type="button" onClick={guardar} disabled={!nombre.trim() || saving} className="btn-primary flex-1">
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>

        <div className="pt-3 border-t border-edge">
          <button
            type="button"
            onClick={desactivar}
            disabled={desactivando}
            className="btn-ghost w-full text-ocupada"
          >
            {desactivando ? 'Desactivando…' : 'Desactivar cuenta'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Ingreso/egreso manual directo sobre una cuenta. Ingreso sirve para dejar el
// saldo inicial de una cuenta nueva; egreso es "Pago nomina" y similares.
// Siempre pide PIN de ADMIN -- el backend rechaza el de un CAJERO aunque sea
// correcto (ver api/src/routes/cajasBancos.js).
function MovimientoModal({ tipo, cuenta, onCancel, onRegistrado }) {
  const [valor, setValor] = useState('')
  const [concepto, setConcepto] = useState('')
  const {
    pin,
    setPin,
    valido: pinValido,
    verificando: verificandoPin,
    error: pinError,
    bloqueado: pinBloqueado,
    segundosRestantes: pinSegundosRestantes,
  } = usePinVerificado()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const completo = Number(valor) > 0 && concepto.trim() && pinValido

  async function confirmar() {
    setSaving(true)
    setError('')
    try {
      const movimiento = await api(`/cajas-bancos/cuentas/${cuenta.id}/movimientos`, {
        method: 'POST',
        body: { tipo, valor: Number(valor), concepto, pin },
      })
      onRegistrado(movimiento)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-sm p-5 space-y-4">
        <h2 className="text-lg font-bold">
          {tipo === 'INGRESO' ? 'Registrar ingreso' : 'Registrar egreso'} · {cuenta.nombre}
        </h2>

        <div>
          <label className="label">Valor</label>
          <MoneyInput className="field" value={valor} onChange={setValor} autoFocus />
        </div>
        <div>
          <label className="label">Concepto</label>
          <input
            className="field"
            value={concepto}
            onChange={(e) => setConcepto(e.target.value)}
            placeholder={tipo === 'EGRESO' ? 'Pago nómina octubre' : 'Saldo inicial'}
          />
        </div>

        <PinField
          pin={pin}
          onChange={setPin}
          verificando={verificandoPin}
          error={pinError}
          bloqueado={pinBloqueado}
          segundosRestantes={pinSegundosRestantes}
          label="PIN del administrador"
        />

        {error && (
          <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onCancel} className="btn-ghost flex-1">
            Cancelar
          </button>
          <button type="button" onClick={confirmar} disabled={!completo || saving} className="btn-primary flex-1">
            {saving ? 'Registrando…' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TrasladoModal({ cuentaOrigen, cuentas, onCancel, onCreado }) {
  const destinos = cuentas.filter((c) => c.id !== cuentaOrigen.id)
  const [destinoId, setDestinoId] = useState(destinos[0]?.id || '')
  const [valor, setValor] = useState('')
  const [concepto, setConcepto] = useState('')
  const {
    pin,
    setPin,
    valido: pinValido,
    verificando: verificandoPin,
    error: pinError,
    bloqueado: pinBloqueado,
    segundosRestantes: pinSegundosRestantes,
  } = usePinVerificado()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Si el traslado supera el saldo registrado en origen, el backend lo
  // rechaza con EXCEDE_SALDO (ver cajasBancos.js) en vez de bloquear -- esto
  // guarda ese aviso para mostrar el paso de confirmar/rechazar en vez de un
  // error comun.
  const [alertaSaldo, setAlertaSaldo] = useState(null) // { saldoDisponible } | null
  const completo = destinoId && Number(valor) > 0 && pinValido

  async function confirmar(forzado = false) {
    setSaving(true)
    setError('')
    try {
      const resultado = await api('/cajas-bancos/traslados', {
        method: 'POST',
        body: {
          origenId: cuentaOrigen.id,
          destinoId,
          valor: Number(valor),
          concepto,
          pin,
          ...(forzado && { confirmado: true }),
        },
      })
      const destino = destinos.find((d) => d.id === destinoId)
      onCreado(resultado, destino)
    } catch (err) {
      if (err.error === 'EXCEDE_SALDO') {
        setAlertaSaldo({ saldoDisponible: err.saldoDisponible })
      } else {
        setError(err.message)
      }
    } finally {
      setSaving(false)
    }
  }

  if (destinos.length === 0) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onCancel}>
        <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-sm p-5 space-y-4">
          <h2 className="text-lg font-bold">Trasladar</h2>
          <p className="text-sm text-muted">Necesitas al menos otra cuenta para poder trasladar dinero.</p>
          <button type="button" onClick={onCancel} className="btn-ghost w-full">
            Cerrar
          </button>
        </div>
      </div>
    )
  }

  if (alertaSaldo) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onCancel}>
        <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-sm p-5 space-y-4">
          <div className="flex items-center gap-2 text-ocupada">
            <Icon.alert width={20} height={20} />
            <h2 className="text-lg font-bold">Supera el saldo registrado</h2>
          </div>
          <p className="text-sm text-muted">
            {cuentaOrigen.nombre} tiene registrado {money(alertaSaldo.saldoDisponible)}, pero este traslado es por{' '}
            {money(Number(valor))}. La cuenta va a quedar en negativo. ¿Confirmas de todas formas o prefieres
            corregir el valor?
          </p>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => setAlertaSaldo(null)} className="btn-ghost flex-1">
              Corregir valor
            </button>
            <button type="button" onClick={() => confirmar(true)} disabled={saving} className="btn-danger flex-1">
              {saving ? 'Confirmando…' : 'Confirmar traslado'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-sm p-5 space-y-4">
        <h2 className="text-lg font-bold">Trasladar desde {cuentaOrigen.nombre}</h2>

        <div>
          <label className="label">Hacia</label>
          <select className="field" value={destinoId} onChange={(e) => setDestinoId(e.target.value)}>
            {destinos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre} · {TIPO_LABEL[c.tipo]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Valor</label>
          <MoneyInput className="field" value={valor} onChange={setValor} autoFocus />
        </div>
        <div>
          <label className="label">Concepto (opcional)</label>
          <input className="field" value={concepto} onChange={(e) => setConcepto(e.target.value)} />
        </div>

        <PinField
          pin={pin}
          onChange={setPin}
          verificando={verificandoPin}
          error={pinError}
          bloqueado={pinBloqueado}
          segundosRestantes={pinSegundosRestantes}
          label="PIN del administrador"
        />

        {error && (
          <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onCancel} className="btn-ghost flex-1">
            Cancelar
          </button>
          <button type="button" onClick={() => confirmar(false)} disabled={!completo || saving} className="btn-primary flex-1">
            {saving ? 'Trasladando…' : 'Trasladar'}
          </button>
        </div>
      </div>
    </div>
  )
}
