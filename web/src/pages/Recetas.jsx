import { useEffect, useMemo, useState } from 'react'
import { api, money } from '../lib/api'
import { getCategories, invalidateCategories } from '../lib/categoriesStore'
import { categoryTree, flattenCategories } from '../lib/categories'
import { resizeProductImage } from '../lib/image'
import { unidadesDisponibles } from '../lib/recetas'
import { useAuth } from '../context/AuthContext'
import { Icon } from '../components/Icons'
import PinField from '../components/PinField'
import MoneyInput from '../components/MoneyInput'
import CategoriaForm from '../components/CategoriaForm'
import InsumoForm from '../components/InsumoForm'
import { usePinVerificado } from '../hooks/usePinVerificado'

// Cuanto cuesta 1 unidadInventario de un insumo: costoCompra es el costo de
// 1 unidadCompra, factorConversion dice cuantas unidadInventario hay en esa
// unidadCompra (misma logica que api/src/lib/unidades.js, pero aqui solo
// para la vista previa instantanea -- el costo que de verdad manda siempre
// viene recalculado del servidor en cada guardado).
function factorConversion(unidades, unidadCompra, unidadInventario) {
  const compra = unidades.find((u) => u.codigo === unidadCompra)
  const inv = unidades.find((u) => u.codigo === unidadInventario)
  if (!compra || !inv || compra.magnitud !== inv.magnitud) return null
  if (compra.factor == null || inv.factor == null) return null
  return compra.factor / inv.factor
}
function costoUnitario(insumo, unidades) {
  // Insumo sin conversion fija (se compra por unidad o por paquete sin un
  // tamano universal, ej. lechugas por unidad o pan por paquete, y se
  // cuenta en otra magnitud/cantidad): no hay conversion fija, asi que el
  // promedio declarado a mano hace de factor.
  let factor = factorConversion(unidades, insumo.unidadCompra, insumo.unidadInventario)
  if (factor === null && insumo.cantidadPromedioPorUnidad) factor = Number(insumo.cantidadPromedioPorUnidad)
  return factor ? Number(insumo.costoCompra) / factor : 0
}
function nombreUnidad(codigo, unidades) {
  return unidades.find((u) => u.codigo === codigo)?.nombre.split(' ')[0] || codigo
}

const TABS = [
  { n: 1, label: 'Información general' },
  { n: 2, label: 'Receta y costos' },
  { n: 3, label: 'Variantes y complementos' },
]

export default function Recetas() {
  const { session } = useAuth()
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [insumos, setInsumos] = useState([])
  const [categoriasInsumo, setCategoriasInsumo] = useState([])
  const [unidades, setUnidades] = useState([])
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(undefined) // undefined = nada, 'new' = creando, id = editando

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const [p, c, i, ci, u] = await Promise.all([
      api('/products'),
      getCategories(session?.tenant.id),
      api('/insumos'),
      api('/insumo-categorias'),
      api('/insumos/unidades'),
    ])
    setProducts(p)
    setCategories(c)
    setInsumos(i)
    setCategoriasInsumo(ci)
    setUnidades(u)
  }

  const recetas = useMemo(() => {
    const term = search.trim().toLowerCase()
    return products
      .filter((p) => p.kind === 'PREPARED')
      .filter((p) => !term || p.name.toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [products, search])

  const selected = selectedId && selectedId !== 'new' ? products.find((p) => p.id === selectedId) : null

  // Espera a que recargue la lista ANTES de seleccionar: si no, selectedId
  // cambia con `products` todavia desactualizado, el RecetaEditor remonta
  // (cambia la key) sin encontrar el producto recien creado/guardado en esa
  // lista vieja, y arranca vacio como si fuera "Nueva receta" otra vez.
  async function alGuardar(saved) {
    await load()
    setSelectedId(saved.id)
  }

  // Igual que onCategoriaCreada en InsumoForm: la categoria recien creada se
  // suma a la lista en memoria (para que aparezca ya seleccionada sin
  // esperar otro round-trip) y se invalida el cache compartido para que el
  // resto de pantallas (Productos, etc.) la vean la proxima vez que lo pidan.
  function categoriaCreada(categoria) {
    setCategories((prev) => [...prev, categoria])
    invalidateCategories()
  }

  // Insumo/categoria de insumo matriculados al vuelo desde el buscador de
  // ingredientes (ver "¿No lo encuentras? Matricúlalo" en RecetaEditor, mismo
  // patron que Compras.jsx): se suman a la lista en memoria para que
  // aparezcan ya mismo, sin esperar otro round-trip.
  function onInsumoCreado(i) {
    setInsumos((prev) => [...prev, i])
  }
  function onCategoriaInsumoCreada(c) {
    setCategoriasInsumo((prev) => [...prev, c])
  }

  return (
    <div className="p-5 md:p-7 max-w-[1500px] mx-auto">
      <header className="mb-6">
        <p className="text-xs text-muted mb-1">Inventario &gt; Recetas y preparaciones</p>
        <h1 className="text-2xl font-bold">Recetas y preparaciones</h1>
        <p className="text-muted text-sm mt-1">Define la composición de tus productos.</p>
      </header>

      {/* Dos columnas solo desde xl (1280px): a 1024px (lg) el editor de
          receta quedaba demasiado angosto. Abajo de xl, el editor (nueva
          receta o una existente) se abre como modal en vez de apretarse al
          lado de la lista -- mismo patron que /compras. */}
      <div className="grid grid-cols-1 xl:grid-cols-[300px_1fr] xl:gap-5 items-start">
        <div className="card p-4 space-y-3">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
              <Icon.search />
            </span>
            <input
              className="field pl-10"
              placeholder="Buscar receta…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
            {recetas.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                className={`w-full flex items-center gap-2.5 text-left p-2.5 rounded-xl border transition-colors ${
                  selectedId === p.id ? 'bg-amber/10 border-amber/40' : 'bg-raised border-edge hover:border-amber/30'
                }`}
              >
                <span className="w-10 h-10 rounded-lg overflow-hidden shrink-0 grid place-items-center bg-canvas border border-edge">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Icon.box width={16} height={16} className="text-muted" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="text-xs text-muted">{money(p.recipe?.price || 0)}</p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`w-2 h-2 rounded-full ${p.available ? 'bg-libre' : 'bg-muted'}`} />
                  {(() => {
                    const alcanza = unidadesDisponibles(p.recipe?.items)
                    if (alcanza === null) return null
                    return (
                      <span
                        className={`text-[10px] font-semibold whitespace-nowrap ${
                          alcanza === 0 ? 'text-ocupada' : alcanza <= 3 ? 'text-amberText' : 'text-muted'
                        }`}
                      >
                        {alcanza === 0 ? 'Sin stock' : `${alcanza} und.`}
                      </span>
                    )
                  })()}
                </div>
              </button>
            ))}
            {recetas.length === 0 && (
              <p className="text-xs text-muted text-center py-6">
                {products.some((p) => p.kind === 'PREPARED') ? 'No hay recetas con ese filtro.' : 'Todavía no hay recetas.'}
              </p>
            )}
          </div>

          <button type="button" onClick={() => setSelectedId('new')} className="btn-primary w-full">
            <Icon.plus width={16} height={16} /> Nueva receta
          </button>
        </div>

        {selectedId === undefined ? (
          <div className="hidden xl:block card p-10 text-center text-muted text-sm">
            Elige una receta de la lista, o crea una nueva.
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setSelectedId(undefined)}
              className="xl:hidden fixed top-4 right-4 z-[60] w-9 h-9 rounded-full bg-raised border border-edge
                         grid place-items-center text-muted hover:text-ink"
            >
              <Icon.x width={16} height={16} />
            </button>
            <div
              className="fixed inset-0 z-50 bg-black/60 p-4 overflow-y-auto
                         xl:static xl:inset-auto xl:z-auto xl:bg-transparent xl:p-0 xl:overflow-visible"
            >
              <div className="max-w-5xl mx-auto xl:max-w-none xl:mx-0">
                <RecetaEditor
                  key={selectedId}
                  product={selected}
                  categories={categories}
                  insumos={insumos}
                  categoriasInsumo={categoriasInsumo}
                  unidades={unidades}
                  onCreated={alGuardar}
                  onSaved={alGuardar}
                  onCategoriaCreada={categoriaCreada}
                  onInsumoCreado={onInsumoCreado}
                  onCategoriaInsumoCreada={onCategoriaInsumoCreada}
                  onCancel={() => setSelectedId(undefined)}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function RecetaEditor({
  product,
  categories,
  insumos,
  categoriasInsumo,
  unidades,
  onCreated,
  onSaved,
  onCategoriaCreada,
  onInsumoCreado,
  onCategoriaInsumoCreada,
  onCancel,
}) {
  const { session } = useAuth()
  const esAdminReal = session?.user.role === 'ADMIN'
  const esNueva = !product
  const [tab, setTab] = useState(1)

  const [name, setName] = useState(product?.name || '')
  const [categoryId, setCategoryId] = useState(product?.categoryId || '')
  const [description, setDescription] = useState(product?.description || '')
  const [price, setPrice] = useState(product?.recipe?.price || '')
  const [imageUrl, setImageUrl] = useState(product?.imageUrl || '')
  const [subiendoImagen, setSubiendoImagen] = useState(false)

  const [items, setItems] = useState(
    (product?.recipe?.items || []).filter((i) => i.insumoId).map((i) => ({ insumo: i.insumo, qty: i.qty }))
  )
  const [buscarInsumo, setBuscarInsumo] = useState('')
  // Nombre con el que se abre el modal de "matricular insumo" (null =
  // cerrado) -- igual que en Compras.jsx, precargado con lo ya escrito.
  const [matriculandoInsumo, setMatriculandoInsumo] = useState(null)

  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmandoSuspender, setConfirmandoSuspender] = useState(false)
  const [confirmandoGuardar, setConfirmandoGuardar] = useState(false)
  const [agregandoCategoria, setAgregandoCategoria] = useState(false)
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

  const options = useMemo(() => flattenCategories(categoryTree(categories)), [categories])

  // Que cambio de verdad contra lo que ya estaba guardado -- null en "Nueva
  // receta" (ahi no hay un "antes" contra que comparar). El boton "Guardar
  // cambios" solo aparece si esta lista no esta vacia, y el modal de PIN
  // lista exactamente esto para que el encargado sepa que esta autorizando.
  const cambios = useMemo(() => {
    if (esNueva) return null
    const lista = []
    if (name.trim() !== product.name) {
      lista.push({ campo: 'Nombre', antes: product.name, despues: name.trim() })
    }
    if (categoryId !== product.categoryId) {
      lista.push({
        campo: 'Categoría',
        antes: options.find((c) => c.id === product.categoryId)?.name || '—',
        despues: options.find((c) => c.id === categoryId)?.name || '—',
      })
    }
    const descOriginal = product.description || ''
    if (description.trim() !== descOriginal) {
      lista.push({ campo: 'Descripción', antes: descOriginal || '(vacía)', despues: description.trim() || '(vacía)' })
    }
    if ((imageUrl || '') !== (product.imageUrl || '')) {
      lista.push({
        campo: 'Imagen',
        antes: product.imageUrl ? 'Con imagen' : 'Sin imagen',
        despues: imageUrl ? 'Con imagen' : 'Sin imagen',
      })
    }
    if (Number(price) !== Number(product.recipe?.price || 0)) {
      lista.push({
        campo: 'Precio de venta',
        antes: money(Number(product.recipe?.price || 0)),
        despues: money(Number(price) || 0),
      })
    }

    const originales = (product.recipe?.items || []).filter((i) => i.insumoId)
    const porIdOriginal = new Map(originales.map((i) => [i.insumoId, Number(i.qty)]))
    const porIdActual = new Map(items.map((it) => [it.insumo.id, Number(it.qty)]))
    for (const it of items) {
      const antes = porIdOriginal.get(it.insumo.id)
      if (antes === undefined) {
        lista.push({ campo: 'Ingrediente agregado', despues: `${it.insumo.name} · ${it.qty} ${it.insumo.unidadInventario}` })
      } else if (antes !== Number(it.qty)) {
        lista.push({
          campo: 'Cantidad de ' + it.insumo.name,
          antes: `${antes} ${it.insumo.unidadInventario}`,
          despues: `${it.qty} ${it.insumo.unidadInventario}`,
        })
      }
    }
    for (const i of originales) {
      if (!porIdActual.has(i.insumoId)) {
        lista.push({ campo: 'Ingrediente quitado', antes: i.insumo?.name || 'Insumo' })
      }
    }
    return lista
  }, [esNueva, product, name, categoryId, description, imageUrl, price, items, options])

  const hayCambios = esNueva || cambios.length > 0

  const coincidencias = useMemo(() => {
    const term = buscarInsumo.trim().toLowerCase()
    if (!term) return []
    const yaAgregados = new Set(items.map((it) => it.insumo.id))
    return insumos.filter((i) => i.name.toLowerCase().includes(term) && !yaAgregados.has(i.id)).slice(0, 6)
  }, [buscarInsumo, insumos, items])

  const costoTotal = items.reduce((sum, it) => sum + costoUnitario(it.insumo, unidades) * Number(it.qty || 0), 0)
  const precioNum = Number(price) || 0
  const margen = precioNum - costoTotal
  const margenPct = precioNum > 0 ? (margen / precioNum) * 100 : 0
  const pctIngredientes = precioNum > 0 ? (costoTotal / precioNum) * 100 : 0

  function agregarInsumo(insumo) {
    setItems((prev) => [...prev, { insumo, qty: 1 }])
    setBuscarInsumo('')
  }
  function setQty(insumoId, qty) {
    setItems((prev) => prev.map((it) => (it.insumo.id === insumoId ? { ...it, qty } : it)))
  }
  function quitarItem(insumoId) {
    setItems((prev) => prev.filter((it) => it.insumo.id !== insumoId))
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

  async function suspender() {
    if (!pinValido) return
    setSaving(true)
    try {
      const saved = await api(`/products/${product.id}/suspend`, {
        method: 'PATCH',
        body: { active: !product.active, pin },
      })
      setConfirmandoSuspender(false)
      resetPin()
      await onSaved(saved)
    } catch (err) {
      setError(err.message)
    } finally {
      // finally, no solo en el catch: onSaved no remonta este componente (el
      // id seleccionado no cambia al suspender), asi que si solo se apagaba
      // en el catch, el boton "Guardar cambios" se quedaba en "Guardando…"
      // para siempre despues de un suspender/reactivar exitoso.
      setSaving(false)
    }
  }

  // Compartidas entre "Guardar"/"Crear receta" y los botones "Siguiente" de
  // cada seccion, para que el flujo por pasos valide lo mismo que el guardado
  // final en vez de dejar avanzar con datos invalidos que solo se notan al
  // final.
  function errorInfoGeneral() {
    if (!name.trim()) return 'La receta necesita un nombre'
    if (!categoryId) return 'Elige una categoría'
    if (price === '' || price === null || Number.isNaN(Number(price))) return 'El precio de venta es obligatorio'
    return ''
  }
  function errorIngredientes() {
    // Un shot SI es una receta de un solo ingrediente (Shot Antioqueño =
    // {Antioqueño: 30 ml}, ver CLAUDE.md): lo que hace falta es al menos uno,
    // no dos. Un cóctel o un cubetazo usan el mismo mecanismo con mas lineas.
    if (items.length < 1) return 'La receta necesita al menos un ingrediente'
    if (items.some((it) => !it.qty || Number(it.qty) <= 0)) return 'Ningún ingrediente puede tener cantidad cero o negativa'
    return ''
  }

  function siguienteDesdeInfo() {
    const err = errorInfoGeneral()
    if (err) return setError(err)
    setError('')
    setTab(2)
  }
  function siguienteDesdeReceta() {
    const err = errorIngredientes()
    if (err) return setError(err)
    setError('')
    setTab(3)
  }

  // Cualquier cambio a la receta -- crearla, tocar ingredientes, precio o
  // solo el nombre -- pide el PIN de un encargado (decision de Alejo,
  // nov-2026): la receta define el costo real y lo que se descuenta de
  // inventario en cada venta. Primero se valida el formulario (para no pedir
  // PIN y recien ahi mostrar un error de datos), despues se abre el cuadro
  // de confirmacion con el PIN.
  function iniciarGuardar() {
    setError('')
    const errInfo = errorInfoGeneral()
    if (errInfo) {
      setTab(1)
      return setError(errInfo)
    }
    const errItems = errorIngredientes()
    if (errItems) {
      setTab(2)
      return setError(errItems)
    }
    setConfirmandoSuspender(false)
    setConfirmandoGuardar(true)
  }

  function cancelarGuardar() {
    setConfirmandoGuardar(false)
    resetPin()
  }

  async function guardar() {
    if (!pinValido) return
    const body = {
      name: name.trim(),
      categoryId,
      description: description.trim() || null,
      imageUrl: imageUrl || null,
      recipe: {
        price: Number(price),
        items: items.map((it) => ({ insumoId: it.insumo.id, qty: Number(it.qty) })),
      },
      pin,
    }

    setSaving(true)
    try {
      if (esNueva) {
        const creado = await api('/products', { method: 'POST', body: { ...body, kind: 'PREPARED' } })
        onCreated(creado)
      } else {
        const guardado = await api(`/products/${product.id}`, { method: 'PATCH', body })
        onSaved(guardado)
      }
      setConfirmandoGuardar(false)
      resetPin()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-5 space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold">{esNueva ? 'Nueva receta' : name || product.name}</h2>
          <p className="text-xs text-muted mt-0.5">
            {esNueva ? 'Crea un producto con receta: ingredientes, costo y precio.' : 'Edita la composición de este producto.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!esNueva && (
            <span
              className={`text-xs font-semibold px-2.5 py-1 rounded-pill border ${
                product.active ? 'text-libre border-libre/40 bg-libre/10' : 'text-muted border-edge bg-raised'
              }`}
            >
              {product.active ? 'Activo' : 'Suspendido'}
            </span>
          )}
          {hayCambios && (
            <button type="button" onClick={iniciarGuardar} disabled={saving} className="btn-primary">
              <Icon.check width={16} height={16} />
              {saving ? 'Guardando…' : esNueva ? 'Crear receta' : 'Guardar cambios'}
            </button>
          )}
        </div>
      </header>

      {confirmandoGuardar && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={cancelarGuardar}>
          <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-md p-5 space-y-4 max-h-[85vh] overflow-y-auto">
            <h2 className="text-lg font-bold">{esNueva ? 'Confirmar nueva receta' : 'Confirmar cambios'}</h2>

            {esNueva ? (
              <div className="text-sm bg-raised border border-edge rounded-xl p-3 space-y-1.5">
                <p>
                  <span className="text-muted">Nombre:</span> <span className="font-medium">{name.trim()}</span>
                </p>
                <p>
                  <span className="text-muted">Categoría:</span>{' '}
                  <span className="font-medium">{options.find((c) => c.id === categoryId)?.name || '—'}</span>
                </p>
                <p>
                  <span className="text-muted">Precio de venta:</span>{' '}
                  <span className="font-medium">{money(Number(price) || 0)}</span>
                </p>
                <p>
                  <span className="text-muted">Ingredientes:</span> <span className="font-medium">{items.length}</span>
                </p>
              </div>
            ) : (
              <div className="text-sm bg-raised border border-edge rounded-xl divide-y divide-edge">
                {cambios.map((c, i) => (
                  <div key={i} className="px-3 py-2">
                    <p className="text-xs font-semibold text-muted uppercase tracking-wide">{c.campo}</p>
                    {c.antes !== undefined && c.despues !== undefined ? (
                      <p>
                        <span className="text-ocupada line-through">{c.antes}</span>{' '}
                        <span className="text-muted">→</span> <span className="text-libre font-medium">{c.despues}</span>
                      </p>
                    ) : (
                      <p className={c.antes !== undefined ? 'text-ocupada' : 'text-libre font-medium'}>
                        {c.antes ?? c.despues}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-muted">Cualquier cambio a una receta necesita el PIN de un encargado.</p>
            <PinField
              pin={pin}
              onChange={setPin}
              verificando={verificandoPin}
              error={pinError}
              bloqueado={pinBloqueado}
              segundosRestantes={pinSegundosRestantes}
              autoFocus
            />
            <div className="flex gap-2">
              <button type="button" onClick={cancelarGuardar} className="btn-ghost flex-1">
                Cancelar
              </button>
              <button type="button" onClick={guardar} disabled={!pinValido || saving} className="btn-primary flex-1">
                {saving ? 'Guardando…' : 'Confirmar y guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">{error}</p>
      )}

      <div className="flex gap-1 border-b border-edge">
        {TABS.map((t) => (
          <button
            key={t.n}
            type="button"
            onClick={() => setTab(t.n)}
            className={`px-3 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t.n ? 'border-amber text-ink' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 1 && (
        <div className="space-y-4">
          {/* Imagen a la derecha, a 1/5 del ancho, formularios a la
              izquierda -- igual en el modal (abajo de xl) que en el panel
              inline: solo se apila en telefonos angostos (abajo de sm),
              donde una imagen a 1/5 quedaria demasiado chica para ser util. */}
          <div className="grid grid-cols-1 sm:grid-cols-[4fr_1fr] gap-4 sm:gap-6">
            <div className="space-y-4">
              <div>
                <label className="label">Nombre de la receta</label>
                <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Sánduche de jamón y queso" autoFocus />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Categoría</label>
                  <div className="flex gap-2">
                    <select className="field flex-1" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                      <option value="" disabled hidden>
                        Elige una categoría
                      </option>
                      {options.map((c) => (
                        <option key={c.id} value={c.id}>
                          {'— '.repeat(c.depth)}
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setAgregandoCategoria(true)}
                      className="btn-ghost h-10 px-3 text-xs whitespace-nowrap"
                    >
                      <Icon.plus width={14} height={14} /> Nueva
                    </button>
                  </div>
                </div>
                <div>
                  <label className="label">Precio de venta</label>
                  <MoneyInput className="field" value={price} onChange={setPrice} />
                </div>
              </div>
              <div>
                <label className="label">Descripción (opcional)</label>
                <textarea
                  className="field resize-none"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Una breve descripción…"
                />
              </div>

              {!esNueva && esAdminReal && (
                <div className="flex items-center justify-between bg-raised border border-edge rounded-xl p-3">
                  <div>
                    <p className="text-sm font-medium">{product.active ? 'Producto disponible' : 'Producto suspendido'}</p>
                    <p className="text-xs text-muted">
                      {product.active ? 'Puede venderse en el punto de venta.' : 'No aparece en ningún pedido.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmandoSuspender(true)}
                    className={`btn-ghost shrink-0 ${product.active ? 'text-ocupada' : 'text-libre'}`}
                  >
                    {product.active ? 'Suspender' : 'Reactivar'}
                  </button>
                </div>
              )}

              {confirmandoSuspender && (
                <div className="space-y-3 bg-raised border border-edge rounded-xl p-3">
                  <p className="text-xs text-muted">
                    {product.active ? 'Suspenderlo lo quita de los pedidos de inmediato.' : 'Vuelve a aparecer en los pedidos.'}{' '}
                    Necesita el PIN del encargado.
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
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmandoSuspender(false)
                        resetPin()
                      }}
                      className="btn-ghost flex-1"
                    >
                      Cancelar
                    </button>
                    <button type="button" onClick={suspender} disabled={!pinValido || saving} className="btn-danger flex-1">
                      {product.active ? 'Suspender' : 'Reactivar'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="label">Imagen del producto</label>
              <span className="w-full aspect-square rounded-xl grid place-items-center overflow-hidden bg-raised border border-edge">
                {imageUrl ? (
                  <img src={imageUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Icon.box width={28} height={28} className="text-muted" />
                )}
              </span>
              <label className="btn-ghost cursor-pointer text-xs w-full justify-center mt-2">
                {subiendoImagen ? 'Subiendo…' : imageUrl ? 'Cambiar imagen' : 'Subir imagen'}
                <input type="file" accept="image/*" className="hidden" onChange={subirImagen} disabled={subiendoImagen} />
              </label>
            </div>
          </div>

          <div className="flex justify-end">
            <button type="button" onClick={siguienteDesdeInfo} className="btn-ghost">
              Siguiente: Receta y costos <Icon.chevronRight width={16} height={16} />
            </button>
          </div>
        </div>
      )}

      {tab === 2 && (
        <div className="space-y-4">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
              <Icon.search />
            </span>
            <input
              className="field pl-10"
              placeholder="Buscar insumo para agregar…"
              value={buscarInsumo}
              onChange={(e) => setBuscarInsumo(e.target.value)}
            />
            {coincidencias.length > 0 && (
              <div className="absolute z-10 top-full left-0 right-0 mt-1 card p-1.5 space-y-0.5 shadow-xl max-h-60 overflow-y-auto">
                {coincidencias.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => agregarInsumo(i)}
                    className="w-full flex items-center justify-between gap-2 text-left px-2.5 py-2 rounded-lg text-sm hover:bg-raised"
                  >
                    <span>{i.name}</span>
                    <span className="text-xs text-muted">{i.categoria?.name}</span>
                  </button>
                ))}
              </div>
            )}
            {buscarInsumo.trim() && coincidencias.length === 0 && (
              <div className="absolute z-10 top-full left-0 right-0 mt-1 card p-3 shadow-xl space-y-2">
                <p className="text-xs text-muted">No encontramos insumos para "{buscarInsumo.trim()}".</p>
                <button
                  type="button"
                  onClick={() => setMatriculandoInsumo(buscarInsumo.trim())}
                  className="btn-ghost w-full justify-center text-xs h-9"
                >
                  <Icon.plus width={14} height={14} /> Matricular "{buscarInsumo.trim()}" como insumo nuevo
                </button>
              </div>
            )}
          </div>

          {matriculandoInsumo !== null && (
            <InsumoForm
              nombreInicial={matriculandoInsumo}
              categorias={categoriasInsumo}
              proveedores={[]}
              unidades={unidades}
              onClose={() => setMatriculandoInsumo(null)}
              onSaved={(creado) => {
                onInsumoCreado(creado)
                agregarInsumo(creado)
                setMatriculandoInsumo(null)
              }}
              onCategoriaCreada={onCategoriaInsumoCreada}
              onProveedorCreado={() => {}}
            />
          )}

          {items.length === 0 ? (
            <p className="text-sm text-muted text-center py-8 border border-dashed border-edge rounded-xl">
              Todavía no hay ingredientes. Búscalos arriba y agrega al menos uno a la receta.
            </p>
          ) : (
            <div className="rounded-xl border border-edge overflow-hidden">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left text-xs text-muted uppercase tracking-wide bg-raised">
                    <th className="py-2.5 px-3 font-semibold">Insumo</th>
                    <th className="py-2.5 px-3 font-semibold">Cantidad</th>
                    <th className="py-2.5 px-3 font-semibold">Costo unitario</th>
                    <th className="py-2.5 px-3 font-semibold">Costo total</th>
                    <th className="py-2.5 px-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => {
                    const unitario = costoUnitario(it.insumo, unidades)
                    return (
                      <tr key={it.insumo.id} className={idx > 0 ? 'border-t border-edge' : ''}>
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-2.5">
                            <span className="w-8 h-8 rounded-lg overflow-hidden shrink-0 grid place-items-center bg-canvas border border-edge">
                              {it.insumo.imageUrl ? (
                                <img src={it.insumo.imageUrl} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <Icon.box width={14} height={14} className="text-muted" />
                              )}
                            </span>
                            <span className="truncate">{it.insumo.name}</span>
                          </div>
                        </td>
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min="1"
                              className="field h-8 w-20"
                              value={it.qty}
                              onChange={(e) => setQty(it.insumo.id, e.target.value)}
                            />
                            <span className="text-xs text-muted">{nombreUnidad(it.insumo.unidadInventario, unidades)}</span>
                          </div>
                        </td>
                        <td className="py-2 px-3 text-muted">{money(unitario)}</td>
                        <td className="py-2 px-3 font-medium">{money(unitario * Number(it.qty || 0))}</td>
                        <td className="py-2 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => quitarItem(it.insumo.id)}
                            className="text-muted hover:text-ocupada p-1"
                          >
                            <Icon.trash width={15} height={15} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="bg-raised border border-edge rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-[10px] font-bold tracking-wide text-muted uppercase">Costo producción</p>
              <p className="text-base font-bold mt-0.5">{money(costoTotal)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold tracking-wide text-muted uppercase">Precio de venta</p>
              <p className="text-base font-bold mt-0.5">{money(precioNum)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold tracking-wide text-muted uppercase">Margen bruto</p>
              <p className={`text-base font-bold mt-0.5 ${margen < 0 ? 'text-ocupada' : 'text-libre'}`}>
                {money(margen)} · {margenPct.toFixed(0)}%
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold tracking-wide text-muted uppercase">% en ingredientes</p>
              <p className="text-base font-bold mt-0.5">{pctIngredientes.toFixed(0)}%</p>
            </div>
          </div>
          {margen < 0 && (
            <p className="text-xs text-ocupada">
              El costo de los ingredientes supera el precio de venta: esta receta se vendería a pérdida.
            </p>
          )}
          <div className="flex justify-end">
            <button type="button" onClick={siguienteDesdeReceta} className="btn-ghost">
              Siguiente: Variantes y complementos <Icon.chevronRight width={16} height={16} />
            </button>
          </div>
        </div>
      )}

      {tab === 3 && (
        <div className="py-10 text-center space-y-2">
          <Icon.lock width={24} height={24} className="text-muted mx-auto" />
          <p className="text-sm font-semibold">Variantes y complementos — Próximamente</p>
          <p className="text-xs text-muted max-w-sm mx-auto">
            Quitar ingredientes, adicionales con precio propio, sustituciones y grupos de selección para el
            POS se configuran aquí más adelante.
          </p>
        </div>
      )}

      {agregandoCategoria && (
        <CategoriaForm
          categories={categories}
          category={null}
          onClose={() => setAgregandoCategoria(false)}
          onSaved={(creada) => {
            setCategoryId(creada.id)
            onCategoriaCreada(creada)
            setAgregandoCategoria(false)
          }}
        />
      )}
    </div>
  )
}
