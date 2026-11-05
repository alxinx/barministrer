import { prisma } from './prisma.js'

// Cuando una venta o un abono se paga a un banco/billetera real del modulo
// de Cajas y bancos, el metodo que se cuenta en el cuadre de turno sigue
// siendo el generico de siempre (TRANSFERENCIA o NEQUI -- ver
// Tenant.moduloCajasBancos y la decision de no tocar el cuadre), pero ademas
// se liga a la cuenta real para que ese ingreso quede en su ledger. Valida
// que la cuenta sea del tenant, este activa, y que su tipo corresponda al
// metodo elegido -- nunca confiar en que el id que llego del cliente es el
// correcto.
const TIPO_POR_METODO = { TRANSFERENCIA: 'BANCO', NEQUI: 'BILLETERA' }

export async function resolverCuentaPago(tenantId, method, cuentaFinancieraId) {
  if (!cuentaFinancieraId) return null
  const tipoEsperado = TIPO_POR_METODO[method]
  if (!tipoEsperado) return null // EFECTIVO/DATAFONO/CREDITO nunca llevan cuenta

  return prisma.cuentaFinanciera.findFirst({
    where: { id: cuentaFinancieraId, tenantId, active: true, tipo: tipoEsperado },
  })
}
