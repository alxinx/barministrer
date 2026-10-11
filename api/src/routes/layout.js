import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireRole } from '../middleware/auth.js'

export const layoutRoutes = Router()
const adminOnly = requireRole('ADMIN')

/** Plano completo: zonas con sus mesas y elementos. Una sola llamada. */
layoutRoutes.get('/zones', async (req, res) => {
  const zones = await prisma.zone.findMany({
    where: { tenantId: req.auth.tenantId },
    include: {
      tables: { where: { active: true }, orderBy: { number: 'asc' } },
      elements: true,
    },
    orderBy: { sortOrder: 'asc' },
  })
  res.json(zones)
})

layoutRoutes.post('/zones', adminOnly, async (req, res) => {
  const { name, icon, gridCols, gridRows, sortOrder } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'La zona necesita un nombre' })

  const zone = await prisma.zone.create({
    data: {
      tenantId: req.auth.tenantId,
      name: name.trim(),
      icon: icon || 'table',
      gridCols: gridCols ?? 16,
      gridRows: gridRows ?? 10,
      sortOrder: sortOrder ?? 0,
    },
    include: { tables: true, elements: true },
  })
  res.status(201).json(zone)
})

/// Celdas fuera del salon: cada una dentro de la cuadricula actual (o la nueva,
/// si gridCols/gridRows cambian en la misma peticion).
function celdasValidas(cells, cols, rows) {
  return (
    Array.isArray(cells) &&
    cells.every(
      (c) =>
        c && Number.isInteger(c.x) && Number.isInteger(c.y) && c.x >= 0 && c.x < cols && c.y >= 0 && c.y < rows
    )
  )
}

layoutRoutes.patch('/zones/:id', adminOnly, async (req, res) => {
  const zone = await prisma.zone.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
  })
  if (!zone) return res.status(404).json({ error: 'Zona no encontrada' })

  const { name, icon, gridCols, gridRows, active, sortOrder, blockedCells } = req.body || {}
  const cols = gridCols ?? zone.gridCols
  const rows = gridRows ?? zone.gridRows

  if (blockedCells !== undefined && !celdasValidas(blockedCells, cols, rows)) {
    return res.status(400).json({ error: 'Las celdas bloqueadas deben estar dentro de la cuadricula' })
  }

  // Si se achica la cuadricula, las celdas bloqueadas que quedan por fuera se
  // descartan solas: no tiene sentido guardar una celda que ya no existe.
  const existentes = Array.isArray(zone.blockedCells) ? zone.blockedCells : []
  const recortadas = existentes.filter((c) => c.x < cols && c.y < rows)
  const siguienteBloqueadas = blockedCells !== undefined ? blockedCells : recortadas

  const updated = await prisma.zone.update({
    where: { id: zone.id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(icon !== undefined && { icon }),
      ...(gridCols !== undefined && { gridCols }),
      ...(gridRows !== undefined && { gridRows }),
      ...(active !== undefined && { active: Boolean(active) }),
      ...(sortOrder !== undefined && { sortOrder }),
      blockedCells: siguienteBloqueadas,
    },
  })
  res.json(updated)
})

layoutRoutes.delete('/zones/:id', adminOnly, async (req, res) => {
  const zone = await prisma.zone.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
    include: { tables: true },
  })
  if (!zone) return res.status(404).json({ error: 'Zona no encontrada' })
  if (zone.tables.length) {
    return res.status(400).json({
      error: `La zona tiene ${zone.tables.length} mesas. Muevelas o eliminalas primero.`,
    })
  }
  await prisma.zone.delete({ where: { id: zone.id } })
  res.status(204).end()
})

// --- Mesas -----------------------------------------------------------------

layoutRoutes.post('/tables', adminOnly, async (req, res) => {
  const { zoneId, number, seats, shape, gridX, gridY, width, height } = req.body || {}
  if (!number?.toString().trim()) return res.status(400).json({ error: 'La mesa necesita un numero' })

  const zone = await prisma.zone.findFirst({
    where: { id: zoneId, tenantId: req.auth.tenantId },
  })
  if (!zone) return res.status(400).json({ error: 'La zona no existe' })

  const duplicate = await prisma.barTable.findFirst({
    where: { tenantId: req.auth.tenantId, number: String(number).trim() },
  })
  if (duplicate) {
    return res.status(400).json({ error: `Ya existe la mesa ${number} en este bar` })
  }

  const table = await prisma.barTable.create({
    data: {
      tenantId: req.auth.tenantId,
      zoneId,
      number: String(number).trim(),
      seats: seats ?? 4,
      shape: shape || 'ROUND',
      gridX: gridX ?? 0,
      gridY: gridY ?? 0,
      width: width ?? 1,
      height: height ?? 1,
    },
  })
  res.status(201).json(table)
})

layoutRoutes.patch('/tables/:id', async (req, res) => {
  const table = await prisma.barTable.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
  })
  if (!table) return res.status(404).json({ error: 'Mesa no encontrada' })

  const { number, seats, shape, gridX, gridY, width, height, status, zoneId, active } = req.body || {}

  // Mover o renombrar una mesa es configuracion: solo ADMIN. Cambiar el estado
  // (libre/ocupada) es operacion: cualquier rol.
  const isConfigChange = [number, seats, shape, gridX, gridY, width, height, zoneId, active]
    .some((v) => v !== undefined)
  if (isConfigChange && req.auth.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Solo el administrador puede mover o editar mesas' })
  }

  // Marcar disponible o cerrada dice que ahi no hay nadie. Si por debajo quedo
  // una cuenta abierta vacia (el caso tipico: se abrio solo para asociar un
  // cliente y al final no se asocio nada), se descarta sola porque nunca hubo
  // nada que auditar. Si de verdad tiene productos o cliente, se rechaza el
  // cambio para no perder el rastro de una cuenta real: hay que liquidarla.
  if ((status === 'AVAILABLE' || status === 'CLOSED') && table.status !== status) {
    const abierta = await prisma.order.findFirst({
      where: { tableId: table.id, tenantId: req.auth.tenantId, status: 'OPEN' },
      include: { items: true },
    })
    if (abierta) {
      const vacia = !abierta.customerId && abierta.items.every((i) => i.status !== 'ACTIVE')
      if (!vacia) {
        return res.status(400).json({
          error: 'Esta mesa tiene una cuenta abierta con productos o cliente. Liquídala antes de cambiarle el estado.',
        })
      }
      await prisma.order.delete({ where: { id: abierta.id } })
    }
  }

  const updated = await prisma.barTable.update({
    where: { id: table.id },
    data: {
      ...(number !== undefined && { number: String(number).trim() }),
      ...(seats !== undefined && { seats }),
      ...(shape !== undefined && { shape }),
      ...(gridX !== undefined && { gridX }),
      ...(gridY !== undefined && { gridY }),
      ...(width !== undefined && { width }),
      ...(height !== undefined && { height }),
      ...(status !== undefined && { status }),
      ...(zoneId !== undefined && { zoneId }),
      ...(active !== undefined && { active: Boolean(active) }),
    },
  })
  res.json(updated)
})

layoutRoutes.delete('/tables/:id', adminOnly, async (req, res) => {
  const table = await prisma.barTable.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
  })
  if (!table) return res.status(404).json({ error: 'Mesa no encontrada' })
  await prisma.barTable.delete({ where: { id: table.id } })
  res.status(204).end()
})

// --- Elementos del plano (pared, barra, puerta, planta, tarima) -------------

layoutRoutes.post('/elements', adminOnly, async (req, res) => {
  const { zoneId, type, label, gridX, gridY, width, height, rotation } = req.body || {}
  const zone = await prisma.zone.findFirst({
    where: { id: zoneId, tenantId: req.auth.tenantId },
  })
  if (!zone) return res.status(400).json({ error: 'La zona no existe' })

  const element = await prisma.layoutElement.create({
    data: {
      tenantId: req.auth.tenantId,
      zoneId,
      type: type || 'WALL',
      label: label || null,
      gridX: gridX ?? 0,
      gridY: gridY ?? 0,
      width: width ?? 1,
      height: height ?? 1,
      rotation: rotation ?? 0,
    },
  })
  res.status(201).json(element)
})

layoutRoutes.patch('/elements/:id', adminOnly, async (req, res) => {
  const element = await prisma.layoutElement.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
  })
  if (!element) return res.status(404).json({ error: 'Elemento no encontrado' })

  const { label, gridX, gridY, width, height, rotation } = req.body || {}
  const updated = await prisma.layoutElement.update({
    where: { id: element.id },
    data: {
      ...(label !== undefined && { label }),
      ...(gridX !== undefined && { gridX }),
      ...(gridY !== undefined && { gridY }),
      ...(width !== undefined && { width }),
      ...(height !== undefined && { height }),
      ...(rotation !== undefined && { rotation }),
    },
  })
  res.json(updated)
})

layoutRoutes.delete('/elements/:id', adminOnly, async (req, res) => {
  const element = await prisma.layoutElement.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
  })
  if (!element) return res.status(404).json({ error: 'Elemento no encontrado' })
  await prisma.layoutElement.delete({ where: { id: element.id } })
  res.status(204).end()
})
