import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, money } from '../lib/api'
import { Icon } from '../components/Icons'
import TarjetaStat from '../components/TarjetaStat'
import RangoFechas from '../components/RangoFechas'
import { useAuth } from '../context/AuthContext'
import { calcularRangoDias, formatCorto, parseISOLocal } from '../lib/fechas'
import {
  nuevoLibro,
  escribirTitulo,
  escribirEncabezados,
  autoAjustarColumnas,
  descargarLibro,
  FORMATO_MONEDA,
  FORMATO_PORCENTAJE,
  OCUPADA_ARGB,
} from '../lib/excel'

const RANGOS = [7, 15, 30, 60, 90]

function Avatar({ p }) {
  return (
    <div
      className="w-9 h-9 rounded-lg overflow-hidden grid place-items-center text-[10px] font-bold text-night shrink-0"
      style={{ background: p.categoryColor || '#7c6cf0' }}
    >
      {p.imageUrl ? (
        <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
      ) : (
        p.name.slice(0, 2).toUpperCase()
      )}
    </div>
  )
}

// Un solo encabezado ordenable: clic alterna asc/desc sobre esa columna. El
// icono queda apagado si no es la columna activa, para no competir con el
// numero que si importa.
function Th({ children, sortKey, sort, setSort, align = 'left' }) {
  const activo = sort.key === sortKey
  function alternar() {
    setSort((s) => (s.key === sortKey ? { key: sortKey, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key: sortKey, dir: 'desc' }))
  }
  return (
    <th className={`px-4 py-3 font-semibold ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={alternar}
        className={`inline-flex items-center gap-1 hover:text-ink transition-colors ${
          align === 'right' ? 'flex-row-reverse' : ''
        } ${activo ? 'text-ink' : ''}`}
      >
        {children}
        {activo ? (
          <Icon.chevronDown
            width={12}
            height={12}
            className="text-amber transition-transform"
            style={{ transform: sort.dir === 'asc' ? 'rotate(180deg)' : 'none' }}
          />
        ) : (
          <Icon.sort width={11} height={11} className="text-muted/40" />
        )}
      </button>
    </th>
  )
}

const CON_VENTAS_OPCIONES = [
  { value: 'todos', label: 'Todos' },
  { value: 'con', label: 'Con ventas' },
  { value: 'sin', label: 'Sin ventas' },
]

export default function UtilidadProducto() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const [days, setDays] = useState(30)
  const [rangoCustom, setRangoCustom] = useState(null) // { desde, hasta } (YYYY-MM-DD) | null = usar days
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoria, setCategoria] = useState('')
  const [conVentas, setConVentas] = useState('todos')
  const [sort, setSort] = useState({ key: 'utilidadPeriodo', dir: 'desc' })

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
    api(`/reports/utilidad-producto?${query}`)
      .then(setData)
      .finally(() => setLoading(false))
  }, [days, rangoCustom])

  function elegirDias(r) {
    setRangoCustom(null)
    setDays(r)
  }

  const resumen = useMemo(() => {
    const productos = data?.productos || []
    const utilidadTotal = productos.reduce((s, p) => s + p.utilidadPeriodo, 0)
    const ventasTotal = productos.reduce((s, p) => s + p.precio * p.qtyVendida, 0)
    const unidadesVendidas = productos.reduce((s, p) => s + p.qtyVendida, 0)
    const margenPromedio = ventasTotal > 0 ? (utilidadTotal / ventasTotal) * 100 : 0
    return { utilidadTotal, ventasTotal, unidadesVendidas, margenPromedio }
  }, [data])

  const ranking = useMemo(() => {
    const productos = data?.productos || []
    // Ya viene ordenado por utilidadPeriodo desc desde el backend.
    const top5 = productos.filter((p) => p.utilidadPeriodo > 0).slice(0, 5)
    const max = top5[0]?.utilidadPeriodo || 0
    return { top5, max, total: resumen.utilidadTotal }
  }, [data, resumen])

  const categorias = useMemo(() => {
    if (!data) return []
    return [...new Set(data.productos.map((p) => p.categoryName))].sort((a, b) => a.localeCompare(b, 'es'))
  }, [data])

  const visibles = useMemo(() => {
    if (!data) return []
    const term = search.trim().toLowerCase()
    const filtradas = data.productos
      .filter((p) => !term || p.name.toLowerCase().includes(term))
      .filter((p) => !categoria || p.categoryName === categoria)
      .filter((p) => conVentas === 'todos' || (conVentas === 'con' ? p.qtyVendida > 0 : p.qtyVendida === 0))

    const esTexto = sort.key === 'name' || sort.key === 'categoryName'
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtradas].sort((a, b) =>
      esTexto ? dir * a[sort.key].localeCompare(b[sort.key], 'es') : dir * (a[sort.key] - b[sort.key])
    )
  }, [data, search, categoria, conVentas, sort])

  async function exportarExcel() {
    const TOTAL_COLUMNAS = 8
    const workbook = nuevoLibro()
    const sheet = workbook.addWorksheet('Utilidad de producto')

    const etiquetaPeriodo = `${formatCorto(rango.from)} – ${formatCorto(rango.to)}${
      rangoCustom ? '' : ` (últimos ${days} días)`
    }`

    escribirTitulo(
      sheet,
      {
        titulo: `Utilidad de producto · ${session?.tenant?.name || 'LicorPlus'}`,
        subtitulo: `Periodo: ${etiquetaPeriodo} · Generado el ${new Date().toLocaleDateString('es-CO', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        })}`,
      },
      TOTAL_COLUMNAS
    )

    const resumenFilas = [
      ['Utilidad total', resumen.utilidadTotal, FORMATO_MONEDA],
      ['Ventas', resumen.ventasTotal, FORMATO_MONEDA],
      ['Margen promedio', resumen.margenPromedio / 100, FORMATO_PORCENTAJE],
      ['Productos vendidos', resumen.unidadesVendidas, '#,##0 "und"'],
    ]
    resumenFilas.forEach(([etiqueta, valor, formato]) => {
      const fila = sheet.addRow([etiqueta, valor])
      fila.getCell(1).font = { bold: true }
      fila.getCell(2).numFmt = formato
    })
    sheet.addRow([])

    const filaEncabezados = sheet.rowCount + 1
    escribirEncabezados(
      sheet,
      ['Producto', 'Categoría', 'Precio', 'Costo', 'Margen $', 'Margen %', 'Unidades vendidas', 'Utilidad del periodo'],
      filaEncabezados
    )

    visibles.forEach((p) => {
      const fila = sheet.addRow([
        p.kind === 'PREPARED' ? `${p.name} (preparado)` : p.name,
        p.categoryName,
        p.precio,
        p.costo,
        p.margenUnitario,
        p.margenPct / 100,
        p.qtyVendida,
        p.utilidadPeriodo,
      ])
      fila.getCell(3).numFmt = FORMATO_MONEDA
      fila.getCell(4).numFmt = FORMATO_MONEDA
      fila.getCell(5).numFmt = FORMATO_MONEDA
      fila.getCell(6).numFmt = FORMATO_PORCENTAJE
      fila.getCell(8).numFmt = FORMATO_MONEDA
      // Igual que en la tabla de la app: una linea vendida a perdida se nota
      // en rojo sin tener que leer cada numero.
      if (p.margenUnitario < 0) {
        fila.eachCell((celda) => {
          celda.font = { color: { argb: OCUPADA_ARGB } }
        })
      }
    })

    const filaTotales = sheet.addRow(['Total', '', '', '', '', '', resumen.unidadesVendidas, resumen.utilidadTotal])
    filaTotales.eachCell((celda) => {
      celda.font = { bold: true }
      celda.border = { top: { style: 'thin', color: { argb: 'FFBFBFBF' } } }
    })
    filaTotales.getCell(8).numFmt = FORMATO_MONEDA

    autoAjustarColumnas(sheet, { desde: 3 })
    const sufijoArchivo = rangoCustom ? `${rangoCustom.desde}_a_${rangoCustom.hasta}` : `${days}-dias`
    await descargarLibro(workbook, `utilidad-producto-${sufijoArchivo}.xlsx`)
  }

  return (
    <div className="p-5 md:p-7 max-w-[1200px] mx-auto space-y-5">
      <button
        onClick={() => navigate('/reportes')}
        className="text-sm text-muted hover:text-ink flex items-center gap-1.5"
      >
        <Icon.chevronLeft width={16} height={16} />
        Reportes
      </button>

      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Utilidad de producto</h1>
          <p className="text-muted text-sm mt-1">
            Margen de catálogo (precio − costo) y lo que cada uno dejó de verdad en el periodo.
          </p>
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

      {loading && !data && <p className="text-muted text-sm py-10 text-center">Cargando…</p>}

      {data && (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <TarjetaStat icon={Icon.cash} label="Utilidad total" value={resumen.utilidadTotal} tono="amber" />
            <TarjetaStat icon={Icon.cart} label="Ventas" value={resumen.ventasTotal} tono="amber" />
            <TarjetaStat
              icon={Icon.percent}
              label="Margen promedio"
              value={resumen.margenPromedio}
              tono="libre"
              formato={(v) => `${v.toFixed(1)}%`}
            />
            <TarjetaStat
              icon={Icon.box}
              label="Productos vendidos"
              value={resumen.unidadesVendidas}
              formato={(v) => `${v} und`}
            />
          </div>

          {ranking.top5.length > 0 && (
            <section className="card p-5">
              <h2 className="font-semibold mb-4">Productos que más utilidad generan</h2>
              <div className="space-y-3">
                {ranking.top5.map((p) => {
                  const pctBarra = ranking.max > 0 ? (p.utilidadPeriodo / ranking.max) * 100 : 0
                  const pctTotal = ranking.total > 0 ? (p.utilidadPeriodo / ranking.total) * 100 : 0
                  return (
                    <div key={p.id} className="flex items-center gap-3">
                      <p className="text-sm w-32 sm:w-48 shrink-0 truncate">{p.name}</p>
                      <div className="flex-1 h-2.5 rounded-pill bg-raised overflow-hidden">
                        <div className="h-full rounded-pill bg-amber" style={{ width: `${pctBarra}%` }} />
                      </div>
                      <span className="text-sm font-semibold w-24 text-right shrink-0">{money(p.utilidadPeriodo)}</span>
                      <span className="text-xs text-muted w-24 text-right shrink-0 hidden sm:block">
                        {pctTotal.toFixed(1)}% del total
                      </span>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
                <Icon.search />
              </span>
              <input
                className="field pl-10"
                placeholder="Buscar producto"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select className="field w-44" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              <option value="">Todas las categorías</option>
              {categorias.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select className="field w-36" value={conVentas} onChange={(e) => setConVentas(e.target.value)}>
              {CON_VENTAS_OPCIONES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button onClick={exportarExcel} className="btn-ghost ml-auto" disabled={visibles.length === 0}>
              <Icon.download width={16} height={16} />
              Exportar
            </button>
          </div>

          <div className="card overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted border-b border-edge">
                  <Th sortKey="name" sort={sort} setSort={setSort}>
                    Producto
                  </Th>
                  <Th sortKey="categoryName" sort={sort} setSort={setSort}>
                    Categoría
                  </Th>
                  <Th sortKey="precio" sort={sort} setSort={setSort} align="right">
                    Precio
                  </Th>
                  <Th sortKey="costo" sort={sort} setSort={setSort} align="right">
                    Costo
                  </Th>
                  <Th sortKey="margenPct" sort={sort} setSort={setSort} align="right">
                    Margen
                  </Th>
                  <Th sortKey="qtyVendida" sort={sort} setSort={setSort} align="right">
                    Unidades vendidas
                  </Th>
                  <Th sortKey="utilidadPeriodo" sort={sort} setSort={setSort} align="right">
                    Utilidad del periodo
                  </Th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((p) => (
                  <tr key={p.id} className="border-b border-edge/60 last:border-0 hover:bg-raised/60">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar p={p} />
                        <p className="font-medium flex items-center gap-1.5 min-w-0">
                          <span className="truncate">{p.name}</span>
                          {p.kind === 'PREPARED' && (
                            <Icon.drop width={12} height={12} className="text-muted shrink-0" />
                          )}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-muted">{p.categoryName}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">{money(p.precio)}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap text-muted">
                      {p.costo > 0 ? money(p.costo) : 'Sin costo'}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        <span className={p.margenUnitario < 0 ? 'text-ocupada font-semibold' : ''}>
                          {money(p.margenUnitario)}
                        </span>
                        <span className="text-muted text-xs">· {p.margenPct.toFixed(0)}%</span>
                      </div>
                      <div className="w-20 h-1.5 rounded-pill bg-edge overflow-hidden ml-auto mt-1.5">
                        <div
                          className={`h-full rounded-pill ${p.margenUnitario < 0 ? 'bg-ocupada' : 'bg-libre'}`}
                          style={{ width: `${Math.min(100, Math.abs(p.margenPct))}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right">{p.qtyVendida} und</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap font-semibold">
                      {money(p.utilidadPeriodo)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {!loading && visibles.length === 0 && (
              <p className="px-4 py-10 text-center text-muted text-sm">No hay productos con ese filtro.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
