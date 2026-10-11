import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { categoryTree, flattenCategories } from '../lib/categories'
import { resizeProductImage } from '../lib/image'
import { Icon } from './Icons'
import MoneyInput from './MoneyInput'

/**
 * Crea o edita un producto. Dos tipos, un solo formulario:
 * - STOCK: presentaciones selladas con stock propio (botella, unidad...).
 * - PREPARED (shot): una receta de un solo ingrediente vinculada a una marca
 *   concreta. Solo existe si la categoria tiene allowsPour, porque ahi vive
 *   el permiso de vender por ml, no en el producto.
 */
export default function ProductoForm({ categories, products, product, initialName, onClose, onSaved }) {
  const isEdit = Boolean(product)
  const [kind, setKind] = useState(product?.kind || 'STOCK')
  const [categoryId, setCategoryId] = useState(product?.categoryId || '')
  const [name, setName] = useState(product?.name || initialName || '')
  const [variants, setVariants] = useState(
    product?.variants?.length
      ? product.variants.map((v) => ({
          id: v.id,
          name: v.name,
          price: v.price,
          cost: v.cost,
          volumeMl: v.volumeMl || '',
          stock: v.stock,
        }))
      : [{ name: '', price: '', cost: '', volumeMl: '', stock: '' }]
  )
  const [recipePrice, setRecipePrice] = useState(product?.recipe?.price || '')
  const [recipeItems, setRecipeItems] = useState(
    product?.recipe?.items?.length
      ? product.recipe.items.map((i) => ({ sourceProductId: i.sourceProductId, ml: i.ml }))
      : [{ sourceProductId: '', ml: 30 }]
  )
  const [imageUrl, setImageUrl] = useState(product?.imageUrl || '')
  const [subiendoImagen, setSubiendoImagen] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function subirImagen(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setSubiendoImagen(true)
    setError('')
    try {
      const webp = await resizeProductImage(file)
      const { imageUrl: url } = await api('/products/image', { method: 'POST', body: { image: webp } })
      setImageUrl(url)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubiendoImagen(false)
    }
  }

  const options = useMemo(() => flattenCategories(categoryTree(categories)), [categories])
  const category = categories.find((c) => c.id === categoryId)
  const allowsPour = Boolean(category?.allowsPour)

  // El shot solo existe si la categoria vende por ml. Si cambian de categoria
  // a una que no, no se queda a medias: vuelve a presentacion sellada.
  useEffect(() => {
    if (kind === 'PREPARED' && !allowsPour) setKind('STOCK')
  }, [allowsPour, kind])

  const ingredientOptions = products.filter(
    (p) => p.kind === 'STOCK' && p.category?.allowsPour && p.id !== product?.id
  )

  function setVariant(i, patch) {
    setVariants((prev) => prev.map((v, idx) => (idx === i ? { ...v, ...patch } : v)))
  }
  function setIngredient(i, patch) {
    setRecipeItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))
  }

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!name.trim()) return setError('El producto necesita un nombre')
    if (!categoryId) return setError('Elige una categoría')

    let body
    if (kind === 'PREPARED') {
      const items = recipeItems
        .filter((i) => i.sourceProductId && i.ml)
        .map((i) => ({ sourceProductId: i.sourceProductId, ml: Number(i.ml) }))
      if (!items.length) return setError('Agrega al menos un ingrediente con su marca y sus ml')
      body = { name: name.trim(), categoryId, kind, recipe: { price: Number(recipePrice) || 0, items } }
    } else {
      const clean = variants.filter((v) => v.name.trim())
      if (!clean.length) return setError('Agrega al menos una presentación')
      if (allowsPour && clean.some((v) => !v.volumeMl)) {
        return setError('Cada presentación necesita su volumen en ml para poder vender shots')
      }
      body = { name: name.trim(), categoryId, kind: 'STOCK' }
    }
    body.imageUrl = imageUrl || null

    setSaving(true)
    try {
      let saved
      if (isEdit) {
        saved = await api(`/products/${product.id}`, { method: 'PATCH', body })
        if (kind !== 'PREPARED') {
          // Quitar una presentacion con el basurero es local hasta aqui: lo
          // que ya existia en el producto y ya no esta en la lista actual se
          // borra de verdad al guardar.
          const idsActuales = new Set(variants.map((v) => v.id).filter(Boolean))
          const eliminadas = (product.variants || []).filter((v) => !idsActuales.has(v.id))
          for (const v of eliminadas) {
            await api(`/variants/${v.id}`, { method: 'DELETE' })
          }
          for (const v of variants.filter((v) => v.name.trim())) {
            const payload = {
              name: v.name.trim(),
              price: Number(v.price) || 0,
              cost: Number(v.cost) || 0,
              volumeMl: v.volumeMl ? Number(v.volumeMl) : null,
            }
            if (v.id) await api(`/variants/${v.id}`, { method: 'PATCH', body: payload })
            else await api(`/products/${product.id}/variants`, { method: 'POST', body: payload })
          }
        }
      } else {
        if (kind !== 'PREPARED') {
          body.variants = variants
            .filter((v) => v.name.trim())
            .map((v) => ({
              name: v.name.trim(),
              price: Number(v.price) || 0,
              cost: Number(v.cost) || 0,
              volumeMl: v.volumeMl ? Number(v.volumeMl) : null,
              stock: Number(v.stock) || 0,
            }))
        }
        saved = await api('/products', { method: 'POST', body })
      }
      onSaved(saved)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="card w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-5"
      >
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{isEdit ? 'Editar producto' : 'Nuevo producto'}</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-ink">
            <Icon.x />
          </button>
        </header>

        {error && (
          <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
            {error}
          </p>
        )}

        <div>
          <label className="label">Categoría</label>
          <select className="field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="" disabled hidden>
              Elige una categoría
            </option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {'— '.repeat(c.depth)}
                {c.name}
                {c.allowsPour ? ' · ml' : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Nombre</label>
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Aguardiente Antioqueño"
          />
        </div>

        {!isEdit && (
          <div>
            <label className="label">Tipo de producto</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setKind('STOCK')} className={tabClass(kind === 'STOCK')}>
                Presentación sellada
              </button>
              <button
                type="button"
                disabled={!allowsPour}
                onClick={() => setKind('PREPARED')}
                className={tabClass(kind === 'PREPARED')}
              >
                <Icon.drop width={16} height={16} />
                Shot
              </button>
            </div>
            {!allowsPour && (
              <p className="text-xs text-muted mt-1.5">
                Un shot solo existe en una categoría que venda por ml. Elige esa categoría arriba para
                habilitarlo.
              </p>
            )}
          </div>
        )}

        {kind === 'STOCK' ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="label mb-0">Presentaciones</span>
              <button
                type="button"
                onClick={() => setVariants((prev) => [...prev, { name: '', price: '', cost: '', volumeMl: '', stock: '' }])}
                className="text-xs font-semibold text-amber flex items-center gap-1"
              >
                <Icon.plus width={14} height={14} /> Agregar
              </button>
            </div>

            {variants.map((v, i) => (
              <div key={i} className="flex flex-wrap gap-2 items-end bg-raised border border-edge rounded-xl p-3">
                <div className="flex-1 min-w-[140px]">
                  <label className="label text-xs">Nombre</label>
                  <input
                    className="field h-9"
                    value={v.name}
                    onChange={(e) => setVariant(i, { name: e.target.value })}
                    placeholder="Botella"
                  />
                </div>
                <div className="w-24">
                  <label className="label text-xs">Precio</label>
                  <MoneyInput className="field h-9" value={v.price} onChange={(val) => setVariant(i, { price: val })} />
                </div>
                <div className="w-24">
                  <label className="label text-xs">Costo</label>
                  <MoneyInput className="field h-9" value={v.cost} onChange={(val) => setVariant(i, { cost: val })} />
                </div>
                {allowsPour && (
                  <div className="w-20">
                    <label className="label text-xs">ml</label>
                    <input
                      type="number"
                      className="field h-9"
                      value={v.volumeMl}
                      onChange={(e) => setVariant(i, { volumeMl: e.target.value })}
                    />
                  </div>
                )}
                {!isEdit && (
                  <div className="w-20">
                    <label className="label text-xs">Stock</label>
                    <input
                      type="number"
                      className="field h-9"
                      value={v.stock}
                      onChange={(e) => setVariant(i, { stock: e.target.value })}
                    />
                  </div>
                )}
                {variants.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setVariants((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-muted hover:text-ocupada self-center h-9 px-1"
                  >
                    <Icon.trash width={16} height={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="label">Precio del shot</label>
              <MoneyInput className="field" value={recipePrice} onChange={setRecipePrice} />
            </div>

            <div className="flex items-center justify-between">
              <span className="label mb-0">Ingredientes</span>
              <button
                type="button"
                onClick={() => setRecipeItems((prev) => [...prev, { sourceProductId: '', ml: 30 }])}
                className="text-xs font-semibold text-amber flex items-center gap-1"
              >
                <Icon.plus width={14} height={14} /> Agregar
              </button>
            </div>

            {recipeItems.map((item, i) => (
              <div key={i} className="flex flex-wrap gap-2 items-end bg-raised border border-edge rounded-xl p-3">
                <div className="flex-1 min-w-[160px]">
                  <label className="label text-xs">Marca</label>
                  <select
                    className="field h-9"
                    value={item.sourceProductId}
                    onChange={(e) => setIngredient(i, { sourceProductId: e.target.value })}
                  >
                    <option value="">Elige una marca</option>
                    {ingredientOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-20">
                  <label className="label text-xs">ml</label>
                  <input
                    type="number"
                    className="field h-9"
                    value={item.ml}
                    onChange={(e) => setIngredient(i, { ml: e.target.value })}
                  />
                </div>
                {recipeItems.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setRecipeItems((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-muted hover:text-ocupada self-center h-9 px-1"
                  >
                    <Icon.trash width={16} height={16} />
                  </button>
                )}
              </div>
            ))}

            {!ingredientOptions.length && (
              <p className="text-xs text-ocupada">
                No hay ninguna marca que venda por ml todavía. Crea primero la botella (ej: Aguardiente
                Antioqueño) y después el shot.
              </p>
            )}
          </div>
        )}

        <div>
          <label className="label">Imagen</label>
          <div className="flex items-center gap-4">
            <span className="w-20 h-20 rounded-xl grid place-items-center overflow-hidden shrink-0 bg-raised border border-edge">
              {imageUrl ? (
                <img src={imageUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <span
                  className="w-full h-full grid place-items-center text-night font-bold text-lg"
                  style={{ background: category?.color || '#6B7280' }}
                >
                  {name.slice(0, 2).toUpperCase() || '—'}
                </span>
              )}
            </span>
            <label className="btn-ghost cursor-pointer">
              {subiendoImagen ? 'Subiendo…' : imageUrl ? 'Cambiar imagen' : 'Subir imagen'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={subirImagen}
                disabled={subiendoImagen}
              />
            </label>
          </div>
          <p className="text-xs text-muted mt-2">
            Opcional: si no hay imagen, se muestra el nombre sobre el color de la categoría.
          </p>
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost flex-1">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="btn-primary flex-1">
            {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear producto'}
          </button>
        </div>
      </form>
    </div>
  )
}

function tabClass(active) {
  return `flex-1 h-10 rounded-xl text-sm font-semibold border flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
    active ? 'bg-amber text-night border-amber' : 'bg-raised text-muted border-edge hover:text-ink'
  }`
}
