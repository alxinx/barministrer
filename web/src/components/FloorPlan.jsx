import { useRef, useState } from 'react'

const CELL = 64 // px por celda de la cuadricula
const GAP = 6

const statusRing = {
  AVAILABLE: 'border-libre/60',
  RESERVED: 'border-reservada/60',
  OCCUPIED: 'border-ocupada/60',
  CLOSED: 'border-edge',
}
const statusDot = {
  AVAILABLE: 'bg-libre',
  RESERVED: 'bg-reservada',
  OCCUPIED: 'bg-ocupada',
  CLOSED: 'bg-muted',
}

const elementStyle = {
  WALL: 'bg-edge',
  BAR: 'bg-raised border border-amberDim',
  DOOR: 'bg-transparent border-2 border-dashed border-muted/50',
  PLANT: 'bg-libre/10 border border-libre/25',
  STAGE: 'bg-amberDim/25 border border-amberDim',
  TEXT: 'bg-transparent',
}

/**
 * Dibuja una zona. Con editable=true las piezas se arrastran por la cuadricula
 * y se avisa al padre con onMove; sin el es solo lectura (el POS).
 */
const MAX_SIZE = 8 // mismo tope que el campo numerico de ancho/alto

const ROTATE_SNAP = 15 // grados por paso, para que sea facil caer justo en 0/90/180/270

export default function FloorPlan({
  zone,
  editable = false,
  blockMode = false,
  selectedId,
  onSelect,
  onMove,
  onResize,
  onRotate,
  onBlockCell,
  onGestureStart,
  onGestureEnd,
  onContextMenu,
  elapsedByTable = {},
  pendingIds,
}) {
  const boardRef = useRef(null)
  const [dragging, setDragging] = useState(null)
  const [resizing, setResizing] = useState(null)
  const [rotating, setRotating] = useState(null)
  const [painting, setPainting] = useState(null)

  if (!zone) return null

  const cols = zone.gridCols
  const rows = zone.gridRows
  const blockedCells = zone.blockedCells || []
  const isBlocked = (x, y) => blockedCells.some((c) => c.x === x && c.y === y)

  function cellFromPointer(e) {
    const rect = boardRef.current.getBoundingClientRect()
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * cols)
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * rows)
    return { x: Math.max(0, Math.min(cols - 1, x)), y: Math.max(0, Math.min(rows - 1, y)) }
  }

  function startDrag(e, kind, item) {
    if (!editable || blockMode) return
    e.preventDefault()
    onGestureStart?.()
    setDragging({ kind, id: item.id })
    onSelect?.(kind, item)
  }

  // Bloquear celdas: pintar sobre el tablero para sacar celdas del salon
  // (plano en L, recortes). El primer click decide la accion (tapar o
  // destapar) y arrastrar la repite sobre cada celda nueva.
  function startPaint(e) {
    if (!blockMode) return
    onGestureStart?.()
    const { x, y } = cellFromPointer(e)
    const adding = !isBlocked(x, y)
    setPainting({ adding })
    onBlockCell?.(x, y, adding)
  }

  // Redimensionar: arrastrar desde la esquina inferior derecha, como se agranda
  // una foto. El punto gridX/gridY no se mueve, solo cambia el ancho/alto.
  function startResize(e, kind, item) {
    if (!editable) return
    e.preventDefault()
    e.stopPropagation()
    onGestureStart?.()
    setResizing({
      kind,
      id: item.id,
      gridX: item.gridX,
      gridY: item.gridY,
      startWidth: item.width,
      startHeight: item.height,
      startClientX: e.clientX,
      startClientY: e.clientY,
    })
    onSelect?.(kind, item)
  }

  // Rotar: arrastrar el mango redondo de arriba. El angulo se calcula siempre
  // desde el centro de la pieza hasta el puntero (no incremental), para que no
  // se acumule error ni importe donde iba la rotacion antes.
  function startRotate(e, item) {
    if (!editable) return
    e.preventDefault()
    e.stopPropagation()
    onGestureStart?.()
    const rect = boardRef.current.getBoundingClientRect()
    const centerX = rect.left + ((item.gridX + item.width / 2) / cols) * rect.width
    const centerY = rect.top + ((item.gridY + item.height / 2) / rows) * rect.height
    setRotating({ id: item.id, centerX, centerY })
    onSelect?.('element', item)
  }

  function onPointerMove(e) {
    if (dragging) {
      const { x, y } = cellFromPointer(e)
      onMove?.(dragging.kind, dragging.id, x, y)
      return
    }
    if (resizing) {
      const rect = boardRef.current.getBoundingClientRect()
      const deltaX = Math.round(((e.clientX - resizing.startClientX) / rect.width) * cols)
      const deltaY = Math.round(((e.clientY - resizing.startClientY) / rect.height) * rows)
      const maxWidth = Math.min(MAX_SIZE, cols - resizing.gridX)
      const maxHeight = Math.min(MAX_SIZE, rows - resizing.gridY)
      const width = Math.max(1, Math.min(maxWidth, resizing.startWidth + deltaX))
      const height = Math.max(1, Math.min(maxHeight, resizing.startHeight + deltaY))
      onResize?.(resizing.kind, resizing.id, width, height)
      return
    }
    if (rotating) {
      const dx = e.clientX - rotating.centerX
      const dy = e.clientY - rotating.centerY
      const raw = (Math.atan2(dx, -dy) * 180) / Math.PI
      const normalized = (raw + 360) % 360
      const snapped = (Math.round(normalized / ROTATE_SNAP) * ROTATE_SNAP) % 360
      onRotate?.(rotating.id, snapped)
      return
    }
    if (painting) {
      const { x, y } = cellFromPointer(e)
      onBlockCell?.(x, y, painting.adding)
    }
  }

  function endPointer() {
    const hadGesture = dragging || resizing || rotating || painting
    setDragging(null)
    setResizing(null)
    setRotating(null)
    setPainting(null)
    if (hadGesture) onGestureEnd?.()
  }

  const style = (item) => ({
    left: `${(item.gridX / cols) * 100}%`,
    top: `${(item.gridY / rows) * 100}%`,
    width: `calc(${(item.width / cols) * 100}% - ${GAP}px)`,
    height: `calc(${(item.height / rows) * 100}% - ${GAP}px)`,
    margin: `${GAP / 2}px`,
  })

  return (
    <div
      ref={boardRef}
      onPointerDown={startPaint}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerLeave={endPointer}
      className={`relative w-full rounded-2xl bg-surface border border-edge overflow-hidden select-none
        ${blockMode ? 'cursor-crosshair' : ''}`}
      style={{
        aspectRatio: `${cols} / ${rows}`,
        minHeight: 320,
        backgroundImage: editable
          ? `linear-gradient(to right, rgba(255,255,255,.04) 1px, transparent 1px),
             linear-gradient(to bottom, rgba(255,255,255,.04) 1px, transparent 1px)`
          : undefined,
        backgroundSize: `${100 / cols}% ${100 / rows}%`,
      }}
    >
      {/* Celdas fuera del salon: tapan el fondo de cuadricula para simular un
          recorte (plano en L, etc). Van primero, debajo de todo lo demas. */}
      {blockedCells.map(({ x, y }) => (
        <div
          key={`blocked-${x}-${y}`}
          className={`absolute bg-night ${blockMode ? 'border border-dashed border-amber/30' : ''}`}
          style={{
            left: `${(x / cols) * 100}%`,
            top: `${(y / rows) * 100}%`,
            width: `${100 / cols}%`,
            height: `${100 / rows}%`,
          }}
        />
      ))}

      {/* Elementos primero: quedan debajo de las mesas */}
      {zone.elements?.map((el) => (
        <div
          key={el.id}
          onPointerDown={(e) => startDrag(e, 'element', el)}
          style={{ ...style(el), transform: `rotate(${el.rotation || 0}deg)` }}
          className={`absolute rounded-lg grid place-items-center text-xs text-muted
            ${elementStyle[el.type]}
            ${editable ? 'cursor-grab active:cursor-grabbing' : ''}
            ${selectedId === el.id ? 'ring-2 ring-amber' : ''}`}
        >
          {el.label}
          {editable && !blockMode && selectedId === el.id && (
            <>
              <RotateHandle onPointerDown={(e) => startRotate(e, el)} />
              <ResizeHandle onPointerDown={(e) => startResize(e, 'element', el)} />
            </>
          )}
        </div>
      ))}

      {zone.tables?.map((t) => {
        const elapsed = elapsedByTable[t.id]
        const pendiente = pendingIds?.has(t.id)
        return (
          <button
            key={t.id}
            type="button"
            onPointerDown={(e) => startDrag(e, 'table', t)}
            onClick={() => !editable && onSelect?.('table', t)}
            onContextMenu={(e) => {
              if (editable || !onContextMenu) return
              e.preventDefault()
              onContextMenu(t, e)
            }}
            style={style(t)}
            className={`absolute grid place-content-center gap-0.5 border-2 bg-raised
              transition-colors
              ${t.shape === 'ROUND' ? 'rounded-full' : 'rounded-xl'}
              ${selectedId === t.id ? 'border-amber bg-amber/10' : statusRing[t.status]}
              ${editable ? 'cursor-grab active:cursor-grabbing' : 'hover:border-amber'}`}
          >
            {pendiente && (
              <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-amber border-2 border-night animate-pulse" />
            )}
            <span className={`w-2 h-2 rounded-full justify-self-center ${statusDot[t.status]}`} />
            <span className={`text-mesa ${pendiente ? 'text-amber' : ''}`}>{t.number}</span>
            <span className="text-[11px] text-muted">{t.seats} pers.</span>
            {elapsed && (
              <span className="text-[11px] font-semibold text-reservada">{elapsed}</span>
            )}
            {editable && !blockMode && selectedId === t.id && (
              <ResizeHandle onPointerDown={(e) => startResize(e, 'table', t)} />
            )}
          </button>
        )
      })}

      {!zone.tables?.length && !zone.elements?.length && (
        <p className="absolute inset-0 grid place-items-center text-muted text-sm px-6 text-center">
          {editable
            ? 'Zona vacía. Agrega mesas y elementos desde el panel de la derecha.'
            : 'Esta zona todavía no tiene mesas.'}
        </p>
      )}
    </div>
  )
}

function RotateHandle({ onPointerDown }) {
  return (
    <>
      <span className="absolute left-1/2 top-0 w-px h-5 bg-amber/60 -translate-x-1/2 -translate-y-5" />
      <span
        onPointerDown={onPointerDown}
        style={{ touchAction: 'none' }}
        className="absolute left-1/2 top-0 w-4 h-4 rounded-full bg-amber border-2 border-night
                   -translate-x-1/2 -translate-y-[34px] cursor-grab active:cursor-grabbing"
      />
    </>
  )
}

function ResizeHandle({ onPointerDown }) {
  return (
    <span
      onPointerDown={onPointerDown}
      style={{ touchAction: 'none' }}
      className="absolute -right-1.5 -bottom-1.5 w-[18px] h-[18px] rounded-sm bg-amber
                 border-2 border-night cursor-nwse-resize"
    />
  )
}

export { CELL }
