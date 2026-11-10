import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, money } from '../lib/api'
import { getCategories } from '../lib/categoriesStore'
import { useAuth } from '../context/AuthContext'
import { getSocket } from '../lib/socket'
import { Icon } from '../components/Icons'
import ProductoForm from '../components/ProductoForm'
import InsumoForm from '../components/InsumoForm'
import PinField from '../components/PinField'
import { NuevaCompraModal } from './Compras'
import { usePinVerificado } from '../hooks/usePinVerificado'

const CLAVE_VISTA = 'licorplus:inventarioVista'
const FILAS_POR_PAGINA = 20
const KARDEX_POR_PAGINA = 12

const TABS = [
  { id: 'todo', label: 'Inventario global' },
  { id: 'productos', label: 'Productos de venta directa' },
  { id: 'insumos', label: 'Insumos y materias primas' },
  { id: 'alertas', label: 'En alerta' },
]

export default function AgregarInventario() {
  const { session } = useAuth()
  const esAdmin = session?.user?.role === 'ADMIN'
  const [products, setProducts] = useState([])
  const [insumos, setInsumos] = useState([])
  const [categories, setCategories] = useState([])
  const [categoriasInsumo, setCategoriasInsumo] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [unidades, setUnidades] = useState([])
  const [ultimaCompra, setUltimaCompra] = useState(null)
  const [errorCompras, setErrorCompras] = useState('')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('todo')
  const [categoriasActivas, setCategoriasActivas] = useState(() => new Set())
  const [pagina, setPagina] = useState(0)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [cargando, setCargando] = useState(true)
  const [creando, setCreando] = useState(false)
  const [nuevaCompra, setNuevaCompra] = useState(false)
  const [modalStock, setModalStock] = useState(null)
  const [modalConteo, setModalConteo] = useState('')
  const [kardex, setKardex] = useState(null)
  const [ficha, setFicha] = useState(null)
  const [editando, setEditando] = useState(null)
  const [vista, setVista] = useState(() => {
    try {
      return localStorage.getItem(CLAVE_VISTA) === 'list' ? 'list' : 'grid'
    } catch {
      return 'grid'
    }
  })

  const load = useCallback(async () => {
    setMensaje('')
    setError('')
    try {
      const [productos, categorias, insumosActuales, unidadesActuales, categoriasMateriaPrima, proveedoresActuales] = await Promise.all([
        api('/products'),
        getCategories(session?.tenant.id),
        api('/insumos'),
        api('/insumos/unidades'),
        api('/insumo-categorias'),
        api('/proveedores'),
      ])
      setProducts(productos)
      setCategories(categorias)
      setInsumos(insumosActuales)
      setUnidades(unidadesActuales)
      setCategoriasInsumo(categoriasMateriaPrima)
      setProveedores(proveedoresActuales)
      setCargando(false)
    } catch (loadError) {
      setCargando(false)
      setError(loadError.message || 'No se pudo cargar el inventario')
      return
    }

    try {
      const compras = await api('/compras?filtro=RECIBIDA')
      setUltimaCompra(compras.items?.[0] || null)
      setErrorCompras('')
    } catch (loadError) {
      setUltimaCompra(null)
      setErrorCompras(loadError.message || 'No se pudo consultar la última compra')
    }
  }, [session?.tenant.id])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const socket = getSocket()
    const onInventarioActualizado = () => load()
    socket.on('inventario:actualizado', onInventarioActualizado)
    return () => socket.off('inventario:actualizado', onInventarioActualizado)
  }, [load])

  const inventario = useMemo(() => {
    const productos = products
      .filter((product) => product.kind === 'STOCK')
      .flatMap((product) =>
        (product.variants || []).map((variant) => {
          const category = product.category
          return {
            id: variant.id,
            kind: 'producto',
            name: product.name,
            detail: variant.name && variant.name !== 'Unidad' ? variant.name : '',
            categoryId: category?.id || category?.name || 'sin-categoria',
            categoryName: category?.name || 'Sin categoría',
            stock: Number(variant.stock) || 0,
            minimum: variant.stockMinimo == null ? null : Number(variant.stockMinimo),
            unit: 'un.',
            cost: Number(variant.cost) || 0,
            imageUrl: product.imageUrl,
            color: category?.color,
            active: product.active && variant.active,
            product,
            variant,
          }
        })
      )
    const materiasPrimas = insumos.map((insumo) => {
      const category = insumo.categoria
      const factor = factorConversionInsumo(insumo, unidades)
      return {
        id: insumo.id,
        kind: 'insumo',
        name: insumo.name,
        detail: '',
        categoryId: category?.id || category?.name || 'sin-categoria',
        categoryName: category?.name || 'Sin categoría',
        stock: Number(insumo.stock) || 0,
        minimum: insumo.stockMinimo == null ? null : Number(insumo.stockMinimo),
        unit: insumo.unidadInventario || '',
        cost:
          insumo.costoUnidadInventario != null
            ? Number(insumo.costoUnidadInventario) || 0
            : factor > 0
              ? (Number(insumo.costoCompra) || 0) / factor
              : 0,
        imageUrl: insumo.imageUrl,
        color: null,
        active: insumo.active,
        insumo,
      }
    })
    return [...productos, ...materiasPrimas].sort((a, b) => {
      const porNombre = a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
      return porNombre || a.id.localeCompare(b.id)
    })
  }, [products, insumos, unidades])

  const alertas = useMemo(
    () => inventario.filter((item) => item.stock <= 0 || (item.minimum != null && item.stock <= item.minimum)),
    [inventario]
  )
  const criticos = useMemo(() => inventario.filter((item) => item.stock <= 0), [inventario])
  const stockBajo = useMemo(
    () => inventario.filter((item) => item.stock > 0 && item.minimum != null && item.stock <= item.minimum),
    [inventario]
  )
  const valorTotal = useMemo(
    () => inventario.reduce((total, item) => total + Math.max(0, item.stock) * item.cost, 0),
    [inventario]
  )

  const categorias = useMemo(() => {
    const conteos = new Map()
    for (const item of inventario) {
      const clave = `${item.kind}:${item.categoryId}`
      const actual = conteos.get(clave) || {
        id: clave,
        kind: item.kind,
        name: item.categoryName,
        count: 0,
      }
      actual.count += 1
      conteos.set(clave, actual)
    }
    return [...conteos.values()].sort(
      (a, b) =>
        a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) ||
        a.kind.localeCompare(b.kind)
    )
  }, [inventario])

  const visibles = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es')
    return inventario.filter((item) => {
      if (tab === 'productos' && item.kind !== 'producto') return false
      if (tab === 'insumos' && item.kind !== 'insumo') return false
      if (tab === 'alertas' && item.stock > 0 && !(item.minimum != null && item.stock <= item.minimum)) return false
      if (categoriasActivas.size > 0 && !categoriasActivas.has(`${item.kind}:${item.categoryId}`)) return false
      return (
        !term ||
        `${item.name} ${item.detail} ${item.categoryName} ${item.unit}`
          .toLocaleLowerCase('es')
          .includes(term)
      )
    })
  }, [inventario, tab, categoriasActivas, search])

  const paginaTotal = Math.max(1, Math.ceil(visibles.length / FILAS_POR_PAGINA))
  const paginaSegura = Math.min(pagina, paginaTotal - 1)
  const itemsPagina = visibles.slice(
    paginaSegura * FILAS_POR_PAGINA,
    (paginaSegura + 1) * FILAS_POR_PAGINA
  )

  useEffect(() => {
    setPagina(0)
  }, [tab, categoriasActivas, search])

  function cambiarVista(valor) {
    setVista(valor)
    try {
      localStorage.setItem(CLAVE_VISTA, valor)
    } catch {
      // La preferencia sigue funcionando mientras la pantalla esté abierta.
    }
  }

  function alternarCategoria(id) {
    setCategoriasActivas((anteriores) => {
      const nuevas = new Set(anteriores)
      if (nuevas.has(id)) nuevas.delete(id)
      else nuevas.add(id)
      return nuevas
    })
  }

  async function exportarInventario() {
    try {
      const {
        autoAjustarColumnas,
        descargarLibro,
        escribirEncabezados,
        escribirTitulo,
        FORMATO_MONEDA,
        nuevoLibro,
      } = await import('../lib/excel')
      const workbook = nuevoLibro()
      const sheet = workbook.addWorksheet('Inventario')
      const columnas = [
        'Tipo',
        'Producto o insumo',
        'Presentación',
        'Categoría',
        'Stock',
        'Unidad',
        'Stock mínimo',
        'Costo unitario',
        'Valor en stock',
        'Estado',
      ]
      escribirTitulo(
        sheet,
        {
          titulo: 'Inventario global',
          subtitulo: `Barminister · Generado ${new Date().toLocaleString('es-CO')}`,
        },
        columnas.length
      )
      escribirEncabezados(sheet, columnas, 4)
      for (const item of inventario) {
        sheet.addRow([
          item.kind === 'producto' ? 'Venta directa' : 'Insumo',
          item.name,
          item.detail,
          item.categoryName,
          item.stock,
          item.unit,
          item.minimum,
          item.cost,
          Math.max(0, item.stock) * item.cost,
          etiquetaEstado(item),
        ])
      }
      sheet.getColumn(8).numFmt = FORMATO_MONEDA
      sheet.getColumn(9).numFmt = FORMATO_MONEDA
      sheet.getColumn(5).numFmt = '#,##0.##'
      sheet.getColumn(7).numFmt = '#,##0.##'
      autoAjustarColumnas(sheet, { desde: 4, max: 42 })
      await descargarLibro(workbook, `inventario-${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (exportError) {
      setError(exportError.message || 'No se pudo exportar el inventario')
    }
  }

  async function exportarKardex(item) {
    try {
      const { autoAjustarColumnas, descargarLibro, escribirEncabezados, escribirTitulo, nuevoLibro } =
        await import('../lib/excel')
      const movimientos = await cargarTodosLosMovimientos(item)
      const workbook = nuevoLibro()
      const sheet = workbook.addWorksheet('Kardex')
      const nombre = `${item.name}${item.detail ? ` · ${item.detail}` : ''}`
      const encabezados = ['Fecha y hora', 'Movimiento', 'Cantidad', 'Unidad', 'Registrado por', 'Factura / nota']
      escribirTitulo(
        sheet,
        { titulo: `Kardex · ${nombre}`, subtitulo: `Generado ${new Date().toLocaleString('es-CO')}` },
        encabezados.length
      )
      escribirEncabezados(sheet, encabezados, 4)
      for (const movimiento of movimientos) {
        const cantidad = cantidadMovimiento(item, movimiento)
        const compra = movimiento.compraItem?.compra
        sheet.addRow([
          formatFechaHora(movimiento.createdAt),
          etiquetaMovimiento(movimiento.type),
          cantidad,
          item.unit,
          movimiento.createdBy?.name || '',
          [compra?.numeroDocumento, compra?.proveedor?.name, movimiento.note].filter(Boolean).join(' · '),
        ])
      }
      sheet.getColumn(3).numFmt = '#,##0.##'
      autoAjustarColumnas(sheet, { desde: 4, max: 48 })
      await descargarLibro(
        workbook,
        `kardex-${item.name.toLocaleLowerCase('es').replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.xlsx`
      )
    } catch (exportError) {
      setError(exportError.message || 'No se pudo exportar el historial')
    }
  }

  async function abrirKardex(item) {
    setKardex({ item, cursor: null, anteriores: [], page: 1, items: [], nextCursor: null, loading: true, error: '' })
    try {
      const respuesta = await pedirMovimientos(item, null)
      setKardex((actual) =>
        actual?.item.id === item.id
          ? { ...actual, items: respuesta.items, nextCursor: respuesta.nextCursor, loading: false }
          : actual
      )
    } catch (requestError) {
      setKardex((actual) =>
        actual?.item.id === item.id
          ? { ...actual, loading: false, error: requestError.message || 'No se pudo cargar el historial' }
          : actual
      )
    }
  }

  async function cambiarPaginaKardex(direccion) {
    if (!kardex) return
    const nuevoCursor =
      direccion === 'siguiente' ? kardex.nextCursor : kardex.anteriores[kardex.anteriores.length - 1]
    if (direccion === 'siguiente' && !nuevoCursor) return
    const anteriores =
      direccion === 'siguiente'
        ? [...kardex.anteriores, kardex.cursor]
        : kardex.anteriores.slice(0, -1)
    const siguientePagina = kardex.page + (direccion === 'siguiente' ? 1 : -1)
    setKardex((actual) => ({ ...actual, loading: true, error: '' }))
    try {
      const respuesta = await pedirMovimientos(kardex.item, nuevoCursor)
      setKardex((actual) =>
        actual?.item.id === kardex.item.id
          ? {
              ...actual,
              cursor: nuevoCursor,
              anteriores,
              page: siguientePagina,
              items: respuesta.items,
              nextCursor: respuesta.nextCursor,
              loading: false,
            }
          : actual
      )
    } catch (requestError) {
      setKardex((actual) =>
        actual?.item.id === kardex.item.id
          ? { ...actual, loading: false, error: requestError.message || 'No se pudo cargar el historial' }
          : actual
      )
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1500px] mx-auto space-y-6">
      <header className="flex flex-col xl:flex-row xl:items-end justify-between gap-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Inventario</h1>
          <p className="text-sm text-muted mt-2 max-w-2xl">
            Existencias y movimientos de productos de venta directa e insumos.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost" onClick={exportarInventario} disabled={cargando || !inventario.length}>
            <Icon.download width={16} height={16} />
            Exportar Excel
          </button>
          {esAdmin && (
            <button type="button" className="btn-ghost" onClick={() => setModalStock({ item: null })}>
              <Icon.box width={16} height={16} />
              Ajustar stock
            </button>
          )}
          <button
            type="button"
            className="btn-primary"
            onClick={() => setNuevaCompra(true)}
            disabled={session?.tenant?.moduloCompras === false}
            title={session?.tenant?.moduloCompras === false ? 'El módulo de compras no está activo' : undefined}
          >
            <Icon.truck width={16} height={16} />
            Registrar compra
          </button>
        </div>
      </header>

      {error && (
        <div className="border border-ocupada/35 bg-ocupada/10 rounded-xl px-4 py-3 flex items-center justify-between gap-4" role="alert">
          <p className="text-sm text-ocupada">{error}</p>
          <button type="button" className="btn-ghost shrink-0" onClick={load}>Reintentar</button>
        </div>
      )}
      {mensaje && (
        <p className="border border-libre/30 bg-libre/10 rounded-xl px-4 py-3 text-sm text-libre" role="status">
          {mensaje}
        </p>
      )}

      <section className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 border-y border-edge divide-y sm:divide-y-0 sm:divide-x divide-edge">
        <Stat
          label="Valor total del stock"
          value={money(valorTotal)}
          detail="A costo, sin utilidad"
          icon={<Icon.chart width={17} height={17} />}
        />
        <Stat
          label="Stock bajo / por agotar"
          value={stockBajo.length}
          detail="Sobre el mínimo, pero cerca"
          icon={<Icon.cart width={17} height={17} />}
          onClick={() => setModalConteo('bajo')}
          emphasis={stockBajo.length > 0}
        />
        <Stat
          label="Críticos"
          value={criticos.length}
          detail="Agotados o con stock negativo"
          icon={<Icon.alert width={17} height={17} />}
          onClick={() => setModalConteo('criticos')}
          emphasis={criticos.length > 0}
          danger={criticos.length > 0}
        />
        <Stat
          label="Última entrada"
          value={ultimaCompra?.numeroDocumento ? `Factura ${ultimaCompra.numeroDocumento}` : ultimaCompra ? 'Compra recibida' : '—'}
          detail={
            ultimaCompra
              ? `${ultimaCompra.proveedor?.name || 'Sin proveedor'} · ${formatFechaHora(ultimaCompra.recibidaAt || ultimaCompra.fecha || ultimaCompra.createdAt)}`
              : errorCompras || 'Todavía no hay compras recibidas'
          }
          icon={<Icon.receipt width={17} height={17} />}
          title={errorCompras || undefined}
        />
      </section>

      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Tipo de inventario">
        {TABS.map((item) => {
          const seleccionado = tab === item.id
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={seleccionado}
              onClick={() => setTab(item.id)}
              className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber ${
                seleccionado
                  ? 'border-amber bg-amber text-night'
                  : 'border-edge bg-raised text-muted hover:text-ink'
              }`}
            >
              {item.label}
              {item.id === 'alertas' && alertas.length > 0 && (
                <span className="ml-2 tabular-nums">{alertas.length}</span>
              )}
            </button>
          )
        })}
      </div>

      <section className="space-y-4">
        {categorias.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Filtrar por categorías">
            {categorias.map((categoria) => {
              const activo = categoriasActivas.has(categoria.id)
              return (
                <button
                  type="button"
                  key={categoria.id}
                  aria-pressed={activo}
                  onClick={() => alternarCategoria(categoria.id)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber ${
                    activo
                      ? 'bg-amber/15 border-amber/60 text-amberText'
                      : 'bg-transparent border-edge text-muted hover:text-ink hover:border-edge/80'
                  }`}
                >
                  {categoria.kind === 'producto' ? 'Producto' : 'Insumo'} · {categoria.name}
                  <span className="ml-1.5 opacity-70 tabular-nums">{categoria.count}</span>
                </button>
              )
            })}
            {categoriasActivas.size > 0 && (
              <button
                type="button"
                className="shrink-0 text-xs text-muted underline underline-offset-4 hover:text-ink"
                onClick={() => setCategoriasActivas(new Set())}
              >
                Limpiar categorías
              </button>
            )}
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">{TABS.find((item) => item.id === tab)?.label}</h2>
            <p className="text-xs text-muted mt-1">
              {visibles.length} {visibles.length === 1 ? 'registro' : 'registros'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="relative flex-1 sm:w-80">
              <span className="sr-only">Buscar en el inventario</span>
              <Icon.search width={16} height={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                className="field pl-10 h-10 text-sm"
                placeholder="Buscar por nombre o categoría"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className="flex items-center gap-0.5 border border-edge rounded-lg p-0.5 shrink-0">
              <button
                type="button"
                onClick={() => cambiarVista('grid')}
                aria-label="Ver en cuadrícula"
                aria-pressed={vista === 'grid'}
                className={`w-9 h-9 rounded-md grid place-items-center ${
                  vista === 'grid' ? 'bg-amber text-night' : 'text-muted hover:text-ink'
                }`}
              >
                <Icon.grid width={16} height={16} />
              </button>
              <button
                type="button"
                onClick={() => cambiarVista('list')}
                aria-label="Ver en lista"
                aria-pressed={vista === 'list'}
                className={`w-9 h-9 rounded-md grid place-items-center ${
                  vista === 'list' ? 'bg-amber text-night' : 'text-muted hover:text-ink'
                }`}
              >
                <Icon.list width={16} height={16} />
              </button>
            </div>
          </div>
        </div>

        {cargando ? (
          <p className="py-12 text-center text-sm text-muted">Cargando inventario…</p>
        ) : itemsPagina.length === 0 ? (
          <div className="border-y border-edge py-12 text-center">
            <p className="text-sm text-muted">
              {search.trim()
                ? `No hay resultados para “${search.trim()}”.`
                : tab === 'alertas'
                  ? 'No hay productos ni insumos en alerta.'
                  : 'Todavía no hay registros en esta vista.'}
            </p>
            {tab === 'productos' && (
              <button type="button" onClick={() => setCreando(true)} className="btn-primary mt-4">
                <Icon.plus width={16} height={16} />
                Crear producto
              </button>
            )}
          </div>
        ) : vista === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-x-5 gap-y-3">
            {itemsPagina.map((item) => (
              <InventarioCard
                key={`${item.kind}:${item.id}`}
                item={item}
                onKardex={() => abrirKardex(item)}
                onAjustar={() => setModalStock({ item })}
                onVerFicha={() => setFicha(item)}
              />
            ))}
          </div>
        ) : (
          <div className="border-y border-edge overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted uppercase tracking-wide">
                  <th className="py-3 px-3 font-semibold">Producto o insumo</th>
                  <th className="py-3 px-3 font-semibold">Categoría</th>
                  <th className="py-3 px-3 font-semibold">Stock</th>
                  <th className="py-3 px-3 font-semibold">Mínimo</th>
                  <th className="py-3 px-3 font-semibold">Valor en stock</th>
                  <th className="py-3 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {itemsPagina.map((item) => (
                  <InventarioRow
                    key={`${item.kind}:${item.id}`}
                    item={item}
                    onKardex={() => abrirKardex(item)}
                    onAjustar={() => setModalStock({ item })}
                    onVerFicha={() => setFicha(item)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {visibles.length > FILAS_POR_PAGINA && (
          <nav className="flex items-center justify-between gap-3 pt-2" aria-label="Paginación del inventario">
            <span className="text-xs text-muted tabular-nums">
              {paginaSegura * FILAS_POR_PAGINA + 1}–{Math.min((paginaSegura + 1) * FILAS_POR_PAGINA, visibles.length)} de {visibles.length}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-ghost h-9"
                disabled={paginaSegura === 0}
                onClick={() => setPagina((actual) => Math.max(0, actual - 1))}
              >
                <Icon.chevronLeft width={15} height={15} />
                Anterior
              </button>
              <button
                type="button"
                className="btn-ghost h-9"
                disabled={paginaSegura >= paginaTotal - 1}
                onClick={() => setPagina((actual) => Math.min(paginaTotal - 1, actual + 1))}
              >
                Siguiente
                <Icon.chevronRight width={15} height={15} />
              </button>
            </div>
          </nav>
        )}
      </section>

      {creando && (
        <ProductoForm
          categories={categories}
          product={null}
          initialName={search.trim()}
          onClose={() => setCreando(false)}
          onSaved={() => {
            setCreando(false)
            setSearch('')
            load()
          }}
        />
      )}
      {nuevaCompra && (
        <NuevaCompraModal
          onClose={() => setNuevaCompra(false)}
          onCreated={async () => {
            await load()
            setNuevaCompra(false)
          }}
        />
      )}
      {modalStock && (
        <AjusteStockModal
          key={modalStock.item ? `${modalStock.item.kind}:${modalStock.item.id}` : 'selector'}
          item={modalStock.item}
          items={inventario}
          onClose={() => setModalStock(null)}
          onSelect={(item) => setModalStock({ item })}
          onSaved={async (resultado) => {
            const diferencia = resultado.diferencia
            const signo = diferencia > 0 ? '+' : ''
            setModalStock(null)
            await load()
            setMensaje(
              `Ajuste registrado: ${resultado.item.name}, ${resultado.stockAnterior} → ${resultado.stock} ${resultado.item.unit} (${signo}${diferencia}).`
            )
          }}
        />
      )}
      {modalConteo && (
        <ModalConteo
          tipo={modalConteo}
          items={modalConteo === 'bajo' ? stockBajo : criticos}
          onClose={() => setModalConteo('')}
          onKardex={(item) => {
            setModalConteo('')
            abrirKardex(item)
          }}
        />
      )}
      {kardex && (
        <KardexModal
          kardex={kardex}
          onClose={() => setKardex(null)}
          onPage={cambiarPaginaKardex}
          onExport={() => exportarKardex(kardex.item)}
        />
      )}
      {ficha && (
        <FichaTecnicaModal
          item={ficha}
          esAdmin={esAdmin}
          onClose={() => setFicha(null)}
          onEdit={() => {
            setEditando(ficha)
            setFicha(null)
          }}
        />
      )}
      {editando?.kind === 'producto' && (
        <ProductoForm
          categories={categories}
          product={editando.product}
          onClose={() => setEditando(null)}
          onSaved={async () => {
            setEditando(null)
            await load()
          }}
        />
      )}
      {editando?.kind === 'insumo' && (
        <InsumoForm
          insumo={editando.insumo}
          categorias={categoriasInsumo}
          proveedores={proveedores}
          unidades={unidades}
          onClose={() => setEditando(null)}
          onSaved={async () => {
            setEditando(null)
            await load()
          }}
        />
      )}
    </div>
  )
}

function factorConversionInsumo(insumo, unidades) {
  const compra = unidades.find((unidad) => unidad.codigo === insumo.unidadCompra)
  const inventario = unidades.find((unidad) => unidad.codigo === insumo.unidadInventario)
  if (
    compra?.factor != null &&
    inventario?.factor != null &&
    compra.magnitud === inventario.magnitud
  ) {
    return Number(compra.factor) / Number(inventario.factor)
  }
  return Number(insumo.cantidadPromedioPorUnidad) || 0
}

function etiquetaEstado(item) {
  if (item.stock <= 0) return 'Crítico'
  if (item.minimum != null && item.stock <= item.minimum) return 'Bajo'
  return 'Normal'
}

function etiquetaMovimiento(type) {
  const nombres = {
    PURCHASE: 'Compra',
    PURCHASE_VOID: 'Anulación de compra',
    SALE: 'Venta',
    VOID_RESTORE: 'Devolución',
    WASTE: 'Merma',
    ADJUSTMENT: 'Ajuste',
    RETURN: 'Devolución',
  }
  return nombres[type] || String(type || 'Movimiento').replaceAll('_', ' ').toLocaleLowerCase('es')
}

function cantidadMovimiento(item, movimiento) {
  const cantidad = Number(movimiento.qty)
  if (item.kind === 'producto' || movimiento.type === 'ADJUSTMENT') return cantidad
  return movimiento.type === 'SALE' || movimiento.type === 'WASTE' ? -cantidad : cantidad
}

function Stat({ label, value, detail, icon, onClick, emphasis = false, danger = false, title }) {
  const contenido = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-muted">{label}</p>
        <span className={danger ? 'text-ocupada' : emphasis ? 'text-amberText' : 'text-muted'}>{icon}</span>
      </div>
      <p className={`mt-3 font-bold tabular-nums ${typeof value === 'string' ? 'text-lg' : 'text-2xl'} ${danger ? 'text-ocupada' : ''}`}>
        {value}
      </p>
      <p className="text-xs text-muted mt-1 line-clamp-2" title={title}>{detail}</p>
    </>
  )
  if (!onClick) return <div className="px-4 py-4 sm:px-5">{contenido}</div>
  return (
    <button
      type="button"
      className="px-4 py-4 sm:px-5 text-left hover:bg-raised/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-amber transition-colors"
      onClick={onClick}
      aria-label={`${label}: ${value}. Ver detalle`}
    >
      {contenido}
    </button>
  )
}

function InventarioCard({ item, onKardex, onAjustar, onVerFicha }) {
  const estado = etiquetaEstado(item)
  return (
    <article className="border-b border-edge py-3 flex items-center gap-3 min-w-0">
      <ImagenInventario item={item} size="large" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wide text-muted">
            {item.kind === 'producto' ? 'Venta directa' : 'Insumo'} · {item.categoryName}
          </span>
          {estado !== 'Normal' && <EstadoStock estado={estado} />}
        </div>
        <p className="font-semibold truncate mt-1" title={`${item.name}${item.detail ? ` · ${item.detail}` : ''}`}>
          {item.name}{item.detail ? <span className="font-normal text-muted"> · {item.detail}</span> : null}
        </p>
        <p className={`text-sm mt-1 tabular-nums ${estado === 'Crítico' ? 'text-ocupada' : estado === 'Bajo' ? 'text-warningText' : 'text-muted'}`}>
          {item.stock} {item.unit}
          <span className="text-muted"> · mínimo {item.minimum == null ? '—' : `${item.minimum} ${item.unit}`}</span>
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <AccionIcono label="Ver historial / Kardex" onClick={onKardex}>
          <Icon.clock width={16} height={16} />
          <Icon.chevronRight width={13} height={13} />
        </AccionIcono>
        <AccionIcono label="Ajuste de stock (próximamente)" onClick={onAjustar}>
          <Icon.box width={16} height={16} />
        </AccionIcono>
        <AccionIcono label={`Ver ficha técnica de ${item.name}`} onClick={onVerFicha}>
          <Icon.eye width={16} height={16} />
        </AccionIcono>
      </div>
    </article>
  )
}

function InventarioRow({ item, onKardex, onAjustar, onVerFicha }) {
  const estado = etiquetaEstado(item)
  return (
    <tr className="border-t border-edge first:border-t-0 hover:bg-raised/30">
      <td className="py-2.5 px-3">
        <div className="flex items-center gap-3 min-w-0">
          <ImagenInventario item={item} />
          <div className="min-w-0">
            <p className="font-medium truncate">{item.name}{item.detail ? ` · ${item.detail}` : ''}</p>
            <p className="text-xs text-muted">{item.kind === 'producto' ? 'Venta directa' : 'Insumo'}</p>
          </div>
        </div>
      </td>
      <td className="py-2.5 px-3 text-muted">{item.categoryName}</td>
      <td className={`py-2.5 px-3 font-semibold tabular-nums ${estado === 'Crítico' ? 'text-ocupada' : estado === 'Bajo' ? 'text-warningText' : ''}`}>
        {item.stock} {item.unit}
      </td>
      <td className="py-2.5 px-3 text-muted tabular-nums">{item.minimum == null ? '—' : `${item.minimum} ${item.unit}`}</td>
      <td className="py-2.5 px-3 tabular-nums">{money(Math.max(0, item.stock) * item.cost)}</td>
      <td className="py-2.5 px-3">
        <div className="flex justify-end gap-1">
          <AccionIcono label="Ver historial / Kardex" onClick={onKardex}>
            <Icon.clock width={16} height={16} />
            <Icon.chevronRight width={13} height={13} />
          </AccionIcono>
          <AccionIcono label="Ajuste de stock (próximamente)" onClick={onAjustar}>
            <Icon.box width={16} height={16} />
          </AccionIcono>
          <AccionIcono label={`Ver ficha técnica de ${item.name}`} onClick={onVerFicha}>
            <Icon.eye width={16} height={16} />
          </AccionIcono>
        </div>
      </td>
    </tr>
  )
}

function ImagenInventario({ item, size = 'small' }) {
  const dimensions = size === 'large' ? 'w-14 h-14 rounded-xl' : 'w-10 h-10 rounded-lg'
  return (
    <div
      className={`${dimensions} shrink-0 overflow-hidden grid place-items-center text-muted`}
      style={{ backgroundColor: item.color || 'rgb(var(--color-raised))' }}
    >
      {item.imageUrl ? (
        <img src={item.imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <Icon.box width={size === 'large' ? 22 : 18} height={size === 'large' ? 22 : 18} />
      )}
    </div>
  )
}

function EstadoStock({ estado }) {
  return (
    <span
      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
        estado === 'Crítico' ? 'bg-ocupada/15 text-ocupada' : 'bg-warning/20 text-warningText'
      }`}
    >
      {estado}
    </span>
  )
}

function AccionIcono({ label, children, onClick, activo = false }) {
  return (
    <button
      type="button"
      className={`w-9 h-9 rounded-lg grid place-items-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber ${
        activo ? 'text-amberText bg-amber/10' : 'text-muted hover:text-ink hover:bg-raised'
      }`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <span className="flex items-center">{children}</span>
    </button>
  )
}

function FichaTecnicaModal({ item, esAdmin, onClose, onEdit }) {
  const [ficha, setFicha] = useState(null)
  const [pestana, setPestana] = useState('ventas')
  const [cargando, setCargando] = useState(true)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [cargandoMasCompras, setCargandoMasCompras] = useState(false)
  const [error, setError] = useState('')
  const [errorMas, setErrorMas] = useState('')
  const [errorMasCompras, setErrorMasCompras] = useState('')
  const esProducto = item.kind === 'producto'
  const nombre = `${item.name}${item.detail ? ` · ${item.detail}` : ''}`

  useEffect(() => {
    let vigente = true
    setCargando(true)
    setError('')
    api(`/inventory/ficha/${item.kind}/${item.id}`)
      .then((data) => {
        if (vigente) setFicha(data)
      })
      .catch((requestError) => {
        if (vigente) setError(requestError.message || 'No se pudo cargar la ficha técnica')
      })
      .finally(() => {
        if (vigente) setCargando(false)
      })
    return () => {
      vigente = false
    }
  }, [item.kind, item.id])

  async function cargarMas() {
    if (!ficha?.siguienteCursor || cargandoMas) return
    setCargandoMas(true)
    setErrorMas('')
    try {
      const params = new URLSearchParams({ cursor: ficha.siguienteCursor })
      const pagina = await api(`/inventory/ficha/${item.kind}/${item.id}?${params}`)
      setFicha((actual) =>
        actual
          ? {
              ...actual,
              historial: [...actual.historial, ...pagina.historial],
              siguienteCursor: pagina.siguienteCursor,
            }
          : actual
      )
    } catch (requestError) {
      setErrorMas(requestError.message || 'No se pudo cargar la siguiente página')
    } finally {
      setCargandoMas(false)
    }
  }

  async function cargarMasCompras() {
    if (!ficha?.comprasSiguienteCursor || cargandoMasCompras) return
    setCargandoMasCompras(true)
    setErrorMasCompras('')
    try {
      const params = new URLSearchParams({ comprasCursor: ficha.comprasSiguienteCursor })
      const pagina = await api(`/inventory/ficha/${item.kind}/${item.id}?${params}`)
      setFicha((actual) =>
        actual
          ? {
              ...actual,
              compras: [...actual.compras, ...pagina.compras],
              comprasSiguienteCursor: pagina.comprasSiguienteCursor,
            }
          : actual
      )
    } catch (requestError) {
      setErrorMasCompras(requestError.message || 'No se pudo cargar la siguiente página de compras')
    } finally {
      setCargandoMasCompras(false)
    }
  }

  const precioVenta = esProducto ? Number(item.variant?.price) || 0 : null
  const margen = precioVenta > 0 ? ((precioVenta - item.cost) / precioVenta) * 100 : null
  const pestanas = [
    { id: 'ventas', label: esProducto ? 'Historial de ventas' : 'Historial de consumo' },
    { id: 'compras', label: 'Historial de compras' },
    { id: 'proveedores', label: `Proveedores (${ficha?.proveedores?.length || 0})` },
  ]

  return (
    <Modal onClose={onClose} title={`Ficha técnica · ${nombre}`} size="max-w-6xl">
      {cargando ? (
        <p className="py-12 text-center text-sm text-muted">Cargando ficha técnica…</p>
      ) : error ? (
        <p className="border border-ocupada/30 bg-ocupada/10 rounded-xl p-4 text-sm text-ocupada" role="alert">{error}</p>
      ) : ficha ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(230px,0.8fr)_minmax(0,2fr)] gap-4">
            <section className="rounded-xl border border-edge bg-raised/40 p-4">
              <div className="flex items-center gap-3">
                <ImagenInventario item={item} size="large" />
                <div className="min-w-0">
                  <p className="font-bold leading-tight">{item.name}</p>
                  <p className="text-xs text-muted mt-1">{esProducto ? 'Venta directa' : 'Insumo'} · {item.categoryName}</p>
                  <EstadoStock estado={etiquetaEstado(item)} />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <DatoFicha label="Stock actual" value={`${item.stock} ${item.unit}`} />
                <DatoFicha label="Mínimo" value={item.minimum == null ? 'Sin configurar' : `${item.minimum} ${item.unit}`} />
                {esProducto ? (
                  <>
                    <DatoFicha label="Precio de venta" value={money(precioVenta)} />
                    <DatoFicha label="Costo promedio" value={money(item.cost)} />
                    <DatoFicha label="Margen bruto" value={margen == null ? '—' : `${margen.toFixed(1)}%`} />
                    <DatoFicha label="Presentación" value={item.detail || item.variant?.name || 'Unidad'} />
                  </>
                ) : (
                  <>
                    <DatoFicha label="Costo por unidad" value={money(item.cost)} />
                    <DatoFicha label="Compra por" value={item.insumo?.unidadCompra || '—'} />
                    <DatoFicha label="Ubicación" value={item.insumo?.ubicacion || '—'} />
                    <DatoFicha label="Código interno" value={item.insumo?.codigoInterno || '—'} />
                  </>
                )}
              </div>
              {item.product?.description && <p className="text-xs text-muted mt-3">{item.product.description}</p>}
              {item.insumo?.description && <p className="text-xs text-muted mt-3">{item.insumo.description}</p>}
              {esAdmin && (
                <button type="button" className="btn-ghost w-full mt-4 h-10" onClick={onEdit}>
                  <Icon.edit width={15} height={15} /> Editar {esProducto ? 'producto' : 'insumo'}
                </button>
              )}
            </section>

            <section className="rounded-xl border border-edge bg-raised/40 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold">Mapa de rotación semanal</h3>
                  <p className="text-xs text-muted mt-1">
                    {esProducto ? 'Unidades vendidas' : 'Consumo registrado'} · últimas {ficha.semanas} semanas completas
                  </p>
                </div>
                <span className="text-[10px] font-semibold rounded-full px-2.5 py-1 bg-amber/10 text-amberText">
                  Semana consolidada
                </span>
              </div>
              <MapaRotacion rotacion={ficha.rotacion} unidad={item.unit} />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
                <ResumenRotacion nivel="pico" porcentaje={ficha.rotacion.porcentajePorNivel.pico} />
                <ResumenRotacion nivel="medio" porcentaje={ficha.rotacion.porcentajePorNivel.medio} />
                <ResumenRotacion nivel="valle" porcentaje={ficha.rotacion.porcentajePorNivel.valle} />
              </div>
              <p className="text-[11px] text-muted mt-3">
                {ficha.rotacion.coberturaDias == null
                  ? 'Sin rotación registrada para estimar días de cobertura.'
                  : `Con el ritmo reciente, el stock cubre aproximadamente ${ficha.rotacion.coberturaDias} días.`}
                {' '}Pico supera el promedio en más de una desviación estándar; valle queda más de una desviación abajo o no registra movimiento.
              </p>
            </section>
          </div>

          <div className="flex gap-2 overflow-x-auto border-b border-edge mt-5" role="tablist" aria-label="Historial de la ficha">
            {pestanas.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={pestana === tab.id}
                onClick={() => setPestana(tab.id)}
                className={`shrink-0 px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                  pestana === tab.id ? 'border-amber text-amberText' : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="pt-4">
            {pestana === 'ventas' && (
              <HistorialFichaVentas
                item={item}
                historial={ficha.historial}
                rotacion={ficha.rotacion}
                semanas={ficha.semanas}
                hayMas={Boolean(ficha.siguienteCursor)}
                cargandoMas={cargandoMas}
                errorMas={errorMas}
                onCargarMas={cargarMas}
              />
            )}
            {pestana === 'compras' && (
              <HistorialFichaCompras
                compras={ficha.compras}
                item={item}
                hayMas={Boolean(ficha.comprasSiguienteCursor)}
                cargandoMas={cargandoMasCompras}
                errorMas={errorMasCompras}
                onCargarMas={cargarMasCompras}
              />
            )}
            {pestana === 'proveedores' && <ProveedoresFicha proveedores={ficha.proveedores} esProducto={esProducto} />}
          </div>
        </>
      ) : null}
    </Modal>
  )
}

function DatoFicha({ label, value }) {
  return (
    <div className="rounded-lg bg-canvas/70 p-2.5 min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
      <p className="font-semibold tabular-nums truncate mt-1" title={String(value)}>{value}</p>
    </div>
  )
}

function MapaRotacion({ rotacion, unidad }) {
  const maximo = Math.max(...rotacion.dias.map((dia) => dia.porcentaje), 0)
  const color = { pico: 'bg-libre', medio: 'bg-amber', valle: 'bg-muted/60' }
  const colorTexto = { pico: 'text-libre', medio: 'text-amberText', valle: 'text-muted' }
  return (
    <div className="mt-5">
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2 items-end" aria-label="Distribución de consumo por día">
        {rotacion.dias.map((dia) => (
          <div key={dia.numero} className="min-w-0 text-center" title={`${dia.nombre}: ${dia.cantidad} ${unidad} · ${dia.porcentaje}% · ${etiquetaNivel(dia.nivel)}`}>
            <p className={`text-[10px] sm:text-xs font-bold tabular-nums ${colorTexto[dia.nivel]}`}>{dia.porcentaje}%</p>
            <div className="h-16 mt-1 flex items-end rounded-md bg-canvas p-1">
              <div
                className={`w-full rounded-sm ${color[dia.nivel]} transition-[height] duration-300`}
                style={{ height: `${maximo ? Math.max(5, (dia.porcentaje / maximo) * 100) : 5}%` }}
              />
            </div>
            <p className="text-[10px] text-muted mt-1">{dia.nombre}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 mt-4 text-xs text-muted">
        <span>Movimiento en el periodo</span>
        <strong className="text-ink tabular-nums">{rotacion.total} {unidad}</strong>
      </div>
    </div>
  )
}

function ResumenRotacion({ nivel, porcentaje }) {
  const clases = {
    pico: 'border-libre/25 bg-libre/5 text-libre',
    medio: 'border-amber/25 bg-amber/5 text-amberText',
    valle: 'border-edge bg-canvas/50 text-muted',
  }
  return (
    <div className={`rounded-lg border p-2.5 ${clases[nivel]}`}>
      <p className="text-[10px] uppercase tracking-wide">{`Días ${etiquetaNivel(nivel)}`}</p>
      <p className="font-bold tabular-nums mt-1">{porcentaje}% del movimiento</p>
    </div>
  )
}

function HistorialFichaVentas({ item, historial, rotacion, semanas, hayMas, cargandoMas, errorMas, onCargarMas }) {
  const esProducto = item.kind === 'producto'
  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-xs text-muted">
          {esProducto ? 'Ventas cerradas' : 'Consumos registrados'} · {rotacion.total} {item.unit} en {semanas} semanas
        </p>
      </div>
      {historial.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">
          {esProducto ? 'Todavía no hay ventas cerradas para esta presentación.' : 'Todavía no hay consumos de este insumo.'}
        </p>
      ) : esProducto ? (
        <div className="overflow-x-auto border-y border-edge">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="sticky top-0 bg-surface text-left text-muted uppercase">
              <tr>
                <th className="px-3 py-2.5">Fecha / hora</th>
                <th className="px-3 py-2.5">Comanda</th>
                <th className="px-3 py-2.5">Cantidad</th>
                <th className="px-3 py-2.5">Mesa · Registró</th>
                <th className="px-3 py-2.5 text-right">Total</th>
                <th className="px-3 py-2.5">Pago</th>
              </tr>
            </thead>
            <tbody>
              {historial.map((venta) => {
                const total = Math.max(0, Number(venta.price) * venta.qty - Number(venta.discountAmount || 0))
                const pago = [...new Set(venta.order.payments.map((p) => etiquetaMedioPago(p.method)))].join(', ') || '—'
                return (
                  <tr key={venta.id} className="border-t border-edge">
                    <td className="px-3 py-2.5 whitespace-nowrap">{formatFechaHora(venta.order.closedAt)}</td>
                    <td className="px-3 py-2.5">#{venta.order.invoiceNumber ?? venta.order.id.slice(0, 8)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{venta.qty} {item.unit}</td>
                    <td className="px-3 py-2.5">{`Mesa ${venta.order.table.number} · ${venta.order.openedBy.name}`}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{money(total)}</td>
                    <td className="px-3 py-2.5">{pago}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto border-y border-edge">
          <table className="w-full min-w-[570px] text-xs">
            <thead className="bg-surface text-left text-muted uppercase">
              <tr>
                <th className="px-3 py-2.5">Fecha / hora</th>
                <th className="px-3 py-2.5">Movimiento</th>
                <th className="px-3 py-2.5 text-right">Cantidad</th>
                <th className="px-3 py-2.5">Registró</th>
                <th className="px-3 py-2.5">Nota</th>
              </tr>
            </thead>
            <tbody>
              {historial.map((movimiento) => (
                <tr key={movimiento.id} className="border-t border-edge">
                  <td className="px-3 py-2.5 whitespace-nowrap">{formatFechaHora(movimiento.createdAt)}</td>
                  <td className="px-3 py-2.5">{movimiento.type === 'SALE' ? 'Consumo de receta' : 'Devolución'}</td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${movimiento.type === 'SALE' ? 'text-ocupada' : 'text-libre'}`}>
                    {movimiento.type === 'SALE' ? '−' : '+'}{movimiento.qty} {item.unit}
                  </td>
                  <td className="px-3 py-2.5">{movimiento.createdBy?.name || '—'}</td>
                  <td className="px-3 py-2.5 max-w-[220px] truncate">{movimiento.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {errorMas && <p className="text-xs text-ocupada mt-3" role="alert">{errorMas}</p>}
      {hayMas && (
        <button type="button" className="btn-ghost h-9 mt-3" onClick={onCargarMas} disabled={cargandoMas}>
          {cargandoMas ? 'Cargando…' : 'Ver más movimientos'}
        </button>
      )}
    </>
  )
}

function HistorialFichaCompras({ compras, item, hayMas, cargandoMas, errorMas, onCargarMas }) {
  if (!compras.length) return <p className="py-8 text-center text-sm text-muted">No hay compras recibidas registradas.</p>
  return (
    <>
      <div className="overflow-x-auto border-y border-edge">
        <table className="w-full min-w-[600px] text-xs">
        <thead className="bg-surface text-left text-muted uppercase">
          <tr>
            <th className="px-3 py-2.5">Recibida</th>
            <th className="px-3 py-2.5">Factura</th>
            <th className="px-3 py-2.5">Proveedor</th>
            <th className="px-3 py-2.5 text-right">Cantidad</th>
            <th className="px-3 py-2.5 text-right">Costo unitario</th>
            <th className="px-3 py-2.5 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {compras.map((linea) => (
            <tr key={linea.id} className="border-t border-edge">
              <td className="px-3 py-2.5 whitespace-nowrap">{formatFechaHora(linea.compra.recibidaAt)}</td>
              <td className="px-3 py-2.5">{linea.compra.numeroDocumento || '—'}</td>
              <td className="px-3 py-2.5">{linea.compra.proveedor.name}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">
                {linea.cantidad} {item.kind === 'insumo' ? linea.insumo?.unidadCompra : 'un.'}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">{money(linea.precioUnitario)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{money(linea.total)}</td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
      {errorMas && <p className="text-xs text-ocupada mt-3" role="alert">{errorMas}</p>}
      {hayMas && (
        <button type="button" className="btn-ghost h-9 mt-3" onClick={onCargarMas} disabled={cargandoMas}>
          {cargandoMas ? 'Cargando…' : 'Ver más compras'}
        </button>
      )}
    </>
  )
}

function ProveedoresFicha({ proveedores, esProducto }) {
  if (!proveedores.length) {
    return (
      <p className="py-8 text-center text-sm text-muted">
        {esProducto ? 'No encontramos proveedores en las compras recibidas.' : 'Este insumo no tiene proveedor habitual asignado.'}
      </p>
    )
  }
  return (
    <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {proveedores.map((proveedor) => (
        <li key={proveedor.id} className="rounded-xl border border-edge bg-raised/40 p-3">
          <p className="font-semibold">{proveedor.name}</p>
          {proveedor.contacto && <p className="text-xs text-muted mt-1">{proveedor.contacto}</p>}
          <p className="text-xs text-muted mt-1">
            {[proveedor.telefono, proveedor.whatsapp, proveedor.email, proveedor.ciudad].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
          </p>
        </li>
      ))}
    </ul>
  )
}

function etiquetaNivel(nivel) {
  return { pico: 'pico', medio: 'rotación media', valle: 'valle' }[nivel] || 'sin datos'
}

function etiquetaMedioPago(medio) {
  return { EFECTIVO: 'Efectivo', NEQUI: 'Nequi', TRANSFERENCIA: 'Transferencia', DATAFONO: 'Datáfono', CREDITO: 'Fiado' }[medio] || medio
}

function AjusteStockModal({ item, items, onClose, onSelect, onSaved }) {
  const [stockFinal, setStockFinal] = useState(item ? String(item.stock) : '')
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const {
    pin,
    setPin,
    valido: pinValido,
    verificando,
    error: errorPin,
    bloqueado,
    segundosRestantes,
  } = usePinVerificado({ soloUsuarioActual: true })
  const conteo = stockFinal === '' ? null : Number(stockFinal)
  const conteoValido = conteo !== null && Number.isSafeInteger(conteo) && conteo >= 0
  const diferencia = conteoValido ? conteo - item?.stock : null

  async function guardarAjuste(event) {
    event.preventDefault()
    if (!item || !conteoValido || !motivo.trim() || !pinValido || guardando) return
    setError('')
    setGuardando(true)
    try {
      const resultado = await api(`/inventory/adjustments/${item.kind === 'producto' ? 'variant' : 'insumo'}/${item.id}`, {
        method: 'POST',
        body: { stock: conteo, reason: motivo.trim(), pin },
      })
      await onSaved({ ...resultado, item })
    } catch (requestError) {
      setError(requestError.message || 'No se pudo registrar el ajuste')
      setGuardando(false)
    }
  }

  return (
    <Modal onClose={onClose} title="Ajuste de stock" size="max-w-lg">
      {!item ? (
        <>
          <p className="text-sm text-muted mb-3">Selecciona qué existencia quieres ajustar.</p>
          <ul className="divide-y divide-edge max-h-[50dvh] overflow-y-auto">
            {items.map((registro) => (
              <li key={`${registro.kind}:${registro.id}`}>
                <button
                  type="button"
                  className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-raised/40"
                  onClick={() => onSelect(registro)}
                >
                  <ImagenInventario item={registro} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium truncate">{registro.name}{registro.detail ? ` · ${registro.detail}` : ''}</span>
                    <span className="block text-xs text-muted">{registro.stock} {registro.unit} · {registro.categoryName}</span>
                  </span>
                  <Icon.chevronRight width={15} height={15} className="text-muted" />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <form onSubmit={guardarAjuste}>
          <p className="font-semibold">{item.name}{item.detail ? ` · ${item.detail}` : ''}</p>
          <p className="text-sm text-muted mt-1">Stock actual: {item.stock} {item.unit}</p>
          <label className="block text-sm font-medium mt-5">
            Conteo físico
            <span className="relative block mt-1.5">
              <input
                type="number"
                min="0"
                max="2147483647"
                step="1"
                inputMode="numeric"
                required
                className="field pr-20"
                value={stockFinal}
                onChange={(event) => setStockFinal(event.target.value)}
                aria-describedby="ajuste-stock-ayuda"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">{item.unit}</span>
            </span>
          </label>
          <p id="ajuste-stock-ayuda" className="text-xs text-muted mt-2">
            Ingresa lo que hay físicamente. El sistema registrará la diferencia sin borrar el historial.
          </p>
          {conteoValido && (
            <p className={`text-sm font-semibold tabular-nums mt-3 ${diferencia < 0 ? 'text-ocupada' : diferencia > 0 ? 'text-libre' : 'text-muted'}`}>
              Diferencia a registrar: {diferencia > 0 ? '+' : ''}{diferencia} {item.unit}
            </p>
          )}
          <label className="block text-sm font-medium mt-5">
            Motivo del ajuste
            <textarea
              className="field mt-1.5 min-h-20 resize-y"
              maxLength={300}
              required
              value={motivo}
              onChange={(event) => setMotivo(event.target.value)}
              placeholder="Ej.: conteo físico al cierre"
            />
            <span className="block text-xs text-muted text-right mt-1">{motivo.length}/300</span>
          </label>
          <div className="mt-5">
            <PinField
              pin={pin}
              onChange={setPin}
              verificando={verificando}
              error={errorPin}
              label="Código de empleado (PIN del administrador)"
              bloqueado={bloqueado}
              segundosRestantes={segundosRestantes}
            />
            <p className="text-xs text-muted text-center mt-2">
              Debe ser el PIN de tu usuario administrador.
            </p>
          </div>
          {(error || (conteo !== null && !conteoValido)) && (
            <p className="text-sm text-ocupada mt-4" role="alert">
              {error || 'El conteo debe ser un número entero igual o mayor a cero.'}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
            <button
              type="submit"
              className="btn-primary"
              disabled={!conteoValido || !motivo.trim() || motivo.trim().length > 300 || !pinValido || verificando || bloqueado || guardando}
            >
              {guardando ? 'Registrando…' : 'Registrar ajuste'}
            </button>
          </div>
        </form>
      )}
      {!item && (
        <div className="mt-6 flex justify-end">
          <button type="button" className="btn-ghost" onClick={onClose}>Cerrar</button>
        </div>
      )}
    </Modal>
  )
}

function ModalConteo({ tipo, items, onClose, onKardex }) {
  const titulo = tipo === 'bajo' ? 'Stock bajo / por agotar' : 'Productos críticos'
  return (
    <Modal onClose={onClose} title={titulo} size="max-w-2xl">
      <p className="text-sm text-muted mb-4">
        {tipo === 'bajo'
          ? 'Existencias positivas que llegaron al mínimo configurado.'
          : 'Productos e insumos agotados o con stock negativo.'}
      </p>
      {items.length === 0 ? (
        <p className="border-y border-edge py-8 text-center text-sm text-muted">No hay registros en esta condición.</p>
      ) : (
        <ul className="divide-y divide-edge max-h-[55dvh] overflow-y-auto">
          {items.map((item) => (
            <li key={`${item.kind}:${item.id}`} className="flex items-center gap-3 py-3">
              <ImagenInventario item={item} />
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{item.name}{item.detail ? ` · ${item.detail}` : ''}</p>
                <p className="text-xs text-muted">{item.categoryName} · {item.stock} {item.unit} / mínimo {item.minimum ?? '—'}</p>
              </div>
              <button type="button" className="btn-ghost h-9 shrink-0" onClick={() => onKardex(item)}>
                Historial
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 flex justify-end">
        <button type="button" className="btn-ghost" onClick={onClose}>Cerrar</button>
      </div>
    </Modal>
  )
}

function KardexModal({ kardex, onClose, onPage, onExport }) {
  const { item, items, page, loading, error } = kardex
  const nombre = `${item.name}${item.detail ? ` · ${item.detail}` : ''}`
  return (
    <Modal onClose={onClose} title={`Historial · ${nombre}`} size="max-w-4xl">
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-sm text-muted">Movimientos de inventario · Página {page}</p>
        <button type="button" className="btn-ghost h-9" onClick={onExport} disabled={loading || items.length === 0}>
          <Icon.download width={15} height={15} /> Exportar Excel
        </button>
      </div>
      {error && <p className="text-sm text-ocupada mb-3" role="alert">{error}</p>}
      <div className="border-y border-edge max-h-[55dvh] overflow-auto">
        {loading ? (
          <p className="py-10 text-center text-sm text-muted">Cargando movimientos…</p>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">Todavía no hay movimientos para este registro.</p>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="text-left text-xs text-muted uppercase tracking-wide">
                <th className="px-3 py-2.5">Fecha</th>
                <th className="px-3 py-2.5">Movimiento</th>
                <th className="px-3 py-2.5 text-right">Cantidad</th>
                <th className="px-3 py-2.5">Responsable</th>
                <th className="px-3 py-2.5">Factura / nota</th>
              </tr>
            </thead>
            <tbody>
              {items.map((movimiento) => {
                const cantidad = cantidadMovimiento(item, movimiento)
                const compra = movimiento.compraItem?.compra
                return (
                  <tr key={movimiento.id} className="border-t border-edge">
                    <td className="px-3 py-2.5 whitespace-nowrap">{formatFechaHora(movimiento.createdAt)}</td>
                    <td className="px-3 py-2.5">{etiquetaMovimiento(movimiento.type)}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${cantidad < 0 ? 'text-ocupada' : 'text-libre'}`}>
                      {cantidad > 0 ? '+' : ''}{cantidad} {item.unit}
                    </td>
                    <td className="px-3 py-2.5">{movimiento.createdBy?.name || '—'}</td>
                    <td className="px-3 py-2.5 max-w-[240px] truncate" title={[compra?.numeroDocumento, compra?.proveedor?.name, movimiento.note].filter(Boolean).join(' · ')}>
                      {[compra?.numeroDocumento, compra?.proveedor?.name, movimiento.note].filter(Boolean).join(' · ') || '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex items-center justify-between mt-4">
        <button type="button" className="btn-ghost h-9" onClick={() => onPage('anterior')} disabled={loading || page <= 1}>
          <Icon.chevronLeft width={15} height={15} /> Anterior
        </button>
        <span className="text-xs text-muted tabular-nums">Página {page}</span>
        <button type="button" className="btn-ghost h-9" onClick={() => onPage('siguiente')} disabled={loading || !kardex.nextCursor}>
          Siguiente <Icon.chevronRight width={15} height={15} />
        </button>
      </div>
    </Modal>
  )
}

function Modal({ onClose, title, size, children }) {
  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 p-3 sm:p-6 flex items-center justify-center"
      onClick={onClose}
      role="presentation"
    >
      <section
        className={`card w-full ${size} max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] overflow-hidden flex flex-col`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="shrink-0 px-5 py-4 border-b border-edge flex items-center justify-between gap-4">
          <h2 className="font-bold text-lg truncate">{title}</h2>
          <button type="button" className="btn-ghost h-9 w-9 p-0 shrink-0" onClick={onClose} aria-label="Cerrar">
            <Icon.x width={17} height={17} />
          </button>
        </header>
        <div className="overflow-y-auto p-4 sm:p-5">{children}</div>
      </section>
    </div>
  )
}

function formatFechaHora(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
}

async function pedirMovimientos(item, cursor, limit = KARDEX_POR_PAGINA) {
  const entidad = item.kind === 'producto' ? 'variant' : 'insumo'
  const params = new URLSearchParams({ limit: String(limit) })
  if (cursor) params.set('cursor', cursor)
  return api(`/inventory/kardex/${entidad}/${item.id}?${params.toString()}`)
}

async function cargarTodosLosMovimientos(item) {
  const movimientos = []
  let cursor = null
  do {
    const respuesta = await pedirMovimientos(item, cursor, 100)
    movimientos.push(...respuesta.items)
    cursor = respuesta.nextCursor
  } while (cursor)
  return movimientos
}
