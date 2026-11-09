import { factorConversion, sinConversionFija } from './unidades.js'

// Convierte una linea de compra a unidadInventario del insumo: el caso
// especial (sinConversionFija, ej. lechugas por unidad o pan por paquete)
// usa el peso/cantidad REAL que se declaro al recibir (cantidadInventarioReal),
// nunca un estimado calculado.
export function cantidadConvertida({ cantidad, cantidadInventarioReal, insumo }) {
  if (sinConversionFija(insumo.unidadCompra, insumo.unidadInventario)) {
    const real = cantidadInventarioReal != null ? Number(cantidadInventarioReal) : null
    if (!real || real <= 0) {
      const err = new Error(
        `"${insumo.name}" se compra por ${insumo.unidadCompra} pero se cuenta en ${insumo.unidadInventario}: escribe cuánto llegó en total para poder recibirlo`
      )
      err.status = 400
      throw err
    }
    return Math.round(real)
  }
  const factor = factorConversion(insumo.unidadCompra, insumo.unidadInventario) ?? 1
  return Math.round(Number(cantidad) * factor)
}

// Costo ponderado = suma(restante x precio) / suma(restante), pesando solo
// los lotes (CompraItem) que todavia tienen existencia real: cantidadRestante
// baja a medida que una venta con receta consume ese insumo (FIFO, ver
// consumoInsumo.js) y un lote en 0 (o de una compra ANULADA) deja de pesar
// aqui -- asi el costo refleja lo que de verdad queda, no todo lo comprado
// historicamente. cantidadRestante vive en unidadInventario; precioUnitario
// vive en unidadCompra, asi que cada lote se reconvierte a su propio factor
// (puede variar si el lote usa cantidadInventarioReal) antes de pesar, para
// que ambos lados de la cuenta esten en la misma unidad.
export async function recalcularCostoPonderadoInsumo(tx, insumoId) {
  const insumo = await tx.insumo.findUnique({
    where: { id: insumoId },
    select: { name: true, unidadCompra: true, unidadInventario: true },
  })
  if (!insumo) return

  const items = await tx.compraItem.findMany({
    where: { insumoId, compra: { estado: 'RECIBIDA' }, cantidadRestante: { gt: 0 } },
    select: { cantidad: true, cantidadInventarioReal: true, cantidadRestante: true, precioUnitario: true },
  })

  let cantidadTotal = 0
  let valorTotal = 0
  for (const item of items) {
    const original = cantidadConvertida({ cantidad: item.cantidad, cantidadInventarioReal: item.cantidadInventarioReal, insumo })
    if (original <= 0) continue
    const factor = original / Number(item.cantidad) // unidadInventario por unidadCompra, segun este lote puntual
    const restanteEnUnidadCompra = item.cantidadRestante / factor
    cantidadTotal += restanteEnUnidadCompra
    valorTotal += restanteEnUnidadCompra * Number(item.precioUnitario)
  }
  if (cantidadTotal <= 0) return
  await tx.insumo.update({ where: { id: insumoId }, data: { costoCompra: valorTotal / cantidadTotal } })
}

// Mismo criterio para presentaciones (Variant): pesa tanto lo comprado por
// Compras como lo entrado a mano por /inventory/movements -- las dos rutas
// quedan en StockMovement tipo PURCHASE con su costo, es una sola fuente.
// PURCHASE_VOID nunca pesa (es la reversa, no una compra real); una compra
// anulada excluye su PURCHASE original via el filtro de estado.
export async function recalcularCostoPonderadoVariant(tx, variantId) {
  const movimientos = await tx.stockMovement.findMany({
    where: {
      variantId,
      type: 'PURCHASE',
      cost: { not: null },
      OR: [{ compraItemId: null }, { compraItem: { compra: { estado: 'RECIBIDA' } } }],
    },
    select: { qty: true, cost: true },
  })
  const cantidadTotal = movimientos.reduce((s, m) => s + m.qty, 0)
  if (cantidadTotal <= 0) return
  const valorTotal = movimientos.reduce((s, m) => s + m.qty * Number(m.cost), 0)
  await tx.variant.update({ where: { id: variantId }, data: { cost: valorTotal / cantidadTotal } })
}
