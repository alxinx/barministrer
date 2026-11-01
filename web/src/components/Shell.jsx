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

const CLAVE_COLAPSADO = 'licorplus:sidebarColapsado'

export default function Shell({ children }) {
  const { session, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const role = session?.user.role

  // Encima de 900px el usuario puede retraer el menu manualmente (ver boton
  // mas abajo); por debajo siempre se retrae solo, sin importar esto.
  const [colapsado, setColapsado] = useState(() => {
    try {
      return localStorage.getItem(CLAVE_COLAPSADO) === '1'
    } catch {
      return false
    }
  })

  function alternarColapsado() {
    setColapsado((v) => {
      const siguiente = !v
      try {
        localStorage.setItem(CLAVE_COLAPSADO, siguiente ? '1' : '0')
      } catch {
        // Sin localStorage (modo privado, etc.) simplemente no persiste.
      }
      return siguiente
    })
  }

  function salir() {
    logout()
    navigate('/entrar')
  }

  return (
    <div className="h-full flex bg-canvas">
      {/* Debajo de 900px (breakpoint `nav`, no uno estandar de Tailwind) se
          retrae a solo iconos: una barra angosta todavia dice donde esta
          cada cosa sin robarle espacio a la pantalla de venta. Encima de eso,
          `colapsado` hace lo mismo pero por eleccion del usuario. */}
      <aside
        className={`hidden md:flex relative shrink-0 flex-col border-r border-edge bg-surface w-16 ${
          colapsado ? '' : 'nav:w-60'
        }`}
      >
        {/* Botón para retraer/expandir, solo tiene sentido con espacio de
            sobra (nav:+); debajo de eso ya esta forzado a solo iconos. */}
        <button
          type="button"
          onClick={alternarColapsado}
          title={colapsado ? 'Expandir menú' : 'Retraer menú'}
          className="hidden nav:flex absolute -right-3 top-6 w-6 h-6 rounded-full border border-edge bg-raised text-muted hover:text-ink items-center justify-center z-10"
        >
          <Icon.chevronLeft width={13} height={13} className={colapsado ? 'rotate-180' : ''} />
        </button>

        <div className={`px-3 py-5 ${colapsado ? '' : 'nav:px-5'}`}>
          {/* Colapsado: siempre las iniciales del bar, nunca el logo — un
              banner de hasta 200px no cabe en una barra de iconos. */}
          <div className={colapsado ? 'flex justify-center' : 'nav:hidden flex justify-center'}>
            <span className="w-9 h-9 rounded-lg bg-amber grid place-items-center text-night font-extrabold text-sm">
              {(session?.tenant.name || 'L').slice(0, 2).toUpperCase()}
            </span>
          </div>

          <div className={colapsado ? 'hidden' : 'hidden nav:block'}>
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
                <NavGroup
                  key={item.label}
                  item={item}
                  active={item.children.some((c) => location.pathname === c.to)}
                  colapsado={colapsado}
                />
              ) : (
                <NavLink
                  key={item.to}
                  to={item.to}
                  title={item.label}
                  className={({ isActive }) =>
                    `flex items-center justify-center ${colapsado ? '' : 'nav:justify-start'} gap-3 h-11 px-3 rounded-xl text-sm font-medium transition-colors ${
                      isActive ? 'bg-amber text-night' : 'text-muted hover:text-ink hover:bg-raised'
                    }`
                  }
                >
                  <item.icon />
                  <span className={colapsado ? 'hidden' : 'hidden nav:inline'}>{item.label}</span>
                </NavLink>
              )
            )}
        </nav>

        <div className={`p-2 border-t border-edge ${colapsado ? '' : 'nav:p-3'}`}>
          <div
            className={`flex flex-col items-center gap-2 px-1 py-2 ${
              colapsado ? '' : 'nav:flex-row nav:gap-3 nav:px-2'
            }`}
          >
            <span
              className={`rounded-full bg-raised border border-edge grid place-items-center font-bold shrink-0 w-8 h-8 text-xs ${
                colapsado ? '' : 'nav:w-9 nav:h-9 nav:text-sm'
              }`}
            >
              {session?.user.name
                .split(' ')
                .slice(0, 2)
                .map((w) => w[0])
                .join('')}
            </span>
            <div className={colapsado ? 'hidden' : 'hidden nav:block min-w-0 flex-1'}>
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

function NavGroup({ item, active, colapsado }) {
  const [open, setOpen] = useState(active)
  const expandido = open && !colapsado

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={item.label}
        className={`w-full flex items-center justify-center gap-3 h-11 px-3 rounded-xl text-sm font-medium transition-colors ${
          colapsado ? '' : 'nav:justify-start'
        } ${active && !expandido ? 'text-amberText' : 'text-muted hover:text-ink hover:bg-raised'}`}
      >
        <item.icon />
        <span className={colapsado ? 'hidden' : 'hidden nav:block flex-1 text-left'}>{item.label}</span>
        <Icon.chevronDown
          width={15}
          height={15}
          className={`${colapsado ? 'hidden' : 'hidden nav:block'} transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* El contenido solo se ve expandido de 900px para arriba y sin
          retraer manualmente: colapsado no hay donde meter una sublista con
          texto (los hijos no tienen icono propio). El estado `open` sigue
          vivo por si la ventana crece o se expande de nuevo. */}
      {expandido && (
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
