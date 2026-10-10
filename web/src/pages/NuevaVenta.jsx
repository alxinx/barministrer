import { useEffect, useMemo, useState } from 'react'
import { api, money } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import FloorPlan from '../components/FloorPlan'
import MoneyInput from '../components/MoneyInput'
import { Icon, zoneIcon } from '../components/Icons'

const estados = [
  { key: 'AVAILABLE', label: 'Disponible', dot: 'bg-libre' },
  { key: 'RESERVED', label: 'Reservada', dot: 'bg-reservada' },
  { key: 'OCCUPIED', label: 'Ocupada', dot: 'bg-ocupada' },
  { key: 'CLOSED', label: 'Cerrada', dot: 'bg-muted' },
]

export default function NuevaVenta() {
  const { session } = useAuth()
  const [zones, setZones] = useState([])
  const [activeZone, setActiveZone] = useState(null)
  const [table, setTable] = useState(null)
  const [products, setProducts] = useState([])
  const [search, setSearch] = useState('')
  const [lines, setLines] = useState([]) // pedido en construccion, aun no enviado
  const [shift, setShift] = useState(undefined) // undefined = cargando, null = sin turno abierto
  const [avisoVisto, setAvisoVisto] = useState(false)

  useEffect(() => {
    api('/zones').then((z) => {
      setZones(z)
      setActiveZone(z[0]?.id || null)
    })
    api('/products').then(setProducts)
    api('/shifts/current').then(setShift)
  }, [])

  const zone = zones.find((z) => z.id === activeZone)
  // Toda venta va atada a un turno: sin uno abierto no hay donde registrarla,
  // asi que no se deja ni intentar el envio.
  const turnoAbierto = Boolean(shift)
  const puedeAbrirTurno = ['ADMIN', 'CAJERO'].includes(session?.user.role)

  // Sugeridos: los que mas se piden deben estar a un toque. Por ahora, los
  // primeros del catalogo disponible; cuando haya historial de ventas esto se
  // ordena por frecuencia real.
  const sugeridos = useMemo(() => {
    const term = search.trim().toLowerCase()
    return products
      .filter((p) => p.available && p.variants.some((v) => v.active))
      .filter((p) => !term || p.name.toLowerCase().includes(term))
      .slice(0, 8)
  }, [products, search])

  const total = lines.reduce((sum, l) => sum + Number(l.price) * l.qty, 0)

  function agregar(product) {
    const variant = product.variants.find((v) => v.active)
    if (!variant) return
    setLines((prev) => {
      const found = prev.find((l) => l.variantId === variant.id)
      if (found) {
        return prev.map((l) => (l.variantId === variant.id ? { ...l, qty: l.qty + 1 } : l))
      }
      return [
        ...prev,
        {
          variantId: variant.id,
          name: product.name,
          variantName: variant.name,
          color: product.category.color,
          price: variant.price,
          qty: 1,
        },
      ]
    })
  }

  function cambiarCantidad(variantId, delta) {
    setLines((prev) =>
      prev
        .map((l) => (l.variantId === variantId ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0)
    )
  }

  async function abrirTurnoInline(baseCash) {
    const nuevo = await api('/shifts', { method: 'POST', body: { baseCash } })
    setShift(nuevo)
  }

  return (
    <div className="p-5 md:p-7 max-w-[1500px] mx-auto">
      <header className="flex items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold">Nueva venta</h1>
        <div className="relative flex-1 max-w-md">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
            <Icon.search />
          </span>
          <input
            className="field pl-10"
            placeholder="Buscar producto"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </header>

      {shift !== undefined && !turnoAbierto && !avisoVisto && (
        <SinTurnoOverlay
          puedeAbrirTurno={puedeAbrirTurno}
          onDismiss={() => setAvisoVisto(true)}
          onAbrir={abrirTurnoInline}
        />
      )}

      <div className="grid lg:grid-cols-[1fr_380px] gap-5 items-start">
        <section>
          <div className="flex gap-2 flex-wrap mb-4">
            {zones.map((z) => {
              const I = zoneIcon[z.icon] || Icon.tables
              return (
                <button
                  key={z.id}
                  onClick={() => setActiveZone(z.id)}
                  className={`flex items-center gap-2 h-11 px-4 rounded-xl text-sm font-semibold border transition-colors ${
                    z.id === activeZone
                      ? 'bg-amber text-night border-amber'
                      : 'bg-surface text-muted border-edge hover:text-ink'
                  }`}
                >
                  <I />
                  {z.name}
                </button>
              )
            })}
          </div>

          <FloorPlan
            zone={zone}
            selectedId={table?.id}
            onSelect={(_kind, item) => setTable(item)}
          />

          <div className="flex gap-4 flex-wrap mt-4 text-xs text-muted">
            {estados.map((e) => (
              <span key={e.key} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${e.dot}`} />
                {e.label}
              </span>
            ))}
          </div>
        </section>

        <aside className="space-y-4">
          <div className="card p-4">
            {table ? (
              <>
                <div className="flex items-baseline gap-3">
                  <span className="text-mesa text-amber">{table.number}</span>
                  <div>
                    <p className="font-semibold">
                      {zone?.name}
                    </p>
                    <p className="text-sm text-muted">{table.seats} puestos</p>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">Toca una mesa del plano para abrir su cuenta.</p>
            )}
          </div>

          <div className="card p-4">
            <h2 className="font-semibold mb-3">Productos en mesa</h2>

            {lines.length === 0 ? (
              <p className="text-sm text-muted">
                Nada agregado todavía. Toca un producto de abajo para empezar el pedido.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {lines.map((l) => (
                  <li key={l.variantId} className="flex items-center gap-3">
                    <span
                      className="w-9 h-9 rounded-lg shrink-0 grid place-items-center text-[11px] font-bold text-night"
                      style={{ background: l.color }}
                    >
                      {l.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{l.name}</p>
                      <p className="text-xs text-muted">
                        {l.variantName} · {money(l.price)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => cambiarCantidad(l.variantId, -1)}
                        className="w-8 h-8 rounded-lg bg-raised border border-edge text-muted hover:text-ink"
                        aria-label={`Quitar uno de ${l.name}`}
                      >
                        −
                      </button>
                      <span className="w-6 text-center text-sm font-semibold">{l.qty}</span>
                      <button
                        onClick={() => cambiarCantidad(l.variantId, 1)}
                        className="w-8 h-8 rounded-lg bg-raised border border-edge text-muted hover:text-ink"
                        aria-label={`Agregar uno de ${l.name}`}
                      >
                        +
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {lines.length > 0 && (
              <div className="flex items-baseline justify-between mt-4 pt-4 border-t border-edge">
                <span className="text-muted text-sm">Total</span>
                <span className="text-xl font-bold">{money(total)}</span>
              </div>
            )}
          </div>

          <div className="card p-4">
            <h2 className="font-semibold mb-3">Productos sugeridos</h2>
            <div className="grid grid-cols-2 gap-2">
              {sugeridos.map((p) => {
                const v = p.variants.find((x) => x.active)
                return (
                  <button
                    key={p.id}
                    onClick={() => agregar(p)}
                    className="text-left p-3 rounded-xl bg-raised border border-edge
                               hover:border-amber transition-colors"
                  >
                    <span
                      className="block w-full h-1 rounded-pill mb-2.5"
                      style={{ background: p.category.color }}
                    />
                    <p className="text-sm font-semibold leading-tight">{p.name}</p>
                    <p className="text-xs text-muted mt-0.5">
                      {v.name}
                      {v.volumeMl ? ` · ${v.volumeMl} ml` : ''}
                    </p>
                    <p className="text-sm font-bold mt-1.5">{money(v.price)}</p>
                  </button>
                )
              })}
            </div>
          </div>

          <button
            className="btn-primary w-full"
            disabled={!table || lines.length === 0 || !turnoAbierto}
            title={!turnoAbierto ? 'No hay un turno abierto' : undefined}
          >
            Enviar pedido a la barra
          </button>
        </aside>
      </div>
    </div>
  )
}

function SinTurnoOverlay({ puedeAbrirTurno, onDismiss, onAbrir }) {
  const [showForm, setShowForm] = useState(false)

  return (
    <div className="fixed inset-0 z-50 backdrop-blur-md bg-night/50 flex items-center justify-center p-4">
      <div className="flex flex-col items-center gap-3 text-center max-w-xs">
        <button
          onClick={() => puedeAbrirTurno && setShowForm(true)}
          disabled={!puedeAbrirTurno}
          className="w-20 h-20 rounded-full bg-raised border border-edge shadow-xl grid place-items-center
                     text-4xl transition-transform disabled:cursor-default enabled:hover:scale-105"
        >
          🔒
        </button>
        <div>
          <h2 className="text-lg font-bold">No hay un turno abierto</h2>
          <p className="text-sm text-muted mt-1">
            {puedeAbrirTurno
              ? 'Toca el candado para abrir caja y enviar pedidos.'
              : 'Avísale al cajero que abra caja antes de enviar pedidos.'}
          </p>
        </div>
        <button onClick={onDismiss} className="text-xs font-semibold text-muted hover:text-ink underline mt-1">
          Seguir sin turno
        </button>
      </div>

      {showForm && <AbrirTurnoModal onCancel={() => setShowForm(false)} onAbrir={onAbrir} />}
    </div>
  )
}

function AbrirTurnoModal({ onCancel, onAbrir }) {
  const [base, setBase] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function confirmar() {
    setSaving(true)
    setError('')
    try {
      await onAbrir(Number(base) || 0)
      onCancel()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">Abrir caja</h2>
        <p className="text-sm text-muted">Declara la base inicial en efectivo para abrir el turno.</p>

        {error && (
          <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
            {error}
          </p>
        )}

        <div>
          <label className="label">Base inicial (efectivo)</label>
          <MoneyInput className="field" value={base} onChange={setBase} autoFocus />
        </div>
        <div className="flex gap-3">
          <button onClick={onCancel} className="btn-ghost flex-1">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={base === '' || saving} className="btn-primary flex-1">
            {saving ? 'Abriendo…' : 'Abrir turno'}
          </button>
        </div>
      </div>
    </div>
  )
}
