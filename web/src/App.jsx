import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Shell from './components/Shell'
import Login from './pages/Login'
import NuevaVenta from './pages/NuevaVenta'
import Distribucion from './pages/Distribucion'
import Productos from './pages/Productos'
import Caja from './pages/Caja'
import Clientes from './pages/Clientes'

function Protegida({ children, soloAdmin = false, roles }) {
  const { session, loading } = useAuth()
  if (loading) return <div className="h-full grid place-items-center text-muted">Cargando…</div>
  if (!session) return <Navigate to="/entrar" replace />
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
            path="/clientes"
            element={<Protegida roles={['ADMIN', 'CAJERO']}><Clientes /></Protegida>}
          />
          <Route
            path="/distribucion"
            element={<Protegida soloAdmin><Distribucion /></Protegida>}
          />
          <Route path="/productos" element={<Protegida soloAdmin><Productos /></Protegida>} />
          <Route
            path="/reportes"
            element={<Protegida soloAdmin><Pendiente titulo="Reportes" /></Protegida>}
          />
          <Route
            path="/configuracion"
            element={<Protegida soloAdmin><Pendiente titulo="Configuración" /></Protegida>}
          />
          <Route path="*" element={<Navigate to="/venta" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
