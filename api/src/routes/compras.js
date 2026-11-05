import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requirePermission } from '../middleware/permissions.js'
import { requireModule } from '../middleware/modules.js'
import { pinLimitExcedido, pinIncorrecto } from '../middleware/rateLimit.js'
import { verificarPin } from '../lib/pin.js'
import { crearShiftExpense } from '../lib/shiftExpense.js'
import { avisarTenant } from '../lib/realtime.js'
import { subirFacturaCompra, esUrlDeFactura } from '../lib/r2.js'
import { recalcularCostoPonderadoInsumo, recalcularCostoPonderadoVariant, cantidadConvertida } from '../lib/costeo.js'

export const comprasRoutes = Router()

// Explicito con path (no un .use() global): sin esto, Express corre el gate
// para CUALQUIER pedido que llegue a este router, incluidos los que caerian
// en otro router montado despues en server.js -- mismo problema ya resuelto
// en cajasBancos.js.
const gate = [requireModule('moduloCompras'), requirePermission('cajeroGestionaInventario')]
comprasRoutes.use('/compras', ...gate)
comprasRoutes.use('/proveedores/:id', ...gate)

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 })
}

function calcularTotalesItem({ cantidad, precioUnitario, descuento, porcentajeImpuesto, nombre }) {
  const bruto = cantidad * precioUnitario
  if (descuento > bruto) throw badRequest(`El descuento de "${nombre}" no puede superar su subtotal`)
  const subtotal = bruto - descuento
  const impuesto = subtotal * (porcentajeImpuesto / 100)
  const total = subtotal + impuesto
  return { subtotal, impuesto, total }
}

function calcularItemInsumo(raw, insumo) {
  const cantidad = Number(raw.cantidad)
  const precioUnitario = Number(raw.precioUnitario)
  const descuento = Number(raw.descuento || 0)
  const porcentajeImpuesto = Number(raw.porcentajeImpuesto || 0)
  // Solo se guarda para insumos sin conversion fija (ver sinConversionFija);
  // para los demas queda null. Opcional aqui a proposito: todavia puede no
  // haberse contado/pesado si la compra sigue en BORRADOR -- se exige recien
  // al recibir (ver cantidadConvertida).
  const cantidadInventarioReal =
    raw.cantidadInventarioReal != null && raw.cantidadInventarioReal !== '' ? Number(raw.cantidadInventarioReal) : null

  if (!Number.isFinite(cantidad) || cantidad <= 0) {
    throw badRequest(`La cantidad de "${insumo.name}" debe ser mayor a cero`)
  }
  if (!Number.isFinite(precioUnitario) || precioUnitario < 0) {
    throw badRequest(`El precio de "${insumo.name}" no es válido`)
  }
  if (!Number.isFinite(descuento) || descuento < 0) {
    throw badRequest(`El descuento de "${insumo.name}" no es válido`)
  }
  if (!Number.isFinite(porcentajeImpuesto) || porcentajeImpuesto < 0 || porcentajeImpuesto > 100) {
    throw badRequest(`El impuesto de "${insumo.name}" no es válido`)
  }
  if (cantidadInventarioReal !== null && (!Number.isFinite(cantidadInventarioReal) || cantidadInventarioReal < 0)) {
    throw badRequest(`El peso o volumen real de "${insumo.name}" no es válido`)
  }

  const { subtotal, impuesto, total } = calcularTotalesItem({
    cantidad,
    precioUnitario,
    descuento,
    porcentajeImpuesto,
    nombre: insumo.name,
  })

  return {
    insumoId: insumo.id,
    variantId: null,
    cantidad,
    precioUnitario,
    descuento,
    porcentajeImpuesto,
    cantidadInventarioReal,
    subtotal,
    impuesto,
    total,
    insumo,
    variant: null,
  }
}

// Producto de consumo final (cerveza, gaseosa, pan empacado -- no entra a
// ninguna receta): sin conversion de unidad, un Variant siempre se cuenta en
// unidades enteras (ver CLAUDE.md > Productos, presentaciones y recetas), y
// no tiene el caso especial de cantidadInventarioReal (eso es solo de
// insumos comprados por unidad/paquete sin tamano fijo).
function calcularItemVariante(raw, variant) {
  const nombre = `${variant.product.name} · ${variant.name}`
  const cantidad = Math.round(Number(raw.cantidad))
  const precioUnitario = Number(raw.precioUnitario)
  const descuento = Number(raw.descuento || 0)
  const porcentajeImpuesto = Number(raw.porcentajeImpuesto || 0)

  if (!Number.isFinite(cantidad) || cantidad <= 0) throw badRequest(`La cantidad de "${nombre}" debe ser mayor a cero`)
  if (!Number.isFinite(precioUnitario) || precioUnitario < 0) throw badRequest(`El precio de "${nombre}" no es válido`)
  if (!Number.isFinite(descuento) || descuento < 0) throw badRequest(`El descuento de "${nombre}" no es válido`)
  if (!Number.isFinite(porcentajeImpuesto) || porcentajeImpuesto < 0 || porcentajeImpuesto > 100) {
    throw badRequest(`El impuesto de "${nombre}" no es válido`)
  }

  const { subtotal, impuesto, total } = calcularTotalesItem({ cantidad, precioUnitario, descuento, porcentajeImpuesto, nombre })

  return {
    insumoId: null,
    variantId: variant.id,
    cantidad,
    precioUnitario,
    descuento,
    porcentajeImpuesto,
    cantidadInventarioReal: null,
    subtotal,
    impuesto,
    total,
    insumo: null,
    variant,
  }
}

// Nunca se confia en subtotal/impuesto/total que mande el cliente: siempre
// se recalculan aqui a partir de cantidad/precio/descuento/% impuesto. Cada
// linea es un insumo (receta) O un producto de consumo final (variantId) --
// ver CompraItem en el schema.
function calcularItem(raw, insumosPorId, variantesPorId) {
  if (raw?.insumoId) {
    const insumo = insumosPorId.get(raw.insumoId)
    if (!insumo) throw badRequest('Uno de los insumos de la compra no existe')
    return calcularItemInsumo(raw, insumo)
  }
  if (raw?.variantId) {
    const variant = variantesPorId.get(raw.variantId)
    if (!variant) throw badRequest('Uno de los productos de la compra no existe')
    return calcularItemVariante(raw, variant)
  }
  throw badRequest('Cada línea necesita un insumo o un producto')
}

// Arma los dos mapas (insumo/variant por id) a partir de los items crudos
// que llegan en el body o de los ya guardados en una Compra -- un solo lugar
// en vez de repetir "sacar los ids, pedirlos, armar el Map" 4 veces.
async function catalogosDeItems(tenantId, items) {
  const insumoIds = [...new Set(items.map((i) => i?.insumoId).filter(Boolean))]
  const variantIds = [...new Set(items.map((i) => i?.variantId).filter(Boolean))]
  const [insumos, variantes] = await Promise.all([
    prisma.insumo.findMany({ where: { id: { in: insumoIds }, tenantId } }),
    prisma.variant.findMany({
      where: { id: { in: variantIds }, product: { tenantId } },
      include: { product: { select: { name: true } } },
    }),
  ])
  return {
    insumosPorId: new Map(insumos.map((i) => [i.id, i])),
    variantesPorId: new Map(variantes.map((v) => [v.id, v])),
  }
}

function sumarTotales(calculados) {
  return calculados.reduce(
    (acc, it) => ({
      subtotal: acc.subtotal + it.subtotal,
      descuento: acc.descuento + it.descuento,
      impuesto: acc.impuesto + it.impuesto,
      total: acc.total + it.total,
    }),
    { subtotal: 0, descuento: 0, impuesto: 0, total: 0 }
  )
}

function estadoPagoDe(total, totalPagado) {
  if (totalPagado <= 0) return 'PENDIENTE'
  if (totalPagado >= total - 0.009) return 'PAGADA'
  return 'PARCIAL'
}

// Comparte la resolucion del pago entre "recibir" (pago inicial) y "pagos"
// (abono posterior): EFECTIVO_TURNO sale de la caja de un turno abierto
// (mismo ExpenseType.RETIRO que ya existia para "pagarle a un proveedor"),
// CUENTA_FINANCIERA sale de una CAJA/BANCO/BILLETERA del modulo de Cajas y
// Bancos. Nunca deja pagar mas del saldo pendiente.
async function resolverPagoCompra(tx, { tenantId, compraId, pago, encargadoId, saldoPendiente, descripcion }) {
  const monto = Number(pago.monto)
  if (!Number.isFinite(monto) || monto <= 0) throw badRequest('El monto del pago debe ser mayor a cero')
  if (monto > saldoPendiente + 0.009) throw badRequest('El pago no puede superar el saldo pendiente')

  if (pago.metodo === 'EFECTIVO_TURNO') {
    if (!pago.shiftId) throw badRequest('Selecciona el turno abierto del que sale el efectivo')
    const expense = await crearShiftExpense(tx, {
      tenantId,
      shiftId: pago.shiftId,
      type: 'RETIRO',
      amount: monto,
      reason: descripcion,
      authorizedById: encargadoId,
    })
    return tx.compraPago.create({
      data: {
        tenantId,
        compraId,
        monto,
        metodo: 'EFECTIVO_TURNO',
        nota: pago.nota?.trim() || null,
        shiftExpenseId: expense.id,
        createdById: encargadoId,
      },
    })
  }

  if (pago.metodo === 'CUENTA_FINANCIERA') {
    const cuenta = await tx.cuentaFinanciera.findFirst({
      where: { id: pago.cuentaFinancieraId, tenantId, active: true, tipo: { in: ['CAJA', 'BANCO', 'BILLETERA'] } },
    })
    if (!cuenta) throw badRequest('Esa cuenta no existe')

    const compraPago = await tx.compraPago.create({
      data: {
        tenantId,
        compraId,
        monto,
        metodo: 'CUENTA_FINANCIERA',
        nota: pago.nota?.trim() || null,
        createdById: encargadoId,
      },
    })
    await tx.movimientoFinanciero.create({
      data: {
        tenantId,
        cuentaId: cuenta.id,
        tipo: 'EGRESO',
        valor: monto,
        concepto: descripcion,
        compraPagoId: compraPago.id,
        createdById: encargadoId,
      },
    })
    return compraPago
  }

  // No mueve plata de ningun turno ni cuenta registrada (canje, caja de
  // eventos, cualquier otro arreglo fuera del sistema) -- la nota es
  // obligatoria porque es la unica forma de saber despues de que se trato.
  if (pago.metodo === 'OTRO') {
    if (!pago.nota?.trim()) throw badRequest('Escribe de qué se trata este pago ("otro")')
    return tx.compraPago.create({
      data: { tenantId, compraId, monto, metodo: 'OTRO', nota: pago.nota.trim(), createdById: encargadoId },
    })
  }

  throw badRequest('El método de pago no es válido')
}

// Varios medios en un solo pago (igual que el POS: parte efectivo, parte
// transferencia, etc.) -- cada fila se valida contra lo que vaya quedando
// del saldo pendiente, nunca contra el total original, para que la suma de
// todas nunca pueda superarlo aunque cada una individualmente quepa.
async function resolverPagos(tx, { tenantId, compraId, pagos, encargadoId, saldoPendiente, descripcion }) {
  if (!pagos || pagos.length === 0) return 0
  let restante = saldoPendiente
  let total = 0
  for (const pago of pagos) {
    await resolverPagoCompra(tx, { tenantId, compraId, pago, encargadoId, saldoPendiente: restante, descripcion })
    const monto = Number(pago.monto)
    restante -= monto
    total += monto
  }
  return total
}

// Por cada linea: InsumoMovement PURCHASE + sube Insumo.stock (convertido a
// su unidadInventario) + recalcula Insumo.costoCompra como promedio
// ponderado contra las demas compras recibidas de este insumo (ver
// recalcularCostoPonderadoInsumo) -- nunca se sobrescribe con el precio de
// esta sola compra, un insumo puede tener varias compras a precios
// distintos coexistiendo con existencia.
async function aplicarRecepcion(tx, { tenantId, items, insumosPorId, variantesPorId, encargadoId }) {
  for (const item of items) {
    if (item.insumoId) {
      const insumo = insumosPorId.get(item.insumoId)
      const qty = cantidadConvertida({ cantidad: item.cantidad, cantidadInventarioReal: item.cantidadInventarioReal, insumo })
      await tx.compraItem.update({ where: { id: item.id }, data: { cantidadRestante: qty } })
      await tx.insumoMovement.create({
        data: { tenantId, insumoId: insumo.id, type: 'PURCHASE', qty, compraItemId: item.id, createdById: encargadoId },
      })
      await tx.insumo.update({ where: { id: insumo.id }, data: { stock: { increment: qty } } })
      await recalcularCostoPonderadoInsumo(tx, insumo.id)
    } else {
      // Producto de consumo final: ya en unidades enteras, sin conversion.
      const variant = variantesPorId.get(item.variantId)
      const qty = Math.round(Number(item.cantidad))
      await tx.stockMovement.create({
        data: {
          tenantId,
          variantId: variant.id,
          type: 'PURCHASE',
          qty,
          cost: item.precioUnitario,
          compraItemId: item.id,
          createdById: encargadoId,
        },
      })
      await tx.variant.update({ where: { id: variant.id }, data: { stock: { increment: qty } } })
      await recalcularCostoPonderadoVariant(tx, variant.id)
    }
  }
}

// --- Factura adjunta (foto o PDF del documento del proveedor) --------------
// Misma logica que /products/image y /insumos/image (base64 -> decodifica ->
// sube a R2 -> devuelve la URL), pero sin exigir el id de una compra: el
// operador puede adjuntarla mientras todavia esta armando una compra nueva,
// antes de que exista un id que guardar. El create/editar de la compra
// (abajo) solo recibe la URL ya subida, igual que imageUrl en productos.
const TIPOS_FACTURA = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
}
comprasRoutes.post('/compras/factura', async (req, res) => {
  const { file, nombre } = req.body || {}
  const match = /^data:([^;]+);base64,(.+)$/.exec(file || '')
  if (!match) return res.status(400).json({ error: 'El archivo de la factura no llegó en el formato esperado' })

  const [, contentType, base64] = match
  const extension = TIPOS_FACTURA[contentType]
  if (!extension) {
    return res.status(400).json({ error: 'Solo se aceptan facturas en JPG, PNG, GIF o PDF' })
  }

  const buffer = Buffer.from(base64, 'base64')
  if (buffer.length > 1_500_000) {
    return res.status(400).json({
      error: 'La factura quedó muy pesada (máximo 1.5 MB); usa una foto más liviana o un PDF comprimido',
    })
  }

  const facturaUrl = await subirFacturaCompra(req.auth.tenantId, buffer, contentType, extension)
  res.status(201).json({ facturaUrl, facturaNombre: nombre?.toString().trim().slice(0, 200) || null })
})

// Adjuntar/reemplazar/quitar la factura de una compra que YA existe, sin
// importar su estado -- a diferencia de editar cabecera/items (solo en
// BORRADOR), documentar la factura no mueve stock ni plata, asi que no hay
// razon para bloquearlo despues de recibida.
comprasRoutes.patch('/compras/:id/factura', async (req, res) => {
  const compra = await prisma.compra.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } })
  if (!compra) return res.status(404).json({ error: 'Compra no encontrada' })

  const { facturaUrl, facturaNombre } = req.body || {}
  if (!esUrlDeFactura(facturaUrl)) {
    return res.status(400).json({ error: 'La URL de la factura no es válida' })
  }
  const actualizada = await prisma.compra.update({
    where: { id: compra.id },
    data: { facturaUrl: facturaUrl || null, facturaNombre: facturaUrl ? facturaNombre || null : null },
  })
  res.json(actualizada)
})

// --- Proveedores (perfil completo -- el alta minima "solo nombre" sigue en
// insumos.js, sin requireModule, para que InsumoForm la use con o sin este
// modulo activo) -----------------------------------------------------------

comprasRoutes.get('/proveedores/:id', async (req, res) => {
  const proveedor = await prisma.proveedor.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } })
  if (!proveedor) return res.status(404).json({ error: 'Proveedor no encontrado' })

  const [compras, insumos] = await Promise.all([
    prisma.compra.findMany({
      where: { proveedorId: proveedor.id, tenantId: req.auth.tenantId },
      // Solo el nombre de cada insumo/producto, para el resumen de la fila
      // en el historial ("Café Quindío + 2 más") -- igual criterio que
      // GET /compras (nunca precios ni cantidades en el listado).
      include: {
        items: {
          select: {
            insumo: { select: { name: true } },
            variant: { select: { name: true, product: { select: { name: true } } } },
          },
        },
      },
      orderBy: { fecha: 'desc' },
    }),
    prisma.insumo.findMany({
      where: { proveedorId: proveedor.id, tenantId: req.auth.tenantId, active: true },
      orderBy: { name: 'asc' },
    }),
  ])

  const recibidas = compras.filter((c) => c.estado === 'RECIBIDA')
  const totalComprado = recibidas.reduce((s, c) => s + Number(c.total), 0)
  const saldoPendiente = recibidas.reduce((s, c) => s + (Number(c.total) - Number(c.totalPagado)), 0)

  res.json({
    ...proveedor,
    compras: compras.map((c) => ({ ...c, saldoPendiente: Number(c.total) - Number(c.totalPagado) })),
    insumos,
    totalComprado,
    saldoPendiente,
  })
})

comprasRoutes.patch('/proveedores/:id', async (req, res) => {
  const proveedor = await prisma.proveedor.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } })
  if (!proveedor) return res.status(404).json({ error: 'Proveedor no encontrado' })

  const {
    name,
    nombreComercial,
    tipoIdentificacion,
    numeroIdentificacion,
    contacto,
    telefono,
    whatsapp,
    email,
    direccion,
    ciudad,
    observaciones,
    condicionPago,
    diasCredito,
    active,
  } = req.body || {}

  if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'El proveedor necesita un nombre' })
  if (tipoIdentificacion !== undefined && tipoIdentificacion !== null && !['NIT', 'CEDULA'].includes(tipoIdentificacion)) {
    return res.status(400).json({ error: 'El tipo de identificación no es válido' })
  }
  if (condicionPago !== undefined && !['CONTADO', 'CREDITO'].includes(condicionPago)) {
    return res.status(400).json({ error: 'La condición de pago no es válida' })
  }

  try {
    const actualizado = await prisma.proveedor.update({
      where: { id: proveedor.id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(nombreComercial !== undefined && { nombreComercial: nombreComercial?.trim() || null }),
        ...(tipoIdentificacion !== undefined && { tipoIdentificacion: tipoIdentificacion || null }),
        ...(numeroIdentificacion !== undefined && {
          numeroIdentificacion: numeroIdentificacion?.toString().trim() || null,
        }),
        ...(contacto !== undefined && { contacto: contacto?.trim() || null }),
        ...(telefono !== undefined && { telefono: telefono?.trim() || null }),
        ...(whatsapp !== undefined && { whatsapp: whatsapp?.trim() || null }),
        ...(email !== undefined && { email: email?.trim() || null }),
        ...(direccion !== undefined && { direccion: direccion?.trim() || null }),
        ...(ciudad !== undefined && { ciudad: ciudad?.trim() || null }),
        ...(observaciones !== undefined && { observaciones: observaciones?.trim() || null }),
        ...(condicionPago !== undefined && { condicionPago }),
        ...(diasCredito !== undefined && { diasCredito: diasCredito ? Number(diasCredito) : null }),
        ...(active !== undefined && { active: Boolean(active) }),
      },
    })
    res.json(actualizado)
  } catch (e) {
    if (e.code === 'P2002') {
      const target = String(e.meta?.target || '')
      if (target.includes('numeroIdentificacion')) {
        return res.status(409).json({ error: 'Ya hay un proveedor con ese número de identificación' })
      }
      return res.status(409).json({ error: 'Ya existe un proveedor con ese nombre' })
    }
    throw e
  }
})

// --- Compras ---------------------------------------------------------------

const COMPRAS_POR_PAGINA = 10

// Scroll infinito de mas nueva a mas vieja, 10 a la vez. orderBy cierra con
// el id (unico) despues de createdAt: dos compras creadas en el mismo
// milisegundo no tienen por que mantener el mismo orden entre paginas si
// solo se ordena por createdAt, y una misma fila podria salir repetida o
// saltada entre un scroll y el siguiente (ver CLAUDE.md > Paginacion).
comprasRoutes.get('/compras', async (req, res) => {
  const { desde, hasta, proveedorId, filtro, search, cursor } = req.query

  const whereBase = {
    tenantId: req.auth.tenantId,
    ...(proveedorId && { proveedorId: String(proveedorId) }),
    ...(search && { numeroDocumento: { contains: String(search) } }),
    ...((desde || hasta) && {
      fecha: {
        ...(desde && { gte: new Date(`${desde}T00:00:00`) }),
        ...(hasta && { lte: new Date(`${hasta}T23:59:59.999`) }),
      },
    }),
  }
  const whereFiltro =
    filtro === 'BORRADOR'
      ? { estado: 'BORRADOR' }
      : filtro === 'RECIBIDA'
        ? { estado: 'RECIBIDA' }
        : filtro === 'CON_SALDO'
          ? { estado: 'RECIBIDA', estadoPago: { in: ['PENDIENTE', 'PARCIAL'] } }
          : {}

  const compras = await prisma.compra.findMany({
    where: { ...whereBase, ...whereFiltro },
    include: {
      proveedor: { select: { id: true, name: true } },
      // Solo el nombre de cada insumo, para el resumen de la tarjeta en la
      // lista ("Leche Entera + 3 más") -- nunca precios ni cantidades, eso
      // solo se pide al abrir el detalle.
      items: {
        select: {
          insumo: { select: { name: true } },
          variant: { select: { name: true, product: { select: { name: true } } } },
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: COMPRAS_POR_PAGINA + 1, // uno de mas, para saber si hay otra pagina
    ...(cursor && { cursor: { id: String(cursor) }, skip: 1 }),
  })
  const hayMas = compras.length > COMPRAS_POR_PAGINA
  const pagina = hayMas ? compras.slice(0, COMPRAS_POR_PAGINA) : compras

  // Contadores de los chips (Borrador/Recibidas/Con saldo): sobre el total
  // filtrado por busqueda/proveedor/fecha, nunca por el filtro de estado ni
  // por la pagina actual -- asi el chip inactivo sigue mostrando cuantas hay
  // sin tener que cambiar de pestaña para pedirlo.
  const [todas, borrador, recibida, conSaldo] = await Promise.all([
    prisma.compra.count({ where: whereBase }),
    prisma.compra.count({ where: { ...whereBase, estado: 'BORRADOR' } }),
    prisma.compra.count({ where: { ...whereBase, estado: 'RECIBIDA' } }),
    prisma.compra.count({ where: { ...whereBase, estado: 'RECIBIDA', estadoPago: { in: ['PENDIENTE', 'PARCIAL'] } } }),
  ])

  res.json({
    items: pagina.map((c) => ({ ...c, saldoPendiente: Number(c.total) - Number(c.totalPagado) })),
    nextCursor: hayMas ? pagina[pagina.length - 1].id : null,
    counts: { todas, BORRADOR: borrador, RECIBIDA: recibida, CON_SALDO: conSaldo },
  })
})

// Lista liviana de cuentas CAJA + BANCO + BILLETERA para el selector de pago
// (a diferencia de /cajas-bancos/cuentas-pago, que a proposito excluye CAJA
// porque es para medios de pago de venta). Sin el modulo de Cajas y Bancos,
// queda vacia -- el formulario cae solo a efectivo de turno o credito, igual
// de transparente que useCuentasPago() en el frontend.
comprasRoutes.get('/compras/cuentas-pago', async (req, res) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.auth.tenantId },
    select: { moduloCajasBancos: true },
  })
  if (!tenant?.moduloCajasBancos) return res.json([])

  const cuentas = await prisma.cuentaFinanciera.findMany({
    where: { tenantId: req.auth.tenantId, active: true, tipo: { in: ['CAJA', 'BANCO', 'BILLETERA'] } },
    select: { id: true, nombre: true, tipo: true },
    orderBy: { createdAt: 'asc' },
  })
  res.json(cuentas)
})

// --- Lista de compras (recordatorio de insumos a pedir, sin cantidad ni
// precio -- eso nace cuando de verdad se registra la Compra) ---------------

comprasRoutes.get('/compras/lista', async (req, res) => {
  const items = await prisma.listaCompraItem.findMany({
    where: { tenantId: req.auth.tenantId },
    include: {
      insumo: {
        select: {
          id: true,
          name: true,
          imageUrl: true,
          stock: true,
          stockMinimo: true,
          unidadInventario: true,
          proveedor: { select: { id: true, name: true, whatsapp: true } },
        },
      },
      variant: {
        select: {
          id: true,
          name: true,
          stock: true,
          stockMinimo: true,
          product: { select: { id: true, name: true, imageUrl: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })
  res.json(items)
})

// Un clic agrega (idempotente: si ya estaba, no duplica ni falla).
comprasRoutes.post('/compras/lista/:insumoId', async (req, res) => {
  const insumo = await prisma.insumo.findFirst({ where: { id: req.params.insumoId, tenantId: req.auth.tenantId } })
  if (!insumo) return res.status(404).json({ error: 'Insumo no encontrado' })

  const item = await prisma.listaCompraItem.upsert({
    where: { tenantId_insumoId: { tenantId: req.auth.tenantId, insumoId: insumo.id } },
    update: {},
    create: { tenantId: req.auth.tenantId, insumoId: insumo.id, createdById: req.auth.userId },
  })
  res.status(201).json(item)
})

comprasRoutes.delete('/compras/lista/:insumoId', async (req, res) => {
  await prisma.listaCompraItem.deleteMany({ where: { tenantId: req.auth.tenantId, insumoId: req.params.insumoId } })
  res.status(204).end()
})

// Mismo mecanismo idempotente que la lista de insumos, pero para productos
// de consumo final (Variant) -- rutas paralelas en vez de una sola
// polimorfica para no tener que adivinar de que tabla es el id en la URL.
comprasRoutes.post('/compras/lista/producto/:variantId', async (req, res) => {
  const variant = await prisma.variant.findFirst({ where: { id: req.params.variantId, product: { tenantId: req.auth.tenantId } } })
  if (!variant) return res.status(404).json({ error: 'Presentación no encontrada' })

  const item = await prisma.listaCompraItem.upsert({
    where: { tenantId_variantId: { tenantId: req.auth.tenantId, variantId: variant.id } },
    update: {},
    create: { tenantId: req.auth.tenantId, variantId: variant.id, createdById: req.auth.userId },
  })
  res.status(201).json(item)
})

comprasRoutes.delete('/compras/lista/producto/:variantId', async (req, res) => {
  await prisma.listaCompraItem.deleteMany({ where: { tenantId: req.auth.tenantId, variantId: req.params.variantId } })
  res.status(204).end()
})

comprasRoutes.get('/compras/:id', async (req, res) => {
  const compra = await prisma.compra.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
    include: {
      proveedor: true,
      items: {
        include: {
          insumo: { select: { id: true, name: true, imageUrl: true, unidadCompra: true, unidadInventario: true } },
          variant: {
            select: { id: true, name: true, product: { select: { id: true, name: true, imageUrl: true } } },
          },
        },
      },
      pagos: { orderBy: { createdAt: 'asc' }, include: { createdBy: { select: { name: true } } } },
      createdBy: { select: { name: true } },
      recibidaBy: { select: { name: true } },
      anuladaBy: { select: { name: true } },
    },
  })
  if (!compra) return res.status(404).json({ error: 'Compra no encontrada' })
  res.json({ ...compra, saldoPendiente: Number(compra.total) - Number(compra.totalPagado) })
})

comprasRoutes.post('/compras', async (req, res) => {
  const {
    proveedorId,
    numeroDocumento,
    fecha,
    fechaVencimiento,
    observaciones,
    facturaUrl,
    facturaNombre,
    items,
    accion,
    pagos,
    pin,
  } = req.body || {}

  if (!proveedorId) return res.status(400).json({ error: 'Elige un proveedor' })
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Agrega al menos un insumo o producto a la compra' })
  }
  if (!['guardar', 'recibir'].includes(accion)) return res.status(400).json({ error: 'Acción inválida' })
  if (!esUrlDeFactura(facturaUrl)) return res.status(400).json({ error: 'La URL de la factura no es válida' })

  const proveedor = await prisma.proveedor.findFirst({
    where: { id: proveedorId, tenantId: req.auth.tenantId, active: true },
  })
  if (!proveedor) return res.status(400).json({ error: 'El proveedor no existe' })

  const { insumosPorId, variantesPorId } = await catalogosDeItems(req.auth.tenantId, items)

  let calculados
  try {
    calculados = items.map((raw) => calcularItem(raw, insumosPorId, variantesPorId))
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message })
  }
  const totales = sumarTotales(calculados)

  const dataCabecera = {
    tenantId: req.auth.tenantId,
    proveedorId: proveedor.id,
    numeroDocumento: numeroDocumento?.toString().trim() || null,
    fecha: fecha ? new Date(fecha) : new Date(),
    fechaVencimiento: fechaVencimiento ? new Date(fechaVencimiento) : null,
    observaciones: observaciones?.trim() || null,
    facturaUrl: facturaUrl || null,
    facturaNombre: facturaUrl ? facturaNombre || null : null,
    subtotal: totales.subtotal,
    descuento: totales.descuento,
    impuesto: totales.impuesto,
    total: totales.total,
    createdById: req.auth.userId,
  }
  const itemsParaCrear = calculados.map(({ insumo, variant, ...it }) => it)

  if (accion === 'guardar') {
    try {
      const compra = await prisma.compra.create({
        data: { ...dataCabecera, items: { create: itemsParaCrear } },
        include: { items: true, proveedor: { select: { id: true, name: true } } },
      })
      return res.status(201).json({ ...compra, saldoPendiente: Number(compra.total) })
    } catch (e) {
      if (e.code === 'P2002') {
        return res.status(409).json({ error: 'Ya existe una compra con ese número de documento para este proveedor' })
      }
      throw e
    }
  }

  // accion === 'recibir': sube stock de una y puede mover plata real -- pide
  // PIN igual que merma y los egresos de Cajas y Bancos.
  if (await pinLimitExcedido(req, res)) return
  const encargado = await verificarPin(req.auth.tenantId, pin)
  if (!encargado) return pinIncorrecto(req, res)

  try {
    const resultado = await prisma.$transaction(async (tx) => {
      const compra = await tx.compra.create({
        data: {
          ...dataCabecera,
          estado: 'RECIBIDA',
          recibidaAt: new Date(),
          recibidaById: encargado.id,
          items: { create: itemsParaCrear },
        },
        include: { items: true },
      })

      await aplicarRecepcion(tx, {
        tenantId: req.auth.tenantId,
        items: compra.items,
        insumosPorId,
        variantesPorId,
        encargadoId: encargado.id,
      })

      const totalPagado = await resolverPagos(tx, {
        tenantId: req.auth.tenantId,
        compraId: compra.id,
        pagos,
        encargadoId: encargado.id,
        saldoPendiente: Number(compra.total),
        descripcion: `Pago compra ${compra.numeroDocumento || proveedor.name}`,
      })

      return tx.compra.update({
        where: { id: compra.id },
        data: { totalPagado, estadoPago: estadoPagoDe(Number(compra.total), totalPagado) },
        include: { items: true, pagos: true, proveedor: { select: { id: true, name: true } } },
      })
    })
    avisarTenant(req.auth.tenantId, 'inventario:actualizado', {})
    res.status(201).json({ ...resultado, saldoPendiente: Number(resultado.total) - Number(resultado.totalPagado) })
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Ya existe una compra con ese número de documento para este proveedor' })
    }
    res.status(err.status || 400).json({ error: err.message })
  }
})

// Solo se puede editar en BORRADOR: una compra recibida ya movio stock y
// quiza plata real, editarla libremente desincronizaria ambas cosas.
comprasRoutes.patch('/compras/:id', async (req, res) => {
  const compra = await prisma.compra.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } })
  if (!compra) return res.status(404).json({ error: 'Compra no encontrada' })
  if (compra.estado !== 'BORRADOR') return res.status(400).json({ error: 'Solo se puede editar una compra en borrador' })

  const { proveedorId, numeroDocumento, fecha, fechaVencimiento, observaciones, facturaUrl, facturaNombre, items } =
    req.body || {}

  if (facturaUrl !== undefined && !esUrlDeFactura(facturaUrl)) {
    return res.status(400).json({ error: 'La URL de la factura no es válida' })
  }

  if (proveedorId !== undefined) {
    const proveedor = await prisma.proveedor.findFirst({
      where: { id: proveedorId, tenantId: req.auth.tenantId, active: true },
    })
    if (!proveedor) return res.status(400).json({ error: 'El proveedor no existe' })
  }

  let itemsParaCrear, totales
  if (items !== undefined) {
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Agrega al menos un insumo o producto a la compra' })
    }
    const { insumosPorId, variantesPorId } = await catalogosDeItems(req.auth.tenantId, items)
    let calculados
    try {
      calculados = items.map((raw) => calcularItem(raw, insumosPorId, variantesPorId))
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message })
    }
    totales = sumarTotales(calculados)
    itemsParaCrear = calculados.map(({ insumo, variant, ...it }) => it)
  }

  try {
    const actualizada = await prisma.$transaction(async (tx) => {
      if (itemsParaCrear) await tx.compraItem.deleteMany({ where: { compraId: compra.id } })
      return tx.compra.update({
        where: { id: compra.id },
        data: {
          ...(proveedorId !== undefined && { proveedorId }),
          ...(numeroDocumento !== undefined && { numeroDocumento: numeroDocumento?.toString().trim() || null }),
          ...(fecha !== undefined && { fecha: new Date(fecha) }),
          ...(fechaVencimiento !== undefined && {
            fechaVencimiento: fechaVencimiento ? new Date(fechaVencimiento) : null,
          }),
          ...(observaciones !== undefined && { observaciones: observaciones?.trim() || null }),
          ...(facturaUrl !== undefined && {
            facturaUrl: facturaUrl || null,
            facturaNombre: facturaUrl ? facturaNombre || null : null,
          }),
          ...(itemsParaCrear && {
            subtotal: totales.subtotal,
            descuento: totales.descuento,
            impuesto: totales.impuesto,
            total: totales.total,
            items: { create: itemsParaCrear },
          }),
        },
        include: { items: true, proveedor: { select: { id: true, name: true } } },
      })
    })
    res.json({ ...actualizada, saldoPendiente: Number(actualizada.total) })
  } catch (e) {
    if (e.code === 'P2002') {
      return res.status(409).json({ error: 'Ya existe una compra con ese número de documento para este proveedor' })
    }
    throw e
  }
})

comprasRoutes.post('/compras/:id/recibir', async (req, res) => {
  const compra = await prisma.compra.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
    include: { items: true, proveedor: true },
  })
  if (!compra) return res.status(404).json({ error: 'Compra no encontrada' })
  if (compra.estado !== 'BORRADOR') return res.status(400).json({ error: 'Esta compra ya fue recibida o anulada' })

  const { pagos, pin } = req.body || {}
  if (await pinLimitExcedido(req, res)) return
  const encargado = await verificarPin(req.auth.tenantId, pin)
  if (!encargado) return pinIncorrecto(req, res)

  const { insumosPorId, variantesPorId } = await catalogosDeItems(req.auth.tenantId, compra.items)

  try {
    const resultado = await prisma.$transaction(async (tx) => {
      // Estado pasa a RECIBIDA antes de aplicar la recepcion: el ponderado
      // que recalcula aplicarRecepcion filtra por compras RECIBIDAS, asi
      // que esta misma compra necesita contar ya como tal para su propio
      // calculo (si no, se excluiria a si misma del promedio).
      await tx.compra.update({
        where: { id: compra.id },
        data: { estado: 'RECIBIDA', recibidaAt: new Date(), recibidaById: encargado.id },
      })

      await aplicarRecepcion(tx, {
        tenantId: req.auth.tenantId,
        items: compra.items,
        insumosPorId,
        variantesPorId,
        encargadoId: encargado.id,
      })

      const totalPagado = await resolverPagos(tx, {
        tenantId: req.auth.tenantId,
        compraId: compra.id,
        pagos,
        encargadoId: encargado.id,
        saldoPendiente: Number(compra.total),
        descripcion: `Pago compra ${compra.numeroDocumento || compra.proveedor.name}`,
      })

      return tx.compra.update({
        where: { id: compra.id },
        data: { totalPagado, estadoPago: estadoPagoDe(Number(compra.total), totalPagado) },
        include: { items: true, pagos: true, proveedor: { select: { id: true, name: true } } },
      })
    })
    avisarTenant(req.auth.tenantId, 'inventario:actualizado', {})
    res.json({ ...resultado, saldoPendiente: Number(resultado.total) - Number(resultado.totalPagado) })
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message })
  }
})

comprasRoutes.post('/compras/:id/pagos', async (req, res) => {
  const compra = await prisma.compra.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } })
  if (!compra) return res.status(404).json({ error: 'Compra no encontrada' })
  if (compra.estado !== 'RECIBIDA') return res.status(400).json({ error: 'Solo se puede pagar una compra recibida' })

  const saldoPendiente = Number(compra.total) - Number(compra.totalPagado)
  if (saldoPendiente <= 0) return res.status(400).json({ error: 'Esta compra ya está pagada por completo' })

  const { pagos, pin } = req.body || {}
  if (!pagos?.length) return res.status(400).json({ error: 'Agrega al menos un medio de pago' })

  if (await pinLimitExcedido(req, res)) return
  const encargado = await verificarPin(req.auth.tenantId, pin)
  if (!encargado) return pinIncorrecto(req, res)

  try {
    const actualizada = await prisma.$transaction(async (tx) => {
      const montoPagado = await resolverPagos(tx, {
        tenantId: req.auth.tenantId,
        compraId: compra.id,
        pagos,
        encargadoId: encargado.id,
        saldoPendiente,
        descripcion: `Abono compra ${compra.numeroDocumento || compra.id}`,
      })
      const totalPagado = Number(compra.totalPagado) + montoPagado
      return tx.compra.update({
        where: { id: compra.id },
        data: { totalPagado, estadoPago: estadoPagoDe(Number(compra.total), totalPagado) },
        include: { pagos: { orderBy: { createdAt: 'asc' }, include: { createdBy: { select: { name: true } } } } },
      })
    })
    res.status(201).json({ ...actualizada, saldoPendiente: Number(actualizada.total) - Number(actualizada.totalPagado) })
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message })
  }
})

// BORRADOR: nunca toco stock ni plata, se anula directo sin PIN. RECIBIDA:
// revierte el stock (PURCHASE_VOID), pide PIN, y se bloquea si ya tiene
// pagos registrados -- esa plata ya salio de verdad, revertirla sola no
// deshace el hecho (gestionar el reembolso es aparte, ver plan).
comprasRoutes.post('/compras/:id/anular', async (req, res) => {
  const compra = await prisma.compra.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
    include: { items: true, pagos: true },
  })
  if (!compra) return res.status(404).json({ error: 'Compra no encontrada' })
  if (compra.estado === 'ANULADA') return res.status(400).json({ error: 'Esta compra ya está anulada' })

  const { pin, motivo } = req.body || {}

  if (compra.estado === 'BORRADOR') {
    const anulada = await prisma.compra.update({
      where: { id: compra.id },
      data: { estado: 'ANULADA', anuladaAt: new Date(), anuladaById: req.auth.userId, motivoAnulacion: motivo?.trim() || null },
    })
    return res.json(anulada)
  }

  if (compra.pagos.length > 0) {
    return res.status(400).json({
      error: 'Esta compra ya tiene pagos registrados; gestiona el reembolso aparte antes de anularla',
    })
  }

  if (await pinLimitExcedido(req, res)) return
  const encargado = await verificarPin(req.auth.tenantId, pin)
  if (!encargado) return pinIncorrecto(req, res)

  const { insumosPorId, variantesPorId } = await catalogosDeItems(req.auth.tenantId, compra.items)

  const anulada = await prisma.$transaction(async (tx) => {
    // Estado pasa a ANULADA antes de reversar: asi el recalculo de costo
    // ponderado de cada linea (filtra por compras RECIBIDAS) ya excluye
    // esta compra de su propio promedio.
    const actualizada = await tx.compra.update({
      where: { id: compra.id },
      data: {
        estado: 'ANULADA',
        anuladaAt: new Date(),
        anuladaById: encargado.id,
        motivoAnulacion: motivo?.trim() || null,
      },
    })

    for (const item of compra.items) {
      if (item.insumoId) {
        const insumo = insumosPorId.get(item.insumoId)
        // Reversa exactamente lo que se habia sumado al recibir (incluido el
        // peso/volumen REAL ya guardado en item.cantidadInventarioReal para
        // un insumo pesable por unidad), no un estimado recalculado.
        const qty = cantidadConvertida({ cantidad: item.cantidad, cantidadInventarioReal: item.cantidadInventarioReal, insumo })
        await tx.insumoMovement.create({
          data: {
            tenantId: req.auth.tenantId,
            insumoId: insumo.id,
            type: 'PURCHASE_VOID',
            qty,
            compraItemId: item.id,
            createdById: encargado.id,
          },
        })
        await tx.insumo.update({ where: { id: insumo.id }, data: { stock: { decrement: qty } } })
        // El lote deja de existir: sin importar cuanto se hubiera consumido
        // de el, ya no pesa en el costo ponderado (ver recalcularCostoPonderadoInsumo).
        await tx.compraItem.update({ where: { id: item.id }, data: { cantidadRestante: 0 } })
        await recalcularCostoPonderadoInsumo(tx, insumo.id)
      } else {
        const variant = variantesPorId.get(item.variantId)
        const qty = Math.round(Number(item.cantidad))
        await tx.stockMovement.create({
          data: {
            tenantId: req.auth.tenantId,
            variantId: variant.id,
            type: 'PURCHASE_VOID',
            qty,
            compraItemId: item.id,
            createdById: encargado.id,
          },
        })
        await tx.variant.update({ where: { id: variant.id }, data: { stock: { decrement: qty } } })
        await recalcularCostoPonderadoVariant(tx, variant.id)
      }
    }
    return actualizada
  })
  avisarTenant(req.auth.tenantId, 'inventario:actualizado', {})
  res.json(anulada)
})
