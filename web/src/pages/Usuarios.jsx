import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Icon } from '../components/Icons'
import UsuarioForm from '../components/UsuarioForm'

const ROLE_LABEL = { ADMIN: 'Administrador', CAJERO: 'Cajero/a', MESERO: 'Mesero/a' }

export default function Usuarios() {
  const { session } = useAuth()
  const esAdminReal = session?.user.role === 'ADMIN'
  const [users, setUsers] = useState([])
  const [target, setTarget] = useState(undefined) // undefined = cerrado, null = nuevo, usuario = editar
  const [error, setError] = useState('')

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setUsers(await api('/users'))
  }

  async function alternar(user) {
    setError('')
    try {
      await api(`/users/${user.id}`, { method: 'PATCH', body: { active: !user.active } })
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  function cerrar() {
    setTarget(undefined)
  }
  function guardado() {
    cerrar()
    load()
  }

  return (
    <div className="p-5 md:p-7 max-w-[900px] mx-auto">
      <header className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-bold">Usuarios</h1>
          <p className="text-muted text-sm mt-1">
            Quién puede entrar al sistema y qué rol tiene. Desactivar un usuario le cierra el acceso
            sin borrar su historial de pedidos y turnos.
          </p>
        </div>
        <button onClick={() => setTarget(null)} className="btn-primary">
          <Icon.plus />
          Nuevo usuario
        </button>
      </header>

      {error && (
        <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5 mb-5">
          {error}
        </p>
      )}

      <div className="card divide-y divide-edge">
        {users.map((u) => {
          const bloqueada = u.role === 'ADMIN' && !esAdminReal
          return (
          <div key={u.id} className="flex items-center gap-4 p-4">
            <span className="w-10 h-10 rounded-full bg-raised border border-edge grid place-items-center text-sm font-bold shrink-0">
              {u.name
                .split(' ')
                .slice(0, 2)
                .map((w) => w[0])
                .join('')}
            </span>

            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm truncate flex items-center gap-2">
                {u.name}
                {u.id === session?.user.id && <span className="text-xs text-muted">(tú)</span>}
              </p>
              <p className="text-xs text-muted truncate">{u.email}</p>
            </div>

            <span className="text-xs font-semibold px-2.5 py-1 rounded-pill border border-edge text-muted shrink-0">
              {ROLE_LABEL[u.role]}
            </span>

            <button
              onClick={() => alternar(u)}
              disabled={bloqueada}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-pill border shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
                u.active ? 'text-libre border-libre/40 bg-libre/10' : 'text-muted border-edge bg-raised'
              }`}
            >
              {u.active ? 'Activo' : 'Desactivado'}
            </button>

            <button
              onClick={() => setTarget(u)}
              disabled={bloqueada}
              className="text-muted hover:text-ink shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Editar"
            >
              <Icon.gear width={16} height={16} />
            </button>
          </div>
          )
        })}

        {users.length === 0 && <p className="p-10 text-center text-muted text-sm">Cargando…</p>}
      </div>

      {target !== undefined && <UsuarioForm user={target} onClose={cerrar} onSaved={guardado} />}
    </div>
  )
}
