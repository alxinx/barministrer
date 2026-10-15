import { prisma } from './prisma.js'
import { avisarEncargados } from './realtime.js'

const PRE_PEDIDO_MAX_MS = 45 * 60 * 1000

// Un pre-pedido que nadie aprobo en 45 minutos ya no sirve: la mesera se fue
// de esa mesa, el cliente cambio de pedido de palabra, o nadie entro a
// aprobarlo. Dejarlo ahi para siempre ensucia el panel del encargado con algo
// que ya no es real. Mismo borrado que el tacho manual
// (DELETE /orders/:id/items/:itemId), solo que por antiguedad en vez de un
// clic, y corriendo solo sobre PENDING: un item ya aprobado (ACTIVE) no vence.
export async function expirarPrePedidosVencidos() {
  const limite = new Date(Date.now() - PRE_PEDIDO_MAX_MS)
  const vencidos = await prisma.orderItem.findMany({
    where: { status: 'PENDING', orderedAt: { lt: limite } },
    select: { id: true, orderId: true, tenantId: true },
  })
  if (!vencidos.length) return

  await prisma.orderItem.deleteMany({ where: { id: { in: vencidos.map((i) => i.id) } } })

  // Por cuenta afectada: si no queda nada pendiente, el aviso de "pre-pedido
  // esperando" en el panel de los encargados tiene que desaparecer, igual que
  // cuando se envia o se borra a mano.
  const porOrden = new Map(vencidos.map((i) => [i.orderId, i.tenantId]))
  for (const [orderId, tenantId] of porOrden) {
    const quedanPendientes = await prisma.orderItem.count({ where: { orderId, status: 'PENDING' } })
    if (quedanPendientes === 0) avisarEncargados(tenantId, 'pre-pedido:cancelado', { orderId })
  }
}
