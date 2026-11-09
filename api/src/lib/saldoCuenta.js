import { prisma } from './prisma.js'

// El saldo de una CuentaFinanciera nunca se guarda: se suma siempre de sus
// MovimientoFinanciero (ver CLAUDE.md, "la disponibilidad se calcula, nunca
// se guarda en dos lugares"). Compartido entre cajasBancos.js (pantalla del
// modulo) y compras.js (selector de medio de pago, que necesita mostrar
// cuanto hay disponible en cada cuenta antes de asignarle un pago).
export async function saldoPorCuenta(tenantId, cuentaIds) {
  const agregados = await prisma.movimientoFinanciero.groupBy({
    by: ['cuentaId', 'tipo'],
    where: { tenantId, cuentaId: { in: cuentaIds } },
    _sum: { valor: true },
  })
  const saldos = {}
  for (const id of cuentaIds) saldos[id] = 0
  for (const a of agregados) {
    const monto = Number(a._sum.valor) || 0
    saldos[a.cuentaId] = (saldos[a.cuentaId] || 0) + (a.tipo === 'INGRESO' ? monto : -monto)
  }
  return saldos
}
