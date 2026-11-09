import { useEffect, useState } from 'react'
import ExcelJS from 'exceljs'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { getCategories } from '../lib/categoriesStore'
import { Icon } from '../components/Icons'
import {
  nuevoLibro,
  escribirEncabezados,
  autoAjustarColumnas,
  descargarLibro,
  AMBER_ARGB,
  MUTED_ARGB,
} from '../lib/excel'

// Mismo orden en la plantilla (encabezado) y al leerla de vuelta: una sola
// fuente de verdad para las columnas, para que generar y parsear nunca se
// desincronicen entre si.
const COLUMNAS_INSUMOS = [
  { key: 'nombre', header: 'Nombre', ancho: 26 },
  { key: 'categoria', header: 'Categoría', ancho: 20 },
  { key: 'unidadInventario', header: 'Unidad de inventario', ancho: 18 },
  { key: 'unidadCompra', header: 'Unidad de compra', ancho: 16 },
  { key: 'cantidadPromedioPorUnidad', header: 'Cantidad promedio por unidad de compra', ancho: 22 },
  { key: 'costoCompra', header: 'Costo de compra', ancho: 16 },
  { key: 'proveedor', header: 'Proveedor', ancho: 20 },
  { key: 'codigoInterno', header: 'Código interno', ancho: 16 },
  { key: 'stockMinimo', header: 'Stock mínimo', ancho: 14 },
  { key: 'descripcion', header: 'Descripción', ancho: 28 },
]

const COLUMNAS_PRODUCTOS = [
  { key: 'nombre', header: 'Nombre', ancho: 26 },
  { key: 'categoria', header: 'Categoría', ancho: 20 },
  { key: 'presentacion', header: 'Presentación', ancho: 16 },
  { key: 'precio', header: 'Precio de venta', ancho: 16 },
  { key: 'costo', header: 'Costo', ancho: 14 },
  { key: 'volumenMl', header: 'Volumen en ml (solo si vende por trago)', ancho: 20 },
  { key: 'stock', header: 'Stock inicial', ancho: 14 },
]

async function construirPlantilla({ categoriasInsumo, categoriasProducto, proveedores, tenantNombre }) {
  const workbook = nuevoLibro()

  const hojaInsumos = workbook.addWorksheet('Insumos')
  escribirEncabezados(hojaInsumos, COLUMNAS_INSUMOS.map((c) => c.header), 1)
  autoAjustarColumnas(hojaInsumos)
  COLUMNAS_INSUMOS.forEach((c, i) => (hojaInsumos.getColumn(i + 1).width = c.ancho))

  const hojaProductos = workbook.addWorksheet('Productos')
  escribirEncabezados(hojaProductos, COLUMNAS_PRODUCTOS.map((c) => c.header), 1)
  autoAjustarColumnas(hojaProductos)
  COLUMNAS_PRODUCTOS.forEach((c, i) => (hojaProductos.getColumn(i + 1).width = c.ancho))

  const hojaInstrucciones = workbook.addWorksheet('Instrucciones')
  hojaInstrucciones.getColumn(1).width = 95
  const lineas = [
    ['Cómo llenar esta plantilla', true],
    ['', false],
    ['Hoja "Insumos": materia prima para recetas (pan, jamón, tomate, aguardiente a granel...).', false],
    ['  • Categoría: si no existe, se crea sola con ese nombre exacto.', false],
    ['  • Unidad de inventario / Unidad de compra: usa los códigos de la hoja "Referencia" (ej. kilogramo, unidad).', false],
    ['  • Cantidad promedio por unidad de compra: solo si compras por "unidad" o "paquete" sin tamaño fijo (ej. compras pan por unidad pero lo cuentas en gramos) — escribe cuánto trae en promedio cada unidad/paquete.', false],
    ['  • Proveedor: si no existe, se crea solo con ese nombre. Déjalo vacío si no aplica.', false],
    ['  • Si el insumo ya existe (mismo nombre exacto), esta fila lo actualiza en vez de duplicarlo.', false],
    ['', false],
    ['Hoja "Productos": lo que se vende directo al cliente (cerveza, gaseosa, combos).', false],
    ['  • Categoría: debe existir ya en el catálogo (Catálogo > Categorías) — no se crea sola, porque define si vende por trago.', false],
    ['  • Presentación: nombre de la presentación (ej. "Botella 330ml", "Lata"). Si la dejas vacía, se usa "Unidad".', false],
    ['  • Volumen en ml: obligatorio solo si la categoría vende por trago (ej. licores con shots).', false],
    ['  • Si el producto+presentación ya existe, esta fila actualiza precio/costo/volumen, nunca el stock (el stock solo sube con una venta o una compra real).', false],
    ['', false],
    ['No borres ni reordenes las columnas del encabezado (fila 1) — el sistema lee por posición de columna.', true],
    ['Filas completamente vacías se ignoran.', false],
  ]
  lineas.forEach(([texto, destacado]) => {
    const fila = hojaInstrucciones.addRow([texto])
    fila.getCell(1).alignment = { wrapText: true }
    if (destacado) fila.getCell(1).font = { bold: true }
  })

  const hojaReferencia = workbook.addWorksheet('Referencia')
  hojaReferencia.getColumn(1).width = 34
  hojaReferencia.getColumn(2).width = 14
  let fila = 1
  const bloque = (titulo, filas, encabezados) => {
    const celda = hojaReferencia.getCell(fila, 1)
    celda.value = titulo
    celda.font = { bold: true, color: { argb: MUTED_ARGB } }
    fila += 1
    if (encabezados) {
      encabezados.forEach((h, i) => {
        const c = hojaReferencia.getCell(fila, i + 1)
        c.value = h
        c.font = { bold: true }
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBER_ARGB } }
      })
      fila += 1
    }
    if (filas.length === 0) {
      hojaReferencia.getCell(fila, 1).value = '(ninguna todavía)'
      fila += 1
    } else {
      filas.forEach((valores) => {
        valores.forEach((v, i) => (hojaReferencia.getCell(fila, i + 1).value = v))
        fila += 1
      })
    }
    fila += 1
  }
  bloque(
    `Categorías de insumos ya creadas en ${tenantNombre}`,
    categoriasInsumo.map((c) => [c.name])
  )
  bloque(
    `Categorías de productos ya creadas en ${tenantNombre} (Sí/No = vende por trago)`,
    categoriasProducto.map((c) => [c.name, c.allowsPour ? 'Sí' : 'No'])
  )
  bloque(
    `Proveedores ya creados en ${tenantNombre}`,
    proveedores.map((p) => [p.name])
  )
  bloque(
    'Unidades válidas (código a usar en "Unidad de inventario" / "Unidad de compra")',
    [
      ['gramo', 'peso'],
      ['kilogramo', 'peso'],
      ['mililitro', 'volumen'],
      ['litro', 'volumen'],
      ['unidad', 'unidad'],
      ['paquete', 'unidad'],
    ],
    ['Código', 'Magnitud']
  )

  await descargarLibro(workbook, `plantilla-implementacion-${tenantNombre.toLowerCase().replace(/\s+/g, '-')}.xlsx`)
}

function leerFilas(hoja, columnas) {
  if (!hoja) return []
  const filas = []
  hoja.eachRow((row, numeroFila) => {
    if (numeroFila === 1) return
    const valores = columnas.map((_, i) => {
      const valor = row.getCell(i + 1).value
      if (valor && typeof valor === 'object' && 'result' in valor) return valor.result
      if (valor && typeof valor === 'object' && 'text' in valor) return valor.text
      return valor
    })
    if (valores.every((v) => v == null || v === '')) return
    const fila = {}
    columnas.forEach((c, i) => (fila[c.key] = typeof valores[i] === 'string' ? valores[i].trim() : valores[i]))
    filas.push(fila)
  })
  return filas
}

async function leerArchivo(file) {
  const buffer = await file.arrayBuffer()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  return {
    insumos: leerFilas(workbook.getWorksheet('Insumos'), COLUMNAS_INSUMOS),
    productos: leerFilas(workbook.getWorksheet('Productos'), COLUMNAS_PRODUCTOS),
  }
}

function PastillaEstado({ estado }) {
  const estilos = {
    creado: 'bg-green-500/15 text-green-400 border-green-500/30',
    actualizado: 'bg-amber/15 text-amberText border-amber/30',
    error: 'bg-red-500/15 text-red-400 border-red-500/30',
  }
  const texto = { creado: 'Creado', actualizado: 'Actualizado', error: 'Error' }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${estilos[estado]}`}>{texto[estado]}</span>
  )
}

function TablaResultados({ titulo, datos }) {
  if (!datos) return null
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="font-semibold">{titulo}</p>
        <p className="text-sm text-muted">
          {datos.resumen.creados} creados · {datos.resumen.actualizados} actualizados ·{' '}
          <span className={datos.resumen.errores > 0 ? 'text-red-400' : ''}>{datos.resumen.errores} errores</span>
        </p>
      </div>
      <div className="max-h-72 overflow-y-auto flex flex-col gap-1.5">
        {datos.resultados.map((r) => (
          <div key={r.fila} className="flex items-center gap-2 text-sm py-1 border-b border-edge/50 last:border-0">
            <span className="text-muted text-xs w-10 shrink-0">F{r.fila}</span>
            <span className="flex-1 truncate">{r.nombre}</span>
            {r.estado === 'error' && <span className="text-red-400 text-xs truncate max-w-[280px]">{r.error}</span>}
            <PastillaEstado estado={r.estado} />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Implementacion() {
  const { session } = useAuth()
  const [referencia, setReferencia] = useState(null)
  const [generandoPlantilla, setGenerandoPlantilla] = useState(false)
  const [archivo, setArchivo] = useState(null)
  const [vistaPrevia, setVistaPrevia] = useState(null) // { insumos: [], productos: [] }
  const [procesando, setProcesando] = useState(false)
  const [resultado, setResultado] = useState(null) // { insumos: {...}|null, productos: {...}|null }
  const [error, setError] = useState('')

  useEffect(() => {
    if (!session?.tenant?.id) return
    Promise.all([
      api('/insumo-categorias'),
      getCategories(session.tenant.id),
      api('/proveedores'),
    ]).then(([categoriasInsumo, categoriasProducto, proveedores]) => {
      setReferencia({ categoriasInsumo, categoriasProducto, proveedores })
    })
  }, [session?.tenant?.id])

  async function descargarPlantilla() {
    if (!referencia) return
    setGenerandoPlantilla(true)
    try {
      await construirPlantilla({ ...referencia, tenantNombre: session.tenant.name })
    } finally {
      setGenerandoPlantilla(false)
    }
  }

  async function onElegirArchivo(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    setResultado(null)
    setVistaPrevia(null)
    setArchivo(file)
    try {
      const { insumos, productos } = await leerArchivo(file)
      if (insumos.length === 0 && productos.length === 0) {
        setError('El archivo no trae filas para importar en las hojas "Insumos" o "Productos"')
        return
      }
      setVistaPrevia({ insumos, productos })
    } catch {
      setError('No se pudo leer el archivo — ¿es el .xlsx de la plantilla, sin modificar las hojas?')
    }
  }

  async function confirmarImportacion() {
    if (!vistaPrevia) return
    setProcesando(true)
    setError('')
    try {
      const [res1, res2] = await Promise.all([
        vistaPrevia.insumos.length > 0
          ? api('/importacion/insumos', { method: 'POST', body: { filas: vistaPrevia.insumos } })
          : null,
        vistaPrevia.productos.length > 0
          ? api('/importacion/productos', { method: 'POST', body: { filas: vistaPrevia.productos } })
          : null,
      ])
      setResultado({ insumos: res1, productos: res2 })
      setVistaPrevia(null)
      setArchivo(null)
      invalidarReferencia()
    } catch (err) {
      setError(err.message)
    } finally {
      setProcesando(false)
    }
  }

  function invalidarReferencia() {
    if (!session?.tenant?.id) return
    Promise.all([api('/insumo-categorias'), getCategories(session.tenant.id), api('/proveedores')]).then(
      ([categoriasInsumo, categoriasProducto, proveedores]) =>
        setReferencia({ categoriasInsumo, categoriasProducto, proveedores })
    )
  }

  return (
    <div className="p-5 md:p-7 max-w-[800px] mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Implementación</h1>
        <p className="text-muted text-sm mt-1">
          Carga masiva de insumos y productos desde un Excel — pensado para el arranque inicial del catálogo, en vez
          de registrar uno por uno.
        </p>
      </header>

      <div className="flex flex-col gap-5">
        <section className="card p-5">
          <p className="font-semibold mb-1">1. Descarga la plantilla</p>
          <p className="text-sm text-muted mb-4">
            Incluye tus categorías y proveedores actuales como referencia, para que escribas los nombres exactos.
          </p>
          <button
            type="button"
            onClick={descargarPlantilla}
            disabled={!referencia || generandoPlantilla}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Icon.download width={18} height={18} />
            {generandoPlantilla ? 'Generando...' : 'Descargar plantilla (.xlsx)'}
          </button>
        </section>

        <section className="card p-5">
          <p className="font-semibold mb-1">2. Súbela de vuelta</p>
          <p className="text-sm text-muted mb-4">
            Un insumo o producto con un nombre que ya existe se actualiza; uno nuevo se crea. El stock nunca se
            sobreescribe por una importación.
          </p>
          <label className="btn-ghost inline-flex items-center gap-2 cursor-pointer">
            <Icon.send width={18} height={18} />
            {archivo ? archivo.name : 'Elegir archivo .xlsx'}
            <input type="file" accept=".xlsx" className="hidden" onChange={onElegirArchivo} />
          </label>

          {error && <p className="text-sm text-red-400 mt-3">{error}</p>}

          {vistaPrevia && (
            <div className="mt-4 p-4 rounded-lg bg-raised border border-edge">
              <p className="text-sm mb-3">
                Se encontraron <strong>{vistaPrevia.insumos.length}</strong> fila(s) en "Insumos" y{' '}
                <strong>{vistaPrevia.productos.length}</strong> fila(s) en "Productos". Esto va a crear o actualizar
                esos registros en {session?.tenant?.name}.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={confirmarImportacion}
                  disabled={procesando}
                  className="btn-primary inline-flex items-center gap-2"
                >
                  <Icon.check width={18} height={18} />
                  {procesando ? 'Importando...' : 'Confirmar e importar'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setVistaPrevia(null)
                    setArchivo(null)
                  }}
                  disabled={procesando}
                  className="btn-ghost"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </section>

        {resultado && (resultado.insumos || resultado.productos) && (
          <section className="flex flex-col gap-4">
            <TablaResultados titulo="Insumos" datos={resultado.insumos} />
            <TablaResultados titulo="Productos" datos={resultado.productos} />
          </section>
        )}
      </div>
    </div>
  )
}
