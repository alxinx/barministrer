import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, money } from '../lib/api'
import { Icon } from '../components/Icons'
import {
  nuevoLibro,
  escribirTitulo,
  escribirEncabezados,
  autoAjustarColumnas,
  descargarLibro,
  FORMATO_MONEDA,
} from '../lib/excel'
import {
  formatFecha,
  formatFechaHora,
  diasParaVencer,
  nombreItemCompra,
  resumenItems,
  ESTADO_LABEL,
  ESTADO_PAGO_LABEL,
  PagoModal,
} from './Compras'
import { ProveedorForm, TIPO_ID_LABEL, CONDICION_LABEL } from './Proveedores'

const FILTROS_COMPRA = [
  { key: 'todas', label: 'Todas' },
  { key: 'RECIBIDA', label: 'Recibidas' },
  { key: 'BORRADOR', label: 'Borrador' },
  { key: 'ANULADA', label: 'Anuladas' },
  { key: 'CON_SALDO', label: 'Con saldo' },
]
const POR_PAGINA = 8

function iniciales(nombre) {
  return (
    nombre
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || '—'
  )
}

function coincide(compra, term) {
  if (!term) return true
  return (
    (compra.numeroDocumento || '').toLowerCase().includes(term) ||
    formatFecha(compra.fecha).toLowerCase().includes(term) ||
    resumenItems(compra.items).toLowerCase().includes(term)
  )
}

export default function ProveedorDetalle() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [proveedor, setProveedor] = useState(null)
  const [error, setError] = useState('')
  const [editando, setEditando] = useState(false)
  const [compraAbierta, setCompraAbierta] = useState(null) // id de la compra en el modal "ver todo"
  const [pagando, setPagando] = useState(null) // compra (row liviano) sobre la que se esta registrando un abono
  const [filtroCompra, setFiltroCompra] = useState('todas')
  const [buscarCompra, setBuscarCompra] = useState('')
  const [pagina, setPagina] = useState(1)

  async function cargar() {
    try {
      setProveedor(await api(`/proveedores/${id}`))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const conteos = useMemo(() => {
    const c = { todas: proveedor?.compras.length || 0, RECIBIDA: 0, BORRADOR: 0, ANULADA: 0, CON_SALDO: 0 }
    for (const compra of proveedor?.compras || []) {
      c[compra.estado] = (c[compra.estado] || 0) + 1
      if (compra.estado === 'RECIBIDA' && compra.saldoPendiente > 0.009) c.CON_SALDO++
    }
    return c
  }, [proveedor])

  const filtradas = useMemo(() => {
    if (!proveedor) return []
    const term = buscarCompra.trim().toLowerCase()
    return proveedor.compras.filter((c) => {
      if (filtroCompra === 'CON_SALDO') {
        if (!(c.estado === 'RECIBIDA' && c.saldoPendiente > 0.009)) return false
      } else if (filtroCompra !== 'todas' && c.estado !== filtroCompra) {
        return false
      }
      return coincide(c, term)
    })
  }, [proveedor, filtroCompra, buscarCompra])

  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA))
  const paginaActual = Math.min(pagina, totalPaginas)
  const visibles = filtradas.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA)

  function cambiarFiltro(key) {
    setFiltroCompra(key)
    setPagina(1)
  }
  function cambiarBusqueda(valor) {
    setBuscarCompra(valor)
    setPagina(1)
  }

  async function exportarExcel() {
    const workbook = nuevoLibro()
    const sheet = workbook.addWorksheet('Compras')
    escribirTitulo(
      sheet,
      {
        titulo: `Historial de compras · ${proveedor.nombreComercial || proveedor.name}`,
        subtitulo: FILTROS_COMPRA.find((f) => f.key === filtroCompra)?.label + (buscarCompra ? ` · "${buscarCompra}"` : ''),
      },
      6
    )
    escribirEncabezados(sheet, ['N° documento', 'Fecha', 'Insumos / detalle', 'Estado', 'Total', 'Saldo pendiente'], 4)
    for (const c of filtradas) {
      sheet.addRow([
        c.numeroDocumento || 'Sin número',
        formatFecha(c.fecha),
        resumenItems(c.items),
        ESTADO_LABEL[c.estado],
        Number(c.total),
        c.estado === 'RECIBIDA' ? Number(c.saldoPendiente) : 0,
      ])
    }
    sheet.getColumn(5).numFmt = FORMATO_MONEDA
    sheet.getColumn(6).numFmt = FORMATO_MONEDA
    autoAjustarColumnas(sheet, { desde: 4 })
    const slug = (proveedor.nombreComercial || proveedor.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')
    await descargarLibro(workbook, `compras-${slug}.xlsx`)
  }

  if (error) {
    return (
      <div className="p-5 md:p-7 max-w-[1200px] mx-auto">
        <BotonVolver onClick={() => navigate('/proveedores')} />
        <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-4 py-3 mt-4">{error}</p>
      </div>
    )
  }
  if (!proveedor) {
    return (
      <div className="p-5 md:p-7 max-w-[1200px] mx-auto">
        <BotonVolver onClick={() => navigate('/proveedores')} />
        <div className="card p-10 text-center text-muted text-sm mt-4">Cargando…</div>
      </div>
    )
  }

  const conDeuda = proveedor.compras.filter((c) => c.estado === 'RECIBIDA' && c.saldoPendiente > 0.009)
  const recibidas = proveedor.compras.filter((c) => c.estado === 'RECIBIDA')
  const vencidas = conDeuda.filter((c) => {
    const d = diasParaVencer(c.fechaVencimiento)
    return d !== null && d < 0
  }).length
  const ultimaRecibida = recibidas[0]
  const hayDatosContacto =
    proveedor.tipoIdentificacion ||
    proveedor.numeroIdentificacion ||
    proveedor.contacto ||
    proveedor.telefono ||
    proveedor.whatsapp ||
    proveedor.email ||
    proveedor.direccion ||
    proveedor.ciudad

  return (
    <div className="p-5 md:p-7 max-w-[1200px] mx-auto">
      <BotonVolver onClick={() => navigate('/proveedores')} />

      {/* Tarjeta de identidad: quien es, como se le paga y como contactarlo,
          todo en un solo lugar -- la pagina no necesita volver aqui despues,
          asi que no hace falta partirlo en varias tarjetas. */}
      <div className="card p-5 mt-4 mb-4 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3.5 min-w-0">
          <span className="w-12 h-12 rounded-xl bg-amber/15 border border-amber/30 grid place-items-center shrink-0 text-amberText font-bold text-base">
            {iniciales(proveedor.nombreComercial || proveedor.name)}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold leading-tight">{proveedor.nombreComercial || proveedor.name}</h1>
              {!proveedor.active && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-pill border border-edge bg-raised text-muted shrink-0">
                  Inactivo
                </span>
              )}
            </div>
            {proveedor.nombreComercial && <p className="text-xs text-muted mt-0.5">{proveedor.name}</p>}

            <div className="flex items-center gap-2 flex-wrap mt-2">
              <span
                className={`text-[10px] font-semibold px-2 py-1 rounded-pill border shrink-0 ${
                  proveedor.condicionPago === 'CREDITO'
                    ? 'text-amberText border-amber/40 bg-amber/10'
                    : 'text-muted border-edge bg-raised'
                }`}
              >
                {CONDICION_LABEL[proveedor.condicionPago]}
                {proveedor.condicionPago === 'CREDITO' && proveedor.diasCredito ? ` · ${proveedor.diasCredito} días` : ''}
              </span>
            </div>

            {hayDatosContacto && (
              <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-2.5 text-xs text-muted">
                {(proveedor.tipoIdentificacion || proveedor.numeroIdentificacion) && (
                  <span className="inline-flex items-center gap-1.5">
                    <Icon.clipboard width={12} height={12} />
                    {TIPO_ID_LABEL[proveedor.tipoIdentificacion] || ''} {proveedor.numeroIdentificacion}
                  </span>
                )}
                {(proveedor.contacto || proveedor.telefono) && (
                  <span className="inline-flex items-center gap-1.5">
                    <Icon.phone width={12} height={12} />
                    {[proveedor.contacto, proveedor.telefono].filter(Boolean).join(' · ')}
                  </span>
                )}
                {(proveedor.direccion || proveedor.ciudad) && (
                  <span className="inline-flex items-center gap-1.5">
                    <Icon.truck width={12} height={12} />
                    {[proveedor.direccion, proveedor.ciudad].filter(Boolean).join(', ')}
                  </span>
                )}
                {proveedor.email && (
                  <span className="inline-flex items-center gap-1.5 truncate max-w-[220px]">
                    <Icon.send width={12} height={12} />
                    {proveedor.email}
                  </span>
                )}
              </div>
            )}

            {proveedor.observaciones && <p className="text-xs text-muted mt-2.5 max-w-[520px]">{proveedor.observaciones}</p>}

            {proveedor.insumos.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {proveedor.insumos.map((i) => (
                  <span key={i.id} className="text-[11px] px-2 py-0.5 rounded-pill border border-edge bg-raised text-muted">
                    {i.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <button type="button" onClick={() => setEditando(true)} className="btn-ghost shrink-0">
          <Icon.gear width={14} height={14} /> Editar
        </button>
      </div>

      {/* 4 cifras reales derivadas de las compras que ya tenemos cargadas --
          nada de metricas de SLA/calificacion que no existen en el dominio. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Tarjeta icon={<Icon.box width={15} height={15} />} label="Total comprado">
          <p className="text-xl font-bold mt-1">{money(proveedor.totalComprado)}</p>
          <p className="text-xs text-muted mt-1">{recibidas.length} compra(s) recibida(s)</p>
        </Tarjeta>

        <Tarjeta icon={<Icon.cash width={15} height={15} />} label="Saldo pendiente">
          <p className={`text-xl font-bold mt-1 ${proveedor.saldoPendiente > 0.009 ? 'text-ocupada' : ''}`}>
            {money(proveedor.saldoPendiente)}
          </p>
          {proveedor.saldoPendiente > 0.009 ? (
            <span
              className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-pill border mt-1 ${
                vencidas > 0 ? 'text-ocupada border-ocupada/40 bg-ocupada/10' : 'text-amberText border-amber/40 bg-amber/10'
              }`}
            >
              {vencidas > 0 ? `${vencidas} vencida(s)` : 'Dentro del plazo'}
            </span>
          ) : (
            <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-pill border border-libre/40 bg-libre/10 text-libre mt-1">
              Sin deuda
            </span>
          )}
        </Tarjeta>

        <Tarjeta icon={<Icon.calendar width={15} height={15} />} label="Última compra">
          <p className="text-xl font-bold mt-1">{ultimaRecibida ? formatFecha(ultimaRecibida.fecha) : '—'}</p>
          <p className="text-xs text-muted mt-1">
            {ultimaRecibida ? `Recibida · ${money(ultimaRecibida.total)}` : 'Todavía no hay recepciones'}
          </p>
        </Tarjeta>

        <Tarjeta icon={<Icon.truck width={15} height={15} />} label="Compras recibidas">
          <p className="text-xl font-bold mt-1">{recibidas.length}</p>
          <p className="text-xs text-muted mt-1">{proveedor.compras.length} registradas en total</p>
        </Tarjeta>
      </div>

      {conDeuda.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold mb-2.5">Abonos a crédito</h2>
          <div className="card border-ocupada/30 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs text-muted uppercase tracking-wide bg-raised">
                  <th className="py-2.5 px-3 font-semibold rounded-tl-2xl">Documento</th>
                  <th className="py-2.5 px-3 font-semibold">Fecha</th>
                  <th className="py-2.5 px-3 font-semibold">Vencimiento</th>
                  <th className="py-2.5 px-3 font-semibold">Saldo</th>
                  <th className="py-2.5 px-3 rounded-tr-2xl"></th>
                </tr>
              </thead>
              <tbody>
                {conDeuda.map((c, idx) => {
                  const dias = diasParaVencer(c.fechaVencimiento)
                  return (
                    <tr key={c.id} className={idx > 0 ? 'border-t border-edge' : ''}>
                      <td className="py-2.5 px-3">
                        <button type="button" onClick={() => setCompraAbierta(c.id)} className="hover:underline text-left">
                          {c.numeroDocumento || 'Sin número'}
                        </button>
                      </td>
                      <td className="py-2.5 px-3 text-muted">{formatFecha(c.fecha)}</td>
                      <td className="py-2.5 px-3">
                        {c.fechaVencimiento ? (
                          <span className={dias !== null && dias < 0 ? 'text-ocupada font-medium' : 'text-muted'}>
                            {formatFecha(c.fechaVencimiento)}
                            {dias !== null && (dias < 0 ? ` · vencida hace ${Math.abs(dias)}d` : ` · ${dias}d`)}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-ocupada">{money(c.saldoPendiente)}</td>
                      <td className="py-2.5 px-3 text-right">
                        <button type="button" onClick={() => setPagando(c)} className="btn-primary h-8 px-3 text-xs">
                          Pagar
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div>
            <h2 className="text-sm font-semibold">Historial de compras</h2>
            <p className="text-xs text-muted mt-0.5">Órdenes y recepciones registradas a este proveedor.</p>
          </div>
          <button type="button" onClick={exportarExcel} disabled={filtradas.length === 0} className="btn-ghost h-9 px-3 text-xs disabled:opacity-40">
            <Icon.download width={14} height={14} /> Exportar a Excel
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div className="flex gap-1.5 flex-wrap">
            {FILTROS_COMPRA.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => cambiarFiltro(f.key)}
                className={`h-8 px-2.5 rounded-lg text-xs font-semibold border transition-colors ${
                  filtroCompra === f.key ? 'bg-amber text-night border-amber' : 'bg-raised text-muted border-edge hover:text-ink'
                }`}
              >
                {f.label} <span className="opacity-70">({conteos[f.key] || 0})</span>
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-64">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
              <Icon.search width={15} height={15} />
            </span>
            <input
              className="field pl-9 h-9 text-sm"
              placeholder="Buscar por N° documento o fecha…"
              value={buscarCompra}
              onChange={(e) => cambiarBusqueda(e.target.value)}
            />
          </div>
        </div>

        {proveedor.compras.length === 0 ? (
          <p className="px-4 py-10 text-center text-muted text-sm">Todavía no hay compras registradas a este proveedor.</p>
        ) : filtradas.length === 0 ? (
          <p className="px-4 py-10 text-center text-muted text-sm">No hay compras con ese filtro.</p>
        ) : (
          <>
            <div className="rounded-xl border border-edge overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left text-xs text-muted uppercase tracking-wide bg-raised">
                    <th className="py-2.5 px-3 font-semibold">Documento</th>
                    <th className="py-2.5 px-3 font-semibold">Fecha</th>
                    <th className="py-2.5 px-3 font-semibold">Insumos / detalle</th>
                    <th className="py-2.5 px-3 font-semibold">Estado</th>
                    <th className="py-2.5 px-3 font-semibold">Total</th>
                    <th className="py-2.5 px-3 font-semibold">Saldo</th>
                    <th className="py-2.5 px-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((c, idx) => (
                    <tr key={c.id} className={`hover:bg-raised/60 transition-colors ${idx > 0 ? 'border-t border-edge' : ''}`}>
                      <td className="py-2.5 px-3">
                        <button type="button" onClick={() => setCompraAbierta(c.id)} className="text-amberText font-medium hover:underline">
                          {c.numeroDocumento || 'Sin número'}
                        </button>
                      </td>
                      <td className="py-2.5 px-3 text-muted">
                        <span className="inline-flex items-center gap-1.5">
                          <Icon.calendar width={12} height={12} />
                          {formatFecha(c.fecha)}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-muted truncate max-w-[220px]">{resumenItems(c.items)}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-pill border ${
                            c.estado === 'RECIBIDA'
                              ? 'text-libre border-libre/40 bg-libre/10'
                              : c.estado === 'ANULADA'
                                ? 'text-muted border-edge bg-raised'
                                : 'text-amberText border-amber/40 bg-amber/10'
                          }`}
                        >
                          {ESTADO_LABEL[c.estado]}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-medium">{money(c.total)}</td>
                      <td className="py-2.5 px-3">
                        {c.estado === 'RECIBIDA' && c.saldoPendiente > 0.009 ? (
                          <span className="text-ocupada font-medium">{money(c.saldoPendiente)}</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button type="button" onClick={() => setCompraAbierta(c.id)} className="text-muted hover:text-ink p-1">
                          <Icon.eye width={15} height={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-edge bg-raised">
                    <td colSpan={4} className="py-2.5 px-3 text-xs font-semibold uppercase tracking-wide text-muted">
                      Total acumulado en esta vista
                    </td>
                    <td className="py-2.5 px-3 font-bold">{money(filtradas.reduce((s, c) => s + Number(c.total), 0))}</td>
                    <td className="py-2.5 px-3 font-bold text-ocupada">
                      {money(filtradas.reduce((s, c) => s + (c.estado === 'RECIBIDA' ? Number(c.saldoPendiente) : 0), 0))}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap mt-3">
              <p className="text-xs text-muted">
                Mostrando {(paginaActual - 1) * POR_PAGINA + 1} a {Math.min(paginaActual * POR_PAGINA, filtradas.length)} de{' '}
                {filtradas.length} compra(s)
              </p>
              {totalPaginas > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPagina((p) => Math.max(1, p - 1))}
                    disabled={paginaActual === 1}
                    className="btn-ghost h-8 px-3 text-xs disabled:opacity-40"
                  >
                    Anterior
                  </button>
                  <span className="text-xs text-muted">
                    {paginaActual} / {totalPaginas}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                    disabled={paginaActual === totalPaginas}
                    className="btn-ghost h-8 px-3 text-xs disabled:opacity-40"
                  >
                    Siguiente
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {editando && (
        <ProveedorForm
          proveedor={proveedor}
          onClose={() => setEditando(false)}
          onSaved={async () => {
            setEditando(false)
            await cargar()
          }}
        />
      )}

      {compraAbierta && (
        <CompraVistaModal
          id={compraAbierta}
          onClose={() => setCompraAbierta(null)}
          onPagado={async () => {
            setCompraAbierta(null)
            await cargar()
          }}
        />
      )}

      {pagando && (
        <PagoModal
          compra={pagando}
          onCancel={() => setPagando(null)}
          onPagado={async () => {
            setPagando(null)
            await cargar()
          }}
        />
      )}
    </div>
  )
}

function BotonVolver({ onClick }) {
  return (
    <button type="button" onClick={onClick} className="text-sm text-muted hover:text-ink flex items-center gap-1">
      <Icon.chevronLeft width={14} height={14} />
      Proveedores
    </button>
  )
}

function Tarjeta({ icon, label, children }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold tracking-wide text-muted uppercase">{label}</p>
        <span className="text-muted">{icon}</span>
      </div>
      {children}
    </div>
  )
}

// Vista de solo lectura de una compra completa: items, totales, pagos y
// factura. A diferencia de CompraDetalle (en Compras.jsx), esta no permite
// editar/recibir/anular -- esas acciones viven en su propia pantalla; aqui
// solo se puede revisar y, si queda saldo, pagarlo.
function CompraVistaModal({ id, onClose, onPagado }) {
  const [compra, setCompra] = useState(null)
  const [error, setError] = useState('')
  const [modalPago, setModalPago] = useState(false)

  async function cargar() {
    try {
      setCompra(await api(`/compras/${id}`))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-2xl p-5 space-y-5 my-8">
        {error && <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">{error}</p>}
        {!compra && !error && <div className="text-center text-muted text-sm py-10">Cargando…</div>}

        {compra && (
          <>
            <header className="flex items-start justify-between gap-3 pb-4 border-b border-edge">
              <div>
                <h2 className="text-lg font-bold">{compra.numeroDocumento || 'Sin número'}</h2>
                <p className="text-xs text-muted mt-0.5">{formatFecha(compra.fecha)}</p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs font-semibold px-2.5 py-1 rounded-pill border ${
                    compra.estado === 'RECIBIDA'
                      ? 'text-libre border-libre/40 bg-libre/10'
                      : compra.estado === 'ANULADA'
                        ? 'text-muted border-edge bg-raised'
                        : 'text-amberText border-amber/40 bg-amber/10'
                  }`}
                >
                  {ESTADO_LABEL[compra.estado]}
                </span>
                <button type="button" onClick={onClose} className="text-muted hover:text-ink">
                  <Icon.x />
                </button>
              </div>
            </header>

            {compra.observaciones && (
              <p className="text-sm text-muted bg-raised border border-edge rounded-xl p-3">{compra.observaciones}</p>
            )}

            {compra.facturaUrl && (
              <a
                href={compra.facturaUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-amberText hover:underline"
              >
                <Icon.receipt width={14} height={14} /> {compra.facturaNombre || 'Ver factura adjunta'}
              </a>
            )}

            <div className="rounded-xl border border-edge overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left text-xs text-muted uppercase tracking-wide bg-raised">
                    <th className="py-2.5 px-3 font-semibold">Insumo o producto</th>
                    <th className="py-2.5 px-3 font-semibold">Cantidad</th>
                    <th className="py-2.5 px-3 font-semibold">Precio unit.</th>
                    <th className="py-2.5 px-3 font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {compra.items.map((it, idx) => (
                    <tr key={it.id} className={idx > 0 ? 'border-t border-edge' : ''}>
                      <td className="py-2 px-3 truncate max-w-[220px]">{nombreItemCompra(it)}</td>
                      <td className="py-2 px-3">
                        {it.cantidad} {it.insumo ? it.insumo.unidadCompra : 'unidad(es)'}
                      </td>
                      <td className="py-2 px-3 text-muted">{money(it.precioUnitario)}</td>
                      <td className="py-2 px-3 font-medium">{money(it.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-raised border border-edge rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-[10px] font-bold tracking-wide text-muted uppercase">Total</p>
                <p className="text-base font-bold mt-0.5">{money(compra.total)}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold tracking-wide text-muted uppercase">Pagado</p>
                <p className="text-base font-bold mt-0.5">{money(compra.totalPagado)}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold tracking-wide text-muted uppercase">Saldo pendiente</p>
                <p className={`text-base font-bold mt-0.5 ${compra.saldoPendiente > 0.009 ? 'text-ocupada' : ''}`}>
                  {money(compra.saldoPendiente)}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold tracking-wide text-muted uppercase">Estado del pago</p>
                <p className="text-base font-bold mt-0.5">{ESTADO_PAGO_LABEL[compra.estadoPago]}</p>
              </div>
            </div>

            {compra.pagos.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-2">Pagos registrados</h3>
                <div className="space-y-1.5">
                  {compra.pagos.map((p) => (
                    <div key={p.id} className="flex items-center justify-between text-sm bg-raised border border-edge rounded-lg px-3 py-2">
                      <div>
                        <p>
                          {p.metodo === 'EFECTIVO_TURNO'
                            ? 'Efectivo de turno'
                            : p.metodo === 'CUENTA_FINANCIERA'
                              ? 'Cuenta financiera'
                              : `Otro${p.nota ? ` · ${p.nota}` : ''}`}
                        </p>
                        <p className="text-xs text-muted">{formatFechaHora(p.createdAt)} · {p.createdBy.name}</p>
                      </div>
                      <p className="font-semibold">{money(p.monto)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {compra.estado === 'ANULADA' && compra.motivoAnulacion && (
              <p className="text-sm text-muted bg-raised border border-edge rounded-xl p-3">
                Motivo de anulación: {compra.motivoAnulacion}
              </p>
            )}

            {compra.estado === 'RECIBIDA' && compra.saldoPendiente > 0.009 && (
              <div className="flex justify-end">
                <button type="button" onClick={() => setModalPago(true)} className="btn-primary">
                  Registrar pago
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {modalPago && compra && (
        <PagoModal
          compra={compra}
          onCancel={() => setModalPago(false)}
          onPagado={async () => {
            setModalPago(false)
            await cargar()
            await onPagado()
          }}
        />
      )}
    </div>
  )
}
