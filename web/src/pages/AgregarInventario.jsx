import { useEffect, useMemo, useState } from 'react'
import { api, money } from '../lib/api'
import { getCategories } from '../lib/categoriesStore'
import { useAuth } from '../context/AuthContext'
import { Icon } from '../components/Icons'
import MoneyInput from '../components/MoneyInput'
import ProductoForm from '../components/ProductoForm'

export default function AgregarInventario() {
  const { session } = useAuth()
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null) // { product, variant }
  const [movements, setMovements] = useState([])
  const [creando, setCreando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const [p, c, m] = await Promise.all([
      api('/products'),
      getCategories(session?.tenant.id),
      api('/inventory/movements'),
    ])
    setProducts(p)
    setCategories(c)
    setMovements(m)
  }

  function productoCreado(nuevo) {
    setCreando(false)
    load()
    if (nuevo?.variants?.length) {
      setSelected({ product: nuevo, variant: nuevo.variants[0] })
      setSearch('')
    }
  }

  function show(err) {
    setError(err.message)
    setTimeout(() => setError(''), 4000)
  }

  const opciones = useMemo(() => {
    const term = search.trim().toLowerCase()
    return products
      .filter((p) => p.kind === 'STOCK')
      .flatMap((p) => p.variants.map((v) => ({ product: p, variant: v })))
      .filter((o) => !term || o.product.name.toLowerCase().includes(term) || o.variant.name.toLowerCase().includes(term))
  }, [products, search])

  async function registrar(payload) {
    try {
      await api('/inventory/movements', { method: 'POST', body: { ...payload, variantId: selected.variant.id } })
      setSelected(null)
      setSearch('')
      load()
    } catch (err) {
      show(err)
    }
  }

  return (
    <div className="p-5 md:p-7 max-w-[900px] mx-auto space-y-5">
      <header>
        <h1 className="text-2xl font-bold">Agregar inventario</h1>
        <p className="text-muted text-sm mt-1">
          Registra lo que entra por compra. Si llegó por caja o canasta, resuélvelo aquí con el
          empaque: el producto solo guarda unidades.
        </p>
      </header>

      {error && (
        <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
          {error}
        </p>
      )}

      {!selected ? (
        <section className="card p-5 space-y-4">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
              <Icon.search />
            </span>
            <input
              className="field pl-10"
              placeholder="Buscar producto o presentación"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[420px] overflow-y-auto">
            {opciones.map((o) => (
              <button
                key={o.variant.id}
                type="button"
                onClick={() => setSelected(o)}
                className="text-left p-3 rounded-xl bg-raised border border-edge hover:border-amber transition-colors"
              >
                <span className="block w-full h-1 rounded-pill mb-2.5" style={{ background: o.product.category.color }} />
                <p className="text-sm font-semibold leading-tight truncate">{o.product.name}</p>
                <p className="text-xs text-muted mt-0.5">{o.variant.name}</p>
                <p className="text-xs text-muted mt-1.5">
                  Stock: <span className="text-ink font-semibold">{o.variant.stock}</span>
                </p>
              </button>
            ))}

            {opciones.length === 0 && (
              <div className="col-span-full text-center py-6 space-y-3">
                <p className="text-sm text-muted">
                  {search.trim() ? <>No encontré “{search.trim()}” en el catálogo.</> : 'No hay presentaciones todavía.'}
                </p>
                <button type="button" onClick={() => setCreando(true)} className="btn-primary">
                  <Icon.plus width={16} height={16} />
                  Agregar {search.trim() ? `"${search.trim()}"` : ''} como producto nuevo
                </button>
              </div>
            )}
          </div>
        </section>
      ) : (
        <EntradaForm selected={selected} onCancelar={() => setSelected(null)} onRegistrar={registrar} />
      )}

      <section className="card p-5">
        <h2 className="font-semibold mb-3">Entradas recientes</h2>
        {movements.length === 0 ? (
          <p className="text-sm text-muted">Todavía no hay entradas de inventario registradas.</p>
        ) : (
          <div>
            {movements.map((m) => (
              <div key={m.id} className="flex items-center gap-3 py-2.5 border-b border-edge/60 last:border-0">
                <span className="w-9 h-9 rounded-full bg-raised border border-edge grid place-items-center text-muted shrink-0">
                  <Icon.truck width={17} height={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {m.variant.product.name} · {m.variant.name}
                    {m.packs && m.unitsPerPack ? ` (${m.packs} × ${m.unitsPerPack})` : ''}
                  </p>
                  <p className="text-xs text-muted">
                    {m.createdBy?.name} · {formatFecha(m.createdAt)}
                    {m.note ? ` · ${m.note}` : ''}
                  </p>
                </div>
                <span className="text-sm font-semibold text-libre shrink-0">+{m.qty}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {creando && (
        <ProductoForm
          categories={categories}
          products={products}
          product={null}
          initialName={search.trim()}
          onClose={() => setCreando(false)}
          onSaved={productoCreado}
        />
      )}
    </div>
  )
}

function EntradaForm({ selected, onCancelar, onRegistrar }) {
  const { product, variant } = selected
  const [modo, setModo] = useState('unidad')
  const [qty, setQty] = useState('')
  const [packs, setPacks] = useState('')
  const [unitsPerPack, setUnitsPerPack] = useState('')
  const [cost, setCost] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const total = modo === 'paquete' ? (Number(packs) || 0) * (Number(unitsPerPack) || 0) : Number(qty) || 0

  async function submit() {
    if (total <= 0) return
    setSaving(true)
    try {
      await onRegistrar({
        qty: total,
        ...(modo === 'paquete' && { packs: Number(packs), unitsPerPack: Number(unitsPerPack) }),
        ...(cost !== '' && { cost: Number(cost) }),
        note: note.trim() || undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold">
            {product.name} · {variant.name}
          </p>
          <p className="text-sm text-muted">
            Stock actual: <span className="text-ink font-semibold">{variant.stock}</span>
          </p>
        </div>
        <button type="button" onClick={onCancelar} className="text-muted hover:text-ink">
          <Icon.x />
        </button>
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={() => setModo('unidad')} className={tipoClass(modo === 'unidad')}>
          Por unidad
        </button>
        <button type="button" onClick={() => setModo('paquete')} className={tipoClass(modo === 'paquete')}>
          Por empaque
        </button>
      </div>

      {modo === 'unidad' ? (
        <div>
          <label className="label">Unidades que entran</label>
          <input
            type="number"
            min="1"
            className="field"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            autoFocus
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Empaques (cajas, canastas…)</label>
            <input
              type="number"
              min="1"
              className="field"
              value={packs}
              onChange={(e) => setPacks(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="label">Unidades por empaque</label>
            <input
              type="number"
              min="1"
              className="field"
              value={unitsPerPack}
              onChange={(e) => setUnitsPerPack(e.target.value)}
            />
          </div>
        </div>
      )}

      {total > 0 && (
        <p className="text-sm text-muted">
          Entran <span className="text-ink font-semibold">{total}</span> unidades · queda en{' '}
          <span className="text-ink font-semibold">{variant.stock + total}</span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Costo unitario (opcional)</label>
          <MoneyInput className="field" value={cost} onChange={setCost} placeholder="Sin cambios" />
        </div>
        <div>
          <label className="label">Nota (opcional)</label>
          <input className="field" placeholder="Proveedor, factura…" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>

      <div className="flex gap-3 pt-1">
        <button type="button" onClick={onCancelar} className="btn-ghost flex-1">
          Cancelar
        </button>
        <button type="button" onClick={submit} disabled={total <= 0 || saving} className="btn-primary flex-1">
          {saving ? 'Guardando…' : 'Agregar al inventario'}
        </button>
      </div>
    </section>
  )
}

function tipoClass(active) {
  return `h-10 px-3 rounded-xl text-xs font-semibold border transition-colors ${
    active ? 'bg-amber text-night border-amber' : 'bg-surface text-muted border-edge hover:text-ink'
  }`
}

function formatFecha(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
}
