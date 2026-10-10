import { NavLink, useNavigate } from 'react-router-dom'
import { Icon } from './Icons'
import { useAuth } from '../context/AuthContext'

const nav = [
  { to: '/venta', label: 'Nueva venta', icon: Icon.cart, roles: ['ADMIN', 'CAJERO', 'MESERO'] },
  { to: '/caja', label: 'Caja', icon: Icon.cash, roles: ['ADMIN', 'CAJERO'] },
  { to: '/clientes', label: 'Clientes', icon: Icon.users, roles: ['ADMIN', 'CAJERO'] },
  { to: '/distribucion', label: 'Distribución', icon: Icon.tables, roles: ['ADMIN'] },
  { to: '/productos', label: 'Productos', icon: Icon.box, roles: ['ADMIN'] },
  { to: '/reportes', label: 'Reportes', icon: Icon.chart, roles: ['ADMIN'] },
  { to: '/configuracion', label: 'Configuración', icon: Icon.gear, roles: ['ADMIN'] },
]

export default function Shell({ children }) {
  const { session, logout } = useAuth()
  const navigate = useNavigate()
  const role = session?.user.role

  function salir() {
    logout()
    navigate('/entrar')
  }

  return (
    <div className="h-full flex bg-night">
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-edge bg-surface">
        <div className="px-5 py-6">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-amber grid place-items-center text-night font-extrabold">
              L
            </span>
            <div>
              <p className="font-bold leading-none">LicorPlus</p>
              <p className="text-xs text-muted mt-1">{session?.tenant.name}</p>
            </div>
          </div>
        </div>

        <nav className="px-3 flex-1 space-y-1">
          {nav
            .filter((item) => item.roles.includes(role))
            .map(({ to, label, icon: I }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-3 h-11 px-3 rounded-xl text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-amber text-night'
                      : 'text-muted hover:text-ink hover:bg-raised'
                  }`
                }
              >
                <I />
                {label}
              </NavLink>
            ))}
        </nav>

        <div className="p-3 border-t border-edge">
          <div className="flex items-center gap-3 px-2 py-2">
            <span className="w-9 h-9 rounded-full bg-raised border border-edge grid place-items-center text-sm font-bold">
              {session?.user.name
                .split(' ')
                .slice(0, 2)
                .map((w) => w[0])
                .join('')}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{session?.user.name}</p>
              <p className="text-xs text-muted capitalize">{role?.toLowerCase()}</p>
            </div>
            <button onClick={salir} title="Cerrar sesión" className="text-muted hover:text-ocupada p-1">
              <Icon.exit />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
    </div>
  )
}
