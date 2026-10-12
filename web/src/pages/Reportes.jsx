import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icons'

const REPORTES = [
  {
    to: '/reportes/utilidad-producto',
    icon: Icon.chart,
    titulo: 'Utilidad de producto',
    descripcion: 'Qué tanto margen deja cada producto: precio contra su costo real.',
  },
  {
    to: '/reportes/ventas',
    icon: Icon.cash,
    titulo: 'Reporte de ventas',
    descripcion: 'Lo vendido por rango de fechas, medio de pago y categoría.',
  },
  {
    to: '/reportes/empleados',
    icon: Icon.users,
    titulo: 'Reporte de empleados',
    descripcion: 'Desempeño por mesero o cajero: ventas, turnos y novedades.',
  },
]

export default function Reportes() {
  const navigate = useNavigate()

  return (
    <div className="p-5 md:p-7 max-w-[900px] mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Reportes</h1>
        <p className="text-muted text-sm mt-1">Elige qué reporte quieres ver.</p>
      </header>

      <div className="grid sm:grid-cols-2 gap-4">
        {REPORTES.map((r) => (
          <button
            key={r.to}
            type="button"
            onClick={() => navigate(r.to)}
            className="card p-5 text-left hover:border-amber/50 transition-colors flex flex-col gap-3"
          >
            <span className="w-11 h-11 rounded-xl bg-raised border border-edge grid place-items-center text-amber shrink-0">
              <r.icon width={20} height={20} />
            </span>
            <div>
              <p className="font-semibold">{r.titulo}</p>
              <p className="text-sm text-muted mt-1">{r.descripcion}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
