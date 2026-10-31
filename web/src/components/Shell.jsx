import { useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Icon } from './Icons'
import { useAuth } from '../context/AuthContext'

const nav = [
  { to: '/venta', label: 'POS y pedidos', icon: Icon.cart, roles: ['ADMIN', 'CAJERO', 'MESERO'] },
  { to: '/caja', label: 'Caja', icon: Icon.cash, roles: ['ADMIN', 'CAJERO'] },
  { to: '/clientes', label: 'Clientes', icon: Icon.users, roles: ['ADMIN', 'CAJERO'] },
  { to: '/distribucion', label: 'Distribución', icon: Icon.tables, roles: ['ADMIN'], permiso: 'cajeroGestionaDistribucion' },
  {
    label: 'Productos',
    icon: Icon.box,
    roles: ['ADMIN'],
    permiso: 'cajeroEditaCatalogo',
    children: [
      { to: '/productos', label: 'Ver productos' },
      { to: '/productos/inventario', label: 'Agregar inventario' },
    ],
  },
  { to: '/reportes', label: 'Reportes', icon: Icon.chart, roles: ['ADMIN'] },
  { to: '/usuarios', label: 'Usuarios', icon: Icon.crown, roles: ['ADMIN'], permiso: 'cajeroGestionaUsuarios' },
  { to: '/configuracion', label: 'Configuración', icon: Icon.gear, roles: ['ADMIN'] },
]

// Admin siempre ve el item. Cajero lo ve si el dueno le delego ese permiso
// puntual desde /configuracion/permisos (ver tambien App.jsx: el flag es el
// mismo que protege la ruta, asi que nunca aparece un item que de clic no
// lleve a nada).
function visible(item, role, tenant) {
  if (item.roles.includes(role)) return true
  return role === 'CAJERO' && item.permiso && Boolean(tenant?.[item.permiso])
}

export default function Shell({ children }) {
  const { session, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const role = session?.user.role

  function salir() {
    logout()
    navigate('/entrar')
  }

  return (
    <div className="h-full flex bg-canvas">
      {/* Debajo de 900px (breakpoint `nav`, no uno estandar de Tailwind) se
          retrae a solo iconos: una barra angosta todavia dice donde esta
          cada cosa sin robarle espacio a la pantalla de venta. */}
      <aside className="hidden md:flex w-16 nav:w-60 shrink-0 flex-col border-r border-edge bg-surface">
        <div className="px-3 nav:px-5 py-5">
          {/* Colapsado: siempre las iniciales del bar, nunca el logo — un
              banner de hasta 200px no cabe en una barra de iconos. */}
          <div className="nav:hidden flex justify-center">
            <span className="w-9 h-9 rounded-lg bg-amber grid place-items-center text-night font-extrabold text-sm">
              {(session?.tenant.name || 'L').slice(0, 2).toUpperCase()}
            </span>
          </div>

          <div className="hidden nav:block">
            {session?.tenant.logoUrl ? (
              // El logo del bar (banner 200x70 max) ya trae su propia marca:
              // reemplaza el bloque de texto en vez de ir apretado al lado.
              // max-h al tope real del archivo (70px): si se achica mas, se ve
              // mas chico de lo que la imagen ya permite sin perder nitidez.
              // Centrado: el logo casi nunca llena los 200px de ancho, y
              // pegado a la izquierda se ve descuadrado con el resto del menu.
              <div className="flex justify-center">
                <img
                  src={session.tenant.logoUrl}
                  alt={session.tenant.name}
                  className="max-w-full max-h-[70px] object-contain"
                />
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-amber grid place-items-center text-night font-extrabold shrink-0">
                  L
                </span>
                <div>
                  <p className="font-bold leading-none">LicorPlus</p>
                  <p className="text-xs text-muted mt-1">{session?.tenant.name}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <nav className="px-3 flex-1 space-y-1">
          {nav
            .filter((item) => visible(item, role, session?.tenant))
            .map((item) =>
              item.children ? (
                <NavGroup key={item.label} item={item} active={item.children.some((c) => location.pathname === c.to)} />
              ) : (
                <NavLink
                  key={item.to}
                  to={item.to}
                  title={item.label}
                  className={({ isActive }) =>
                    `flex items-center justify-center nav:justify-start gap-3 h-11 px-3 rounded-xl text-sm font-medium transition-colors ${
                      isActive ? 'bg-amber text-night' : 'text-muted hover:text-ink hover:bg-raised'
                    }`
                  }
                >
                  <item.icon />
                  <span className="hidden nav:inline">{item.label}</span>
                </NavLink>
              )
            )}
        </nav>

        <div className="p-2 nav:p-3 border-t border-edge">
          <div className="flex flex-col nav:flex-row items-center gap-2 nav:gap-3 px-1 nav:px-2 py-2">
            <span className="w-8 h-8 nav:w-9 nav:h-9 rounded-full bg-raised border border-edge grid place-items-center text-xs nav:text-sm font-bold shrink-0">
              {session?.user.name
                .split(' ')
                .slice(0, 2)
                .map((w) => w[0])
                .join('')}
            </span>
            <div className="hidden nav:block min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{session?.user.name}</p>
              <p className="text-xs text-muted capitalize">{role?.toLowerCase()}</p>
            </div>
            <button onClick={salir} title="Cerrar sesión" className="text-muted hover:text-ocupada p-1">
              <Icon.exit width={16} height={16} />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
    </div>
  )
}

function NavGroup({ item, active }) {
  const [open, setOpen] = useState(active)

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={item.label}
        className={`w-full flex items-center justify-center nav:justify-start gap-3 h-11 px-3 rounded-xl text-sm font-medium transition-colors ${
          active && !open ? 'text-amberText' : 'text-muted hover:text-ink hover:bg-raised'
        }`}
      >
        <item.icon />
        <span className="hidden nav:block flex-1 text-left">{item.label}</span>
        <Icon.chevronDown
          width={15}
          height={15}
          className={`hidden nav:block transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* El contenido solo se ve expandido de 900px para arriba: colapsado no
          hay donde meter una sublista con texto (los hijos no tienen icono
          propio). El estado `open` sigue vivo por si la ventana crece. */}
      {open && (
        <div className="hidden nav:block pl-[22px] mt-1 space-y-1 border-l border-edge ml-5">
          {item.children.map((c) => (
            <NavLink
              key={c.to}
              to={c.to}
              end
              className={({ isActive }) =>
                `block h-9 px-3 rounded-lg text-sm leading-9 transition-colors ${
                  isActive ? 'bg-amber text-night font-medium' : 'text-muted hover:text-ink hover:bg-raised'
                }`
              }
            >
              {c.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}
