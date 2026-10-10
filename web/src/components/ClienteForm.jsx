import { useState } from 'react'
import { api, money } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import MoneyInput from './MoneyInput'
import { Icon } from './Icons'

/**
 * Crea o edita un cliente. Habilitar credito (y su tope) es una decision de
 * confianza del dueno: solo ADMIN puede tocarlo, igual que allowsPour en
 * categorias. El historial de cargos/pagos solo existe editando uno que ya
 * existe, porque no hay nada que mostrar antes de crearlo.
 */
export default function ClienteForm({ customer, onClose, onSaved }) {
  const { session } = useAuth()
  const isAdmin = session?.user.role === 'ADMIN'
  const isEdit = Boolean(customer)

  const [firstName, setFirstName] = useState(customer?.firstName || '')
  const [lastName, setLastName] = useState(customer?.lastName || '')
  const [alias, setAlias] = useState(customer?.alias || '')
  const [idNumber, setIdNumber] = useState(customer?.idNumber || '')
  const [email, setEmail] = useState(customer?.email || '')
  const [whatsapp, setWhatsapp] = useState(customer?.whatsapp || '')
  const [creditEnabled, setCreditEnabled] = useState(customer?.creditEnabled || false)
  const [creditLimit, setCreditLimit] = useState(customer?.creditLimit || '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const [charges, setCharges] = useState(customer?.charges || [])
  const [payments, setPayments] = useState(customer?.payments || [])
  const balance = charges.reduce((s, c) => s + Number(c.amount), 0) - payments.reduce((s, p) => s + Number(p.amount), 0)

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!firstName.trim()) return setError('El cliente necesita un nombre')

    const body = {
      firstName: firstName.trim(),
      lastName: lastName.trim() || null,
      alias: alias.trim() || null,
      idNumber: idNumber.trim() || null,
      email: email.trim() || null,
      whatsapp: whatsapp.trim() || null,
      ...(isAdmin && { creditEnabled, creditLimit: creditEnabled && creditLimit ? Number(creditLimit) : null }),
    }

    setSaving(true)
    try {
      if (isEdit) await api(`/customers/${customer.id}`, { method: 'PATCH', body })
      else await api('/customers', { method: 'POST', body })
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function agregarCargo({ amount, description }) {
    const cargo = await api(`/customers/${customer.id}/charges`, {
      method: 'POST',
      body: { amount, description },
    })
    setCharges((prev) => [cargo, ...prev])
  }

  async function agregarPago({ amount, note }) {
    const pago = await api(`/customers/${customer.id}/payments`, {
      method: 'POST',
      body: { amount, note },
    })
    setPayments((prev) => [pago, ...prev])
  }

  const historial = [
    ...charges.map((c) => ({ ...c, tipo: 'cargo' })),
    ...payments.map((p) => ({ ...p, tipo: 'pago' })),
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="card w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-5"
      >
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{isEdit ? 'Editar cliente' : 'Nuevo cliente'}</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-ink">
            <Icon.x />
          </button>
        </header>

        {error && (
          <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
            {error}
          </p>
        )}

        {isEdit && (
          <div
            className={`flex items-center justify-between rounded-xl px-3 py-2.5 border ${
              balance > 0
                ? 'border-ocupada/30 bg-ocupada/10'
                : balance < 0
                  ? 'border-reservada/30 bg-reservada/10'
                  : 'border-libre/30 bg-libre/10'
            }`}
          >
            <span className="text-sm font-medium">Saldo</span>
            <span
              className={`text-sm font-bold ${
                balance > 0 ? 'text-ocupada' : balance < 0 ? 'text-reservada' : 'text-libre'
              }`}
            >
              {balance === 0 ? 'Al día' : balance > 0 ? `Debe ${money(balance)}` : `A favor ${money(-balance)}`}
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Nombre</label>
            <input className="field" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <label className="label">Apellido</label>
            <input className="field" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Alias</label>
            <input
              className="field"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="Como le dicen"
            />
          </div>
          <div>
            <label className="label">Cédula (opcional)</label>
            <input className="field" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Correo electrónico</label>
            <input
              type="email"
              className="field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="label">WhatsApp</label>
            <input className="field" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
          </div>
        </div>

        <div className="space-y-3 bg-raised border border-edge rounded-xl p-3">
          <div className="flex items-center justify-between">
            <label className="label mb-0">Crédito en el bar (fiado)</label>
            <button
              type="button"
              disabled={!isAdmin}
              onClick={() => setCreditEnabled((v) => !v)}
              className={`h-8 px-3 rounded-pill text-xs font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                creditEnabled
                  ? 'bg-amber text-night border-amber'
                  : 'bg-surface text-muted border-edge hover:text-ink'
              }`}
            >
              {creditEnabled ? 'Habilitado' : 'Deshabilitado'}
            </button>
          </div>

          {!isAdmin && (
            <p className="text-xs text-muted">Solo el administrador puede habilitar o cambiar el crédito.</p>
          )}

          {creditEnabled && (
            <div>
              <label className="label">Límite (opcional)</label>
              <MoneyInput
                className="field"
                value={creditLimit}
                onChange={setCreditLimit}
                placeholder="Sin tope"
                disabled={!isAdmin}
              />
            </div>
          )}
        </div>

        {isEdit && creditEnabled && (
          <CargoForm onAgregar={agregarCargo} />
        )}
        {isEdit && <PagoForm onAgregar={agregarPago} />}

        {isEdit && (
          <div className="space-y-2">
            <h3 className="label mb-0">Historial</h3>
            {historial.length === 0 ? (
              <p className="text-sm text-muted">Todavía no hay consumos ni pagos registrados.</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {historial.map((h) => (
                  <div
                    key={h.id}
                    className="flex items-center justify-between bg-raised border border-edge rounded-xl px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {h.tipo === 'cargo' ? h.description : h.note || 'Abono'}
                      </p>
                      <p className="text-xs text-muted">
                        {h.createdBy?.name} · {formatFecha(h.createdAt)}
                      </p>
                    </div>
                    <span
                      className={`text-sm font-semibold shrink-0 ml-2 ${
                        h.tipo === 'cargo' ? 'text-ocupada' : 'text-libre'
                      }`}
                    >
                      {h.tipo === 'cargo' ? '+' : '-'}
                      {money(h.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost flex-1">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="btn-primary flex-1">
            {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear cliente'}
          </button>
        </div>
      </form>
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
      <label className="label">Registrar consumo fiado</label>
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
      <label className="label">Registrar pago / abono</label>
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
        <button type="button" onClick={agregar} disabled={saving} className="btn-ghost h-10">
          <Icon.plus width={16} height={16} />
          Agregar
        </button>
      </div>
    </div>
  )
}

function formatFecha(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
}
