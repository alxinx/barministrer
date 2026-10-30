import { useMemo, useState } from 'react'
import { money } from '../lib/api'
import { Icon } from './Icons'
import { METHOD_LABEL } from '../lib/paymentMethods'

const POR_PAGINA = 8
// Credito no esta en METHODS (ver lib/paymentMethods.js: el cuadre ciego no
// lo cuenta, es cuenta por cobrar, no efectivo en el cajon), pero si es un
// medio de pago valido al cerrar una cuenta, asi que necesita su propia
// etiqueta aqui para no mostrar el nombre crudo del enum.
const METODO_LABEL = { ...METHOD_LABEL, CREDITO: 'Fiado' }

// Lista de cuentas cerradas con su mesa. Se reusa en el turno activo ("ver
// factura" en vivo) y en el detalle de un turno pasado (consumo por mesa).
export default function FacturasDelDia({ facturas, onVer, titulo = 'Facturas de hoy', subtitulo }) {
  const [filtroMesa, setFiltroMesa] = useState('')
  const [pagina, setPagina] = useState(1)

  const visibles = useMemo(() => {
    const term = filtroMesa.trim()
    if (!term) return facturas
    return facturas.filter((f) => String(f.tableNumber).includes(term))
  }, [facturas, filtroMesa])

  // Si el filtro deja menos paginas de las que habia, la pagina guardada
  // puede quedar fuera de rango: se recorta aqui mismo en vez de en un
  // efecto aparte, para no parpadear a una pagina vacia antes de corregirse.
  const totalPaginas = Math.max(1, Math.ceil(visibles.length / POR_PAGINA))
  const paginaActual = Math.min(pagina, totalPaginas)
  const paginaItems = visibles.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA)

  function cambiarFiltro(v) {
    setFiltroMesa(v)
    setPagina(1)
  }

  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h2 className="font-semibold">{titulo}</h2>
          {subtitulo && <p className="text-xs text-muted mt-0.5">{subtitulo}</p>}
        </div>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
            <Icon.search width={14} height={14} />
          </span>
          <input
            className="field h-9 pl-8 w-32 text-sm"
            placeholder="Mesa…"
            inputMode="numeric"
            value={filtroMesa}
            onChange={(e) => cambiarFiltro(e.target.value)}
          />
        </div>
      </div>
      {visibles.length === 0 && (
        <p className="text-sm text-muted py-6 text-center">Ninguna cuenta en esa mesa.</p>
      )}
      <div>
        {paginaItems.map((f) => (
          <div key={f.id} className="flex items-center gap-3 py-3 border-b border-edge/60 last:border-0">
            <span className="w-11 h-11 rounded-xl bg-raised border border-edge grid place-items-center shrink-0 leading-none">
              <span className="text-center">
                <span className="block text-[8px] font-bold text-muted tracking-wider">MESA</span>
                <span className="block text-base font-bold">{String(f.tableNumber).padStart(2, '0')}</span>
              </span>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium flex items-center gap-2 flex-wrap">
                {f.invoiceNumber && (
                  <span className="text-muted font-mono text-xs">{formatFactura(f.invoiceNumber)}</span>
                )}
                Servicio salón
                {f.isCourtesy ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber border border-amber/40 bg-amber/10 rounded-pill px-2 py-0.5 shrink-0">
                    <Icon.gift width={11} height={11} />
                    Cortesía
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-libre border border-libre/40 bg-libre/10 rounded-pill px-2 py-0.5 shrink-0">
                    <Icon.check width={10} height={10} />
                    Pagada
                  </span>
                )}
                {f.discountAmount > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber border border-amber/40 bg-amber/10 rounded-pill px-2 py-0.5 shrink-0">
                    <Icon.tag width={11} height={11} />
                    Descuento
                  </span>
                )}
              </p>
              <p className="text-xs text-muted mt-0.5">
                Atendido por {f.openedByName} · {formatHora(f.closedAt)}
              </p>
            </div>
            <span className="text-right shrink-0">
              {f.discountAmount > 0 ? (
                <>
                  <span className="block text-xs text-muted line-through">{money(f.total)}</span>
                  <span className="font-semibold">{money(f.total - f.discountAmount)}</span>
                </>
              ) : (
                <span className="font-semibold block">{money(f.total)}</span>
              )}
              {f.metodoPago && (
                <span className="block text-[11px] text-muted mt-0.5">{METODO_LABEL[f.metodoPago] || f.metodoPago}</span>
              )}
            </span>
            <button
              type="button"
              onClick={() => onVer(f.id)}
              aria-label={`Ver factura de la mesa ${f.tableNumber}`}
              className="w-9 h-9 rounded-lg bg-raised border border-edge grid place-items-center text-muted hover:text-amber hover:border-amber/40 transition-colors shrink-0"
            >
              <Icon.receipt width={17} height={17} />
            </button>
          </div>
        ))}
      </div>
      {totalPaginas > 1 && (
        <div className="flex items-center justify-between gap-3 pt-3 mt-1 border-t border-edge">
          <p className="text-xs text-muted">
            {(paginaActual - 1) * POR_PAGINA + 1}–{Math.min(paginaActual * POR_PAGINA, visibles.length)} de {visibles.length}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPagina(paginaActual - 1)}
              disabled={paginaActual === 1}
              aria-label="Página anterior"
              className="w-8 h-8 rounded-lg bg-raised border border-edge grid place-items-center text-muted hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Icon.chevronLeft width={14} height={14} />
            </button>
            <span className="text-xs font-semibold w-20 text-center shrink-0">
              Pág. {paginaActual} de {totalPaginas}
            </span>
            <button
              type="button"
              onClick={() => setPagina(paginaActual + 1)}
              disabled={paginaActual === totalPaginas}
              aria-label="Página siguiente"
              className="w-8 h-8 rounded-lg bg-raised border border-edge grid place-items-center text-muted hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Icon.chevronLeft width={14} height={14} className="rotate-180" />
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function formatHora(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-CO', { timeStyle: 'short' })
}

function formatFactura(n) {
  return `#${String(n).padStart(4, '0')}`
}
