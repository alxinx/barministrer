import { useRef, useState } from 'react'
import { Icon } from './Icons'

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

// Mismo formato que usa el panel de la cuenta: nombre y apellido, con el
// alias entre parentesis si tiene.
function nombreCliente(c) {
  if (!c) return ''
  const base = [c.firstName, c.lastName].filter(Boolean).join(' ')
  return c.alias ? `${base} (${c.alias})` : base
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
  onElementContextMenu,
  onTableContextMenu,
  elapsedByTable = {},
  pendingIds,
  // Seleccion de varias mesas a la vez (solo en el POS, nunca en el editor):
  // Ctrl/Cmd+clic suma o quita una mesa, y arrastrar sobre el fondo dibuja un
  // recuadro que selecciona todas las que toque. selectedIds/onToggleSelect/
  // onSelectRange los controla el padre; aqui solo se detecta el gesto.
  multiSelectable = false,
  selectedIds,
  onToggleSelect,
  onSelectRange,
  onMultiContextMenu,
  linkedIds,
}) {
  const boardRef = useRef(null)
  const [dragging, setDragging] = useState(null)
  const [resizing, setResizing] = useState(null)
  const [rotating, setRotating] = useState(null)
  const [painting, setPainting] = useState(null)
  const [seleccion, setSeleccion] = useState(null) // {x0,y0,x1,y1} en px relativos al tablero

  // En celular el clic derecho no existe: mantener el dedo 2s sobre la mesa
  // hace de context menu. Se cancela si se suelta antes o si el dedo se
  // corrio (eso es un intento de arrastrar/hacer scroll, no de mantener).
  const [pressingTableId, setPressingTableId] = useState(null)
  const longPressTimerRef = useRef(null)
  const longPressOriginRef = useRef(null)
  const suppressNextClickRef = useRef(false)

  function cancelarPulsacion() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    setPressingTableId(null)
  }

  // Misma logica que el onContextMenu de abajo, pero sin preventDefault (no
  // hay evento nativo que cancelar: esto lo dispara un timer, no el navegador).
  function dispararPorPulsacion(t, e) {
    if (editable) {
      if (blockMode || !onTableContextMenu) return
      onTableContextMenu(t)
      return
    }
    if (multiSelectable && selectedIds?.size >= 2 && selectedIds.has(t.id)) {
      onMultiContextMenu?.([...selectedIds], e)
      return
    }
    if (!onContextMenu) return
    onContextMenu(t, e)
  }

  if (!zone) return null

  const cols = zone.gridCols
  const rows = zone.gridRows
  const blockedCells = zone.blockedCells || []
  const isBlocked = (x, y) => blockedCells.some((c) => c.x === x && c.y === y)

  // Grupos de mesas fusionadas temporalmente (cada una ya trae su groupId
  // desde /zones): un contorno por grupo, calculado del rectangulo que cubre
  // a todas sus mesas, para que se vean como una sola figura en vez de solo
  // el link de cada una por separado.
  const gruposFusion = []
  for (const t of zone.tables || []) {
    if (!t.groupId) continue
    let grupo = gruposFusion.find((g) => g.principalId === t.groupId)
    if (!grupo) {
      grupo = { principalId: t.groupId, ids: [t.groupId] }
      gruposFusion.push(grupo)
    }
    grupo.ids.push(t.id)
  }
  function bboxDeGrupo(ids) {
    const miembros = (zone.tables || []).filter((t) => ids.includes(t.id))
    return {
      left: Math.min(...miembros.map((t) => t.gridX)),
      top: Math.min(...miembros.map((t) => t.gridY)),
      right: Math.max(...miembros.map((t) => t.gridX + t.width)),
      bottom: Math.max(...miembros.map((t) => t.gridY + t.height)),
    }
  }
  const idsFusionados = new Set(gruposFusion.flatMap((g) => g.ids))

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

  // Recuadro de seleccion: arrastrar sobre el fondo (nunca sobre una mesa,
  // esas manejan su propio clic/ctrl+clic) para elegir varias de un tiron, en
  // vez de ctrl+clic una por una.
  function startSelectionDrag(e) {
    if (editable || !multiSelectable || e.target.closest('button')) return
    const rect = boardRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setSeleccion({ x0: x, y0: y, x1: x, y1: y })
  }

  function tableRectPx(t) {
    const rect = boardRef.current.getBoundingClientRect()
    return {
      left: (t.gridX / cols) * rect.width,
      top: (t.gridY / rows) * rect.height,
      right: ((t.gridX + t.width) / cols) * rect.width,
      bottom: ((t.gridY + t.height) / rows) * rect.height,
    }
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
    if (seleccion) {
      const rect = boardRef.current.getBoundingClientRect()
      setSeleccion((s) => ({ ...s, x1: e.clientX - rect.left, y1: e.clientY - rect.top }))
    }
  }

  function endPointer() {
    const hadGesture = dragging || resizing || rotating || painting
    setDragging(null)
    setResizing(null)
    setRotating(null)
    setPainting(null)
    if (hadGesture) onGestureEnd?.()

    if (seleccion) {
      const left = Math.min(seleccion.x0, seleccion.x1)
      const right = Math.max(seleccion.x0, seleccion.x1)
      const top = Math.min(seleccion.y0, seleccion.y1)
      const bottom = Math.max(seleccion.y0, seleccion.y1)
      setSeleccion(null)
      // Un clic sin arrastrar sobre el fondo (sin soltar lejos de donde
      // empezo) limpia la seleccion en vez de "elegir" un recuadro de 0px.
      if (right - left < 4 && bottom - top < 4) {
        onSelectRange?.([])
        return
      }
      const idsEnRecuadro = (zone.tables || [])
        .filter((t) => {
          const r = tableRectPx(t)
          return !(r.right < left || r.left > right || r.bottom < top || r.top > bottom)
        })
        .map((t) => t.id)
      onSelectRange?.(idsEnRecuadro)
    }
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
      onPointerDown={(e) => {
        startPaint(e)
        startSelectionDrag(e)
      }}
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

      {/* Recuadro de seleccion en vivo mientras se arrastra. */}
      {seleccion && (
        <div
          className="absolute z-20 border-2 border-amber bg-amber/10 pointer-events-none rounded-sm"
          style={{
            left: Math.min(seleccion.x0, seleccion.x1),
            top: Math.min(seleccion.y0, seleccion.y1),
            width: Math.abs(seleccion.x1 - seleccion.x0),
            height: Math.abs(seleccion.y1 - seleccion.y0),
          }}
        />
      )}

      {/* Elementos primero: quedan debajo de las mesas */}
      {zone.elements?.map((el) => (
        <div
          key={el.id}
          onPointerDown={(e) => startDrag(e, 'element', el)}
          onContextMenu={(e) => {
            if (!editable || blockMode || !onElementContextMenu) return
            e.preventDefault()
            onElementContextMenu(el)
          }}
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

      {/* Contorno de cada grupo fusionado: un solo rectangulo punteado que
          envuelve a todas sus mesas, para que se lean como una sola cuenta
          de un vistazo y no solo por el link pequeño de cada una. */}
      {gruposFusion.map((g) => {
        const b = bboxDeGrupo(g.ids)
        return (
          <div
            key={g.principalId}
            className="absolute rounded-2xl border-2 border-dashed border-amber/70 pointer-events-none"
            style={{
              left: `calc(${(b.left / cols) * 100}% - 4px)`,
              top: `calc(${(b.top / rows) * 100}% - 4px)`,
              width: `calc(${((b.right - b.left) / cols) * 100}% + 8px)`,
              height: `calc(${((b.bottom - b.top) / rows) * 100}% + 8px)`,
            }}
          />
        )
      })}

      {/* Nombre del cliente asociado, como una etiqueta siempre visible
          (no al pasar el mouse: en el POS nadie usa mouse) encima de la mesa
          o, si esta fusionada, encima de todo el grupo. Solo en el POS: en
          el editor de planos el cliente no pinta nada. */}
      {!editable && (
        <>
          {gruposFusion.map((g) => {
            const b = bboxDeGrupo(g.ids)
            const cliente = (zone.tables || []).find((t) => g.ids.includes(t.id) && t.customer)?.customer
            if (!cliente) return null
            return (
              <ClienteTag
                key={`cliente-${g.principalId}`}
                left={((b.left + b.right) / 2 / cols) * 100}
                top={(b.top / rows) * 100}
                nombre={nombreCliente(cliente)}
              />
            )
          })}
          {zone.tables
            ?.filter((t) => t.customer && !idsFusionados.has(t.id))
            .map((t) => (
              <ClienteTag
                key={`cliente-${t.id}`}
                left={((t.gridX + t.width / 2) / cols) * 100}
                top={(t.gridY / rows) * 100}
                nombre={nombreCliente(t.customer)}
              />
            ))}
        </>
      )}

      {zone.tables?.map((t) => {
        const elapsed = elapsedByTable[t.id]
        const pendiente = pendingIds?.has(t.id)
        // Una mesa angosta y alta (ej. una esquina pegada a la pared) no le
        // alcanza el ancho al numero/nombre: se gira el texto 90 grados para
        // que corra a lo largo del lado mas largo en vez de desbordarse.
        const vertical = t.height > t.width
        const multiSel = multiSelectable && selectedIds?.has(t.id)
        const vinculada = linkedIds?.has(t.id)
        return (
          <button
            key={t.id}
            type="button"
            onPointerDown={(e) => {
              startDrag(e, 'table', t)
              if (e.pointerType !== 'touch') return
              longPressOriginRef.current = { x: e.clientX, y: e.clientY }
              setPressingTableId(t.id)
              const clientX = e.clientX
              const clientY = e.clientY
              longPressTimerRef.current = setTimeout(() => {
                longPressTimerRef.current = null
                setPressingTableId(null)
                suppressNextClickRef.current = true
                dispararPorPulsacion(t, { clientX, clientY, preventDefault() {} })
              }, 2000)
            }}
            onPointerMove={(e) => {
              if (!longPressTimerRef.current || !longPressOriginRef.current) return
              const dx = e.clientX - longPressOriginRef.current.x
              const dy = e.clientY - longPressOriginRef.current.y
              if (Math.hypot(dx, dy) > 10) cancelarPulsacion()
            }}
            onPointerUp={cancelarPulsacion}
            onPointerCancel={cancelarPulsacion}
            onPointerLeave={cancelarPulsacion}
            onClick={(e) => {
              if (suppressNextClickRef.current) {
                suppressNextClickRef.current = false
                e.preventDefault()
                return
              }
              if (editable) return
              if (multiSelectable && (e.ctrlKey || e.metaKey)) {
                onToggleSelect?.(t.id)
                return
              }
              onSelect?.('table', t)
            }}
            onContextMenu={(e) => {
              if (editable) {
                if (blockMode || !onTableContextMenu) return
                e.preventDefault()
                onTableContextMenu(t)
                return
              }
              if (multiSelectable && selectedIds?.size >= 2 && selectedIds.has(t.id)) {
                e.preventDefault()
                onMultiContextMenu?.([...selectedIds], e)
                return
              }
              if (!onContextMenu) return
              e.preventDefault()
              onContextMenu(t, e)
            }}
            style={style(t)}
            className={`absolute grid place-content-center gap-0.5 border-2 bg-raised
              transition-colors transition-transform
              ${t.shape === 'ROUND' ? 'rounded-full' : 'rounded-xl'}
              ${selectedId === t.id ? 'border-amber bg-amber/10 animate-mesa-seleccionada' : statusRing[t.status]}
              ${multiSel ? 'ring-2 ring-amber ring-offset-2 ring-offset-night' : ''}
              ${pressingTableId === t.id ? 'scale-95 border-amber' : ''}
              ${editable ? 'cursor-grab active:cursor-grabbing' : 'hover:border-amber'}`}
          >
            {pendiente && (
              <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-amber border-2 border-night animate-pulse" />
            )}
            {vinculada && !pendiente && (
              <span
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-night border border-amber/60
                           text-amber grid place-items-center"
                title="Fusionada temporalmente con otra mesa"
              >
                <Icon.link width={10} height={10} strokeWidth={2.2} />
              </span>
            )}
            <span className={`w-2 h-2 rounded-full justify-self-center ${statusDot[t.status]}`} />
            <div className={`flex flex-col items-center gap-0.5 ${vertical ? '-rotate-90' : ''}`}>
              <span className={`text-mesa whitespace-nowrap ${pendiente ? 'text-amber' : ''}`}>{t.number}</span>
              <span className="text-[11px] text-muted whitespace-nowrap">{t.seats} pers.</span>
              {elapsed && (
                <span className="text-[11px] font-semibold text-reservada whitespace-nowrap">{elapsed}</span>
              )}
            </div>
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

// Etiqueta con el nombre del cliente, flotando justo encima de la mesa o del
// contorno del grupo. z-30 para quedar por encima de las mesas vecinas (una
// mesa alta puede meterse debajo del borde de arriba si no).
function ClienteTag({ left, top, nombre }) {
  return (
    <div
      className="absolute z-30 -translate-x-1/2 -translate-y-full -mt-1.5 px-2.5 py-1 rounded-lg
                 bg-night border border-amber/60 text-amber text-[11px] font-semibold
                 whitespace-nowrap pointer-events-none"
      style={{ left: `${left}%`, top: `${top}%` }}
    >
      {nombre}
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
