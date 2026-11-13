// Catalogo fijo de unidades para insumos, agrupadas por magnitud (masa,
// volumen, conteo). La conversion entre dos unidades de la MISMA magnitud se
// calcula de aqui (factor relativo a la unidad base de su magnitud), nunca
// se guarda en el insumo. Unidad de compra y unidad de inventario de un
// mismo insumo siempre deben ser de la misma magnitud: no tiene sentido
// comprar en litros y contar en gramos.
export const UNIDADES = [
  { codigo: 'gramo', nombre: 'Gramos (g)', magnitud: 'masa', factor: 1 },
  { codigo: 'kilogramo', nombre: 'Kilogramo (kg)', magnitud: 'masa', factor: 1000 },
  { codigo: 'mililitro', nombre: 'Mililitros (ml)', magnitud: 'volumen', factor: 1 },
  { codigo: 'litro', nombre: 'Litro (L)', magnitud: 'volumen', factor: 1000 },
  { codigo: 'unidad', nombre: 'Unidad', magnitud: 'conteo', factor: 1 },
  // Sin factor: un paquete de pan o de jamon no tiene un tamano universal
  // (20 panes en uno, 10 en otro), a diferencia de kg/g que siempre son
  // 1000. Solo tiene sentido como unidadCompra, nunca como unidadInventario
  // -- ver el filtro en InsumoForm.
  { codigo: 'paquete', nombre: 'Paquete', magnitud: 'conteo', factor: null },
  // Mismo caso que "paquete": una botella de jarabe, vino de cocina o
  // vinagre no tiene un tamano universal (puede venir de 500 ml, 750 ml, 1
  // L...), asi que tampoco tiene un factor fijo. Solo unidadCompra, nunca
  // unidadInventario.
  { codigo: 'botella', nombre: 'Botella', magnitud: 'conteo', factor: null },
  // Mismo caso que "paquete" y "botella": una caja de cerveza o de gaseosa
  // no tiene un tamano universal (puede traer 12, 24, 30 unidades), asi que
  // tampoco tiene un factor fijo. Solo unidadCompra, nunca unidadInventario.
  { codigo: 'caja', nombre: 'Caja', magnitud: 'conteo', factor: null },
]

export function buscarUnidad(codigo) {
  return UNIDADES.find((u) => u.codigo === codigo) || null
}

// Cuantas unidadInventario hay en 1 unidadCompra (ej: 1 kg = 1000 g -> 1000).
// Null si las dos no son de la misma magnitud, o si alguna no tiene un
// factor fijo declarado (ej: 'paquete') -- no se puede convertir.
export function factorConversion(codigoCompra, codigoInventario) {
  const compra = buscarUnidad(codigoCompra)
  const inventario = buscarUnidad(codigoInventario)
  if (!compra || !inventario || compra.magnitud !== inventario.magnitud) return null
  if (compra.factor == null || inventario.factor == null) return null
  return compra.factor / inventario.factor
}

// Caso especial: se compra por una unidad sin factor fijo real (conteo que
// varia -- "unidad" cuando cada una pesa distinto como una lechuga, o
// "paquete" cuando cada paquete trae una cantidad distinta de pan o jamon)
// y/o se cuenta/consume en otra magnitud (recetas en gramos). No entra en
// factorConversion: se declara a mano con Insumo.cantidadPromedioPorUnidad
// (estimado, para costear) y la cantidad real se declara en cada compra
// (ver CompraItem.cantidadInventarioReal).
export function sinConversionFija(codigoCompra, codigoInventario) {
  const compra = buscarUnidad(codigoCompra)
  const inventario = buscarUnidad(codigoInventario)
  if (!compra || !inventario) return false
  if (compra.factor == null) return true
  return compra.magnitud === 'conteo' && inventario.magnitud !== 'conteo'
}
