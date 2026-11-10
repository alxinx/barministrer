import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { categoryTree, flattenCategories } from '../lib/categories'
import { resizeProductImage } from '../lib/image'
import { Icon } from './Icons'
import MoneyInput from './MoneyInput'
import PinField from './PinField'
import { usePinVerificado } from '../hooks/usePinVerificado'
import TicketMermaModal from './TicketMermaModal'

/**
 * Crea o edita un producto STOCK (presentacion sellada con stock propio:
 * botella, unidad...). Un producto PREPARED (receta: shot, sanduche, cafe)
 * ya no se crea ni se edita aqui -- eso vive en Inventario > Recetas y
 * preparaciones, que ademas arma la composicion con Insumo y calcula costo
 * real. Si este formulario abre un producto PREPARED existente (legado, o
 * creado desde la otra pantalla), solo deja tocar lo general (nombre,
 * categoria, imagen, activo) y manda a esa pantalla para la receta.
 */
export default function ProductoForm({ categories, product, initialName, onClose, onSaved }) {
  const { session } = useAuth()
  const esAdminReal = session?.user.role === 'ADMIN' // nunca delegable: ni cajeroEditaCatalogo lo habilita
  const isEdit = Boolean(product)
  const esPrepared = product?.kind === 'PREPARED'
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
          stockMinimo: v.stockMinimo ?? '',
        }))
      : [{ name: '', price: '', cost: '', volumeMl: '', stock: '', stockMinimo: '' }]
  )
  const [imageUrl, setImageUrl] = useState(product?.imageUrl || '')
  const [subiendoImagen, setSubiendoImagen] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmandoSuspender, setConfirmandoSuspender] = useState(false)
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false)
  const permiteEliminar = Boolean(session?.tenant.permiteEliminarProductos)
  const {
    pin,
    setPin,
    valido: pinValido,
    verificando: verificandoPin,
    error: pinError,
    bloqueado: pinBloqueado,
    segundosRestantes: pinSegundosRestantes,
    reset: resetPin,
  } = usePinVerificado()
  const [confirmandoMerma, setConfirmandoMerma] = useState(false)
  const [mermaVariantId, setMermaVariantId] = useState(product?.variants?.[0]?.id || '')
  const [mermaQty, setMermaQty] = useState('')
  const [mermaReason, setMermaReason] = useState('')
  const [mermaResultado, setMermaResultado] = useState(null)
  const variantesConStock = product?.variants || []
  const mermaVariant = variantesConStock.find((v) => v.id === mermaVariantId)
  const mermaExcedeStock = Boolean(mermaVariant && mermaQty && Number(mermaQty) > mermaVariant.stock)

  // Suspender es el PATCH active=false que ya filtra disponibilidad en
  // ventas (producto.active && categoria.active). Sale de todos los pedidos
  // de inmediato, por eso es solo del ADMIN real (no delegable) y pide PIN
  // como anular un item.
  async function suspender() {
    if (!pinValido) return
    setError('')
    setSaving(true)
    try {
      const saved = await api(`/products/${product.id}/suspend`, {
        method: 'PATCH',
        body: { active: !product.active, pin },
      })
      onSaved(saved)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  // Eliminar nunca es un DELETE de verdad (rompería el rastro de pedidos que
  // ya referencian este producto): es Product.deletedAt, que lo saca del
  // todo de /productos -- a diferencia de suspender, que lo deja ahi marcado
  // como suspendido. Solo existe si la plataforma le prendió
  // permiteEliminarProductos a este tenant, y solo plataforma lo puede
  // restaurar despues (ver /plataforma/tenants/:id).
  async function eliminar() {
    if (!pinValido) return
    setError('')
    setSaving(true)
    try {
      await api(`/products/${product.id}`, { method: 'DELETE', body: { pin } })
      onSaved()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  // Merma: nunca mas de lo que hay en stock (el backend lo valida otra vez,
  // esto no es mas que no dejar mandar un numero absurdo). Genera su propio
  // egreso de caja menor por el costo, no por el precio de venta.
  async function registrarMerma() {
    if (!mermaVariantId || !mermaQty || !mermaReason.trim() || !pinValido) return
    setError('')
    setSaving(true)
    try {
      const resultado = await api(`/variants/${mermaVariantId}/waste`, {
        method: 'POST',
        body: { qty: Number(mermaQty), reason: mermaReason.trim(), pin },
      })
      setMermaResultado(resultado)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

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
  const tieneStockInicial = !isEdit && !esPrepared && variants.some((variant) => Number(variant.stock) > 0)

  function setVariant(i, patch) {
    setVariants((prev) => prev.map((v, idx) => (idx === i ? { ...v, ...patch } : v)))
  }

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!name.trim()) return setError('El producto necesita un nombre')
    if (!categoryId) return setError('Elige una categoría')
    if (esPrepared && !pinValido) return setError('Escribe el PIN del encargado para guardar cambios en una receta')
    if (tieneStockInicial && !pinValido) return setError('Escribe el PIN del encargado para registrar el stock inicial')

    const body = { name: name.trim(), categoryId, imageUrl: imageUrl || null }
    if (esPrepared || tieneStockInicial) body.pin = pin
    if (!esPrepared) {
      const clean = variants.filter((v) => v.name.trim())
      if (!clean.length) return setError('Agrega al menos una presentación')
      if (allowsPour && clean.some((v) => !v.volumeMl)) {
        return setError('Cada presentación necesita su volumen en ml para poder vender shots')
      }
      body.kind = 'STOCK'
    }

    setSaving(true)
    try {
      let saved
      if (isEdit) {
        saved = await api(`/products/${product.id}`, { method: 'PATCH', body })
        if (!esPrepared) {
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
              stockMinimo: v.stockMinimo ? Number(v.stockMinimo) : null,
            }
            if (v.id) await api(`/variants/${v.id}`, { method: 'PATCH', body: payload })
            else await api(`/products/${product.id}/variants`, { method: 'POST', body: payload })
          }
        }
      } else {
        body.variants = variants
          .filter((v) => v.name.trim())
          .map((v) => ({
            name: v.name.trim(),
            price: Number(v.price) || 0,
            cost: Number(v.cost) || 0,
            volumeMl: v.volumeMl ? Number(v.volumeMl) : null,
            stock: Number(v.stock) || 0,
            stockMinimo: v.stockMinimo ? Number(v.stockMinimo) : null,
          }))
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
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={mermaResultado ? undefined : onClose}>
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

        {confirmandoSuspender ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              {product.active
                ? `¿Suspender "${product.name}"? Desaparece de todos los pedidos de inmediato. Necesita el PIN del encargado.`
                : `¿Reactivar "${product.name}"? Vuelve a aparecer en los pedidos. Necesita el PIN del encargado.`}
            </p>
            <PinField
              pin={pin}
              onChange={setPin}
              verificando={verificandoPin}
              error={pinError}
              bloqueado={pinBloqueado}
              segundosRestantes={pinSegundosRestantes}
              autoFocus
            />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setConfirmandoSuspender(false)
                  resetPin()
                  setError('')
                }}
                className="btn-ghost flex-1"
              >
                Cancelar
              </button>
              <button type="button" onClick={suspender} disabled={saving || !pinValido} className="btn-danger flex-1">
                {saving ? 'Guardando…' : product.active ? 'Suspender' : 'Reactivar'}
              </button>
            </div>
          </div>
        ) : confirmandoEliminar ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              ¿Eliminar "{product.name}"? Desaparece por completo de /productos, no solo de la venta. Esto no lo
              puedes deshacer tú mismo: solo plataforma puede restaurarlo. Necesita el PIN del encargado.
            </p>
            <PinField
              pin={pin}
              onChange={setPin}
              verificando={verificandoPin}
              error={pinError}
              bloqueado={pinBloqueado}
              segundosRestantes={pinSegundosRestantes}
              autoFocus
            />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setConfirmandoEliminar(false)
                  resetPin()
                  setError('')
                }}
                className="btn-ghost flex-1"
              >
                Cancelar
              </button>
              <button type="button" onClick={eliminar} disabled={saving || !pinValido} className="btn-danger flex-1">
                {saving ? 'Eliminando…' : 'Eliminar producto'}
              </button>
            </div>
          </div>
        ) : confirmandoMerma ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Registra una merma o pérdida. Nunca más de lo que hay en stock. Queda como egreso de
              caja menor por el costo (no el precio de venta) e imprime un comprobante.
            </p>

            {variantesConStock.length > 1 && (
              <div>
                <label className="label">Presentación</label>
                <select
                  className="field"
                  value={mermaVariantId}
                  onChange={(e) => setMermaVariantId(e.target.value)}
                >
                  {variantesConStock.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} · quedan {v.stock}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex gap-3 items-stretch">
              <div className="w-28 shrink-0">
                <label className="label text-center block min-h-[2.5rem] leading-tight">
                  Cantidad a eliminar {mermaVariant ? `(hay ${mermaVariant.stock})` : ''}
                </label>
                <input
                  type="number"
                  min="1"
                  max={mermaVariant?.stock || undefined}
                  value={mermaQty}
                  onChange={(e) => setMermaQty(e.target.value)}
                  autoFocus
                  className={`w-full h-28 text-center text-4xl font-bold rounded-2xl bg-raised border-2
                             text-ink focus:outline-none [appearance:textfield]
                             [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                               mermaExcedeStock ? 'border-ocupada' : 'border-amber'
                             }`}
                />
                {mermaExcedeStock && (
                  <p className="text-xs text-ocupada mt-1.5 text-center">Solo hay {mermaVariant.stock}</p>
                )}
              </div>
              <div className="flex-1">
                <label className="label min-h-[2.5rem] leading-tight flex items-end">Razón o motivo</label>
                <textarea
                  className="field h-28 resize-none"
                  value={mermaReason}
                  onChange={(e) => setMermaReason(e.target.value)}
                  placeholder="Se rompió al bajarla de la nevera"
                />
              </div>
            </div>

            <PinField
              pin={pin}
              onChange={setPin}
              verificando={verificandoPin}
              error={pinError}
              bloqueado={pinBloqueado}
              segundosRestantes={pinSegundosRestantes}
            />

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setConfirmandoMerma(false)
                  resetPin()
                  setMermaQty('')
                  setMermaReason('')
                  setError('')
                }}
                className="btn-ghost flex-1"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={registrarMerma}
                disabled={saving || !pinValido || !mermaQty || !mermaReason.trim() || mermaExcedeStock}
                className="btn-danger flex-1"
              >
                {saving ? 'Guardando…' : 'Registrar merma'}
              </button>
            </div>
          </div>
        ) : (
          <>
        <div>
          <label className="label">Categoría</label>
          <select className="field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="" disabled hidden>
              Elige una categoría
            </option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {'— '.repeat(c.depth)}
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

        {esPrepared ? (
          <div className="space-y-3">
            <p className="text-xs text-muted bg-raised border border-edge rounded-xl px-3 py-2.5">
              Este producto tiene receta. Sus ingredientes, precio y costo se editan en{' '}
              <Link to="/recetas" className="text-amberText font-medium" onClick={onClose}>
                Inventario → Recetas y preparaciones
              </Link>
              . Cualquier cambio aquí, incluido el nombre, necesita el PIN del encargado.
            </p>
            <PinField
              pin={pin}
              onChange={setPin}
              verificando={verificandoPin}
              error={pinError}
              bloqueado={pinBloqueado}
              segundosRestantes={pinSegundosRestantes}
            />
          </div>
        ) : (
          <div className="space-y-3">
            {/* Un producto es una sola presentacion: media, botella y garrafa
                del mismo licor son productos separados, no variantes de uno
                solo. Por eso no hay boton para agregar otra. */}
            <span className="label mb-0">Presentación</span>

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
                <div className="w-24">
                  <label className="label text-xs">Stock mínimo</label>
                  <input
                    type="number"
                    min="0"
                    className="field h-9"
                    value={v.stockMinimo}
                    onChange={(e) => setVariant(i, { stockMinimo: e.target.value })}
                    placeholder="Sin avisar"
                  />
                </div>
                {!isEdit && esAdminReal && (
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
            {tieneStockInicial && (
              <div className="space-y-2">
                <p className="text-xs text-muted">
                  El stock inicial quedará en el historial como ajuste y requiere autorización de un encargado.
                </p>
                <PinField
                  pin={pin}
                  onChange={setPin}
                  verificando={verificandoPin}
                  error={pinError}
                  bloqueado={pinBloqueado}
                  segundosRestantes={pinSegundosRestantes}
                />
              </div>
            )}
          </div>
        )}

        {isEdit && esAdminReal && (
          <div className="flex items-center justify-between bg-raised border border-edge rounded-xl p-3">
            <div>
              <p className="text-sm font-medium">{product.active ? 'Activo' : 'Suspendido'}</p>
              <p className="text-xs text-muted">
                {product.active
                  ? 'Suspenderlo lo quita de los pedidos sin borrar nada. Se reactiva cuando quieras.'
                  : 'No aparece en ningún pedido ni se puede vender.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmandoSuspender(true)}
              disabled={saving}
              className={`btn-ghost shrink-0 ${product.active ? 'text-ocupada' : 'text-libre'}`}
            >
              {product.active ? 'Suspender producto' : 'Reactivar producto'}
            </button>
          </div>
        )}

        {isEdit && esAdminReal && permiteEliminar && (
          <div className="flex items-center justify-between bg-raised border border-edge rounded-xl p-3">
            <div>
              <p className="text-sm font-medium">Eliminar</p>
              <p className="text-xs text-muted">
                Desaparece por completo de /productos, a diferencia de suspender. Solo plataforma puede
                recuperarlo después.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmandoEliminar(true)}
              disabled={saving}
              className="btn-ghost shrink-0 text-ocupada"
            >
              Eliminar producto
            </button>
          </div>
        )}

        {isEdit && esAdminReal && !esPrepared && (
          <div className="flex items-center justify-between bg-raised border border-edge rounded-xl p-3">
            <div>
              <p className="text-sm font-medium">Merma o pérdida</p>
              <p className="text-xs text-muted">Unidades rotas, vencidas o que no se van a vender.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setMermaVariantId(variantesConStock[0]?.id || '')
                resetPin()
                setMermaQty('')
                setMermaReason('')
                setConfirmandoMerma(true)
              }}
              disabled={saving || !variantesConStock.length}
              className="btn-ghost shrink-0 text-ocupada"
            >
              Registrar merma
            </button>
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
          <button
            type="submit"
            disabled={saving || ((esPrepared || tieneStockInicial) && !pinValido)}
            className="btn-primary flex-1"
          >
            {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear producto'}
          </button>
        </div>
          </>
        )}
      </form>

      {mermaResultado && (
        <TicketMermaModal
          merma={mermaResultado}
          tenant={session?.tenant}
          onClose={() => {
            setMermaResultado(null)
            onSaved()
          }}
        />
      )}
    </div>
  )
}
