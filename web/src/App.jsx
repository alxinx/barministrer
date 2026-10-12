import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Shell from './components/Shell'
import Login from './pages/Login'
import NuevaVenta from './pages/NuevaVenta'
import Distribucion from './pages/Distribucion'
import Productos from './pages/Productos'
import AgregarInventario from './pages/AgregarInventario'
import Caja from './pages/Caja'
import TurnoDetalle from './pages/TurnoDetalle'
import Clientes from './pages/Clientes'
import ClienteDetalle from './pages/ClienteDetalle'
import Usuarios from './pages/Usuarios'
import Reportes from './pages/Reportes'
import ReporteVentas from './pages/ReporteVentas'
import UtilidadProducto from './pages/UtilidadProducto'
import Configuracion from './pages/Configuracion'
import DatosBar from './pages/DatosBar'
import Permisos from './pages/Permisos'

// `permiso` es el flag de Tenant que el dueno puede prender para delegarle
// esto a CAJERO (ver /configuracion/permisos). ADMIN siempre entra; cualquier
// otro rol necesita que ese flag especifico este en true para este tenant.
function Protegida({ children, soloAdmin = false, roles, permiso }) {
  const { session, loading } = useAuth()
  if (loading) return <div className="h-full grid place-items-center text-muted">Cargando…</div>
  if (!session) return <Navigate to="/entrar" replace />
  if (permiso) {
    const tienePermiso = session.user.role === 'ADMIN' || (session.user.role === 'CAJERO' && session.tenant[permiso])
    if (!tienePermiso) return <Navigate to="/venta" replace />
    return <Shell>{children}</Shell>
  }
  if (soloAdmin && session.user.role !== 'ADMIN') return <Navigate to="/venta" replace />
  if (roles && !roles.includes(session.user.role)) return <Navigate to="/venta" replace />
  return <Shell>{children}</Shell>
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
          <Route path="/configuracion" element={<Protegida soloAdmin><Configuracion /></Protegida>} />
          <Route path="/configuracion/datos" element={<Protegida soloAdmin><DatosBar /></Protegida>} />
          <Route path="/configuracion/permisos" element={<Protegida soloAdmin><Permisos /></Protegida>} />
          <Route path="*" element={<Navigate to="/venta" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
