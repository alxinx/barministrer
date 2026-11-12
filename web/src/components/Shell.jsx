import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Icon } from './Icons'
import { useAuth } from '../context/AuthContext'
import SimuladorImpresora from './SimuladorImpresora'
import SyncBadge from './SyncBadge'

// Items sin `to`: todavia no tienen pantalla propia (ver CLAUDE.md / lo
// acordado con Alejo nov-2026). Quedan visibles pero deshabilitados en vez de
// desaparecer, para que se sepa que van a existir y no haya que reconstruir
// el menu cuando se agreguen.
const nav = [
  { to: '/venta', label: 'POS y pedidos', icon: Icon.cart, roles: ['ADMIN', 'CAJERO', 'MESERO'] },
  { to: '/caja', label: 'Caja', icon: Icon.cash, roles: ['ADMIN', 'CAJERO'] },
  { to: '/distribucion', label: 'Distribución', icon: Icon.tables, roles: ['ADMIN'], permiso: 'cajeroGestionaDistribucion' },

  {
    section: 'Gestión comercial',
    roles: ['ADMIN'],
    permisoAny: ['cajeroEditaCatalogo', 'cajeroGestionaInventario'],
  },
  {
    label: 'Catálogo',
    icon: Icon.box,
    roles: ['ADMIN'],
    permiso: 'cajeroEditaCatalogo',
    children: [
      { to: '/productos', label: 'Productos' },
      { label: 'Categorías' },
      { label: 'Complementos y variantes' },
    ],
  },
  {
    label: 'Inventario',
    icon: Icon.truck,
    roles: ['ADMIN'],
    permiso: 'cajeroGestionaInventario',
    children: [
      { to: '/insumos', label: 'Insumos' },
      { to: '/productos/inventario', label: 'Ver inventario' },
      { to: '/recetas', label: 'Recetas y preparaciones' },
      { to: '/compras', label: 'Compras', modulo: 'moduloCompras' },
      { to: '/proveedores', label: 'Proveedores', modulo: 'moduloCompras' },
      { label: 'Movimientos' },
    ],
  },
  { to: '/clientes', label: 'Clientes', icon: Icon.users, roles: ['ADMIN', 'CAJERO'] },

  { to: '/reportes', label: 'Reportes', icon: Icon.chart, roles: ['ADMIN'] },
  { to: '/usuarios', label: 'Usuarios', icon: Icon.crown, roles: ['ADMIN'], permiso: 'cajeroGestionaUsuarios' },
  { to: '/cajas-bancos', label: 'Cajas y bancos', icon: Icon.bank, roles: ['ADMIN'], modulo: 'moduloCajasBancos' },
  { to: '/configuracion', label: 'Configuración', icon: Icon.gear, roles: ['ADMIN'] },
]

// Admin siempre ve el item. Cajero lo ve si el dueno le delego ese permiso
// puntual desde /configuracion/permisos (ver tambien App.jsx: el flag es el
// mismo que protege la ruta, asi que nunca aparece un item que de clic no
// lleve a nada). `permisoAny` es para un separador de seccion: se ve si
// cualquiera de los permisos de lo que agrupa esta delegado, no hace falta
// los dos. `modulo` es distinto de `permiso`: si el modulo esta apagado,
// NINGUN rol lo ve, ni siquiera ADMIN -- no es un permiso delegable, es una
// funcionalidad que el tenant puede no tener contratada (solo plataforma la
// prende, ver Tenant.moduloCajasBancos).
function visible(item, role, tenant) {
  if (item.modulo && !tenant?.[item.modulo]) return false
  if (item.roles.includes(role)) return true
  if (role !== 'CAJERO') return false
  if (item.permiso) return Boolean(tenant?.[item.permiso])
  if (item.permisoAny) return item.permisoAny.some((p) => Boolean(tenant?.[p]))
  return false
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

  // Debajo de md (768px) el <aside> de escritorio se oculta entero -- sin
  // esto no habia NINGUNA forma de navegar desde un celular. Se cierra solo
  // al cambiar de ruta (ChildLink/NavLink ya llaman onNavigate, esto es
  // ademas un respaldo para atras/adelante del navegador).
  const [menuMovil, setMenuMovil] = useState(false)
  useEffect(() => {
    setMenuMovil(false)
  }, [location.pathname])

  function salirMovil() {
    setMenuMovil(false)
    salir()
  }

  return (
    <div className="h-full flex flex-col md:flex-row bg-canvas">
      {/* Barra superior solo en celular: unico punto de entrada al menu ahi
          abajo de md, donde el <aside> de escritorio esta oculto entero. */}
      <header className="md:hidden flex items-center gap-3 px-4 h-14 shrink-0 border-b border-sidebarEdge bg-sidebar text-sidebarInk sidebar-panel">
        <button
          type="button"
          onClick={() => setMenuMovil(true)}
          aria-label="Abrir menú"
          className="text-sidebarMuted hover:text-sidebarInk -ml-1 p-1.5"
        >
          <Icon.menu width={22} height={22} />
        </button>
        <span className="font-bold truncate flex-1">{session?.tenant.name || 'Barminister'}</span>
        <SyncBadge />
      </header>

      {/* Fondo oscuro detras del panel flotante: un clic afuera lo cierra. */}
      {menuMovil && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/60" onClick={() => setMenuMovil(false)} />
      )}

      {/* Panel flotante del menu en celular: desliza desde la izquierda,
          siempre con los textos visibles (nunca el modo solo-iconos del
          escritorio, no tendria sentido en un panel que ya es flotante). */}
      <aside
        className={`md:hidden fixed inset-y-0 left-0 z-50 w-[280px] max-w-[85vw] flex flex-col border-r border-sidebarEdge bg-sidebar text-sidebarInk transition-transform duration-200 ${
          menuMovil ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between gap-3 px-4 h-14 shrink-0 border-b border-sidebarEdge">
          <span className="font-bold truncate">{session?.tenant.name || 'Barminister'}</span>
          <button
            type="button"
            onClick={() => setMenuMovil(false)}
            aria-label="Cerrar menú"
            className="text-sidebarMuted hover:text-sidebarInk p-1 shrink-0"
          >
            <Icon.x width={20} height={20} />
          </button>
        </div>

        <NavListMovil role={role} tenant={session?.tenant} location={location} onNavigate={() => setMenuMovil(false)} />

        <div className="p-3 border-t border-sidebarEdge flex items-center gap-3 shrink-0">
          <span className="rounded-full bg-sidebarRaised border border-sidebarEdge grid place-items-center font-bold shrink-0 w-9 h-9 text-sm">
            {session?.user.name
              .split(' ')
              .slice(0, 2)
              .map((w) => w[0])
              .join('')}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{session?.user.name}</p>
            <p className="text-xs text-sidebarMuted capitalize">{role?.toLowerCase()}</p>
          </div>
          <button onClick={salirMovil} title="Cerrar sesión" className="text-sidebarMuted hover:text-sidebarOcupada p-1 shrink-0">
            <Icon.exit width={16} height={16} />
          </button>
        </div>
      </aside>

      {/* Debajo de 900px (breakpoint `nav`, no uno estandar de Tailwind) se
          retrae a solo iconos: una barra angosta todavia dice donde esta
          cada cosa sin robarle espacio a la pantalla de venta. Encima de eso,
          `colapsado` hace lo mismo pero por eleccion del usuario. Todo esto
          es ademas invisible debajo de md -- ahi el menu vive en el panel
          flotante de arriba. */}
      <aside
        className={`hidden md:flex relative shrink-0 flex-col border-r border-sidebarEdge bg-sidebar text-sidebarInk w-16 sidebar-panel ${
          colapsado ? '' : 'nav:w-60'
        }`}
      >
        {/* Botón para retraer/expandir, solo tiene sentido con espacio de
            sobra (nav:+); debajo de eso ya esta forzado a solo iconos. */}
        <button
          type="button"
          onClick={alternarColapsado}
          title={colapsado ? 'Expandir menú' : 'Retraer menú'}
          className="hidden nav:flex absolute -right-3 top-6 w-6 h-6 rounded-full border border-sidebarEdge bg-sidebarRaised text-sidebarMuted hover:text-sidebarInk items-center justify-center z-10"
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
                <img src="/img/isotipo.webp" alt="" className="w-8 h-8 rounded-lg shrink-0" />
                <div>
                  <p className="font-bold leading-none">Barminister</p>
                  <p className="text-xs text-sidebarMuted mt-1">{session?.tenant.name}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <nav className="px-3 flex-1 space-y-1">
          {nav
            .filter((item) => visible(item, role, session?.tenant))
            .map((item) =>
              item.section ? (
                <div key={`section:${item.section}`} className="pt-4 pb-1">
                  <p
                    className={`${colapsado ? 'hidden' : 'hidden nav:block'} px-3 text-[10px] font-bold tracking-wider text-sidebarMuted/70 uppercase`}
                  >
                    {item.section}
                  </p>
                  <hr className={`${colapsado ? 'block' : 'block nav:hidden'} border-sidebarEdge mx-3`} />
                </div>
              ) : item.children ? (
                <NavGroup
                  key={item.label}
                  item={item}
                  active={item.children.some((c) => location.pathname === c.to)}
                  colapsado={colapsado}
                  tenant={session?.tenant}
                />
              ) : (
                <NavLink
                  key={item.to}
                  to={item.to}
                  title={item.label}
                  className={({ isActive }) =>
                    `flex items-center justify-center ${colapsado ? '' : 'nav:justify-start'} gap-3 h-11 px-3 rounded-xl text-sm font-medium transition-colors ${
                      isActive ? 'bg-amber text-night' : 'text-sidebarMuted hover:text-sidebarInk hover:bg-sidebarRaised'
                    }`
                  }
                >
                  <item.icon />
                  <span className={colapsado ? 'hidden' : 'hidden nav:inline'}>{item.label}</span>
                </NavLink>
              )
            )}
        </nav>

        <div className={`p-2 border-t border-sidebarEdge ${colapsado ? '' : 'nav:p-3'}`}>
          <div className={colapsado ? 'hidden' : 'hidden nav:flex justify-center pb-2'}>
            <SyncBadge />
          </div>
          <div
            className={`flex flex-col items-center gap-2 px-1 py-2 ${
              colapsado ? '' : 'nav:flex-row nav:gap-3 nav:px-2'
            }`}
          >
            <span
              className={`rounded-full bg-sidebarRaised border border-sidebarEdge grid place-items-center font-bold shrink-0 w-8 h-8 text-xs ${
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
              <p className="text-xs text-sidebarMuted capitalize">{role?.toLowerCase()}</p>
            </div>
            <button onClick={salir} title="Cerrar sesión" className="text-sidebarMuted hover:text-sidebarOcupada p-1">
              <Icon.exit width={16} height={16} />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
      <SimuladorImpresora />
    </div>
  )
}

function NavGroup({ item, active, colapsado, tenant }) {
  const [open, setOpen] = useState(active)
  const ref = useRef(null)

  // Mismo criterio que `visible()` arriba, pero a nivel de hijo: un hijo con
  // `modulo` (ej. Compras) solo se ve si el tenant lo tiene activo, sin
  // importar el rol -- el padre ("Inventario") puede ser visible por otros
  // hijos aunque este en particular este apagado.
  const children = item.children.filter((c) => !c.modulo || tenant?.[c.modulo])

  // `colapsado` solo cuenta la retraccion manual (>=900px). Debajo de 900px
  // el menu se retrae solo por CSS (`nav:`), sin que este booleano se
  // entere -- por eso aqui tambien seguimos el breakpoint con matchMedia,
  // para saber en JS si estamos en modo solo-iconos por cualquiera de las
  // dos razones.
  const [anchoNav, setAnchoNav] = useState(() => window.matchMedia('(min-width: 900px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)')
    const onChange = (e) => setAnchoNav(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const soloIconos = colapsado || !anchoNav
  const expandido = open && !soloIconos

  // En modo solo-iconos no hay espacio para expandir inline, asi que el
  // submenu sale en un flyout flotante junto al icono. Se cierra solo con
  // un clic afuera: si no, queda pegado abierto tapando lo de al lado.
  useEffect(() => {
    if (!open || !soloIconos) return
    function onClickAfuera(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickAfuera)
    return () => document.removeEventListener('mousedown', onClickAfuera)
  }, [open, soloIconos])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={item.label}
        className={`w-full flex items-center justify-center gap-3 h-11 px-3 rounded-xl text-sm font-medium transition-colors ${
          colapsado ? '' : 'nav:justify-start'
        } ${active && !expandido ? 'text-amberText' : 'text-sidebarMuted hover:text-sidebarInk hover:bg-sidebarRaised'}`}
      >
        <span className="relative shrink-0">
          <item.icon />
          {/* Solo-iconos no deja espacio para la flechita de abajo -- sin
              esto, un grupo con submenu era indistinguible de un link
              normal hasta que alguien le hacia clic por curiosidad. Un
              triangulo chiquito en la esquina basta para avisar "esto
              despliega algo", sin competir con el icono. */}
          {soloIconos && <span className="absolute -bottom-0.5 -right-1 w-0 h-0 border-t-[3px] border-t-transparent border-b-[3px] border-b-transparent border-l-[4px] border-l-amber" />}
        </span>
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
        <div className="hidden nav:block pl-[22px] mt-1 space-y-1 border-l border-sidebarEdge ml-5">
          {children.map((c) => (
            <ChildLink key={c.to || c.label} c={c} />
          ))}
        </div>
      )}

      {open && soloIconos && (
        <div className="absolute left-full top-0 ml-2 z-20 min-w-[190px] bg-sidebarRaised border border-sidebarEdge text-sidebarInk rounded-2xl p-1.5 space-y-0.5 shadow-xl">
          <p className="px-2.5 pt-1 pb-1.5 text-xs font-semibold text-sidebarMuted">{item.label}</p>
          {children.map((c) => (
            <ChildLink key={c.to || c.label} c={c} onNavigate={() => setOpen(false)} />
          ))}
        </div>
      )}
    </div>
  )
}

// Un hijo sin `to` todavia no tiene pantalla propia: se ve en el menu (para
// que se sepa que existe en el diseno) pero no es un link de verdad, no
// reacciona a hover ni foco. "Pronto" en vez de ocultarlo evita que alguien
// piense que el boton no sirvio de nada.
function ChildLink({ c, onNavigate }) {
  if (!c.to) {
    return (
      <span className="flex flex-col gap-0.5 px-3 py-1.5 rounded-lg text-sm leading-tight text-sidebarMuted/50 select-none">
        {c.label}
        <span className="text-[9px] font-semibold uppercase tracking-wide text-sidebarMuted/40">Pronto</span>
      </span>
    )
  }
  return (
    <NavLink
      to={c.to}
      end
      onClick={onNavigate}
      className={({ isActive }) =>
        `block px-3 py-1.5 rounded-lg text-sm leading-tight transition-colors ${
          isActive ? 'bg-amber text-night font-medium' : 'text-sidebarMuted hover:text-sidebarInk hover:bg-sidebarRaised'
        }`
      }
    >
      {c.label}
    </NavLink>
  )
}

// Version del menu para el panel flotante de celular: siempre expandido, sin
// modo solo-iconos ni flyout -- en un panel que ya es flotante y a pantalla
// completa de ancho no tiene sentido retraer nada. Reusa `nav`, `visible()`
// y `ChildLink` tal cual; solo cambia como se renderiza el contenedor.
function NavListMovil({ role, tenant, location, onNavigate }) {
  return (
    <nav className="px-3 py-3 flex-1 space-y-1 overflow-y-auto">
      {nav
        .filter((item) => visible(item, role, tenant))
        .map((item) =>
          item.section ? (
            <p
              key={`section:${item.section}`}
              className="pt-4 pb-1 px-3 text-[10px] font-bold tracking-wider text-sidebarMuted/70 uppercase"
            >
              {item.section}
            </p>
          ) : item.children ? (
            <NavGroupMovil
              key={item.label}
              item={item}
              active={item.children.some((c) => location.pathname === c.to)}
              tenant={tenant}
              onNavigate={onNavigate}
            />
          ) : (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={({ isActive }) =>
                `flex items-center gap-3 h-11 px-3 rounded-xl text-sm font-medium transition-colors ${
                  isActive ? 'bg-amber text-night' : 'text-sidebarMuted hover:text-sidebarInk hover:bg-sidebarRaised'
                }`
              }
            >
              <item.icon />
              <span>{item.label}</span>
            </NavLink>
          )
        )}
    </nav>
  )
}

function NavGroupMovil({ item, active, tenant, onNavigate }) {
  const [open, setOpen] = useState(active)
  const children = item.children.filter((c) => !c.modulo || tenant?.[c.modulo])

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-3 h-11 px-3 rounded-xl text-sm font-medium transition-colors ${
          active && !open ? 'text-amberText' : 'text-sidebarMuted hover:text-sidebarInk hover:bg-sidebarRaised'
        }`}
      >
        <item.icon />
        <span className="flex-1 text-left">{item.label}</span>
        <Icon.chevronDown width={15} height={15} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="pl-[22px] mt-1 space-y-1 border-l border-sidebarEdge ml-5">
          {children.map((c) => (
            <ChildLink key={c.to || c.label} c={c} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  )
}
