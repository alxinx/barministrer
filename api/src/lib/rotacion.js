import { diaLocal, sumarDias } from './fechas.js'

const DIAS_SEMANA = [
  { numero: 1, nombre: 'Lun' },
  { numero: 2, nombre: 'Mar' },
  { numero: 3, nombre: 'Mié' },
  { numero: 4, nombre: 'Jue' },
  { numero: 5, nombre: 'Vie' },
  { numero: 6, nombre: 'Sáb' },
  { numero: 7, nombre: 'Dom' },
]
const SEMANAS_ANALIZADAS = 8
const DIAS_ANALIZADOS = SEMANAS_ANALIZADAS * 7

export function rangoSemanasCompletas(timezone, ahora = new Date()) {
  const hoy = diaLocal(ahora, timezone)
  const dia = new Date(`${hoy}T00:00:00.000Z`).getUTCDay()
  const lunesActual = sumarDias(hoy, -((dia + 6) % 7))
  const desdeFecha = sumarDias(lunesActual, -SEMANAS_ANALIZADAS * 7)
  const hastaFecha = lunesActual

  return {
    desdeFecha,
    hastaFecha,
    desde: new Date(Date.parse(`${desdeFecha}T00:00:00.000Z`) - 86400000),
    hasta: new Date(Date.parse(`${hastaFecha}T00:00:00.000Z`) + 86400000),
  }
}

export function calcularRotacionSemanal(movimientos, timezone, desdeFecha, hastaFecha, stock) {
  const cantidades = Array(7).fill(0)
  for (const movimiento of movimientos) {
    const fecha = diaLocal(movimiento.fecha, timezone)
    if (fecha < desdeFecha || fecha >= hastaFecha) continue
    const dia = new Date(`${fecha}T00:00:00.000Z`).getUTCDay()
    cantidades[(dia + 6) % 7] += Number(movimiento.cantidad) || 0
  }

  const cantidadesNetas = cantidades.map((cantidad) => Math.max(0, cantidad))
  const total = cantidadesNetas.reduce((suma, cantidad) => suma + cantidad, 0)
  const promediosPorDia = cantidadesNetas.map((cantidad) => cantidad / SEMANAS_ANALIZADAS)
  const promedioDiario = total / DIAS_ANALIZADOS
  const desviacion = Math.sqrt(
    promediosPorDia.reduce((suma, cantidad) => suma + (cantidad - promedioDiario) ** 2, 0) / 7
  )

  const dias = DIAS_SEMANA.map((dia, indice) => {
    const promedio = promediosPorDia[indice]
    const nivel =
      total === 0
        ? 'medio'
        : promedio > promedioDiario + desviacion
          ? 'pico'
          : promedio === 0 || promedio < promedioDiario - desviacion
            ? 'valle'
            : 'medio'
    const cantidad = cantidadesNetas[indice]
    return {
      ...dia,
      cantidad,
      promedio,
      porcentaje: total ? Math.round((cantidad / total) * 1000) / 10 : 0,
      nivel,
    }
  })

  const volumenPorNivel = dias.reduce(
    (resultado, dia) => {
      resultado[dia.nivel] += dia.cantidad
      return resultado
    },
    { pico: 0, medio: 0, valle: 0 }
  )
  const porcentajePorNivel = Object.fromEntries(
    Object.entries(volumenPorNivel).map(([nivel, cantidad]) => [
      nivel,
      total ? Math.round((cantidad / total) * 1000) / 10 : 0,
    ])
  )

  return {
    dias,
    total,
    promedioDiario: Math.round(promedioDiario * 100) / 100,
    coberturaDias: promedioDiario > 0 ? Math.round((Math.max(0, stock) / promedioDiario) * 10) / 10 : null,
    porcentajePorNivel,
  }
}
