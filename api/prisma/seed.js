/**
 * Datos de arranque para el bar piloto. Idempotente: se puede correr en cada
 * arranque del contenedor sin duplicar nada.
 */
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'bar-piloto' },
    update: {},
    create: { name: 'Bar Piloto', slug: 'bar-piloto' },
  })

  const users = [
    { name: 'Alejandro Gonzalez', email: 'admin@licorplus.co', role: 'ADMIN', pass: 'admin123' },
    { name: 'Carolina Ruiz', email: 'caja@licorplus.co', role: 'CAJERO', pass: 'caja123' },
    { name: 'Geraldine Mesa', email: 'mesera@licorplus.co', role: 'MESERO', pass: 'mesa123' },
  ]
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        tenantId: tenant.id,
        name: u.name,
        email: u.email,
        role: u.role,
        passwordHash: await bcrypt.hash(u.pass, 10),
        pinHash: await bcrypt.hash('1234', 10),
      },
    })
  }

  // --- Categorias ----------------------------------------------------------
  async function category(name, { parentId = null, color, allowsPour = false, sortOrder = 0 } = {}) {
    const found = await prisma.category.findFirst({
      where: { tenantId: tenant.id, name, parentId },
    })
    if (found) return found
    return prisma.category.create({
      data: { tenantId: tenant.id, name, parentId, color, allowsPour, sortOrder },
    })
  }

  const licores = await category('Licores', { color: '#C97B2E', allowsPour: true, sortOrder: 0 })
  const aguardiente = await category('Aguardiente', { parentId: licores.id, color: '#C97B2E', allowsPour: true })
  const whisky = await category('Whisky', { parentId: licores.id, color: '#A8641F', allowsPour: true })
  const cervezas = await category('Cervezas', { color: '#E8A33D', sortOrder: 1 })
  const sinAlcohol = await category('Sin alcohol', { color: '#4C9BD6', sortOrder: 2 })
  const snacks = await category('Snacks', { color: '#8E7CC3', sortOrder: 3 })
  const cigarrillos = await category('Cigarrillos', { color: '#6B7280', sortOrder: 4 })

  // --- Productos -----------------------------------------------------------
  async function product(name, categoryId, variants) {
    const found = await prisma.product.findFirst({ where: { tenantId: tenant.id, name } })
    if (found) return found
    return prisma.product.create({
      data: {
        tenantId: tenant.id,
        categoryId,
        name,
        variants: {
          create: variants.map((v, i) => ({
            name: v.name,
            price: v.price,
            cost: v.cost ?? 0,
            volumeMl: v.volumeMl ?? null,
            stock: v.stock ?? 0,
            sortOrder: i,
          })),
        },
      },
    })
  }

  const aguardienteAntioqueno = await product('Aguardiente Antioqueno', aguardiente.id, [
    { name: 'Media', price: 32000, cost: 24000, volumeMl: 375, stock: 8 },
    { name: 'Botella', price: 58000, cost: 44000, volumeMl: 750, stock: 12 },
    { name: 'Litro', price: 74000, cost: 57000, volumeMl: 1000, stock: 6 },
    { name: 'Garrafa', price: 138000, cost: 108000, volumeMl: 2000, stock: 3 },
  ])
  await product('Whisky Old Parr', whisky.id, [
    { name: 'Botella', price: 185000, cost: 148000, volumeMl: 750, stock: 4 },
  ])
  await product('Corona Extra', cervezas.id, [{ name: 'Unidad', price: 5500, cost: 3600, volumeMl: 355, stock: 48 }])
  await product('Aguila', cervezas.id, [{ name: 'Unidad', price: 4000, cost: 2500, volumeMl: 330, stock: 120 }])
  await product('Poker', cervezas.id, [{ name: 'Unidad', price: 4000, cost: 2500, volumeMl: 330, stock: 96 }])
  await product('Club Colombia', cervezas.id, [{ name: 'Unidad', price: 5900, cost: 3900, volumeMl: 330, stock: 60 }])
  await product('Coca-Cola', sinAlcohol.id, [
    { name: 'Lata', price: 3500, cost: 2200, volumeMl: 330, stock: 72 },
    { name: 'Litro', price: 7000, cost: 4500, volumeMl: 1500, stock: 18 },
  ])
  await product('Papas Margarita', snacks.id, [
    { name: 'Paquete pequeno', price: 3000, cost: 1900, stock: 40 },
    { name: 'Paquete grande', price: 6500, cost: 4300, stock: 24 },
  ])
  await product('Mani salado', snacks.id, [{ name: 'Paquete', price: 2500, cost: 1500, stock: 50 }])
  await product('Marlboro', cigarrillos.id, [
    { name: 'Unidad', price: 1000, cost: 600, stock: 200 },
    { name: 'Cajetilla', price: 15000, cost: 11000, stock: 20 },
  ])

  // Un shot: receta de un solo ingrediente, vinculada a una marca concreta
  // (Aguardiente Antioqueno), no a "aguardiente" en general.
  async function shot(name, categoryId, { price, sourceProductId, ml }) {
    const found = await prisma.product.findFirst({ where: { tenantId: tenant.id, name } })
    if (found) return found
    return prisma.product.create({
      data: {
        tenantId: tenant.id,
        categoryId,
        name,
        kind: 'PREPARED',
        recipe: { create: { price, items: { create: [{ sourceProductId, ml }] } } },
      },
    })
  }

  await shot('Shot Antioqueno', aguardiente.id, {
    price: 6000,
    sourceProductId: aguardienteAntioqueno.id,
    ml: 30,
  })

  // --- Zonas y mesas -------------------------------------------------------
  // Sectores como los definio el dueno: VIP, salon, barra y calle.
  const zoneSpecs = [
    { name: 'Salon Principal', icon: 'table', sortOrder: 0, gridCols: 14, gridRows: 9 },
    { name: 'Terraza', icon: 'sun', sortOrder: 1, gridCols: 12, gridRows: 8 },
    { name: 'VIP', icon: 'crown', sortOrder: 2, gridCols: 10, gridRows: 7 },
    { name: 'Barra', icon: 'glass', sortOrder: 3, gridCols: 12, gridRows: 6 },
  ]
  const zones = {}
  for (const spec of zoneSpecs) {
    zones[spec.name] =
      (await prisma.zone.findFirst({ where: { tenantId: tenant.id, name: spec.name } })) ||
      (await prisma.zone.create({ data: { tenantId: tenant.id, ...spec } }))
  }

  const tableSpecs = [
    // Salon principal: 9 mesas en cuadricula
    { number: '01', zone: 'Salon Principal', seats: 4, gridX: 1, gridY: 1 },
    { number: '02', zone: 'Salon Principal', seats: 4, gridX: 4, gridY: 1 },
    { number: '03', zone: 'Salon Principal', seats: 4, gridX: 7, gridY: 1 },
    { number: '04', zone: 'Salon Principal', seats: 6, gridX: 1, gridY: 4 },
    { number: '05', zone: 'Salon Principal', seats: 4, gridX: 4, gridY: 4 },
    { number: '06', zone: 'Salon Principal', seats: 4, gridX: 7, gridY: 4 },
    { number: '07', zone: 'Salon Principal', seats: 4, gridX: 10, gridY: 4 },
    { number: '08', zone: 'Salon Principal', seats: 2, gridX: 1, gridY: 7, shape: 'SQUARE' },
    { number: '09', zone: 'Salon Principal', seats: 8, gridX: 4, gridY: 7, shape: 'RECT', width: 2 },
    // Terraza (la calle)
    { number: '10', zone: 'Terraza', seats: 4, gridX: 1, gridY: 1 },
    { number: '11', zone: 'Terraza', seats: 6, gridX: 4, gridY: 1 },
    { number: '12', zone: 'Terraza', seats: 4, gridX: 7, gridY: 1 },
    { number: '13', zone: 'Terraza', seats: 4, gridX: 1, gridY: 4 },
    // VIP
    { number: '14', zone: 'VIP', seats: 6, gridX: 1, gridY: 1, shape: 'RECT', width: 2 },
    { number: '15', zone: 'VIP', seats: 6, gridX: 5, gridY: 1, shape: 'RECT', width: 2 },
  ]
  for (const t of tableSpecs) {
    const exists = await prisma.barTable.findFirst({
      where: { tenantId: tenant.id, number: t.number },
    })
    if (exists) continue
    await prisma.barTable.create({
      data: {
        tenantId: tenant.id,
        zoneId: zones[t.zone].id,
        number: t.number,
        seats: t.seats,
        shape: t.shape || 'ROUND',
        gridX: t.gridX,
        gridY: t.gridY,
        width: t.width || 1,
        height: t.height || 1,
      },
    })
  }

  // Barra y pared de muestra en el salon
  const salon = zones['Salon Principal']
  const hasElements = await prisma.layoutElement.findFirst({ where: { zoneId: salon.id } })
  if (!hasElements) {
    await prisma.layoutElement.createMany({
      data: [
        { tenantId: tenant.id, zoneId: salon.id, type: 'BAR', label: 'Barra', gridX: 10, gridY: 0, width: 4, height: 2 },
        { tenantId: tenant.id, zoneId: salon.id, type: 'DOOR', label: 'Entrada', gridX: 6, gridY: 8, width: 2, height: 1 },
        { tenantId: tenant.id, zoneId: salon.id, type: 'WALL', gridX: 0, gridY: 0, width: 1, height: 9 },
      ],
    })
  }

  console.log('Seed listo. Entra con admin@licorplus.co / admin123')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
