// Crea un ShiftExpense (retiro o gasto) con la misma validacion que
// POST /shifts/:id/expenses usa hoy. Factorizado para que el modulo de
// Compras pueda registrar un retiro ("pagar a un proveedor", el caso de uso
// que el propio ExpenseType.RETIRO ya documenta) dentro de la MISMA
// transaccion que sube el stock del insumo, en vez de hacer una llamada HTTP
// aparte que dejaria una ventana de inconsistencia si algo falla a medias.
// `client` es el cliente de prisma normal o un `tx` de `$transaction`.
export async function crearShiftExpense(client, { tenantId, shiftId, type, amount, reason, authorizedById }) {
  const shift = await client.shift.findFirst({ where: { id: shiftId, tenantId } })
  if (!shift) throw Object.assign(new Error('Turno no encontrado'), { status: 404 })
  if (shift.status !== 'OPEN') {
    throw Object.assign(new Error('Este turno ya esta cerrado, no se le pueden agregar egresos'), { status: 400 })
  }
  if (!['RETIRO', 'GASTO'].includes(type)) {
    throw Object.assign(new Error('El egreso necesita un tipo: retiro o gasto'), { status: 400 })
  }
  if (!amount || Number(amount) <= 0) {
    throw Object.assign(new Error('El egreso necesita un monto mayor a cero'), { status: 400 })
  }
  if (!reason?.trim()) {
    throw Object.assign(new Error('El egreso necesita un motivo'), { status: 400 })
  }

  return client.shiftExpense.create({
    data: { tenantId, shiftId, type, amount, reason: reason.trim(), authorizedById },
  })
}
