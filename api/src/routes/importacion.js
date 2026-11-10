import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireRole } from '../middleware/auth.js'
import { sinConversionFija } from '../lib/unidades.js'
import { validarUnidades, validarCantidadPromedio } from './insumos.js'
import { calcularCostoUnidadInventario } from '../lib/costeo.js'
import { tituloInteligente } from '../lib/texto.js'

export const importacionRoutes = Router()

// Carga masiva: pensada para que el dueño migre su catálogo inicial desde un
// Excel en vez de registrar insumo por insumo. Mas blast radius que un CRUD
// de un solo registro (puede crear/tocar decenas de filas de una), por eso
// ADMIN real y no delegable con cajeroGestionaInventario/cajeroEditaCatalogo.
const soloAdmin = requireRole('ADMIN')

function errorDeValidacion(mensaje) {
  return Object.assign(new Error(mensaje), { esValidacion: true })
}

// Stock e InsumoMovement/StockMovement no se tocan aquí: tanto Insumo.stock
// como Variant.stock nacen en 0 y solo suben por un movimiento real (compra,
// venta...) -- ver CLAUDE.md "Inventario de presentaciones". Un insumo o
// producto NUEVO por import es consistente con eso (nace en 0, igual que
// crearlo a mano desde el formulario); uno que YA EXISTE jamás ve su stock
// sobreescrito por un re-import, solo sus datos de catálogo.

importacionRoutes.post('/importacion/insumos', soloAdmin, async (req, res) => {
  const { filas } = req.body || {}
  if (!Array.isArray(filas) || filas.length === 0) {
    return res.status(400).json({ error: 'El archivo no trajo ninguna fila para importar' })
  }

  const resultados = []
  for (let i = 0; i < filas.length; i++) {
    const fila = filas[i] || {}
    const numeroFila = i + 2 // fila 1 es el encabezado
    const nombreOriginal = fila.nombre || '(sin nombre)'
    try {
      const nombre = tituloInteligente(String(fila.nombre || '').trim())
      if (!nombre) throw errorDeValidacion('Falta el nombre')

      const unidadInventario = String(fila.unidadInventario || '').trim().toLowerCase()
      const unidadCompra = String(fila.unidadCompra || '').trim().toLowerCase()
      if (!unidadInventario || !unidadCompra) {
        throw errorDeValidacion('Falta la unidad de inventario o la unidad de compra')
      }
      const errorUnidad = validarUnidades(unidadInventario, unidadCompra)
      if (errorUnidad) throw errorDeValidacion(errorUnidad)
      const cantidadPromedioPorUnidad = fila.cantidadPromedioPorUnidad
      const errorPromedio = validarCantidadPromedio(unidadInventario, unidadCompra, cantidadPromedioPorUnidad)
      if (errorPromedio) throw errorDeValidacion(errorPromedio)

      const nombreCategoria = String(fila.categoria || '').trim()
      if (!nombreCategoria) throw errorDeValidacion('Falta la categoría')
      let categoria = await prisma.insumoCategoria.findFirst({
        where: { tenantId: req.auth.tenantId, name: nombreCategoria },
      })
      if (!categoria) {
        categoria = await prisma.insumoCategoria.create({
          data: { tenantId: req.auth.tenantId, name: nombreCategoria },
        })
      }

      let proveedorId = null
      const nombreProveedor = String(fila.proveedor || '').trim()
      if (nombreProveedor) {
        let proveedor = await prisma.proveedor.findFirst({
          where: { tenantId: req.auth.tenantId, name: nombreProveedor },
        })
        if (!proveedor) {
          proveedor = await prisma.proveedor.create({
            data: { tenantId: req.auth.tenantId, name: nombreProveedor },
          })
        }
        proveedorId = proveedor.id
      }

      const datos = {
        name: nombre,
        categoriaId: categoria.id,
        unidadInventario,
        unidadCompra,
        cantidadPromedioPorUnidad: sinConversionFija(unidadCompra, unidadInventario)
          ? Number(cantidadPromedioPorUnidad)
          : null,
        costoCompra: Number(fila.costoCompra) || 0,
        costoUnidadInventario: calcularCostoUnidadInventario({
          costoCompra: Number(fila.costoCompra) || 0,
          unidadCompra,
          unidadInventario,
          cantidadPromedioPorUnidad,
        }),
        proveedorId,
        codigoInterno: fila.codigoInterno ? String(fila.codigoInterno).trim() : null,
        stockMinimo: fila.stockMinimo ? Number(fila.stockMinimo) : null,
        description: fila.descripcion ? String(fila.descripcion).trim() : null,
      }

      const existente = await prisma.insumo.findFirst({
        where: { tenantId: req.auth.tenantId, name: nombre },
      })
      if (existente) {
        await prisma.insumo.update({ where: { id: existente.id }, data: datos })
        resultados.push({ fila: numeroFila, nombre, estado: 'actualizado' })
      } else {
        await prisma.insumo.create({
          data: { ...datos, tenantId: req.auth.tenantId, createdById: req.auth.userId },
        })
        resultados.push({ fila: numeroFila, nombre, estado: 'creado' })
      }
    } catch (err) {
      resultados.push({ fila: numeroFila, nombre: nombreOriginal, estado: 'error', error: err.message })
    }
  }

  res.json(resumenImportacion(resultados))
})

importacionRoutes.post('/importacion/productos', soloAdmin, async (req, res) => {
  const { filas } = req.body || {}
  if (!Array.isArray(filas) || filas.length === 0) {
    return res.status(400).json({ error: 'El archivo no trajo ninguna fila para importar' })
  }

  const resultados = []
  for (let i = 0; i < filas.length; i++) {
    const fila = filas[i] || {}
    const numeroFila = i + 2
    const nombreOriginal = fila.nombre || '(sin nombre)'
    try {
      const nombre = tituloInteligente(String(fila.nombre || '').trim())
      if (!nombre) throw errorDeValidacion('Falta el nombre')
      const nombrePresentacion = String(fila.presentacion || '').trim() || 'Unidad'

      const nombreCategoria = String(fila.categoria || '').trim()
      if (!nombreCategoria) throw errorDeValidacion('Falta la categoría')
      // A diferencia de insumos, la categoría de producto NO se crea sola:
      // tiene allowsPour y jerarquía, eso lo decide el admin desde el
      // catálogo, no una fila de Excel.
      const categoria = await prisma.category.findFirst({
        where: { tenantId: req.auth.tenantId, name: nombreCategoria },
      })
      if (!categoria) {
        throw errorDeValidacion(`La categoría "${nombreCategoria}" no existe; créala primero en Catálogo`)
      }

      const precio = Number(fila.precio)
      if (!Number.isFinite(precio) || precio < 0) throw errorDeValidacion('El precio de venta no es válido')
      const costo = Number(fila.costo) || 0
      const volumenMl = fila.volumenMl ? Number(fila.volumenMl) : null
      if (categoria.allowsPour && !volumenMl) {
        throw errorDeValidacion(`"${nombreCategoria}" vende por trago: la presentación necesita su volumen en ml`)
      }
      const stockInicial = fila.stock ? Math.round(Number(fila.stock)) : 0

      let producto = await prisma.product.findFirst({
        where: { tenantId: req.auth.tenantId, name: nombre, kind: 'STOCK' },
      })
      if (!producto) {
        producto = await prisma.product.create({
          data: { tenantId: req.auth.tenantId, categoryId: categoria.id, name: nombre, kind: 'STOCK' },
        })
      } else if (producto.categoryId !== categoria.id) {
        await prisma.product.update({ where: { id: producto.id }, data: { categoryId: categoria.id } })
      }

      const existente = await prisma.variant.findFirst({
        where: { productId: producto.id, name: nombrePresentacion },
      })
      if (existente) {
        await prisma.variant.update({
          where: { id: existente.id },
          data: { price: precio, cost: costo, volumeMl: volumenMl },
        })
        resultados.push({ fila: numeroFila, nombre: `${nombre} · ${nombrePresentacion}`, estado: 'actualizado' })
      } else {
        const sortOrder = await prisma.variant.count({ where: { productId: producto.id } })
        await prisma.variant.create({
          data: {
            productId: producto.id,
            name: nombrePresentacion,
            price: precio,
            cost: costo,
            volumeMl: volumenMl,
            stock: stockInicial,
            sortOrder,
          },
        })
        resultados.push({ fila: numeroFila, nombre: `${nombre} · ${nombrePresentacion}`, estado: 'creado' })
      }
    } catch (err) {
      resultados.push({ fila: numeroFila, nombre: nombreOriginal, estado: 'error', error: err.message })
    }
  }

  res.json(resumenImportacion(resultados))
})

function resumenImportacion(resultados) {
  return {
    resultados,
    resumen: {
      creados: resultados.filter((r) => r.estado === 'creado').length,
      actualizados: resultados.filter((r) => r.estado === 'actualizado').length,
      errores: resultados.filter((r) => r.estado === 'error').length,
    },
  }
}
