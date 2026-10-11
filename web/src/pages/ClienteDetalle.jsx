import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, money } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Icon } from '../components/Icons'
import ClienteForm from '../components/ClienteForm'
import ReciboModal from '../components/ReciboModal'
import ConsumoChart from '../components/ConsumoChart'
import MoneyInput from '../components/MoneyInput'

export default function ClienteDetalle() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { session } = useAuth()
  const [customer, setCustomer] = useState(undefined) // undefined = cargando, null = no existe
  const [editing, setEditing] = useState(false)
  const [factura, setFactura] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    load()
  }, [id])

  async function load() {
    try {
      setCustomer(await api(`/customers/${id}`))
    } catch {
      setCustomer(null)
    }
  }

  function show(err) {
    setError(err.message)
    setTimeout(() => setError(''), 4000)
  }

  async function agregarCargo({ amount, description }) {
    await api(`/customers/${id}/charges`, { method: 'POST', body: { amount, description } })
    load()
  }

  async function agregarPago({ amount, note }) {
    await api(`/customers/${id}/payments`, { method: 'POST', body: { amount, note } })
    load()
  }

  async function verFactura(orderId) {
    try {
      setFactura(await api(`/orders/${orderId}`))
    } catch (err) {
      show(err)
    }
  }

  if (customer === undefined) {
    return <div className="p-7 text-muted text-sm">Cargando…</div>
  }
  if (customer === null) {
    return (
      <div className="p-7 space-y-3">
        <p className="text-muted text-sm">Ese cliente no existe.</p>
        <button onClick={() => navigate('/clientes')} className="btn-ghost">
          Volver a clientes
        </button>
      </div>
    )
  }

  const diasSinAbono = diasDesde(customer.payments[0]?.createdAt || customer.createdAt)
  const alerta = customer.creditEnabled && customer.balance > 0 && diasSinAbono >= 15

  const historial = [
    ...customer.charges.map((c) => ({ ...c, tipo: 'cargo' })),
    ...customer.payments.map((p) => ({ ...p, tipo: 'pago' })),
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

  const consumoMensual = ultimosMeses(6).map(({ key, label, start, end }) => ({
    key,
    label,
    total: customer.charges
      .filter((c) => new Date(c.createdAt) >= start && new Date(c.createdAt) < end)
      .reduce((s, c) => s + Number(c.amount), 0),
  }))

  const cupo = Number(customer.creditLimit) || 0

  return (
    <div className="p-5 md:p-7 max-w-[900px] mx-auto space-y-5">
      <button
        onClick={() => navigate('/clientes')}
        className="text-sm text-muted hover:text-ink flex items-center gap-1.5"
      >
        <Icon.chevronLeft width={16} height={16} />
        Clientes
      </button>

      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="w-14 h-14 rounded-full grid place-items-center text-lg font-bold text-night bg-amber shrink-0">
            {customer.firstName.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <h1 className="text-2xl font-bold">
              {customer.firstName} {customer.lastName}
              {customer.alias && <span className="text-muted font-normal text-lg"> · {customer.alias}</span>}
            </h1>
            <p className="text-muted text-sm mt-0.5">
              {[customer.whatsapp, customer.email, customer.idNumber && `Cédula ${customer.idNumber}`]
                .filter(Boolean)
                .join(' · ') || 'Sin datos de contacto'}
            </p>
          </div>
        </div>
        <button onClick={() => setEditing(true)} className="btn-ghost">
          <Icon.gear width={16} height={16} />
          Editar datos
        </button>
      </header>

      {error && (
        <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
          {error}
        </p>
      )}

      {alerta && (
        <div className="flex items-center gap-3 bg-ocupada/10 border border-ocupada/30 rounded-xl px-4 py-3">
          <Icon.alert width={20} height={20} className="text-ocupada shrink-0" />
          <p className="text-sm">
            <span className="font-semibold">Hace {diasSinAbono} días que no abona</span>
            <span className="text-muted"> y debe {money(customer.balance)}.</span>
          </p>
        </div>
      )}

      <section className="card p-5 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Crédito</h2>
          <span
            className={`text-[10px] font-bold rounded-pill px-2 py-0.5 border ${
              customer.creditEnabled
                ? 'text-amber border-amber/40 bg-amber/10'
                : 'text-muted border-edge bg-raised'
            }`}
          >
            {customer.creditEnabled ? 'Habilitado' : 'Deshabilitado'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-xs text-muted mb-1">
              {customer.balance > 0 ? 'Debe actualmente' : customer.balance < 0 ? 'A favor' : 'Saldo'}
            </p>
            <p
              className={`text-[28px] font-bold leading-none ${
                customer.balance > 0 ? 'text-ocupada' : customer.balance < 0 ? 'text-reservada' : 'text-libre'
              }`}
            >
              {customer.balance === 0 ? 'Al día' : money(Math.abs(customer.balance))}
            </p>
          </div>
          {customer.creditEnabled && (
            <div>
              <p className="text-xs text-muted mb-1">Cupo</p>
              <p className="text-[28px] font-bold leading-none">{cupo > 0 ? money(cupo) : 'Sin tope'}</p>
            </div>
          )}
        </div>

        {customer.creditEnabled && cupo > 0 && (
          <div>
            <div className="h-2 rounded-pill bg-raised overflow-hidden">
              <div
                className={`h-full rounded-pill ${customer.balance >= cupo ? 'bg-ocupada' : 'bg-amber'}`}
                style={{ width: `${Math.min(100, (Math.max(0, customer.balance) / cupo) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted mt-1.5">
              {money(Math.max(0, cupo - customer.balance))} disponibles de cupo
            </p>
          </div>
        )}
      </section>

      <section className="card p-5 space-y-3">
        <h2 className="font-semibold">Consumo de los últimos 6 meses</h2>
        <ConsumoChart data={consumoMensual} />
      </section>

      <section className="card p-5 space-y-4">
        <h2 className="font-semibold">Abonar a la deuda</h2>
        <PagoForm onAgregar={agregarPago} />
      </section>

      {customer.creditEnabled && (
        <section className="card p-5 space-y-4">
          <h2 className="font-semibold">Registrar consumo fiado</h2>
          <CargoForm onAgregar={agregarCargo} />
        </section>
      )}

      <section className="card p-5">
        <h2 className="font-semibold mb-3">Historial</h2>
        {historial.length === 0 ? (
          <p className="text-sm text-muted">Todavía no hay consumos ni pagos registrados.</p>
        ) : (
          <div>
            {historial.map((h) => (
              <div key={`${h.tipo}-${h.id}`} className="flex items-center gap-3 py-2.5 border-b border-edge/60 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate flex items-center gap-2">
                    {h.tipo === 'cargo' ? h.description : h.note || 'Abono'}
                    {h.tipo === 'cargo' && h.order && (
                      <span className="text-[10px] font-bold text-muted border border-edge rounded-pill px-1.5 py-0.5 shrink-0">
                        Mesa {h.order.table.number}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted">
                    {h.createdBy?.name} · {formatFecha(h.createdAt)}
                  </p>
                </div>
                <span
                  className={`text-sm font-semibold shrink-0 ${h.tipo === 'cargo' ? 'text-ocupada' : 'text-libre'}`}
                >
                  {h.tipo === 'cargo' ? '+' : '-'}
                  {money(h.amount)}
                </span>
                {h.tipo === 'cargo' && h.order ? (
                  <button
                    type="button"
                    onClick={() => verFactura(h.order.id)}
                    aria-label={`Ver factura de la mesa ${h.order.table.number}`}
                    className="w-9 h-9 rounded-lg bg-raised border border-edge grid place-items-center text-muted hover:text-amber hover:border-amber/40 transition-colors shrink-0"
                  >
                    <Icon.receipt width={16} height={16} />
                  </button>
                ) : (
                  <span className="w-9 h-9 shrink-0" />
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {editing && (
        <ClienteForm
          customer={customer}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            load()
          }}
        />
      )}

      {factura && (
        <ReciboModal
          order={factura}
          splitCount={1}
          tenantName={session?.tenant?.name}
          autoPrint={false}
          onClose={() => setFactura(null)}
        />
      )}
    </div>
  )
}

function PagoForm({ onAgregar }) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function agregar() {
    if (!amount) return
    setSaving(true)
    setError('')
    try {
      await onAgregar({ amount: Number(amount), note: note.trim() })
      setAmount('')
      setNote('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-ocupada">{error}</p>}
      <div className="flex flex-wrap gap-2 items-end bg-raised border border-edge rounded-xl p-3">
        <div className="flex-1 min-w-[160px]">
          <input
            className="field h-10"
            placeholder="Nota (opcional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="w-32">
          <MoneyInput className="field h-10" placeholder="Monto" value={amount} onChange={setAmount} />
        </div>
        <button type="button" onClick={agregar} disabled={saving} className="btn-primary h-10">
          <Icon.plus width={16} height={16} />
          Abonar
        </button>
      </div>
    </div>
  )
}

function CargoForm({ onAgregar }) {
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function agregar() {
    if (!amount || !description.trim()) return
    setSaving(true)
    setError('')
    try {
      await onAgregar({ amount: Number(amount), description: description.trim() })
      setAmount('')
      setDescription('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-ocupada">{error}</p>}
      <div className="flex flex-wrap gap-2 items-end bg-raised border border-edge rounded-xl p-3">
        <div className="flex-1 min-w-[160px]">
          <input
            className="field h-10"
            placeholder="Qué consumió (ej: 2 cervezas)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="w-32">
          <MoneyInput className="field h-10" placeholder="Monto" value={amount} onChange={setAmount} />
        </div>
        <button type="button" onClick={agregar} disabled={saving} className="btn-ghost h-10">
          <Icon.plus width={16} height={16} />
          Agregar
        </button>
      </div>
    </div>
  )
}

function diasDesde(iso) {
  if (!iso) return 0
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

function ultimosMeses(n) {
  const out = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
    const label = start.toLocaleDateString('es-CO', { month: 'short' }).replace('.', '')
    out.push({ key: `${start.getFullYear()}-${start.getMonth()}`, label, start, end })
  }
  return out
}

function formatFecha(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
}
