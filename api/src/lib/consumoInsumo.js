import { recalcularCostoPonderadoInsumo, cantidadConvertida } from './costeo.js'

// Venta de un producto con receta que usa este insumo: consume del lote mas
// viejo primero (FIFO, nunca del mas caro ni del mas nuevo), igual que un
// insumo fisico real -- la bolsa que lleva mas tiempo abierta se gasta
// antes. Un InsumoMovement por cada lote tocado (compraItemId = ese lote),
// mismo patron que PURCHASE/PURCHASE_VOID. Si la venta pide mas de lo que
// hay en lotes con existencia (sobreconsumo -- nunca se bloquea una venta,
// el stock es un aviso), el resto queda en un movimiento sin lote asignado.
export async function consumirInsumoFIFO(tx, { tenantId, insumoId, qty, note, createdById }) {
  let restante = qty
  const lotes = await tx.compraItem.findMany({
    where: { insumoId, compra: { estado: 'RECIBIDA' }, cantidadRestante: { gt: 0 } },
    orderBy: { compra: { recibidaAt: 'asc' } },
    select: { id: true, cantidadRestante: true },
  })

  for (const lote of lotes) {
    if (restante <= 0) break
    const tomado = Math.min(restante, lote.cantidadRestante)
    await tx.compraItem.update({ where: { id: lote.id }, data: { cantidadRestante: { decrement: tomado } } })
    await tx.insumoMovement.create({
      data: { tenantId, insumoId, type: 'SALE', qty: tomado, compraItemId: lote.id, note, createdById },
    })
    restante -= tomado
  }
  if (restante > 0) {
    await tx.insumoMovement.create({
      data: { tenantId, insumoId, type: 'SALE', qty: restante, compraItemId: null, note, createdById },
    })
  }

  await tx.insumo.update({ where: { id: insumoId }, data: { stock: { decrement: qty } } })
  await recalcularCostoPonderadoInsumo(tx, insumoId)
}

// Devolucion de un producto ya servido: reposicion APROXIMADA en orden
// inverso (repone primero al lote mas recientemente tocado). No es un
// ledger exacto por venta -- coincide con lo correcto casi siempre (salvo
// que otra venta haya consumido el mismo insumo entre la venta y esta
// devolucion, caso raro) y es consistente con que el stock ya es "un
// aviso, no un balance exacto" en el resto del dominio.
export async function restaurarInsumoFIFO(tx, { tenantId, insumoId, qty, note, createdById }) {
  let restante = qty
  const lotes = await tx.compraItem.findMany({
    where: { insumoId, compra: { estado: 'RECIBIDA' } },
    orderBy: { compra: { recibidaAt: 'desc' } },
    select: { id: true, cantidad: true, cantidadInventarioReal: true, cantidadRestante: true },
  })
  const insumo = await tx.insumo.findUnique({ where: { id: insumoId }, select: { name: true, unidadCompra: true, unidadInventario: true } })

  for (const lote of lotes) {
    if (restante <= 0) break
    const original = cantidadConvertida({ cantidad: lote.cantidad, cantidadInventarioReal: lote.cantidadInventarioReal, insumo })
    const espacio = original - (lote.cantidadRestante ?? 0)
    if (espacio <= 0) continue
    const repuesto = Math.min(restante, espacio)
    await tx.compraItem.update({ where: { id: lote.id }, data: { cantidadRestante: { increment: repuesto } } })
    await tx.insumoMovement.create({
      data: { tenantId, insumoId, type: 'SALE_VOID', qty: repuesto, compraItemId: lote.id, note, createdById },
    })
    restante -= repuesto
  }
  if (restante > 0) {
    await tx.insumoMovement.create({
      data: { tenantId, insumoId, type: 'SALE_VOID', qty: restante, compraItemId: null, note, createdById },
    })
  }

  await tx.insumo.update({ where: { id: insumoId }, data: { stock: { increment: qty } } })
  await recalcularCostoPonderadoInsumo(tx, insumoId)
}
