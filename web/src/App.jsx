import { Suspense, lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { PlatformAuthProvider, usePlatformAuth } from './context/PlatformAuthContext'
import { ShiftProvider } from './context/ShiftContext'
import Shell from './components/Shell'
import ModuloNoDisponible from './components/ModuloNoDisponible'

// Cada pantalla es su propio chunk: una mesera solo opera /venta y nunca
// deberia descargar el codigo de Reportes, Usuarios, Permisos o el editor de
// Distribucion (ademas, su rol ni siquiera entra ahi). En una conexion mala
// desde el celular, los KB que no se piden importan mas que los que si.
const Login = lazy(() => import('./pages/Login'))
const NuevaVenta = lazy(() => import('./pages/NuevaVenta'))
const Distribucion = lazy(() => import('./pages/Distribucion'))
const Productos = lazy(() => import('./pages/Productos'))
const AgregarInventario = lazy(() => import('./pages/AgregarInventario'))
const Insumos = lazy(() => import('./pages/Insumos'))
const Recetas = lazy(() => import('./pages/Recetas'))
const Compras = lazy(() => import('./pages/Compras'))
const Proveedores = lazy(() => import('./pages/Proveedores'))
const Caja = lazy(() => import('./pages/Caja'))
const TurnoDetalle = lazy(() => import('./pages/TurnoDetalle'))
const Clientes = lazy(() => import('./pages/Clientes'))
const ClienteDetalle = lazy(() => import('./pages/ClienteDetalle'))
const Usuarios = lazy(() => import('./pages/Usuarios'))
const Reportes = lazy(() => import('./pages/Reportes'))
const ReporteVentas = lazy(() => import('./pages/ReporteVentas'))
const UtilidadProducto = lazy(() => import('./pages/UtilidadProducto'))
const Configuracion = lazy(() => import('./pages/Configuracion'))
const DatosBar = lazy(() => import('./pages/DatosBar'))
const Permisos = lazy(() => import('./pages/Permisos'))
const CajasBancos = lazy(() => import('./pages/CajasBancos'))
const PlataformaLogin = lazy(() => import('./pages/plataforma/Login'))
const PlataformaPanel = lazy(() => import('./pages/plataforma/Panel'))
const PlataformaTarifas = lazy(() => import('./pages/plataforma/Tarifas'))
const PlataformaTenantDetalle = lazy(() => import('./pages/plataforma/TenantDetalle'))

function Cargando() {
  return <div className="h-full grid place-items-center text-muted">Cargando…</div>
}

// `permiso` es el flag de Tenant que el dueno puede prender para delegarle
// esto a CAJERO (ver /configuracion/permisos). ADMIN siempre entra; cualquier
// otro rol necesita que ese flag especifico este en true para este tenant.
// `modulo` es distinto: si el tenant no lo tiene contratado, NADIE entra, ni
// siquiera ADMIN -- solo plataforma lo activa (ver Tenant.moduloCajasBancos).
// A diferencia de los demas casos, no redirige: se queda en la misma ruta con
// el Shell puesto (sidebar y topbar visibles) y muestra ModuloNoDisponible en
// el area de contenido -- tambien reacciona en vivo si el modulo se apaga
// mientras la persona esta parada ahi (ver el socket 'tenant:actualizado' en
// AuthContext, que refresca session.tenant).
function Protegida({ children, soloAdmin = false, roles, permiso, modulo, moduloNombre }) {
  const { session, loading } = useAuth()
  if (loading) return <Cargando />
  if (!session) return <Navigate to="/entrar" replace />
  if (modulo && !session.tenant?.[modulo]) {
    return (
      <Shell>
        <ModuloNoDisponible nombre={moduloNombre} />
      </Shell>
    )
  }
  if (permiso) {
    const tienePermiso = session.user.role === 'ADMIN' || (session.user.role === 'CAJERO' && session.tenant[permiso])
    if (!tienePermiso) return <Navigate to="/venta" replace />
    return <Shell>{children}</Shell>
  }
  if (soloAdmin && session.user.role !== 'ADMIN') return <Navigate to="/venta" replace />
  if (roles && !roles.includes(session.user.role)) return <Navigate to="/venta" replace />
  return <Shell>{children}</Shell>
}

// La plataforma es otra sesion (PlatformAdmin, sin tenantId), asi que no
// reusa Protegida: no hay rol de tenant que revisar ni Shell del bar que
// envolver, solo que haya una sesion de plataforma activa.
function PlataformaProtegida({ children }) {
  const { session, loading } = usePlatformAuth()
  if (loading) return <Cargando />
  if (!session) return <Navigate to="/plataforma/entrar" replace />
  return children
}

function Pendiente({ titulo }) {
  return (
    <div className="p-7">
      <h1 className="text-2xl font-bold">{titulo}</h1>
      <p className="text-muted text-sm mt-2">Este módulo todavía no está construido.</p>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ShiftProvider>
          <Suspense fallback={<Cargando />}>
            <Routes>
              <Route path="/entrar" element={<Login />} />
              <Route path="/venta" element={<Protegida><NuevaVenta /></Protegida>} />
              <Route
                path="/caja"
                element={<Protegida roles={['ADMIN', 'CAJERO']}><Caja /></Protegida>}
              />
              <Route
                path="/caja/turnos/:id"
                element={<Protegida roles={['ADMIN', 'CAJERO']}><TurnoDetalle /></Protegida>}
              />
              <Route
                path="/clientes"
                element={<Protegida roles={['ADMIN', 'CAJERO']}><Clientes /></Protegida>}
              />
              <Route
                path="/clientes/:id"
                element={<Protegida roles={['ADMIN', 'CAJERO']}><ClienteDetalle /></Protegida>}
              />
              <Route
                path="/distribucion"
                element={<Protegida permiso="cajeroGestionaDistribucion"><Distribucion /></Protegida>}
              />
              <Route
                path="/usuarios"
                element={<Protegida permiso="cajeroGestionaUsuarios"><Usuarios /></Protegida>}
              />
              <Route
                path="/productos"
                element={<Protegida permiso="cajeroEditaCatalogo"><Productos /></Protegida>}
              />
              <Route
                path="/productos/inventario"
                element={<Protegida permiso="cajeroGestionaInventario"><AgregarInventario /></Protegida>}
              />
              <Route
                path="/insumos"
                element={<Protegida permiso="cajeroGestionaInventario"><Insumos /></Protegida>}
              />
              <Route
                path="/recetas"
                element={<Protegida permiso="cajeroGestionaInventario"><Recetas /></Protegida>}
              />
              <Route
                path="/compras"
                element={
                  <Protegida modulo="moduloCompras" moduloNombre="Compras y proveedores" permiso="cajeroGestionaInventario">
                    <Compras />
                  </Protegida>
                }
              />
              <Route
                path="/proveedores"
                element={
                  <Protegida modulo="moduloCompras" moduloNombre="Compras y proveedores" permiso="cajeroGestionaInventario">
                    <Proveedores />
                  </Protegida>
                }
              />
              <Route path="/reportes" element={<Protegida soloAdmin><Reportes /></Protegida>} />
              <Route
                path="/reportes/utilidad-producto"
                element={<Protegida soloAdmin><UtilidadProducto /></Protegida>}
              />
              <Route path="/reportes/ventas" element={<Protegida soloAdmin><ReporteVentas /></Protegida>} />
              <Route
                path="/reportes/empleados"
                element={<Protegida soloAdmin><Pendiente titulo="Reporte de empleados" /></Protegida>}
              />
              <Route
                path="/cajas-bancos"
                element={
                  <Protegida modulo="moduloCajasBancos" moduloNombre="Cajas y bancos" soloAdmin>
                    <CajasBancos />
                  </Protegida>
                }
              />
              <Route path="/configuracion" element={<Protegida soloAdmin><Configuracion /></Protegida>} />
              <Route path="/configuracion/datos" element={<Protegida soloAdmin><DatosBar /></Protegida>} />
              <Route path="/configuracion/permisos" element={<Protegida soloAdmin><Permisos /></Protegida>} />
              <Route
                path="/plataforma/*"
                element={
                  <PlatformAuthProvider>
                    <Routes>
                      <Route path="entrar" element={<PlataformaLogin />} />
                      <Route
                        index
                        element={
                          <PlataformaProtegida>
                            <PlataformaPanel />
                          </PlataformaProtegida>
                        }
                      />
                      <Route
                        path="tarifas"
                        element={
                          <PlataformaProtegida>
                            <PlataformaTarifas />
                          </PlataformaProtegida>
                        }
                      />
                      <Route
                        path="tenants/:id"
                        element={
                          <PlataformaProtegida>
                            <PlataformaTenantDetalle />
                          </PlataformaProtegida>
                        }
                      />
                    </Routes>
                  </PlatformAuthProvider>
                }
              />
              <Route path="*" element={<Navigate to="/venta" replace />} />
            </Routes>
          </Suspense>
        </ShiftProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
