import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireRole } from '../middleware/auth.js'
import { requirePermission } from '../middleware/permissions.js'
import { pinLimitExcedido, pinIncorrecto } from '../middleware/rateLimit.js'
import { verificarPinPropio } from '../lib/pin.js'
import { recalcularCostoPonderadoInsumo, recalcularCostoPonderadoVariant } from '../lib/costeo.js'
import { avisarTenant } from '../lib/realtime.js'
import { calcularRotacionSemanal, rangoSemanasCompletas } from '../lib/rotacion.js'

export const inventoryRoutes = Router()
const adminOnly = requirePermission('cajeroGestionaInventario')
const soloAdminReal = requireRole('ADMIN')
const KARDEX_PAGE_SIZE = 12
const FICHA_PAGE_SIZE = 10

function despuesDe(movimiento) {
  return {
    OR: [
      { createdAt: { lt: movimiento.createdAt } },
      { createdAt: movimiento.createdAt, id: { lt: movimiento.id } },
    ],
  }
}

function leerDatosAjuste(req, res) {
  const { stock, reason, pin } = req.body || {}
  const stockFinal = Number(stock)
  const conteoValido =
    (typeof stock === 'number' || typeof stock === 'string') &&
    String(stock).trim() !== '' &&
    Number.isSafeInteger(stockFinal) &&
    stockFinal >= 0 &&
    stockFinal <= 2147483647
  if (!conteoValido) {
    res.status(400).json({ error: 'El conteo físico debe ser un número entero igual o mayor a cero' })
    return null
  }
  if (typeof reason !== 'string' || !reason.trim()) {
    res.status(400).json({ error: 'Escribe el motivo del ajuste' })
    return null
  }
  if (String(reason).trim().length > 300) {
    res.status(400).json({ error: 'El motivo no puede superar los 300 caracteres' })
    return null
  }
  if (!/^\d{5}$/.test(String(pin || ''))) {
    res.status(400).json({ error: 'Ingresa el código de empleado de 5 dígitos' })
    return null
  }
  return { stockFinal, reason: String(reason).trim(), pin: String(pin) }
}

async function cargarComprasDeFicha({ tenantId, filtro, cursorId }) {
  const whereBase = { ...filtro, compra: { tenantId, estado: 'RECIBIDA' } }
  const cursor = cursorId
    ? await prisma.compraItem.findFirst({
        where: { ...whereBase, id: cursorId },
        select: { id: true, compra: { select: { recibidaAt: true } } },
      })
    : null
  if (cursorId && !cursor) return { error: 'El cursor de compras no es válido' }

  const items = await prisma.compraItem.findMany({
    where: {
      ...whereBase,
      ...(cursor && {
        OR: [
          { compra: { recibidaAt: { lt: cursor.compra.recibidaAt } } },
          { compra: { recibidaAt: cursor.compra.recibidaAt }, id: { lt: cursor.id } },
        ],
      }),
    },
    include: {
      compra: {
        select: {
          numeroDocumento: true,
          recibidaAt: true,
          proveedor: {
            select: { id: true, name: true, telefono: true, whatsapp: true, email: true, contacto: true, ciudad: true },
          },
        },
      },
      insumo: { select: { unidadCompra: true } },
      variant: { select: { name: true, product: { select: { name: true } } } },
    },
    orderBy: [{ compra: { recibidaAt: 'desc' } }, { id: 'desc' }],
    take: FICHA_PAGE_SIZE + 1,
  })
  const hayMas = items.length > FICHA_PAGE_SIZE
  const pagina = hayMas ? items.slice(0, FICHA_PAGE_SIZE) : items
  return {
    items: pagina,
    siguienteCursor: hayMas ? pagina[pagina.length - 1].id : null,
  }
}

inventoryRoutes.get('/inventory/ficha/:kind/:id', adminOnly, async (req, res) => {
  const { kind, id } = req.params
  if (!['producto', 'insumo'].includes(kind)) {
    return res.status(400).json({ error: 'El tipo de ficha no es válido' })
  }
  const tenantId = req.auth.tenantId
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { timezone: true },
  })
  const timezone = tenant?.timezone || 'America/Bogota'
  const rango = rangoSemanasCompletas(timezone)
  let stock
  let movimientosRotacion
  let historial
  let siguienteCursor = null
  let compras
  let comprasSiguienteCursor = null
  let proveedores

  if (kind === 'producto') {
    const variant = await prisma.variant.findFirst({
      where: { id, product: { tenantId, deletedAt: null } },
      select: { id: true, stock: true },
    })
    if (!variant) return res.status(404).json({ error: 'La presentación no existe' })
    stock = variant.stock

    const baseVentas = {
      tenantId,
      variantId: id,
      status: 'ACTIVE',
      order: { tenantId, status: 'CLOSED', closedAt: { not: null } },
    }
    const cursor = req.query.cursor
      ? await prisma.orderItem.findFirst({
          where: { ...baseVentas, id: String(req.query.cursor) },
          select: { id: true, order: { select: { closedAt: true } } },
        })
      : null
    if (req.query.cursor && !cursor) {
      return res.status(400).json({ error: 'El cursor del historial no es válido' })
    }

    const [rotacion, ventas] = await Promise.all([
      prisma.orderItem.findMany({
        where: {
          ...baseVentas,
          order: { ...baseVentas.order, closedAt: { gte: rango.desde, lt: rango.hasta } },
        },
        select: { qty: true, order: { select: { closedAt: true } } },
      }),
      prisma.orderItem.findMany({
        where: {
          ...baseVentas,
          ...(cursor && {
            OR: [
              { order: { closedAt: { lt: cursor.order.closedAt } } },
              { order: { closedAt: cursor.order.closedAt }, id: { lt: cursor.id } },
            ],
          }),
        },
        include: {
          order: {
            select: {
              id: true,
              invoiceNumber: true,
              closedAt: true,
              table: { select: { number: true } },
              openedBy: { select: { name: true } },
              payments: { select: { method: true, amount: true } },
            },
          },
        },
        orderBy: [{ order: { closedAt: 'desc' } }, { id: 'desc' }],
        take: FICHA_PAGE_SIZE + 1,
      }),
    ])
    movimientosRotacion = rotacion.map((venta) => ({
      fecha: venta.order.closedAt,
      cantidad: venta.qty,
    }))
    const hayMas = ventas.length > FICHA_PAGE_SIZE
    historial = hayMas ? ventas.slice(0, FICHA_PAGE_SIZE) : ventas
    if (hayMas) siguienteCursor = historial[historial.length - 1].id

    const paginaCompras = await cargarComprasDeFicha({
      tenantId,
      filtro: { variantId: id },
      cursorId: String(req.query.comprasCursor || ''),
    })
    if (paginaCompras.error) return res.status(400).json({ error: paginaCompras.error })
    compras = paginaCompras.items
    comprasSiguienteCursor = paginaCompras.siguienteCursor
    proveedores = [...new Map(compras.map((item) => [item.compra.proveedor.id, item.compra.proveedor])).values()]
  } else {
    const insumo = await prisma.insumo.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        stock: true,
        proveedor: { select: { id: true, name: true, telefono: true, whatsapp: true, email: true, contacto: true, ciudad: true } },
      },
    })
    if (!insumo) return res.status(404).json({ error: 'El insumo no existe' })
    stock = insumo.stock

    const baseMovimientos = { tenantId, insumoId: id, type: { in: ['SALE', 'SALE_VOID'] } }
    const cursor = req.query.cursor
      ? await prisma.insumoMovement.findFirst({
          where: { ...baseMovimientos, id: String(req.query.cursor) },
          select: { id: true, createdAt: true },
        })
      : null
    if (req.query.cursor && !cursor) {
      return res.status(400).json({ error: 'El cursor del historial no es válido' })
    }

    const [rotacion, movimientos] = await Promise.all([
      prisma.insumoMovement.findMany({
        where: {
          ...baseMovimientos,
          createdAt: { gte: rango.desde, lt: rango.hasta },
        },
        select: { qty: true, type: true, createdAt: true },
      }),
      prisma.insumoMovement.findMany({
        where: {
          ...baseMovimientos,
          ...(cursor && despuesDe(cursor)),
        },
        include: { createdBy: { select: { name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: FICHA_PAGE_SIZE + 1,
      }),
    ])
    movimientosRotacion = rotacion.map((movimiento) => ({
      fecha: movimiento.createdAt,
      cantidad: movimiento.type === 'SALE' ? movimiento.qty : -movimiento.qty,
    }))
    const hayMas = movimientos.length > FICHA_PAGE_SIZE
    historial = hayMas ? movimientos.slice(0, FICHA_PAGE_SIZE) : movimientos
    if (hayMas) siguienteCursor = historial[historial.length - 1].id

    const paginaCompras = await cargarComprasDeFicha({
      tenantId,
      filtro: { insumoId: id },
      cursorId: String(req.query.comprasCursor || ''),
    })
    if (paginaCompras.error) return res.status(400).json({ error: paginaCompras.error })
    compras = paginaCompras.items
    comprasSiguienteCursor = paginaCompras.siguienteCursor
    proveedores = insumo.proveedor ? [insumo.proveedor] : []
  }

  res.json({
    semanas: 8,
    desde: rango.desdeFecha,
    hasta: rango.hastaFecha,
    rotacion: calcularRotacionSemanal(
      movimientosRotacion,
      timezone,
      rango.desdeFecha,
      rango.hastaFecha,
      stock
    ),
    historial,
    siguienteCursor,
    compras,
    comprasSiguienteCursor,
    proveedores,
  })
})

async function validarPinDeAjuste(req, res, pin) {
  if (await pinLimitExcedido(req, res)) return false
  const usuario = await verificarPinPropio(req.auth.tenantId, req.auth.userId, pin)
  if (!usuario) {
    await pinIncorrecto(req, res)
    return false
  }
  return true
}

// Entradas recientes, para ver que se agrego sin tener que ir variante por
// variante. Solo entradas (PURCHASE); el stock mismo sigue siendo el numero
// en Variant, esto es el rastro de como llego ahi.
inventoryRoutes.get('/inventory/movements', adminOnly, async (req, res) => {
  const movements = await prisma.stockMovement.findMany({
    where: { tenantId: req.auth.tenantId },
    include: {
      variant: { select: { id: true, name: true, product: { select: { id: true, name: true } } } },
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  res.json(movements)
})

inventoryRoutes.get('/inventory/kardex/variant/:id', adminOnly, async (req, res) => {
  const limit = req.query.limit == null ? KARDEX_PAGE_SIZE : Number(req.query.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return res.status(400).json({ error: 'El tamaño de página debe estar entre 1 y 100' })
  }
  const tenantId = req.auth.tenantId
  const variant = await prisma.variant.findFirst({
    where: { id: req.params.id, product: { tenantId } },
    select: { id: true },
  })
  if (!variant) return res.status(404).json({ error: 'Esa presentación no existe' })

  const whereBase = { tenantId, variantId: variant.id }
  const cursor = req.query.cursor
    ? await prisma.stockMovement.findFirst({
        where: { ...whereBase, id: String(req.query.cursor) },
        select: { id: true, createdAt: true },
      })
    : null
  if (req.query.cursor && !cursor) return res.status(400).json({ error: 'El cursor del historial no es válido' })

  const movimientos = await prisma.stockMovement.findMany({
    where: { ...whereBase, ...(cursor && despuesDe(cursor)) },
    include: {
      createdBy: { select: { id: true, name: true } },
      compraItem: {
        select: {
          compra: {
            select: {
              numeroDocumento: true,
              fecha: true,
              proveedor: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  })
  const hasMore = movimientos.length > limit
  const items = hasMore ? movimientos.slice(0, limit) : movimientos
  res.json({ items, nextCursor: hasMore ? items[items.length - 1].id : null })
})

inventoryRoutes.get('/inventory/kardex/insumo/:id', adminOnly, async (req, res) => {
  const limit = req.query.limit == null ? KARDEX_PAGE_SIZE : Number(req.query.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return res.status(400).json({ error: 'El tamaño de página debe estar entre 1 y 100' })
  }
  const tenantId = req.auth.tenantId
  const insumo = await prisma.insumo.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true },
  })
  if (!insumo) return res.status(404).json({ error: 'Ese insumo no existe' })

  const whereBase = { tenantId, insumoId: insumo.id }
  const cursor = req.query.cursor
    ? await prisma.insumoMovement.findFirst({
        where: { ...whereBase, id: String(req.query.cursor) },
        select: { id: true, createdAt: true },
      })
    : null
  if (req.query.cursor && !cursor) return res.status(400).json({ error: 'El cursor del historial no es válido' })

  const movimientos = await prisma.insumoMovement.findMany({
    where: { ...whereBase, ...(cursor && despuesDe(cursor)) },
    include: {
      createdBy: { select: { id: true, name: true } },
      compraItem: {
        select: {
          compra: {
            select: {
              numeroDocumento: true,
              fecha: true,
              proveedor: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  })
  const hasMore = movimientos.length > limit
  const items = hasMore ? movimientos.slice(0, limit) : movimientos
  res.json({ items, nextCursor: hasMore ? items[items.length - 1].id : null })
})

inventoryRoutes.post('/inventory/adjustments/variant/:id', soloAdminReal, async (req, res) => {
  const datos = leerDatosAjuste(req, res)
  if (!datos) return
  if (!(await validarPinDeAjuste(req, res, datos.pin))) return

  const variant = await prisma.variant.findFirst({
    where: { id: req.params.id, product: { tenantId: req.auth.tenantId } },
    select: { id: true },
  })
  if (!variant) return res.status(404).json({ error: 'Esa presentación no existe' })

  const resultado = await prisma.$transaction(async (tx) => {
    const [bloqueada] = await tx.$queryRaw`SELECT stock FROM Variant WHERE id = ${variant.id} FOR UPDATE`
    if (!bloqueada) return null

    const stockAnterior = Number(bloqueada.stock)
    const diferencia = datos.stockFinal - stockAnterior
    if (diferencia < -2147483648 || diferencia > 2147483647) {
      return { error: 'La diferencia supera el rango permitido para un movimiento de inventario' }
    }
    const movement = await tx.stockMovement.create({
      data: {
        tenantId: req.auth.tenantId,
        variantId: variant.id,
        type: 'ADJUSTMENT',
        qty: diferencia,
        note: `Conteo físico: ${stockAnterior} → ${datos.stockFinal}. Motivo: ${datos.reason}`,
        createdById: req.auth.userId,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    })
    await tx.variant.update({ where: { id: variant.id }, data: { stock: { increment: diferencia } } })
    return { movement, stockAnterior, stock: datos.stockFinal, diferencia }
  })
  if (!resultado) return res.status(404).json({ error: 'Esa presentación ya no existe' })
  if (resultado.error) return res.status(400).json({ error: resultado.error })

  avisarTenant(req.auth.tenantId, 'inventario:actualizado', {})
  res.status(201).json(resultado)
})

inventoryRoutes.post('/inventory/adjustments/insumo/:id', soloAdminReal, async (req, res) => {
  const datos = leerDatosAjuste(req, res)
  if (!datos) return
  if (!(await validarPinDeAjuste(req, res, datos.pin))) return

  const insumo = await prisma.insumo.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
    select: { id: true },
  })
  if (!insumo) return res.status(404).json({ error: 'Ese insumo no existe' })

  const resultado = await prisma.$transaction(async (tx) => {
    const [bloqueado] = await tx.$queryRaw`
      SELECT stock FROM Insumo WHERE id = ${insumo.id} AND tenantId = ${req.auth.tenantId} FOR UPDATE
    `
    if (!bloqueado) return null

    const stockAnterior = Number(bloqueado.stock)
    const diferencia = datos.stockFinal - stockAnterior
    if (diferencia < -2147483648 || diferencia > 2147483647) {
      return { error: 'La diferencia supera el rango permitido para un movimiento de inventario' }
    }
    const movement = await tx.insumoMovement.create({
      data: {
        tenantId: req.auth.tenantId,
        insumoId: insumo.id,
        type: 'ADJUSTMENT',
        qty: diferencia,
        note: `Conteo físico: ${stockAnterior} → ${datos.stockFinal}. Motivo: ${datos.reason}`,
        createdById: req.auth.userId,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    })
    if (diferencia < 0) {
      let porDescontar = -diferencia
      const lotes = await tx.compraItem.findMany({
        where: { insumoId: insumo.id, compra: { estado: 'RECIBIDA' }, cantidadRestante: { gt: 0 } },
        orderBy: [{ compra: { recibidaAt: 'asc' } }, { id: 'asc' }],
        select: { id: true, cantidadRestante: true },
      })
      for (const lote of lotes) {
        if (porDescontar <= 0) break
        const cantidad = Math.min(porDescontar, lote.cantidadRestante)
        await tx.compraItem.update({
          where: { id: lote.id },
          data: { cantidadRestante: { decrement: cantidad } },
        })
        porDescontar -= cantidad
      }
    }
    await tx.insumo.update({ where: { id: insumo.id }, data: { stock: { increment: diferencia } } })
    await recalcularCostoPonderadoInsumo(tx, insumo.id)
    return { movement, stockAnterior, stock: datos.stockFinal, diferencia }
  })
  if (!resultado) return res.status(404).json({ error: 'Ese insumo ya no existe' })
  if (resultado.error) return res.status(400).json({ error: resultado.error })

  avisarTenant(req.auth.tenantId, 'inventario:actualizado', {})
  res.status(201).json(resultado)
})

// Compra por empaque (caja, canasta) se resuelve aqui con unitsPerPack x
// packs, nunca en el producto: qty es lo que de verdad entra al stock.
inventoryRoutes.post('/inventory/movements', adminOnly, async (req, res) => {
  const { variantId, qty, unitsPerPack, packs, cost, note } = req.body || {}

  const variant = await prisma.variant.findFirst({
    where: { id: variantId, product: { tenantId: req.auth.tenantId } },
  })
  if (!variant) return res.status(400).json({ error: 'Esa presentación no existe' })

  const unidades = Number(qty) || 0
  if (unidades <= 0) return res.status(400).json({ error: 'La cantidad que entra debe ser mayor a cero' })

  const costoIngresado = cost !== undefined && cost !== null && cost !== '' ? Number(cost) : null

  const movement = await prisma.$transaction(async (tx) => {
    const creado = await tx.stockMovement.create({
      data: {
        tenantId: req.auth.tenantId,
        variantId: variant.id,
        qty: unidades,
        unitsPerPack: unitsPerPack ? Number(unitsPerPack) : null,
        packs: packs ? Number(packs) : null,
        cost: costoIngresado,
        note: note?.trim() || null,
        createdById: req.auth.userId,
      },
      include: {
        variant: { select: { id: true, name: true, product: { select: { id: true, name: true } } } },
        createdBy: { select: { id: true, name: true } },
      },
    })
    await tx.variant.update({ where: { id: variant.id }, data: { stock: { increment: unidades } } })
    // Solo recalcula si esta entrada trajo costo: una entrada sin costo (ej.
    // ajuste de conteo) no debe mover el promedio ponderado para nada.
    if (costoIngresado !== null) await recalcularCostoPonderadoVariant(tx, variant.id)
    return creado
  })

  avisarTenant(req.auth.tenantId, 'inventario:actualizado', {})
  res.status(201).json(movement)
})

// Merma/perdida manual: solo el admin real (no delegable, ni con
// cajeroGestionaInventario) y con PIN, porque a diferencia de vender en
// negativo (que nunca se bloquea) esto SI tiene techo: nunca se puede
// mermar mas de lo que hay. Genera su propio movimiento de stock (WASTE,
// para no perder el rastro) y un egreso de caja menor por el costo de lo
// perdido -- nunca por el precio de venta, eso inflaria el gasto real.
inventoryRoutes.post('/variants/:id/waste', soloAdminReal, async (req, res) => {
  const { qty, reason, pin } = req.body || {}
  const unidades = Number(qty) || 0
  if (unidades <= 0) return res.status(400).json({ error: 'La cantidad a eliminar debe ser mayor a cero' })
  if (!reason?.trim()) return res.status(400).json({ error: 'Escribe la razón o motivo de la eliminación' })
  if (!pin?.toString().trim()) return res.status(400).json({ error: 'Escribe el PIN' })

  const variant = await prisma.variant.findFirst({
    where: { id: req.params.id, product: { tenantId: req.auth.tenantId } },
    include: { product: true },
  })
  if (!variant) return res.status(400).json({ error: 'Esa presentación no existe' })
  if (unidades > variant.stock) {
    return res.status(400).json({ error: `Solo hay ${variant.stock} en stock, no se puede mermar más de eso` })
  }

  // Solo se limita aqui, no toda la ruta: cantidad invalida o sin stock
  // suficiente no tiene nada que ver con un PIN mal escrito (ver pinLimiter
  // en middleware/rateLimit.js).
  if (await pinLimitExcedido(req, res)) return
  const encargado = await verificarPin(req.auth.tenantId, pin)
  if (!encargado) return pinIncorrecto(req, res)

  const shift = await prisma.shift.findFirst({ where: { tenantId: req.auth.tenantId, status: 'OPEN' } })
  if (!shift) {
    return res.status(400).json({ error: 'Necesitas un turno abierto para registrar una merma' })
  }

  const costoUnitario = Number(variant.cost) || 0
  const montoEgreso = costoUnitario * unidades
  const nombre = `${variant.product.name}${variant.name ? ` · ${variant.name}` : ''}`

  const [movement, , expense] = await prisma.$transaction([
    prisma.stockMovement.create({
      data: {
        tenantId: req.auth.tenantId,
        variantId: variant.id,
        type: 'WASTE',
        qty: -unidades,
        cost: costoUnitario,
        note: reason.trim(),
        createdById: encargado.id,
      },
    }),
    prisma.variant.update({ where: { id: variant.id }, data: { stock: { decrement: unidades } } }),
    prisma.shiftExpense.create({
      data: {
        tenantId: req.auth.tenantId,
        shiftId: shift.id,
        type: 'GASTO',
        amount: montoEgreso,
        reason: `Eliminación de ${unidades} ${nombre} por ${reason.trim()}`,
        authorizedById: encargado.id,
      },
      include: { authorizedBy: { select: { id: true, name: true } } },
    }),
  ])

  avisarTenant(req.auth.tenantId, 'inventario:actualizado', {})
  res.status(201).json({
    movement,
    expense,
    productName: variant.product.name,
    variantName: variant.name,
    qty: unidades,
    reason: reason.trim(),
    unitCost: costoUnitario,
    total: montoEgreso,
    authorizedBy: { id: encargado.id, name: encargado.name },
    createdAt: movement.createdAt,
  })
})
