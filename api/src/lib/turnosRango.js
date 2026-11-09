import { prisma } from './prisma.js'
import { rangoEntreFechas, sumarDias, turnoEnRango } from './fechas.js'

export async function buscarTurnosDelRango(tenantId, desdeStr, hastaStr, timezone) {
  const rango = rangoEntreFechas(desdeStr, hastaStr)
  const desde = new Date(rango.desde.getTime() - 86400000)
  const { hasta } = rango
  const candidatos = await prisma.shift.findMany({
    where: { tenantId, openedAt: { gte: desde, lte: hasta } },
    select: {
      id: true,
      status: true,
      sales: true,
      openedAt: true,
      closedAt: true,
      openedBy: { select: { name: true } },
      closedBy: { select: { name: true } },
    },
    orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
  })
  return candidatos.filter((shift) => turnoEnRango(shift, desdeStr, hastaStr, timezone))
}
