import { Icon } from './Icons'

// Reemplaza el contenido de una pagina de modulo (no el Shell: sidebar y
// topbar siguen visibles) cuando el tenant no tiene ese modulo contratado, o
// lo pierde en vivo mientras lo esta viendo (ver socket 'tenant:actualizado'
// en AuthContext). El boton queda deshabilitado a proposito: todavia no hay
// un canal de venta self-service (ver CLAUDE.md -- sin maquinaria SaaS hasta
// el segundo cliente real), asi que fingir que es clickeable seria peor que
// mostrarlo inactivo.
export default function ModuloNoDisponible({ nombre }) {
  return (
    <div className="h-full grid place-items-center p-4">
      <div className="flex flex-col items-center gap-3 text-center max-w-xs">
        <div className="w-20 h-20 rounded-full bg-raised border border-edge shadow-xl grid place-items-center">
          <Icon.lock width={32} height={32} className="text-muted" />
        </div>
        <div>
          <h2 className="text-lg font-bold">Este módulo no está disponible en tu plan</h2>
          <p className="text-sm text-muted mt-1">{nombre} es una función adicional de Barminister.</p>
        </div>
        <button type="button" className="btn-primary mt-1" disabled>
          Adquiérelo aquí
        </button>
      </div>
    </div>
  )
}
