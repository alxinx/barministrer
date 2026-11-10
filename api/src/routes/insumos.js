import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requirePermission } from '../middleware/permissions.js'
import { subirImagenInsumo } from '../lib/r2.js'
import { UNIDADES, factorConversion, sinConversionFija } from '../lib/unidades.js'
import { calcularCostoUnidadInventario } from '../lib/costeo.js'
import { tituloInteligente } from '../lib/texto.js'

export const insumoRoutes = Router()
// Mismo permiso que ya protege /productos/inventario: un insumo es materia
// prima de bodega, no catalogo de venta (eso es cajeroEditaCatalogo).
const adminOnly = requirePermission('cajeroGestionaInventario')

// --- Unidades (catalogo fijo) -----------------------------------------------

insumoRoutes.get('/insumos/unidades', (req, res) => {
  res.json(UNIDADES)
})

// --- Categorias de insumos ---------------------------------------------------
// Lista plana a proposito (sin padre/hija como Category) y separada del
// catalogo de productos: nunca se mezclan.

insumoRoutes.get('/insumo-categorias', async (req, res) => {
  const categorias = await prisma.insumoCategoria.findMany({
    where: { tenantId: req.auth.tenantId },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })
  res.json(categorias)
})

insumoRoutes.post('/insumo-categorias', adminOnly, async (req, res) => {
  const { name } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'La categoría necesita un nombre' })
  const categoria = await prisma.insumoCategoria.create({
    data: { tenantId: req.auth.tenantId, name: name.trim() },
  })
  res.status(201).json(categoria)
})

// --- Proveedores -------------------------------------------------------------
// Minimo viable: solo nombre. "Compras y proveedores" (ordenes de compra,
// historial) es una pantalla propia que todavia no existe.

insumoRoutes.get('/proveedores', async (req, res) => {
  // ?todos=1 incluye los inactivos: sin esto, desactivar un proveedor desde
  // /proveedores lo hacia desaparecer de esa misma pantalla sin forma de
  // volver a encontrarlo para reactivarlo. El uso normal (InsumoForm al
  // vuelo) sigue sin mandar el parametro, mismo comportamiento de siempre.
  const { todos } = req.query
  const proveedores = await prisma.proveedor.findMany({
    where: { tenantId: req.auth.tenantId, ...(todos === '1' ? {} : { active: true }) },
    orderBy: { name: 'asc' },
  })
  res.json(proveedores)
})

insumoRoutes.post('/proveedores', adminOnly, async (req, res) => {
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
  } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'El proveedor necesita un nombre' })
  if (tipoIdentificacion && !['NIT', 'CEDULA'].includes(tipoIdentificacion)) {
    return res.status(400).json({ error: 'El tipo de identificación no es válido' })
  }
  if (condicionPago && !['CONTADO', 'CREDITO'].includes(condicionPago)) {
    return res.status(400).json({ error: 'La condición de pago no es válida' })
  }

  try {
    const proveedor = await prisma.proveedor.create({
      data: {
        tenantId: req.auth.tenantId,
        name: name.trim(),
        nombreComercial: nombreComercial?.trim() || null,
        tipoIdentificacion: tipoIdentificacion || null,
        numeroIdentificacion: numeroIdentificacion?.toString().trim() || null,
        contacto: contacto?.trim() || null,
        telefono: telefono?.trim() || null,
        whatsapp: whatsapp?.trim() || null,
        email: email?.trim() || null,
        direccion: direccion?.trim() || null,
        ciudad: ciudad?.trim() || null,
        observaciones: observaciones?.trim() || null,
        ...(condicionPago && { condicionPago }),
        diasCredito: condicionPago === 'CREDITO' && diasCredito ? Number(diasCredito) : null,
      },
    })
    res.status(201).json(proveedor)
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

// --- Imagen de insumo --------------------------------------------------------
// El navegador ya redujo la imagen (max 800px, ~200KB) y la convirtio a
// webp; aqui solo se decodifica y se sube a R2, carpeta "insumos/".

insumoRoutes.post('/insumos/image', adminOnly, async (req, res) => {
  const { image } = req.body || {}
  const match = /^data:image\/webp;base64,(.+)$/.exec(image || '')
  if (!match) return res.status(400).json({ error: 'La imagen debe venir en formato webp' })

  const buffer = Buffer.from(match[1], 'base64')
  if (buffer.length > 300_000) {
    return res.status(400).json({ error: 'La imagen quedo mas grande de lo esperado, intenta con otra' })
  }

  const imageUrl = await subirImagenInsumo(buffer)
  res.status(201).json({ imageUrl })
})

// --- Insumos -------------------------------------------------------------

insumoRoutes.get('/insumos', async (req, res) => {
  const { categoriaId, proveedorId, search } = req.query
  const insumos = await prisma.insumo.findMany({
    where: {
      tenantId: req.auth.tenantId,
      ...(categoriaId && { categoriaId: String(categoriaId) }),
      ...(proveedorId && { proveedorId: String(proveedorId) }),
      ...(search && { name: { contains: String(search) } }),
    },
    include: { categoria: true, proveedor: true },
    orderBy: { name: 'asc' },
  })
  res.json(insumos)
})

// La unidad de compra y la de inventario tienen que ser de la misma
// magnitud (las dos de peso, las dos de volumen, o las dos "unidad") -- a
// menos que sea el caso especial de sinConversionFija (se compra por unidad
// o por paquete pero no hay un tamano fijo real, ej. lechugas por unidad o
// pan por paquete, y recetas en gramos/unidad): ese combo se permite aparte.
export function validarUnidades(unidadInventario, unidadCompra) {
  if (factorConversion(unidadCompra, unidadInventario) !== null) return null
  if (sinConversionFija(unidadCompra, unidadInventario)) return null
  return 'La unidad de compra y la unidad de inventario deben ser de la misma magnitud (ambas de peso, ambas de volumen, o ambas "unidad")'
}

// Caso sinConversionFija: sin conversion fija real (cada unidad o paquete
// trae una cantidad distinta), asi que el promedio se declara a mano y es
// obligatorio -- se usa para costear la receta y sugerir el total al
// registrar la compra (la cantidad real de cada compra se declara aparte,
// ver compras.js).
export function validarCantidadPromedio(unidadInventario, unidadCompra, cantidadPromedioPorUnidad) {
  if (!sinConversionFija(unidadCompra, unidadInventario)) return null
  const valor = Number(cantidadPromedioPorUnidad)
  if (!cantidadPromedioPorUnidad || !Number.isFinite(valor) || valor <= 0) {
    return `Como compras por ${unidadCompra} pero cuentas en otra unidad, escribe cuánto trae en promedio cada ${unidadCompra}`
  }
  return null
}

insumoRoutes.post('/insumos', adminOnly, async (req, res) => {
  const {
    name,
    categoriaId,
    codigoInterno,
    description,
    imageUrl,
    unidadInventario,
    unidadCompra,
    stockMinimo,
    ubicacion,
    costoCompra,
    proveedorId,
    cantidadPromedioPorUnidad,
  } = req.body || {}

  if (!name?.trim()) return res.status(400).json({ error: 'El insumo necesita un nombre' })
  if (!categoriaId) return res.status(400).json({ error: 'Elige una categoría' })
  if (!unidadInventario || !unidadCompra) {
    return res.status(400).json({ error: 'Elige la unidad de inventario y la unidad de compra' })
  }
  const errorUnidad = validarUnidades(unidadInventario, unidadCompra)
  if (errorUnidad) return res.status(400).json({ error: errorUnidad })
  const errorPromedio = validarCantidadPromedio(unidadInventario, unidadCompra, cantidadPromedioPorUnidad)
  if (errorPromedio) return res.status(400).json({ error: errorPromedio })

  const categoria = await prisma.insumoCategoria.findFirst({
    where: { id: categoriaId, tenantId: req.auth.tenantId },
  })
  if (!categoria) return res.status(400).json({ error: 'La categoría no existe' })

  if (proveedorId) {
    const proveedor = await prisma.proveedor.findFirst({ where: { id: proveedorId, tenantId: req.auth.tenantId } })
    if (!proveedor) return res.status(400).json({ error: 'El proveedor no existe' })
  }

  const insumo = await prisma.insumo.create({
    data: {
      tenantId: req.auth.tenantId,
      categoriaId,
      name: tituloInteligente(name.trim()),
      codigoInterno: codigoInterno?.trim() || null,
      description: description?.trim() || null,
      imageUrl: imageUrl || null,
      unidadInventario,
      unidadCompra,
      stockMinimo: stockMinimo ? Number(stockMinimo) : null,
      ubicacion: ubicacion?.trim() || null,
      costoCompra: costoCompra ?? 0,
      costoUnidadInventario: calcularCostoUnidadInventario({
        costoCompra,
        unidadCompra,
        unidadInventario,
        cantidadPromedioPorUnidad,
      }),
      cantidadPromedioPorUnidad: sinConversionFija(unidadCompra, unidadInventario)
        ? Number(cantidadPromedioPorUnidad)
        : null,
      proveedorId: proveedorId || null,
      createdById: req.auth.userId,
    },
    include: { categoria: true, proveedor: true },
  })
  res.status(201).json(insumo)
})

insumoRoutes.patch('/insumos/:id', adminOnly, async (req, res) => {
  const existing = await prisma.insumo.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } })
  if (!existing) return res.status(404).json({ error: 'Insumo no encontrado' })

  const {
    name,
    categoriaId,
    codigoInterno,
    description,
    imageUrl,
    unidadInventario,
    unidadCompra,
    stockMinimo,
    ubicacion,
    costoCompra,
    proveedorId,
    cantidadPromedioPorUnidad,
    active,
  } = req.body || {}

  const efectivoInv = unidadInventario ?? existing.unidadInventario
  const efectivoCompra = unidadCompra ?? existing.unidadCompra
  if (unidadInventario !== undefined || unidadCompra !== undefined) {
    const errorUnidad = validarUnidades(efectivoInv, efectivoCompra)
    if (errorUnidad) return res.status(400).json({ error: errorUnidad })
  }
  const efectivoPromedio =
    cantidadPromedioPorUnidad !== undefined ? cantidadPromedioPorUnidad : existing.cantidadPromedioPorUnidad
  const errorPromedio = validarCantidadPromedio(efectivoInv, efectivoCompra, efectivoPromedio)
  if (errorPromedio) return res.status(400).json({ error: errorPromedio })
  const efectivoCosto = costoCompra !== undefined ? costoCompra : existing.costoCompra
  const costoUnidadInventario = calcularCostoUnidadInventario({
    costoCompra: efectivoCosto,
    unidadCompra: efectivoCompra,
    unidadInventario: efectivoInv,
    cantidadPromedioPorUnidad: efectivoPromedio,
  })

  // Si cambia de unidades y deja de ser el caso especial, el promedio viejo
  // ya no significa nada -- se limpia solo, sin que el cliente tenga que
  // acordarse de mandarlo en null.
  let dataCantidadPromedio
  if (cantidadPromedioPorUnidad !== undefined) {
    dataCantidadPromedio = cantidadPromedioPorUnidad ? Number(cantidadPromedioPorUnidad) : null
  } else if ((unidadInventario !== undefined || unidadCompra !== undefined) && !sinConversionFija(efectivoCompra, efectivoInv)) {
    dataCantidadPromedio = null
  }

  if (categoriaId !== undefined) {
    const categoria = await prisma.insumoCategoria.findFirst({
      where: { id: categoriaId, tenantId: req.auth.tenantId },
    })
    if (!categoria) return res.status(400).json({ error: 'La categoría no existe' })
  }
  if (proveedorId) {
    const proveedor = await prisma.proveedor.findFirst({ where: { id: proveedorId, tenantId: req.auth.tenantId } })
    if (!proveedor) return res.status(400).json({ error: 'El proveedor no existe' })
  }

  const insumo = await prisma.insumo.update({
    where: { id: existing.id },
    data: {
      ...(name !== undefined && { name: tituloInteligente(name.trim()) }),
      ...(categoriaId !== undefined && { categoriaId }),
      ...(codigoInterno !== undefined && { codigoInterno: codigoInterno?.trim() || null }),
      ...(description !== undefined && { description: description?.trim() || null }),
      ...(imageUrl !== undefined && { imageUrl: imageUrl || null }),
      ...(unidadInventario !== undefined && { unidadInventario }),
      ...(unidadCompra !== undefined && { unidadCompra }),
      ...(stockMinimo !== undefined && { stockMinimo: stockMinimo ? Number(stockMinimo) : null }),
      ...(ubicacion !== undefined && { ubicacion: ubicacion?.trim() || null }),
      ...(costoCompra !== undefined && { costoCompra }),
      ...((costoCompra !== undefined ||
        unidadCompra !== undefined ||
        unidadInventario !== undefined ||
        cantidadPromedioPorUnidad !== undefined) && { costoUnidadInventario }),
      ...(dataCantidadPromedio !== undefined && { cantidadPromedioPorUnidad: dataCantidadPromedio }),
      ...(proveedorId !== undefined && { proveedorId: proveedorId || null }),
      ...(active !== undefined && { active: Boolean(active) }),
    },
    include: { categoria: true, proveedor: true },
  })
  res.json(insumo)
})
