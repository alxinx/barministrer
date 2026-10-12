// YYYY-MM-DD en el calendario del navegador, no UTC: toISOString() corre el
// dia cuando el offset local cae del lado equivocado de medianoche. El dia
// que el dueño ve y clickea en el calendario es el dia que se manda al back.
export function isoLocal(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function formatCorto(date) {
  return date.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
}

// Inverso de isoLocal: 'YYYY-MM-DD' -> Date a medianoche local. new Date(str)
// lo interpreta como UTC y puede correr el dia un lugar atras del que el
// dueño eligio en el calendario.
export function parseISOLocal(str) {
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// El rango implicito de "ultimos N dias", en objetos Date locales: sirve
// tanto para el texto del boton como para pre-cargar el calendario con lo
// que ya esta aplicado, en vez de abrirlo vacio.
export function calcularRangoDias(dias) {
  const hasta = new Date()
  const from = new Date(hasta.getTime() - (dias - 1) * 86400000)
  return { from, to: hasta }
}
