import { factorConversion, sinConversionFija } from './unidades.js'

export function calcularCostoUnidadInventario({
  costoCompra,
  unidadCompra,
  unidadInventario,
  cantidadPromedioPorUnidad,
}) {
  let factor = factorConversion(unidadCompra, unidadInventario)
  if (factor === null && sinConversionFija(unidadCompra, unidadInventario)) {
    factor = Number(cantidadPromedioPorUnidad) || null
  }
  return factor ? Number(costoCompra || 0) / factor : 0
}

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

// Pesa solo los lotes con cantidadRestante. El costo por unidadInventario se
// calcula con la cantidad real de cada lote, que puede diferir del promedio
// usado para sugerir compras; asi una bolsa de 2 kg no hereda el costo por
// gramo de una bolsa anterior de 500 g. Un insumo sin stock no conserva un
// ponderado viejo.
export async function recalcularCostoPonderadoInsumo(tx, insumoId) {
  const insumo = await tx.insumo.findUnique({
    where: { id: insumoId },
    select: { name: true, unidadCompra: true, unidadInventario: true, stock: true },
  })
  if (!insumo) return

  const items = await tx.compraItem.findMany({
    where: { insumoId, compra: { estado: 'RECIBIDA' }, cantidadRestante: { gt: 0 } },
    select: { cantidad: true, cantidadInventarioReal: true, cantidadRestante: true, precioUnitario: true },
  })

  let cantidadTotal = 0
  let valorTotal = 0
  let cantidadInventarioTotal = 0
  let valorInventarioTotal = 0
  for (const item of items) {
    const original = cantidadConvertida({ cantidad: item.cantidad, cantidadInventarioReal: item.cantidadInventarioReal, insumo })
    if (original <= 0) continue
    const factor = original / Number(item.cantidad) // unidadInventario por unidadCompra, segun este lote puntual
    const restanteInventario = Math.min(Number(item.cantidadRestante), original)
    const restanteEnUnidadCompra = restanteInventario / factor
    cantidadTotal += restanteEnUnidadCompra
    valorTotal += restanteEnUnidadCompra * Number(item.precioUnitario)
    cantidadInventarioTotal += restanteInventario
    valorInventarioTotal += restanteEnUnidadCompra * Number(item.precioUnitario)
  }
  const sinExistencia = Number(insumo.stock) <= 0 || cantidadInventarioTotal <= 0
  await tx.insumo.update({
    where: { id: insumoId },
    data: sinExistencia
      ? { costoCompra: 0, costoUnidadInventario: 0 }
      : {
          costoCompra: valorTotal / cantidadTotal,
          costoUnidadInventario: valorInventarioTotal / cantidadInventarioTotal,
        },
  })
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
