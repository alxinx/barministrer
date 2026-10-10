import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Menu flotante de clic derecho sobre una mesa. Se ancla al punto del clic y
 * se corrige si se sale de la pantalla; se cierra con clic afuera o Escape.
 */
export default function TableContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))
    const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))
    setPos({ left, top })
  }, [x, y])

  useEffect(() => {
    function onDocPointerDown(e) {
      if (!ref.current?.contains(e.target)) onClose()
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onDocPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-50 w-56 py-1.5 rounded-xl bg-surface border border-edge shadow-xl"
    >
      {items.map((item, i) =>
        item.divider ? (
          <div key={i} className="my-1 border-t border-edge" />
        ) : (
          <button
            key={i}
            type="button"
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.onClick()
            }}
            className={`w-full text-left px-3.5 h-10 text-sm font-medium flex items-center gap-2
              disabled:opacity-40 disabled:cursor-not-allowed
              ${item.danger ? 'text-ocupada hover:bg-ocupada/10' : 'text-ink hover:bg-raised'}`}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  )
}
