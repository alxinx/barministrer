// Medios de pago unificados entre cierre de cuenta y cuadre de caja. Credito
// no entra aqui: el fiado es cuenta por cobrar, nunca efectivo ni plastico.
export const METHODS = [
  { key: 'EFECTIVO', label: 'Efectivo', icon: 'cash' },
  { key: 'NEQUI', label: 'Nequi', icon: 'phone' },
  { key: 'TRANSFERENCIA', label: 'Transferencia', icon: 'bank' },
  { key: 'DATAFONO', label: 'Datáfono', icon: 'card' },
]

export const METHOD_LABEL = Object.fromEntries(METHODS.map((m) => [m.key, m.label]))

const TIPO_METODO = { BANCO: 'TRANSFERENCIA', BILLETERA: 'NEQUI' }

// Sustituye las opciones genericas TRANSFERENCIA/NEQUI por una opcion por
// cada cuenta real de ese tipo en el modulo de Cajas y bancos (ver
// useCuentasPago), con su propio nombre y su id -- asi el operador ve
// "Bancolombia ahorros" en vez de "Transferencia" y ese pago queda ligado a
// la cuenta real. Sin cuentas de un tipo, se deja la opcion generica de
// siempre; EFECTIVO/DATAFONO/CREDITO nunca cambian. Compartido entre el
// selector de cierre de cuenta (su propia lista, con CREDITO) y el de abono
// a fiado (METHODS, sin CREDITO).
export function conCuentasPago(methods, cuentas = []) {
  const porMetodo = {}
  for (const c of cuentas) {
    const metodo = TIPO_METODO[c.tipo]
    if (metodo) (porMetodo[metodo] ??= []).push(c)
  }
  return methods.flatMap((m) => {
    const cuentasDelMetodo = porMetodo[m.key]
    if (!cuentasDelMetodo?.length) return [m]
    return cuentasDelMetodo.map((c) => ({ ...m, label: c.nombre, cuentaFinancieraId: c.id }))
  })
}
