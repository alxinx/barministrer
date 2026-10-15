import { useState } from 'react'
import { api } from '../lib/api'
import { Icon } from './Icons'
import { useAuth } from '../context/AuthContext'
import PinInput, { PIN_LENGTH } from './PinInput'

const ROLES = [
  { value: 'MESERO', label: 'Mesero/a' },
  { value: 'CAJERO', label: 'Cajero/a' },
  { value: 'ADMIN', label: 'Administrador' },
]

/**
 * Crear o editar un usuario. La clave y el PIN se dejan en blanco al editar:
 * si el admin no escribe nada, no se tocan. Es la unica forma de "resetear"
 * sin obligar a retipear la clave cada vez que se cambia el nombre.
 */
export default function UsuarioForm({ user, onClose, onSaved }) {
  const { session } = useAuth()
  const esAdminReal = session?.user.role === 'ADMIN'
  const esNuevo = !user
  // Un cajero con el permiso delegado gestiona meseras y cajeros, pero nunca
  // una cuenta de administrador: ni la crea ni se la encuentra en la lista.
  const rolesDisponibles = esAdminReal ? ROLES : ROLES.filter((r) => r.value !== 'ADMIN')

  const [name, setName] = useState(user?.name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [role, setRole] = useState(user?.role || 'MESERO')
  const [active, setActive] = useState(user?.active ?? true)
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function guardar() {
    if (!name.trim() || !email.trim()) return setError('Nombre y correo son obligatorios')
    if (esNuevo && password.length < 6) return setError('La clave debe tener minimo 6 caracteres')
    if (pin && pin.length !== PIN_LENGTH) return setError(`El PIN debe tener exactamente ${PIN_LENGTH} dígitos`)

    setError('')
    setSaving(true)
    try {
      if (esNuevo) {
        await api('/users', {
          method: 'POST',
          body: { name: name.trim(), email: email.trim(), password, role, pin: pin || undefined },
        })
      } else {
        await api(`/users/${user.id}`, {
          method: 'PATCH',
          body: {
            name: name.trim(),
            email: email.trim(),
            role,
            active,
            ...(password ? { password } : {}),
            ...(pin ? { pin } : {}),
          },
        })
      }
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-sm p-5 space-y-4">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{esNuevo ? 'Nuevo usuario' : 'Editar usuario'}</h2>
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
          <label className="label">Nombre</label>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>

        <div>
          <label className="label">Correo</label>
          <input
            type="email"
            className="field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div>
          <label className="label">Rol</label>
          <select className="field" value={role} onChange={(e) => setRole(e.target.value)}>
            {rolesDisponibles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">{esNuevo ? 'Clave' : 'Nueva clave (opcional)'}</label>
          <input
            type="password"
            className="field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={esNuevo ? 'Mínimo 6 caracteres' : 'Déjalo en blanco para no cambiarla'}
          />
        </div>

        <div>
          <label className="label text-center">
            {esNuevo ? 'PIN (opcional)' : 'Nuevo PIN (opcional)'}
          </label>
          <PinInput value={pin} onChange={setPin} />
          <p className="text-xs text-muted text-center mt-2">
            {role === 'MESERO'
              ? 'Solo lo usan admin/cajero para autorizar'
              : user?.tienePin
                ? 'Ya tiene uno · déjalo en blanco para no cambiarlo'
                : `${PIN_LENGTH} dígitos`}
          </p>
        </div>

        {!esNuevo && (
          <div className="flex items-center justify-between bg-raised border border-edge rounded-xl p-3">
            <div>
              <p className="text-sm font-medium">Activo</p>
              <p className="text-xs text-muted">Desactivado no puede iniciar sesión, pero su historial se conserva</p>
            </div>
            <button
              type="button"
              onClick={() => setActive((v) => !v)}
              className={`h-7 w-12 rounded-pill relative transition-colors shrink-0 ${
                active ? 'bg-amber' : 'bg-raised border border-edge'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full transition-transform ${
                  active ? 'translate-x-5 bg-night' : 'bg-muted'
                }`}
              />
            </button>
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost flex-1">
            Cancelar
          </button>
          <button type="button" onClick={guardar} disabled={saving} className="btn-primary flex-1">
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
