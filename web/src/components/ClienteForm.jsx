import { useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import MoneyInput from './MoneyInput'
import { Icon } from './Icons'

/**
 * Crea o edita los datos basicos de un cliente (identidad, contacto y el
 * interruptor de credito). El saldo, el historial de cargos/pagos y la
 * grafica de consumo viven en la pagina dedicada del cliente, no aqui:
 * este modal es solo para entrar o corregir datos, de paso o desde esa
 * pagina. Habilitar credito (y su tope) es una decision de confianza del
 * dueno: solo ADMIN puede tocarlo, igual que allowsPour en categorias.
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
      const saved = isEdit
        ? await api(`/customers/${customer.id}`, { method: 'PATCH', body })
        : await api('/customers', { method: 'POST', body })
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

