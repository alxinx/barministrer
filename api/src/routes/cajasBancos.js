import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireRole } from '../middleware/auth.js'
import { requireModule } from '../middleware/modules.js'
import { pinLimitExcedido, pinIncorrecto } from '../middleware/rateLimit.js'
import { verificarPin } from '../lib/pin.js'
import { ENTIDADES_FINANCIERAS, buscarEntidadFinanciera } from '../lib/catalogoFinanciero.js'
import { saldoPorCuenta } from '../lib/saldoCuenta.js'

export const cajasBancosRoutes = Router()

// Lista liviana para el selector de medio de pago al cerrar una venta o
// registrar un abono (ver CerrarCuentaModal.jsx y ClienteDetalle.jsx):
// cualquier rol que cobra la necesita, no solo ADMIN, a diferencia del resto
// de este modulo. Solo nombre/tipo, nada de saldos ni movimientos. Declarada
// ANTES del requireRole('ADMIN') de abajo para quedar fuera de esa cerca;
// requireModule igual aplica, asi que con el modulo apagado devuelve vacio y
// el frontend cae solo a los metodos genericos de siempre.
cajasBancosRoutes.get('/cajas-bancos/cuentas-pago', requireModule('moduloCajasBancos'), async (req, res) => {
  const cuentas = await prisma.cuentaFinanciera.findMany({
    where: { tenantId: req.auth.tenantId, active: true, tipo: { in: ['BANCO', 'BILLETERA'] } },
    select: { id: true, nombre: true, tipo: true, codigoEntidadFinanciera: true },
    orderBy: { createdAt: 'asc' },
  })
  res.json(cuentas)
})

// Modulo activable por tenant (ver Tenant.moduloCajasBancos) y, dentro de el,
// siempre solo ADMIN: es dinero real de la operacion del bar, mismo criterio
// que merma/descuentos. No hay flag delegable a CAJERO para este modulo.
// Con path explicito: sin el, un router.use() de Express corre para
// CUALQUIER pedido que llegue a este router sin importar la ruta, incluidos
// los que no matchean nada aqui y deberian caer al siguiente router montado
// en server.js (los demas routers montados despues de este en /api)-- los
// bloqueaba con "modulo no activado" aunque no tuvieran nada que ver con
// cajas y bancos.
cajasBancosRoutes.use('/cajas-bancos', requireModule('moduloCajasBancos'), requireRole('ADMIN'))

const TIPOS_CUENTA = ['CAJA', 'BANCO', 'BILLETERA']

cajasBancosRoutes.get('/cajas-bancos/catalogo-entidades', (_req, res) => {
  res.json(ENTIDADES_FINANCIERAS)
})

cajasBancosRoutes.get('/cajas-bancos/cuentas', async (req, res) => {
  const cuentas = await prisma.cuentaFinanciera.findMany({
    where: { tenantId: req.auth.tenantId, active: true },
    orderBy: { createdAt: 'asc' },
  })
  const saldos = await saldoPorCuenta(req.auth.tenantId, cuentas.map((c) => c.id))
  res.json(cuentas.map((c) => ({ ...c, saldo: saldos[c.id] || 0 })))
})

cajasBancosRoutes.post('/cajas-bancos/cuentas', async (req, res) => {
  const { nombre, tipo, codigoEntidadFinanciera, numeroCuenta } = req.body || {}
  if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre de la cuenta es obligatorio' })
  if (!TIPOS_CUENTA.includes(tipo)) return res.status(400).json({ error: 'El tipo de cuenta no es valido' })

  let codigo = null
  let numero = null
  if (tipo !== 'CAJA') {
    const entidad = buscarEntidadFinanciera(codigoEntidadFinanciera)
    if (!entidad) return res.status(400).json({ error: 'Selecciona un banco o billetera del catalogo' })
    codigo = entidad.codigo

    // Obligatorio para banco/billetera: una cuenta real sin numero no sirve
    // para conciliar contra el extracto. CAJA es virtual, nunca lo pide.
    if (!numeroCuenta?.toString().trim()) {
      return res.status(400).json({ error: 'El número de cuenta o de billetera es obligatorio' })
    }
    numero = numeroCuenta.toString().trim()
  }

  try {
    const cuenta = await prisma.cuentaFinanciera.create({
      data: {
        tenantId: req.auth.tenantId,
        nombre: nombre.trim(),
        tipo,
        codigoEntidadFinanciera: codigo,
        numeroCuenta: numero,
        createdById: req.auth.userId,
      },
    })
    res.status(201).json({ ...cuenta, saldo: 0 })
  } catch (e) {
    if (e.code === 'P2002') {
      const target = String(e.meta?.target || '')
      if (target.includes('numeroCuenta')) {
        return res.status(409).json({ error: 'Ya hay una cuenta registrada con ese número' })
      }
      return res.status(409).json({ error: 'Ya existe una cuenta con ese nombre' })
    }
    throw e
  }
})

// Query opcionales: search (concepto), desde/hasta (YYYY-MM-DD) -- mismo
// filtro que alimenta la lista en pantalla y la exportacion a Excel, para
// que lo que se ve sea exactamente lo que se exporta.
cajasBancosRoutes.get('/cajas-bancos/cuentas/:id', async (req, res) => {
  const cuenta = await prisma.cuentaFinanciera.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
  })
  if (!cuenta) return res.status(404).json({ error: 'Esa cuenta no existe' })

  const { search, desde, hasta } = req.query
  const movimientos = await prisma.movimientoFinanciero.findMany({
    where: {
      cuentaId: cuenta.id,
      ...(search && { concepto: { contains: String(search) } }),
      ...((desde || hasta) && {
        createdAt: {
          ...(desde && { gte: new Date(`${desde}T00:00:00`) }),
          ...(hasta && { lte: new Date(`${hasta}T23:59:59.999`) }),
        },
      }),
    },
    orderBy: { createdAt: 'desc' },
    take: 1000,
    include: {
      createdBy: { select: { name: true } },
      // Solo lo necesario para la accion "reimprimir": si el movimiento
      // nacio de una venta o un abono, su id real para ir a buscar esa
      // factura/comprobante (ver CajasBancos.jsx).
      orderPayment: { select: { orderId: true } },
      customerPayment: { select: { customerId: true } },
    },
  })
  const saldos = await saldoPorCuenta(req.auth.tenantId, [cuenta.id])

  res.json({ ...cuenta, saldo: saldos[cuenta.id] || 0, movimientos })
})

// Nombre si cambia; active para desactivar (nunca se borra, igual que
// categorias/usuarios). El tipo, el banco/billetera asignado y el numero de
// cuenta quedan fijos para siempre una vez creada: recategorizar o
// renumerar una cuenta con historial ya registrado rompe la conciliacion
// contra el extracto real.
cajasBancosRoutes.patch('/cajas-bancos/cuentas/:id', async (req, res) => {
  const cuenta = await prisma.cuentaFinanciera.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
  })
  if (!cuenta) return res.status(404).json({ error: 'Esa cuenta no existe' })

  const { nombre, active } = req.body || {}
  const data = {}
  if (nombre !== undefined) {
    if (!nombre.trim()) return res.status(400).json({ error: 'El nombre no puede quedar vacio' })
    data.nombre = nombre.trim()
  }
  if (active !== undefined) data.active = Boolean(active)

  try {
    const actualizada = await prisma.cuentaFinanciera.update({ where: { id: cuenta.id }, data })
    res.json(actualizada)
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'Ya existe una cuenta con ese nombre' })
    throw e
  }
})

// Movimiento manual directo sobre una cuenta: INGRESO (ej. saldo inicial al
// crear la cuenta) o EGRESO (ej. "Pago nomina"). Siempre con PIN de ADMIN,
// igual flujo que la merma manual en inventory.js.
cajasBancosRoutes.post('/cajas-bancos/cuentas/:id/movimientos', async (req, res) => {
  const { tipo, valor, concepto, pin } = req.body || {}
  const monto = Number(valor)
  if (!['INGRESO', 'EGRESO'].includes(tipo)) return res.status(400).json({ error: 'El tipo de movimiento no es valido' })
  if (!Number.isFinite(monto) || monto <= 0) return res.status(400).json({ error: 'El valor debe ser mayor a cero' })
  if (!concepto?.trim()) return res.status(400).json({ error: 'Escribe el concepto del movimiento' })
  if (!pin?.toString().trim()) return res.status(400).json({ error: 'Escribe el PIN' })

  const cuenta = await prisma.cuentaFinanciera.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId, active: true },
  })
  if (!cuenta) return res.status(400).json({ error: 'Esa cuenta no existe' })

  // Igual que la merma en inventory.js: la sesion ya tiene que ser ADMIN
  // (requireRole arriba), el PIN solo reconfirma que hay un encargado
  // presente -- acepta el de cualquier ADMIN/CAJERO activo, no exige que sea
  // especificamente el del ADMIN logueado.
  if (await pinLimitExcedido(req, res)) return
  const encargado = await verificarPin(req.auth.tenantId, pin)
  if (!encargado) return pinIncorrecto(req, res)

  const movimiento = await prisma.movimientoFinanciero.create({
    data: {
      tenantId: req.auth.tenantId,
      cuentaId: cuenta.id,
      tipo,
      valor: monto,
      concepto: concepto.trim(),
      createdById: encargado.id,
    },
    include: { createdBy: { select: { name: true } } },
  })
  res.status(201).json(movimiento)
})

// Traslado entre dos cuentas propias del negocio: crea el documento Traslado
// y sus 2 patas (egreso en origen, ingreso en destino) en una transaccion.
cajasBancosRoutes.post('/cajas-bancos/traslados', async (req, res) => {
  const { origenId, destinoId, valor, concepto, pin, confirmado } = req.body || {}
  const monto = Number(valor)
  if (!origenId || !destinoId) return res.status(400).json({ error: 'Selecciona la cuenta de origen y de destino' })
  if (origenId === destinoId) return res.status(400).json({ error: 'La cuenta de origen y destino no pueden ser la misma' })
  if (!Number.isFinite(monto) || monto <= 0) return res.status(400).json({ error: 'El valor debe ser mayor a cero' })
  if (!pin?.toString().trim()) return res.status(400).json({ error: 'Escribe el PIN' })

  const [origen, destino] = await Promise.all([
    prisma.cuentaFinanciera.findFirst({ where: { id: origenId, tenantId: req.auth.tenantId, active: true } }),
    prisma.cuentaFinanciera.findFirst({ where: { id: destinoId, tenantId: req.auth.tenantId, active: true } }),
  ])
  if (!origen || !destino) return res.status(400).json({ error: 'Alguna de las cuentas no existe' })

  // No bloquea -- solo avisa: si el traslado deja la cuenta origen en
  // negativo, el frontend muestra un modal de confirmar/rechazar (ver
  // TrasladoModal en CajasBancos.jsx) y reintenta con confirmado:true. Se
  // revisa antes del PIN para no gastar un intento en una alerta que todavia
  // ni siquiera se confirmo.
  const saldos = await saldoPorCuenta(req.auth.tenantId, [origenId])
  const saldoOrigen = saldos[origenId] || 0
  if (monto > saldoOrigen && !confirmado) {
    return res.status(409).json({ error: 'EXCEDE_SALDO', saldoDisponible: saldoOrigen })
  }

  if (await pinLimitExcedido(req, res)) return
  const encargado = await verificarPin(req.auth.tenantId, pin)
  if (!encargado) return pinIncorrecto(req, res)

  const resultado = await prisma.$transaction(async (tx) => {
    const traslado = await tx.traslado.create({
      data: {
        tenantId: req.auth.tenantId,
        origenId,
        destinoId,
        valor: monto,
        concepto: concepto?.trim() || null,
        createdById: encargado.id,
      },
    })
    await tx.movimientoFinanciero.createMany({
      data: [
        {
          tenantId: req.auth.tenantId,
          cuentaId: origenId,
          tipo: 'EGRESO',
          valor: monto,
          concepto: `Traslado a ${destino.nombre}`,
          trasladoId: traslado.id,
          createdById: encargado.id,
        },
        {
          tenantId: req.auth.tenantId,
          cuentaId: destinoId,
          tipo: 'INGRESO',
          valor: monto,
          concepto: `Traslado desde ${origen.nombre}`,
          trasladoId: traslado.id,
          createdById: encargado.id,
        },
      ],
    })
    return traslado
  })

  res.status(201).json({ ...resultado, createdBy: { name: encargado.name } })
})
