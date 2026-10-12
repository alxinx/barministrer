// "Hoy" como lo ve el bar, no el servidor: una venta a las 11pm en Bogota no
// debe contarse en el dia UTC siguiente (el servidor corre en UTC). YYYY-MM-DD
// con locale en-CA porque ya sale ordenable, sin tener que armarlo a mano.
export function diaLocal(fecha, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(fecha)
}

// Las ultimas N fechas (como strings YYYY-MM-DD, de la mas vieja a la mas
// nueva) en el calendario del tenant, mas un rango [desde, hasta] para
// consultar en la base de datos con colchon de 1 dia a cada lado: evita
// calcular el instante UTC exacto de la medianoche local, el filtro fino por
// dia se hace despues comparando las etiquetas con diaLocal.
export function rangoUltimosDias(n, timezone) {
  const hoy = diaLocal(new Date(), timezone)
  const [y, m, d] = hoy.split('-').map(Number)
  const ancla = Date.UTC(y, m - 1, d)
  const etiquetas = []
  for (let i = n - 1; i >= 0; i--) {
    etiquetas.push(new Date(ancla - i * 86400000).toISOString().slice(0, 10))
  }
  const desde = new Date(Date.parse(etiquetas[0] + 'T00:00:00Z') - 86400000)
  const hasta = new Date(Date.now() + 86400000)
  return { etiquetas, desde, hasta }
}

// Mismo contrato que rangoUltimosDias, pero entre dos fechas explicitas que
// el dueno eligio en un calendario (ya vienen como YYYY-MM-DD, no hay que
// convertir zona horaria: el dia que el escogio es el dia que quiere, sin
// importar en que huso este el servidor). Tope de 365 dias para no dejar que
// un rango absurdo cargue la base de datos completa.
const UN_DIA = 86400000
export function rangoEntreFechas(desdeStr, hastaStr) {
  let inicio = Date.parse(`${desdeStr}T00:00:00Z`)
  const fin = Date.parse(`${hastaStr}T00:00:00Z`)
  if (fin - inicio > 364 * UN_DIA) inicio = fin - 364 * UN_DIA

  const etiquetas = []
  for (let t = inicio; t <= fin; t += UN_DIA) {
    etiquetas.push(new Date(t).toISOString().slice(0, 10))
  }
  const desde = new Date(Date.parse(`${etiquetas[0]}T00:00:00Z`) - UN_DIA)
  const hasta = new Date(Date.parse(`${etiquetas[etiquetas.length - 1]}T00:00:00Z`) + 2 * UN_DIA)
  return { etiquetas, desde, hasta }
}

// YYYY-MM-DD valido y en orden (desde <= hasta); si el query no trae un
// rango explicito completo, el caller sigue con days como antes.
export function rangoValido(desdeStr, hastaStr) {
  const formato = /^\d{4}-\d{2}-\d{2}$/
  return Boolean(desdeStr && hastaStr && formato.test(desdeStr) && formato.test(hastaStr) && desdeStr <= hastaStr)
}
