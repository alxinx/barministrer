import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, money } from '../lib/api'
import { Icon } from '../components/Icons'
import TarjetaStat from '../components/TarjetaStat'
import RangoFechas from '../components/RangoFechas'
import { useAuth } from '../context/AuthContext'
import { calcularRangoDias, formatCorto, parseISOLocal } from '../lib/fechas'
import { METHODS } from '../lib/paymentMethods'
import {
  nuevoLibro,
  escribirTitulo,
  escribirEncabezados,
  autoAjustarColumnas,
  descargarLibro,
  FORMATO_MONEDA,
  OCUPADA_ARGB,
} from '../lib/excel'

const RANGOS = [7, 15, 30, 60, 90]

// Recharts pinta SVG con props, no con clases de Tailwind: no lee las CSS
// vars del tema solo, asi que cada serie necesita su par oscuro/sepia a
// mano. Mismos tonos que libre/ocupada en ambos temas para que la grafica
// combine con el resto de la app; el azul de "recaudado" es independiente
// del acento y tambien se oscurece en sepia, si no pierde contraste contra
// el fondo claro de la tarjeta.
const COLORES_SERIE = {
  dark: { recaudado: '#4C9BD6', utilidad: '#5FD18C', costo: '#E05252', grid: '#2E2939', eje: '#9A93A8' },
  sepia: { recaudado: '#1A5E8A', utilidad: '#1F5C31', costo: '#A6321F', grid: '#B9A378', eje: '#6B5A42' },
}

const ETIQUETAS_SERIE = { recaudado: 'Recaudado', utilidad: 'Utilidad', costo: 'Costo' }

function formatFechaCorta(fecha) {
  return new Date(fecha + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-raised border border-edge rounded-xl p-3 text-xs space-y-1 shadow-xl">
      <p className="font-semibold text-ink mb-1">{formatFechaCorta(label)}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2" style={{ color: p.color }}>
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          {ETIQUETAS_SERIE[p.dataKey] || p.dataKey}: {money(p.value)}
        </p>
      ))}
    </div>
  )
}

export default function ReporteVentas() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const colores = COLORES_SERIE[session?.tenant?.theme === 'SEPIA' ? 'sepia' : 'dark']
  const [days, setDays] = useState(30)
  const [rangoCustom, setRangoCustom] = useState(null) // { desde, hasta } (YYYY-MM-DD) | null = usar days
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const rango = useMemo(
    () =>
      rangoCustom
        ? { from: parseISOLocal(rangoCustom.desde), to: parseISOLocal(rangoCustom.hasta) }
        : calcularRangoDias(days),
    [days, rangoCustom]
  )

  useEffect(() => {
    setLoading(true)
    const query = rangoCustom ? `desde=${rangoCustom.desde}&hasta=${rangoCustom.hasta}` : `days=${days}`
    api(`/reports/ventas?${query}`)
      .then(setData)
      .finally(() => setLoading(false))
  }, [days, rangoCustom])

  function elegirDias(r) {
    setRangoCustom(null)
    setDays(r)
  }

  async function exportarExcel() {
    // "Otro" solo aparece si de verdad hay algo ahi (un abono de antes de que
    // el medio de pago fuera obligatorio): si no, es una columna en cero que
    // no le aporta nada al cuadre.
    const hayOtro = data.serie.some((d) => d.OTRO)
    const columnasMetodo = hayOtro ? [...METHODS, { key: 'OTRO', label: 'Otro' }] : METHODS
    const TOTAL_COLUMNAS = 4 + columnasMetodo.length
    const workbook = nuevoLibro()
    const sheet = workbook.addWorksheet('Reporte de ventas')

    const etiquetaPeriodo = `${formatCorto(rango.from)} – ${formatCorto(rango.to)}${
      rangoCustom ? '' : ` (últimos ${days} días)`
    }`

    escribirTitulo(
      sheet,
      {
        titulo: `Reporte de ventas · ${session?.tenant?.name || 'LicorPlus'}`,
        subtitulo: `Periodo: ${etiquetaPeriodo} · Generado el ${new Date().toLocaleDateString('es-CO', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        })}`,
      },
      TOTAL_COLUMNAS
    )

    const resumenFilas = [
      ['Total vendido', data.totales.vendido],
      ['Pendiente por cobrar (créditos)', data.totales.pendienteCredito],
      ['Utilidad', data.totales.utilidad],
      ['Egresos', data.totales.egresos],
    ]
    resumenFilas.forEach(([etiqueta, valor]) => {
      const fila = sheet.addRow([etiqueta, valor])
      fila.getCell(1).font = { bold: true }
      fila.getCell(2).numFmt = FORMATO_MONEDA
    })
    sheet.addRow([])

    const filaEncabezados = sheet.rowCount + 1
    escribirEncabezados(
      sheet,
      ['Día', ...columnasMetodo.map((m) => m.label), 'Recaudado', 'Costo', 'Utilidad'],
      filaEncabezados
    )

    data.serie.forEach((d) => {
      const fila = sheet.addRow([d.date, ...columnasMetodo.map((m) => d[m.key] || 0), d.recaudado, d.costo, d.utilidad])
      for (let c = 2; c <= TOTAL_COLUMNAS; c++) fila.getCell(c).numFmt = FORMATO_MONEDA
      // Un dia que cerro a perdida (costo mayor que lo vendido) se nota en
      // rojo, igual que una linea de producto vendida a perdida en el otro
      // reporte: es la misma alerta, un dia en vez de un producto.
      if (d.utilidad < 0) {
        fila.eachCell((celda) => {
          celda.font = { color: { argb: OCUPADA_ARGB } }
        })
      }
    })

    const totalesPorMetodo = columnasMetodo.map((m) => data.serie.reduce((s, d) => s + (d[m.key] || 0), 0))
    const totalRecaudado = data.serie.reduce((s, d) => s + d.recaudado, 0)
    const totalCosto = data.serie.reduce((s, d) => s + d.costo, 0)
    const totalUtilidad = data.serie.reduce((s, d) => s + d.utilidad, 0)
    const filaTotales = sheet.addRow(['Total', ...totalesPorMetodo, totalRecaudado, totalCosto, totalUtilidad])
    filaTotales.eachCell((celda) => {
      celda.font = { bold: true }
      celda.border = { top: { style: 'thin', color: { argb: 'FFBFBFBF' } } }
    })
    for (let c = 2; c <= TOTAL_COLUMNAS; c++) filaTotales.getCell(c).numFmt = FORMATO_MONEDA

    autoAjustarColumnas(sheet, { desde: 3 })
    const sufijoArchivo = rangoCustom ? `${rangoCustom.desde}_a_${rangoCustom.hasta}` : `${days}-dias`
    await descargarLibro(workbook, `reporte-ventas-${sufijoArchivo}.xlsx`)
  }

  return (
    <div className="p-5 md:p-7 max-w-[1100px] mx-auto space-y-5">
      <button
        onClick={() => navigate('/reportes')}
        className="text-sm text-muted hover:text-ink flex items-center gap-1.5"
      >
        <Icon.chevronLeft width={16} height={16} />
        Reportes
      </button>

      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Reporte de ventas</h1>
          <p className="text-muted text-sm mt-1">Recaudado contra utilidad, día por día.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {RANGOS.map((r) => (
            <button
              key={r}
              onClick={() => elegirDias(r)}
              className={`h-9 px-3.5 rounded-xl text-sm font-semibold border transition-colors ${
                !rangoCustom && days === r
                  ? 'bg-amber text-night border-amber'
                  : 'bg-surface text-muted border-edge hover:text-ink'
              }`}
            >
              {r} días
            </button>
          ))}
          <input
            type="number"
            min="1"
            max="365"
            value={days}
            onChange={(e) => elegirDias(Math.min(365, Math.max(1, Number(e.target.value) || 1)))}
            className="field h-9 w-20 text-center"
          />
          <RangoFechas rango={rango} onElegir={setRangoCustom} activo={Boolean(rangoCustom)} />
        </div>
      </header>

      <section className="card p-5">
        <div className="flex items-center gap-4 text-xs text-muted mb-3 flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: colores.recaudado }} />
            Recaudado
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: colores.utilidad }} />
            Utilidad
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: colores.costo }} />
            Costo
          </span>
          <button onClick={exportarExcel} className="btn-ghost ml-auto" disabled={!data || data.serie.length === 0}>
            <Icon.download width={16} height={16} />
            Exportar
          </button>
        </div>

        {loading || !data ? (
          <div className="h-[300px] grid place-items-center text-muted text-sm">Cargando…</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={data.serie} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gradRecaudado" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={colores.recaudado} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={colores.recaudado} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradUtilidad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={colores.utilidad} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={colores.utilidad} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradCosto" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={colores.costo} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={colores.costo} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={colores.grid} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatFechaCorta}
                stroke={colores.eje}
                fontSize={11}
                tickLine={false}
                axisLine={{ stroke: colores.grid }}
                minTickGap={20}
              />
              <YAxis
                stroke={colores.eje}
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={60}
                tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)}
              />
              <Tooltip content={<ChartTooltip />} />
              <Area
                type="monotone"
                dataKey="recaudado"
                stroke={colores.recaudado}
                fill="url(#gradRecaudado)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="utilidad"
                stroke={colores.utilidad}
                fill="url(#gradUtilidad)"
                strokeWidth={2}
              />
              <Area type="monotone" dataKey="costo" stroke={colores.costo} fill="url(#gradCosto)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </section>

      {data && (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <TarjetaStat icon={Icon.cash} label="Total vendido" value={data.totales.vendido} tono="amber" />
            <TarjetaStat
              icon={Icon.clipboard}
              label="Pendiente por cobrar (créditos)"
              value={data.totales.pendienteCredito}
            />
            <TarjetaStat icon={Icon.chart} label="Utilidad" value={data.totales.utilidad} tono="amber" />
            <TarjetaStat icon={Icon.exit} label="Egresos" value={data.totales.egresos} tono="ocupada" />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <section className="card p-5">
              <h2 className="font-semibold mb-3">Más vendidos</h2>
              {data.masVendidos.length === 0 ? (
                <p className="text-sm text-muted">No hay ventas en este periodo.</p>
              ) : (
                <div>
                  {data.masVendidos.map((p, i) => (
                    <div
                      key={p.productId}
                      className="flex items-center gap-3 py-2 border-b border-edge/60 last:border-0"
                    >
                      <span className="w-6 text-xs text-muted shrink-0">{i + 1}</span>
                      <p className="text-sm flex-1 min-w-0 truncate">{p.name}</p>
                      <span className="text-sm font-semibold shrink-0">{p.qty} und</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="card p-5">
              <h2 className="font-semibold mb-1">Más quedados</h2>
              <p className="text-xs text-muted mb-3">Lo que menos se movió, con el stock que queda hoy.</p>
              {data.masQuedados.length === 0 ? (
                <p className="text-sm text-muted">No hay productos de inventario activos.</p>
              ) : (
                <div>
                  {data.masQuedados.map((p) => (
                    <div
                      key={p.productId}
                      className="flex items-center gap-3 py-2 border-b border-edge/60 last:border-0"
                    >
                      <p className="text-sm flex-1 min-w-0 truncate">{p.name}</p>
                      <span className="text-xs text-muted shrink-0">{p.qty} vendidas</span>
                      <span className="text-sm font-semibold shrink-0">{p.stock} en stock</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
