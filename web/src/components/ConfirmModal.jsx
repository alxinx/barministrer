import { Icon } from './Icons'

/** Confirmacion generica antes de una accion que no se deshace: mejor preguntar. */
export default function ConfirmModal({
  title,
  message,
  confirmLabel = 'Eliminar',
  confirmIcon: ConfirmIcon = Icon.trash,
  onConfirm,
  onCancel,
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-sm p-5 space-y-4">
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="text-sm text-muted">{message}</p>
        <div className="flex gap-3 pt-1">
          <button onClick={onCancel} className="btn-ghost flex-1">
            Cancelar
          </button>
          <button onClick={onConfirm} className="btn-danger flex-1">
            <ConfirmIcon />
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
