// Medios de pago unificados entre cierre de cuenta y cuadre de caja. Credito
// no entra aqui: el fiado es cuenta por cobrar, nunca efectivo ni plastico.
export const METHODS = [
  { key: 'EFECTIVO', label: 'Efectivo', icon: 'cash' },
  { key: 'NEQUI', label: 'Nequi', icon: 'phone' },
  { key: 'TRANSFERENCIA', label: 'Transferencia', icon: 'bank' },
  { key: 'DATAFONO', label: 'Datáfono', icon: 'card' },
]

export const METHOD_LABEL = Object.fromEntries(METHODS.map((m) => [m.key, m.label]))
