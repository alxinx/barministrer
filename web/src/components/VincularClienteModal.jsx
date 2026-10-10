import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import MoneyInput from './MoneyInput'
import { Icon } from './Icons'

/**
 * Asocia un cliente ya registrado a la cuenta de la mesa, o permite
 * registrar uno nuevo ahi mismo si no existe. Habilitar credito sigue
 * siendo decision de ADMIN, igual que en el modulo de clientes.
 */
export default function VincularClienteModal({ order, onClose, onVinculado }) {
  const { session } = useAuth()
  const isAdmin = session?.user.role === 'ADMIN'
  const [customers, setCustomers] = useState([])
  const [search, setSearch] = useState('')
  const [creando, setCreando] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api('/customers').then(setCustomers)
  }, [])

  const resultados = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return []
    return customers.filter((c) =>
      [c.firstName, c.lastName, c.alias, c.idNumber].filter(Boolean).join(' ').toLowerCase().includes(term)
    )
  }, [customers, search])

  async function vincular(customerId) {
    setSaving(true)
    setError('')
    try {
      const actualizada = await api(`/orders/${order.id}/customer`, { method: 'PATCH', body: { customerId } })
      onVinculado(actualizada)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Cliente de la mesa</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-ink">
            <Icon.x />
          </button>
        </header>

        {error && (
          <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
            {error}
          </p>
        )}

        {order.customer && !creando && (
          <div className="flex items-center justify-between bg-raised border border-edge rounded-xl px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">
                {order.customer.firstName} {order.customer.lastName}
                {order.customer.alias && ` · ${order.customer.alias}`}
              </p>
              <p className="text-xs text-muted">Cliente actual de esta cuenta</p>
            </div>
            <button
              onClick={() => vincular(null)}
              disabled={saving}
              className="text-xs font-semibold text-ocupada hover:underline shrink-0"
            >
              Quitar
            </button>
          </div>
        )}

        {!creando && (
          <>
            <div>
              <label className="label">Buscar por cédula, alias o nombre</label>
              <input
                className="field"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ej: Juan, Juanito, 1020304050"
                autoFocus
              />
            </div>

            {search.trim() && (
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {resultados.length === 0 ? (
                  <div className="text-center py-2 space-y-3">
                    <p className="text-sm text-muted">No hay ningún cliente con ese dato.</p>
                    <button type="button" onClick={() => setCreando(true)} className="btn-ghost w-full">
                      <Icon.plus width={16} height={16} />
                      Registrar cliente nuevo
                    </button>
                  </div>
                ) : (
                  resultados.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => vincular(c.id)}
                      disabled={saving}
                      className="w-full flex items-center justify-between bg-raised border border-edge rounded-xl
                                 px-3 py-2.5 hover:border-amber text-left transition-colors"
                    >
                      <div>
                        <p className="text-sm font-medium">
                          {c.firstName} {c.lastName}
                          {c.alias && ` · ${c.alias}`}
                        </p>
                        <p className="text-xs text-muted">{c.idNumber || 'Sin cédula'}</p>
                      </div>
                      {c.creditEnabled && (
                        <span className="text-[10px] font-bold text-amber border border-amber/40 rounded-pill px-2 py-0.5 shrink-0">
                          Crédito
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </>
        )}

        {creando && (
          <RegistroInline isAdmin={isAdmin} onCancel={() => setCreando(false)} onCreado={(c) => vincular(c.id)} />
        )}
      </div>
    </div>
  )
}

function RegistroInline({ isAdmin, onCancel, onCreado }) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [alias, setAlias] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [creditEnabled, setCreditEnabled] = useState(false)
  const [creditLimit, setCreditLimit] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!firstName.trim()) return setError('El cliente necesita un nombre')
    setSaving(true)
    setError('')
    try {
      const nuevo = await api('/customers', {
        method: 'POST',
        body: {
          firstName: firstName.trim(),
          lastName: lastName.trim() || null,
          alias: alias.trim() || null,
          idNumber: idNumber.trim() || null,
          ...(isAdmin && {
            creditEnabled,
            creditLimit: creditEnabled && creditLimit ? Number(creditLimit) : null,
          }),
        },
      })
      onCreado(nuevo)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">Registrar cliente nuevo</p>

      {error && (
        <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">{error}</p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Nombre</label>
          <input className="field" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="label">Apellido</label>
          <input className="field" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Alias</label>
          <input className="field" value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Como le dicen" />
        </div>
        <div>
          <label className="label">Cédula (opcional)</label>
          <input className="field" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
        </div>
      </div>

      <div className="space-y-3 bg-raised border border-edge rounded-xl p-3">
        <div className="flex items-center justify-between">
          <label className="label mb-0">Crédito en el bar</label>
          <button
            type="button"
            disabled={!isAdmin}
            onClick={() => setCreditEnabled((v) => !v)}
            className={`h-8 px-3 rounded-pill text-xs font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              creditEnabled ? 'bg-amber text-night border-amber' : 'bg-surface text-muted border-edge hover:text-ink'
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
            <MoneyInput className="field" value={creditLimit} onChange={setCreditLimit} placeholder="Sin tope" />
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <button type="button" onClick={onCancel} className="btn-ghost flex-1">
          Cancelar
        </button>
        <button type="button" onClick={submit} disabled={saving} className="btn-primary flex-1">
          {saving ? 'Guardando…' : 'Registrar y vincular'}
        </button>
      </div>
    </div>
  )
}
