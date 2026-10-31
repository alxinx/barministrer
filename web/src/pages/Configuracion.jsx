import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icons'

const SECTORES = [
  {
    to: '/configuracion/datos',
    icon: Icon.gear,
    titulo: 'Datos del negocio',
    descripcion: 'Nombre, logo, dirección y datos tributarios para la factura.',
  },
  {
    to: '/configuracion/permisos',
    icon: Icon.crown,
    titulo: 'Permisos',
    descripcion: 'Dale a cajero acceso puntual a algo que hoy es solo tuyo.',
  },
]

export default function Configuracion() {
  const navigate = useNavigate()

  return (
    <div className="p-5 md:p-7 max-w-[900px] mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Configuración</h1>
        <p className="text-muted text-sm mt-1">Elige qué quieres configurar.</p>
      </header>

      <div className="grid sm:grid-cols-2 gap-4">
        {SECTORES.map((s) => (
          <button
            key={s.to}
            type="button"
            onClick={() => navigate(s.to)}
            className="card p-5 text-left hover:border-amber/50 transition-colors flex flex-col gap-3"
          >
            <span className="w-11 h-11 rounded-xl bg-raised border border-edge grid place-items-center text-amberText shrink-0">
              <s.icon width={20} height={20} />
            </span>
            <div>
              <p className="font-semibold">{s.titulo}</p>
              <p className="text-sm text-muted mt-1">{s.descripcion}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
