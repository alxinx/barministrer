import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, money } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { categoryTree, flattenCategories } from '../lib/categories'
import { resizeProductImage } from '../lib/image'
import { Icon } from './Icons'
import MoneyInput from './MoneyInput'
import PinField from './PinField'
import { usePinVerificado } from '../hooks/usePinVerificado'
import TicketMermaModal from './TicketMermaModal'

const PASOS = [
  { n: 1, label: 'Información general', subtitle: 'Nombre, categoría e imagen del producto.', icon: Icon.box },
  { n: 2, label: 'Presentación y precio', subtitle: 'Cómo se vende y cuánto cuesta.', icon: Icon.cash },
  { n: 3, label: 'Control de stock', subtitle: 'Stock inicial y aviso de mínimo.', icon: Icon.clipboard },
]

function normalizado(texto) {
  return (texto || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// Mismo nombre ya existente en el catalogo del tenant (sin importar mayus/
// minusculas ni espacios de mas). Esto solo evita el viaje al servidor para
// avisarlo antes: el backend es quien de verdad lo bloquea (ver POST/PATCH
// /products), porque la lista que tiene el navegador puede estar
// desactualizada si alguien mas crea un producto al mismo tiempo.
function nombreRepetido(products, name, excludeId) {
  const norm = normalizado(name)
  if (!norm) return false
  return products.some((p) => p.id !== excludeId && normalizado(p.name) === norm)
}

/**
 * Crea o edita un producto STOCK (presentacion sellada con stock propio:
 * botella, unidad...). Un producto PREPARED (receta: shot, sanduche, cafe)
 * ya no se crea ni se edita aqui -- eso vive en Inventario > Recetas y
 * preparaciones, que ademas arma la composicion con Insumo y calcula costo
 * real. Si este formulario abre un producto PREPARED existente (legado, o
 * creado desde la otra pantalla), solo deja tocar lo general (nombre,
 * categoria, imagen, activo) y manda a esa pantalla para la receta.
 *
 * Crear uno nuevo es un asistente por pasos (igual que InsumoForm): el paso 1
 * pregunta si en realidad es una receta, y si el operador elige eso, este
 * modal se cierra y lo manda a /recetas con lo ya escrito (nombre, categoria,
 * imagen) precargado -- ahi vive de verdad la composicion de ingredientes.
 * Crearlo pide confirmar con el PIN de un encargado justo antes de guardar,
 * igual que ya pide una receta o una merma: la ruta ya exige
 * cajeroEditaCatalogo (ver /productos en App.jsx y adminOnly en
 * api/src/routes/catalog.js), el PIN aqui solo identifica a quien lo autorizo.
 */
export default function ProductoForm({
  categories,
  product,
  products = [],
  initialName,
  onClose,
  onSaved,
  onCategoriaCreada,
}) {
  const { session } = useAuth()
  const navigate = useNavigate()
  const esAdminReal = session?.user.role === 'ADMIN' // nunca delegable: ni cajeroEditaCatalogo lo habilita
  // /recetas pide su propio permiso (cajeroGestionaInventario, distinto de
  // cajeroEditaCatalogo que ya exige /productos): sin esto, un cajero que
  // apenas puede entrar aqui se estrellaria con un redirect silencioso a
  // /venta al intentar "continuar a Recetas" y perderia lo que escribio.
  const puedeCrearRecetas =
    session?.user.role === 'ADMIN' || (session?.user.role === 'CAJERO' && session?.tenant.cajeroGestionaInventario)
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

  // --- Solo para el asistente de "Nuevo producto" (!isEdit) ----------------
  const [modo, setModo] = useState('producto') // 'producto' | 'receta'
  const [step, setStep] = useState(1)
  const [nuevaCategoria, setNuevaCategoria] = useState(false)
  const [nombreCategoria, setNombreCategoria] = useState('')
  const [nuevaCategoriaPadre, setNuevaCategoriaPadre] = useState('')
  const [creandoCategoria, setCreandoCategoria] = useState(false)
  const [confirmandoCrear, setConfirmandoCrear] = useState(false)

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

  // Merma: nunca mas de lo que hay en stock. El backend lo valida otra vez,
  // esto no es mas que no dejar mandar un numero absurdo. Genera su propio
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

  async function crearCategoria() {
    if (!nombreCategoria.trim()) return
    setError('')
    setCreandoCategoria(true)
    try {
      const creada = await api('/categories', {
        method: 'POST',
        body: { name: nombreCategoria.trim(), parentId: nuevaCategoriaPadre || null },
      })
      onCategoriaCreada?.(creada)
      setCategoryId(creada.id)
      setNuevaCategoria(false)
      setNombreCategoria('')
      setNuevaCategoriaPadre('')
    } catch (err) {
      setError(err.message)
    } finally {
      setCreandoCategoria(false)
    }
  }

  const options = useMemo(() => flattenCategories(categoryTree(categories)), [categories])
  const category = categories.find((c) => c.id === categoryId)
  const allowsPour = Boolean(category?.allowsPour)
  const nombreYaExiste = nombreRepetido(products, name, product?.id)

  function setVariant(i, patch) {
    setVariants((prev) => prev.map((v, idx) => (idx === i ? { ...v, ...patch } : v)))
  }

  // --- Edicion de un producto existente ------------------------------------
  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!name.trim()) return setError('El producto necesita un nombre')
    if (nombreYaExiste) return setError(`Ya existe un producto llamado "${name.trim()}"`)
    if (!categoryId) return setError('Elige una categoría')
    if (esPrepared && !pinValido) return setError('Escribe el PIN del encargado para guardar cambios en una receta')

    const body = { name: name.trim(), categoryId, imageUrl: imageUrl || null }
    if (esPrepared) body.pin = pin
    if (!esPrepared) {
      const clean = variants.filter((v) => v.name.trim())
      if (!clean.length) return setError('Agrega al menos una presentación')
      if (allowsPour && clean.some((v) => !v.volumeMl)) {
        return setError('Cada presentación necesita su volumen en ml para poder vender shots')
      }
    }

    setSaving(true)
    try {
      const saved = await api(`/products/${product.id}`, { method: 'PATCH', body })
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
      onSaved(saved)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // --- Asistente para un producto nuevo ------------------------------------
  function errorPaso1() {
    if (!name.trim()) return 'El producto necesita un nombre'
    if (nombreYaExiste) return `Ya existe un producto llamado "${name.trim()}"`
    if (!categoryId) return 'Elige una categoría'
    return ''
  }
  function errorPaso2() {
    const v = variants[0]
    if (!v.name.trim()) return 'Escribe el nombre de la presentación'
    if (allowsPour && !v.volumeMl) return 'Esta presentación necesita su volumen en ml para poder vender shots'
    return ''
  }

  function siguienteDesdePaso1() {
    const err = errorPaso1()
    if (err) return setError(err)
    setError('')
    setStep(2)
  }
  function continuarComoReceta() {
    if (!name.trim()) return setError('Escribe un nombre antes de continuar')
    if (nombreYaExiste) return setError(`Ya existe un producto llamado "${name.trim()}"`)
    setError('')
    navigate('/recetas', {
      state: { prefillReceta: { name: name.trim(), categoryId: categoryId || '', imageUrl: imageUrl || '' } },
    })
  }
  function siguienteDesdePaso2() {
    const err = errorPaso2()
    if (err) return setError(err)
    setError('')
    setStep(3)
  }
  function retrocederPaso() {
    setError('')
    setStep((s) => Math.max(1, s - 1))
  }
  function iniciarCrear() {
    const e1 = errorPaso1()
    if (e1) {
      setStep(1)
      return setError(e1)
    }
    const e2 = errorPaso2()
    if (e2) {
      setStep(2)
      return setError(e2)
    }
    setError('')
    setConfirmandoCrear(true)
  }
  function cancelarCrear() {
    setConfirmandoCrear(false)
    resetPin()
  }

  async function crear() {
    if (!pinValido) return
    const v = variants[0]
    const body = {
      name: name.trim(),
      categoryId,
      imageUrl: imageUrl || null,
      kind: 'STOCK',
      pin,
      variants: [
        {
          name: v.name.trim(),
          price: Number(v.price) || 0,
          cost: Number(v.cost) || 0,
          volumeMl: v.volumeMl ? Number(v.volumeMl) : null,
          stock: Number(v.stock) || 0,
          stockMinimo: v.stockMinimo ? Number(v.stockMinimo) : null,
        },
      ],
    }
    setSaving(true)
    try {
      const saved = await api('/products', { method: 'POST', body })
      onSaved(saved)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // ==========================================================================
  // Editar un producto existente: formulario de una sola pagina, sin cambios
  // de fondo respecto al que ya existia.
  // ==========================================================================
  if (isEdit) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={mermaResultado ? undefined : onClose}>
        <form
          onClick={(e) => e.stopPropagation()}
          onSubmit={submit}
          className="card w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-5"
        >
          <header className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Editar producto</h2>
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
                {nombreYaExiste && (
                  <p className="text-xs text-ocupada mt-1.5">Ya existe un producto con este nombre.</p>
                )}
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
              )}

              {esAdminReal && (
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

              {esAdminReal && permiteEliminar && (
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

              {esAdminReal && !esPrepared && (
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
                  disabled={saving || (esPrepared && !pinValido)}
                  className="btn-primary flex-1"
                >
                  {saving ? 'Guardando…' : 'Guardar cambios'}
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

  // ==========================================================================
  // Producto nuevo: asistente por pasos. "Receta" no se crea aqui: cierra este
  // modal y manda a /recetas con lo ya escrito, sin perderlo.
  // ==========================================================================
  const paso = PASOS[step - 1]

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5 space-y-5">
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Nuevo producto</h2>
            <p className="text-xs text-muted mt-0.5">Registra un producto para venta directa en barra, mesas o caja.</p>
          </div>
          <button type="button" onClick={onClose} className="text-muted hover:text-ink shrink-0">
            <Icon.x />
          </button>
        </header>

        {error && (
          <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
            {error}
          </p>
        )}

        {confirmandoCrear ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Confirma los datos antes de crearlo. Necesita el PIN de un encargado.
            </p>
            <div className="text-sm bg-raised border border-edge rounded-xl p-3 space-y-1.5">
              <p>
                <span className="text-muted">Nombre:</span> <span className="font-medium">{name.trim()}</span>
              </p>
              <p>
                <span className="text-muted">Categoría:</span>{' '}
                <span className="font-medium">{options.find((c) => c.id === categoryId)?.name || '—'}</span>
              </p>
              <p>
                <span className="text-muted">Presentación:</span>{' '}
                <span className="font-medium">{variants[0].name.trim()}</span>
              </p>
              <p>
                <span className="text-muted">Precio de venta:</span>{' '}
                <span className="font-medium">{money(Number(variants[0].price) || 0)}</span>
              </p>
              {Number(variants[0].stock) > 0 && (
                <p>
                  <span className="text-muted">Stock inicial:</span>{' '}
                  <span className="font-medium">{Number(variants[0].stock)}</span>
                </p>
              )}
            </div>
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
              <button type="button" onClick={cancelarCrear} className="btn-ghost flex-1">
                Cancelar
              </button>
              <button type="button" onClick={crear} disabled={saving || !pinValido} className="btn-primary flex-1">
                {saving ? 'Creando…' : 'Confirmar y crear'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row gap-5">
              {/* Igual que InsumoForm: indicador de pasos a la izquierda (arriba
                  en celular), saltable con un clic salvo en modo receta, donde
                  solo el paso 1 aplica porque el resto se arma en /recetas. */}
              <nav className="flex sm:flex-col gap-1.5 sm:w-44 sm:shrink-0 overflow-x-auto sm:overflow-visible">
                {PASOS.map((p) => (
                  <button
                    key={p.n}
                    type="button"
                    disabled={modo === 'receta' && p.n !== 1}
                    onClick={() => setStep(p.n)}
                    className={`flex items-center gap-2.5 shrink-0 text-left px-2.5 py-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      step === p.n ? 'bg-amber/10' : 'hover:bg-raised'
                    }`}
                  >
                    <span
                      className={`w-6 h-6 rounded-full grid place-items-center text-xs font-bold shrink-0 ${
                        step === p.n ? 'bg-amber text-night' : 'bg-raised border border-edge text-muted'
                      }`}
                    >
                      {p.n}
                    </span>
                    <span className={`text-xs leading-tight whitespace-nowrap sm:whitespace-normal ${step === p.n ? 'text-ink font-semibold' : 'text-muted'}`}>
                      {p.label}
                    </span>
                  </button>
                ))}
              </nav>

              <div className="flex-1 min-w-0 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <paso.icon width={16} height={16} className="text-amberText shrink-0" />
                  <span>
                    {step}. {paso.label}
                  </span>
                </div>
                <p className="text-xs text-muted -mt-2">{paso.subtitle}</p>

                {step === 1 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-4">
                      <span className="w-16 h-16 rounded-xl grid place-items-center overflow-hidden shrink-0 bg-raised border border-edge">
                        {imageUrl ? (
                          <img src={imageUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Icon.box width={22} height={22} className="text-muted" />
                        )}
                      </span>
                      <label className="btn-ghost cursor-pointer text-sm">
                        {subiendoImagen ? 'Subiendo…' : imageUrl ? 'Cambiar imagen' : 'Subir imagen'}
                        <input type="file" accept="image/*" className="hidden" onChange={subirImagen} disabled={subiendoImagen} />
                      </label>
                    </div>

                    <div>
                      <label className="label">Nombre del producto</label>
                      <input
                        className="field"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ej: Aguardiente Antioqueño Azul 750ml"
                        autoFocus
                      />
                      {nombreYaExiste && (
                        <p className="text-xs text-ocupada mt-1.5">Ya existe un producto con este nombre.</p>
                      )}
                    </div>

                    <div>
                      <label className="label">Categoría</label>
                      {nuevaCategoria ? (
                        <div className="space-y-2 bg-raised border border-edge rounded-xl p-3">
                          <div className="flex gap-2">
                            <input
                              className="field h-9 flex-1"
                              value={nombreCategoria}
                              onChange={(e) => setNombreCategoria(e.target.value)}
                              placeholder="Ej: Licores"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setNuevaCategoria(false)
                                setNombreCategoria('')
                                setNuevaCategoriaPadre('')
                              }}
                              className="text-muted hover:text-ink px-1"
                            >
                              <Icon.x width={16} height={16} />
                            </button>
                          </div>
                          <div className="flex gap-2">
                            <select
                              className="field h-9 flex-1"
                              value={nuevaCategoriaPadre}
                              onChange={(e) => setNuevaCategoriaPadre(e.target.value)}
                            >
                              <option value="">Ninguna · categoría principal</option>
                              {categories
                                .filter((c) => !c.parentId)
                                .map((c) => (
                                  <option key={c.id} value={c.id}>
                                    Subcategoría de {c.name}
                                  </option>
                                ))}
                            </select>
                            <button
                              type="button"
                              onClick={crearCategoria}
                              disabled={creandoCategoria || !nombreCategoria.trim()}
                              className="btn-ghost h-9 px-3 text-sm whitespace-nowrap"
                            >
                              {creandoCategoria ? 'Creando…' : 'Crear'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <select className="field flex-1" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
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
                          <button type="button" onClick={() => setNuevaCategoria(true)} className="btn-ghost h-10 px-3 text-xs whitespace-nowrap">
                            <Icon.plus width={14} height={14} /> Nueva
                          </button>
                        </div>
                      )}
                      <p className="text-xs text-muted mt-1.5">Propia de venta: no se mezcla con las categorías de insumos de bodega.</p>
                    </div>

                    <div>
                      <span className="label mb-0">¿Qué estás registrando?</span>
                      <div className="grid grid-cols-2 gap-2 mt-1.5">
                        <button
                          type="button"
                          onClick={() => setModo('producto')}
                          className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                            modo === 'producto' ? 'border-amber bg-amber/10' : 'border-edge hover:border-muted'
                          }`}
                        >
                          <Icon.box width={16} height={16} className={`mt-0.5 shrink-0 ${modo === 'producto' ? 'text-amberText' : 'text-muted'}`} />
                          <span>
                            <span className="block text-sm font-semibold">Producto real</span>
                            <span className="block text-xs text-muted">Presentación sellada con su propio stock</span>
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => puedeCrearRecetas && setModo('receta')}
                          disabled={!puedeCrearRecetas}
                          title={puedeCrearRecetas ? undefined : 'No tienes permiso para crear recetas'}
                          className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                            modo === 'receta' ? 'border-amber bg-amber/10' : 'border-edge hover:border-muted'
                          }`}
                        >
                          <Icon.glass width={16} height={16} className={`mt-0.5 shrink-0 ${modo === 'receta' ? 'text-amberText' : 'text-muted'}`} />
                          <span>
                            <span className="block text-sm font-semibold">Receta</span>
                            <span className="block text-xs text-muted">Shot, cóctel o preparación con ingredientes</span>
                          </span>
                        </button>
                      </div>
                      {modo === 'receta' && (
                        <p className="text-xs text-muted mt-2">
                          Sus ingredientes y costo real se arman en Inventario → Recetas y preparaciones. Al
                          continuar se cierra este modal y se abre ese editor con lo que ya escribiste aquí.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2 items-end bg-raised border border-edge rounded-xl p-3">
                      <div className="flex-1 min-w-[140px]">
                        <label className="label text-xs">Presentación</label>
                        <input
                          className="field h-9"
                          value={variants[0].name}
                          onChange={(e) => setVariant(0, { name: e.target.value })}
                          placeholder="Botella 750ml"
                          autoFocus
                        />
                      </div>
                      <div className="w-28">
                        <label className="label text-xs">Precio venta</label>
                        <MoneyInput className="field h-9" value={variants[0].price} onChange={(val) => setVariant(0, { price: val })} />
                      </div>
                      <div className="w-28">
                        <label className="label text-xs">Costo est.</label>
                        <MoneyInput className="field h-9" value={variants[0].cost} onChange={(val) => setVariant(0, { cost: val })} />
                      </div>
                      {allowsPour && (
                        <div className="w-20">
                          <label className="label text-xs">ml</label>
                          <input
                            type="number"
                            className="field h-9"
                            value={variants[0].volumeMl}
                            onChange={(e) => setVariant(0, { volumeMl: e.target.value })}
                          />
                        </div>
                      )}
                    </div>
                    {allowsPour && (
                      <p className="text-xs text-muted">
                        Esta categoría vende por ml: el volumen define cuántos shots salen de cada unidad.
                      </p>
                    )}
                  </div>
                )}

                {step === 3 && (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="label text-xs">Alerta stock mínimo</label>
                        <input
                          type="number"
                          min="0"
                          className="field h-9"
                          value={variants[0].stockMinimo}
                          onChange={(e) => setVariant(0, { stockMinimo: e.target.value })}
                          placeholder="Sin avisar"
                          autoFocus
                        />
                      </div>
                      {esAdminReal && (
                        <div className="flex-1">
                          <label className="label text-xs">Stock inicial</label>
                          <input
                            type="number"
                            className="field h-9"
                            value={variants[0].stock}
                            onChange={(e) => setVariant(0, { stock: e.target.value })}
                            placeholder="0"
                          />
                        </div>
                      )}
                    </div>
                    {!esAdminReal && (
                      <p className="text-xs text-muted">
                        Solo un administrador puede registrar el stock inicial. El producto nace en 0 y se ajusta
                        después desde inventario.
                      </p>
                    )}
                    {Number(variants[0].stock) > 0 && (
                      <p className="text-xs text-muted">
                        El stock inicial queda en el historial como un ajuste, con el PIN del encargado que lo
                        confirme.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              {step === 1 ? (
                <button type="button" onClick={onClose} className="btn-ghost flex-1">
                  Cancelar
                </button>
              ) : (
                <button type="button" onClick={retrocederPaso} className="btn-ghost flex-1">
                  <Icon.chevronLeft width={14} height={14} /> Atrás
                </button>
              )}

              {step === 1 ? (
                modo === 'receta' ? (
                  <button type="button" onClick={continuarComoReceta} className="btn-primary flex-1">
                    Continuar a Recetas →
                  </button>
                ) : (
                  <button type="button" onClick={siguienteDesdePaso1} className="btn-primary flex-1">
                    Siguiente →
                  </button>
                )
              ) : step === 2 ? (
                <button type="button" onClick={siguienteDesdePaso2} className="btn-primary flex-1">
                  Siguiente →
                </button>
              ) : (
                <button type="button" onClick={iniciarCrear} className="btn-primary flex-1">
                  Crear producto
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
