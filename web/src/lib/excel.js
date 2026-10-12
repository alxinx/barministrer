import ExcelJS from 'exceljs'

// Formato compartido entre los excel que exporta la app, para que el dueño
// abra cualquiera de ellos y lo entienda sin tener que descifrar columnas
// crudas: encabezado con el acento ambar de la marca, fila de totales fija
// (freeze) para no perder el contexto al bajar, filtro automatico para que
// pueda explorar los datos el mismo sin pedir otro reporte.
//
// El fondo del archivo es blanco (el estandar de cualquier hoja de calculo
// que se abra fuera de la app, incluso impresa): el tema oscuro es para la
// pantalla del bar de noche, no para un documento que circula por correo. El
// ambar se usa igual que en la app, pero como unico acento sobre fondo claro.
export const AMBER_ARGB = 'FFE8A33D'
export const NIGHT_ARGB = 'FF0E0C13'
export const OCUPADA_ARGB = 'FFE05252'
export const MUTED_ARGB = 'FF595959'

export const FORMATO_MONEDA = '"$"#,##0'
export const FORMATO_PORCENTAJE = '0.0"%"'

export function nuevoLibro() {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'LicorPlus'
  workbook.created = new Date()
  return workbook
}

// Titulo del reporte + subtitulo (periodo, tenant) en las primeras filas,
// fusionadas sobre todo el ancho de la tabla para que se lean como un
// encabezado de documento, no como una celda mas.
export function escribirTitulo(sheet, { titulo, subtitulo }, columnas) {
  sheet.mergeCells(1, 1, 1, columnas)
  const celdaTitulo = sheet.getCell(1, 1)
  celdaTitulo.value = titulo
  celdaTitulo.font = { bold: true, size: 14, color: { argb: NIGHT_ARGB } }

  sheet.mergeCells(2, 1, 2, columnas)
  const celdaSubtitulo = sheet.getCell(2, 1)
  celdaSubtitulo.value = subtitulo
  celdaSubtitulo.font = { italic: true, size: 10, color: { argb: MUTED_ARGB } }

  sheet.getRow(1).height = 22
  sheet.addRow([])
}

// Encabezados de tabla: fondo ambar, texto oscuro (el mismo contraste que la
// app usa para el acento), fila congelada y con filtro para ordenar/filtrar
// directo en Excel sin tener que volver a la app.
export function escribirEncabezados(sheet, encabezados, filaInicio) {
  const fila = sheet.getRow(filaInicio)
  fila.values = encabezados
  fila.eachCell((celda) => {
    celda.font = { bold: true, color: { argb: NIGHT_ARGB } }
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBER_ARGB } }
    celda.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    celda.border = { bottom: { style: 'thin', color: { argb: 'FF2E2939' } } }
  })
  sheet.views = [{ state: 'frozen', ySplit: filaInicio }]
  sheet.autoFilter = { from: { row: filaInicio, column: 1 }, to: { row: filaInicio, column: encabezados.length } }
}

// Ancho de columna a partir del contenido real (encabezado + filas), con un
// colchon para que no quede el texto pegado al borde de la celda. `desde`
// salta las filas de titulo/subtitulo: estan fusionadas sobre todo el ancho
// de la tabla, asi que su texto largo no debe inflar cada columna por igual.
export function autoAjustarColumnas(sheet, { min = 10, max = 46, desde = 1 } = {}) {
  sheet.columns.forEach((columna) => {
    let largo = min
    columna.eachCell?.({ includeEmpty: true }, (celda) => {
      if (celda.row < desde) return
      // Un numero sin redondear (ej. un costo-por-ml arrastrando decimales)
      // mide larguisimo como texto aunque el numFmt lo vaya a mostrar corto:
      // se mide como se va a ver, no como esta guardado.
      const valor = celda.value
      const texto = valor == null ? '' : typeof valor === 'number' ? valor.toFixed(2) : String(valor)
      largo = Math.max(largo, texto.length + 2)
    })
    columna.width = Math.min(max, largo)
  })
}

export async function descargarLibro(workbook, nombreArchivo) {
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo
  a.click()
  URL.revokeObjectURL(url)
}
