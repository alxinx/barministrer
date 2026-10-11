import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireRole } from '../middleware/auth.js'

export const catalogRoutes = Router()
const adminOnly = requireRole('ADMIN')

// --- Categorias ------------------------------------------------------------

catalogRoutes.get('/categories', async (req, res) => {
  const categories = await prisma.category.findMany({
    where: { tenantId: req.auth.tenantId },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })
  res.json(categories)
})

catalogRoutes.post('/categories', adminOnly, async (req, res) => {
  const { name, parentId, color, allowsPour, sortOrder } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'La categoria necesita un nombre' })

  // Una subcategoria hereda allowsPour del padre: si el padre permite venta por
  // ml, cualquier hija nueva entra automaticamente y no se queda por fuera en
  // silencio.
  let inherited = Boolean(allowsPour)
  if (parentId) {
    const parent = await prisma.category.findFirst({
      where: { id: parentId, tenantId: req.auth.tenantId },
    })
    if (!parent) return res.status(400).json({ error: 'La categoria padre no existe' })
    inherited = allowsPour === undefined ? parent.allowsPour : Boolean(allowsPour)
  }

  const category = await prisma.category.create({
    data: {
      tenantId: req.auth.tenantId,
      name: name.trim(),
      parentId: parentId || null,
      color: color || '#E8A33D',
      allowsPour: inherited,
      sortOrder: sortOrder ?? 0,
    },
  })
  res.status(201).json(category)
})

catalogRoutes.patch('/categories/:id', adminOnly, async (req, res) => {
  const { name, color, allowsPour, active, sortOrder } = req.body || {}
  const existing = await prisma.category.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
  })
  if (!existing) return res.status(404).json({ error: 'Categoria no encontrada' })

  const category = await prisma.category.update({
    where: { id: existing.id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(color !== undefined && { color }),
      ...(allowsPour !== undefined && { allowsPour: Boolean(allowsPour) }),
      ...(active !== undefined && { active: Boolean(active) }),
      ...(sortOrder !== undefined && { sortOrder }),
    },
  })
  res.json(category)
})

// Borrar de verdad, no solo desactivar: para cuando una categoria se creo mal
// y no debe quedar ni como historial. Si todavia tiene subcategorias o
// productos, hay que moverlos o borrarlos primero (o solo desactivarla).
catalogRoutes.delete('/categories/:id', adminOnly, async (req, res) => {
  const existing = await prisma.category.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
  })
  if (!existing) return res.status(404).json({ error: 'Categoria no encontrada' })

  const [hijas, productos] = await Promise.all([
    prisma.category.count({ where: { parentId: existing.id } }),
    prisma.product.count({ where: { categoryId: existing.id } }),
  ])
  if (hijas > 0) {
    return res.status(400).json({ error: 'Esta categoría tiene subcategorías; bórralas primero' })
  }
  if (productos > 0) {
    return res.status(400).json({ error: 'Esta categoría todavía tiene productos; muévelos o bórralos primero' })
  }

  await prisma.category.delete({ where: { id: existing.id } })
  res.status(204).end()
})

// --- Productos -------------------------------------------------------------

catalogRoutes.get('/products', async (req, res) => {
  const { categoryId, search } = req.query
  const products = await prisma.product.findMany({
    where: {
      tenantId: req.auth.tenantId,
      ...(categoryId && { categoryId: String(categoryId) }),
      ...(search && { name: { contains: String(search) } }),
    },
    include: {
      category: { select: { id: true, name: true, color: true, allowsPour: true, active: true } },
      variants: { orderBy: { sortOrder: 'asc' } },
      recipe: { include: { items: { include: { sourceProduct: { select: { id: true, name: true } } } } } },
    },
    orderBy: { name: 'asc' },
  })

  // Un producto solo esta disponible si el y su categoria estan activos.
  // Se calcula, nunca se guarda: asi desactivar una categoria no pisa el estado
  // individual de cada producto.
  res.json(products.map((p) => ({ ...p, available: p.active && p.category.active })))
})

// Un shot (o coctel/cubetazo) es una receta de un solo ingrediente vinculada a
// una marca concreta: valida que cada ingrediente tenga producto + ml, y que
// ese producto viva en una categoria que de verdad vende por ml.
async function validarIngredientes(tenantId, items) {
  if (!items?.length) return 'El shot necesita al menos un ingrediente'
  for (const item of items) {
    if (!item.sourceProductId || !item.ml) {
      return 'Cada ingrediente necesita un producto de origen y sus ml'
    }
    const source = await prisma.product.findFirst({
      where: { id: item.sourceProductId, tenantId },
      include: { category: true },
    })
    if (!source) return 'El producto de origen del ingrediente no existe'
    if (!source.category.allowsPour) {
      return `"${source.name}" no esta en una categoria que vende por ml, no puede ser ingrediente de un shot`
    }
  }
  return null
}

catalogRoutes.post('/products', adminOnly, async (req, res) => {
  const { name, categoryId, kind = 'STOCK', imageUrl, variants = [], recipe } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'El producto necesita un nombre' })
  if (!categoryId) return res.status(400).json({ error: 'Elige una categoria' })

  const category = await prisma.category.findFirst({
    where: { id: categoryId, tenantId: req.auth.tenantId },
  })
  if (!category) return res.status(400).json({ error: 'La categoria no existe' })

  if (kind === 'PREPARED') {
    // El flag vive en la categoria: si no permite venta por ml, el shot no
    // tiene de donde servirse, sin importar que el producto diga otra cosa.
    if (!category.allowsPour) {
      return res.status(400).json({
        error: `La categoria "${category.name}" no permite venta por shots. Activa esa opcion en la categoria o elige otra.`,
      })
    }
    const error = await validarIngredientes(req.auth.tenantId, recipe?.items)
    if (error) return res.status(400).json({ error })

    const product = await prisma.product.create({
      data: {
        tenantId: req.auth.tenantId,
        categoryId,
        name: name.trim(),
        kind,
        imageUrl: imageUrl || null,
        recipe: {
          create: {
            price: recipe.price ?? 0,
            items: { create: recipe.items.map((i) => ({ sourceProductId: i.sourceProductId, ml: i.ml })) },
          },
        },
      },
      include: { category: true, recipe: { include: { items: { include: { sourceProduct: true } } } } },
    })
    return res.status(201).json(product)
  }

  // Si la categoria permite venta por ml, cada presentacion debe declarar su
  // volumen: sin eso el sistema no sabe cuantos shots salen al abrirla.
  if (category.allowsPour) {
    const missing = variants.find((v) => !v.volumeMl)
    if (missing) {
      return res.status(400).json({
        error: `La presentacion "${missing.name}" necesita su volumen en ml para poder vender shots`,
      })
    }
  }

  const product = await prisma.product.create({
    data: {
      tenantId: req.auth.tenantId,
      categoryId,
      name: name.trim(),
      kind,
      imageUrl: imageUrl || null,
      variants: {
        create: variants.map((v, i) => ({
          name: v.name,
          price: v.price ?? 0,
          cost: v.cost ?? 0,
          volumeMl: v.volumeMl ?? null,
          stock: v.stock ?? 0,
          sortOrder: i,
        })),
      },
    },
    include: { variants: true, category: true },
  })
  res.status(201).json(product)
})

catalogRoutes.patch('/products/:id', adminOnly, async (req, res) => {
  const { name, categoryId, imageUrl, active, recipe } = req.body || {}
  const existing = await prisma.product.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
    include: { recipe: true },
  })
  if (!existing) return res.status(404).json({ error: 'Producto no encontrado' })

  if (recipe) {
    if (existing.kind !== 'PREPARED') {
      return res.status(400).json({ error: 'Solo un shot tiene receta para editar' })
    }
    const error = await validarIngredientes(req.auth.tenantId, recipe.items)
    if (error) return res.status(400).json({ error })

    await prisma.recipeItem.deleteMany({ where: { recipeId: existing.recipe.id } })
    await prisma.recipe.update({
      where: { id: existing.recipe.id },
      data: {
        price: recipe.price ?? existing.recipe.price,
        items: { create: recipe.items.map((i) => ({ sourceProductId: i.sourceProductId, ml: i.ml })) },
      },
    })
  }

  const product = await prisma.product.update({
    where: { id: existing.id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(categoryId !== undefined && { categoryId }),
      ...(imageUrl !== undefined && { imageUrl }),
      ...(active !== undefined && { active: Boolean(active) }),
    },
    include: { variants: true, category: true, recipe: { include: { items: { include: { sourceProduct: true } } } } },
  })
  res.json(product)
})

// --- Presentaciones --------------------------------------------------------

catalogRoutes.post('/products/:id/variants', adminOnly, async (req, res) => {
  const product = await prisma.product.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
    include: { category: true, variants: true },
  })
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' })

  const { name, price, cost, volumeMl } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'La presentacion necesita un nombre' })
  if (product.category.allowsPour && !volumeMl) {
    return res.status(400).json({ error: 'Esta presentacion necesita su volumen en ml' })
  }

  const variant = await prisma.variant.create({
    data: {
      productId: product.id,
      name: name.trim(),
      price: price ?? 0,
      cost: cost ?? 0,
      volumeMl: volumeMl ?? null,
      sortOrder: product.variants.length,
    },
  })
  res.status(201).json(variant)
})

catalogRoutes.patch('/variants/:id', adminOnly, async (req, res) => {
  const variant = await prisma.variant.findFirst({
    where: { id: req.params.id, product: { tenantId: req.auth.tenantId } },
  })
  if (!variant) return res.status(404).json({ error: 'Presentacion no encontrada' })

  const { name, price, cost, volumeMl, active } = req.body || {}
  const updated = await prisma.variant.update({
    where: { id: variant.id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(price !== undefined && { price }),
      ...(cost !== undefined && { cost }),
      ...(volumeMl !== undefined && { volumeMl }),
      ...(active !== undefined && { active: Boolean(active) }),
    },
  })
  res.json(updated)
})

// Borra la presentacion de verdad. Si es ingrediente de algun shot se
// rechaza: borrarla igual dejaria la receta apuntando a nada (SET NULL en la
// base), sellando un shot roto en silencio. El historial de inventario de la
// presentacion (StockMovement) sí se pierde: es la cuenta de borrar de verdad.
catalogRoutes.delete('/variants/:id', adminOnly, async (req, res) => {
  const variant = await prisma.variant.findFirst({
    where: { id: req.params.id, product: { tenantId: req.auth.tenantId } },
  })
  if (!variant) return res.status(404).json({ error: 'Presentacion no encontrada' })

  const enReceta = await prisma.recipeItem.findFirst({ where: { variantId: variant.id } })
  if (enReceta) {
    return res.status(400).json({ error: 'Esta presentacion es ingrediente de un shot. Quitala de esa receta antes de borrarla.' })
  }

  await prisma.variant.delete({ where: { id: variant.id } })
  res.status(204).end()
})
