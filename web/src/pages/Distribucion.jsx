import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import FloorPlan from '../components/FloorPlan'
import ConfirmModal from '../components/ConfirmModal'
import { Icon, zoneIcon } from '../components/Icons'

const PIEZAS = [
  { type: 'TABLE', label: 'Mesa', icon: Icon.tables, w: 1, h: 1 },
  { type: 'BAR', label: 'Barra', icon: Icon.glass, w: 3, h: 1 },
  { type: 'WALL', label: 'Pared', icon: Icon.wall, w: 1, h: 3 },
  { type: 'DOOR', label: 'Entrada', icon: Icon.door, w: 2, h: 1 },
  { type: 'PLANT', label: 'Planta', icon: Icon.plant, w: 1, h: 1 },
  { type: 'STAGE', label: 'Tarima', icon: Icon.stage, w: 3, h: 2 },
]

const FORMAS = [
  { value: 'ROUND', label: 'Redonda' },
  { value: 'SQUARE', label: 'Cuadrada' },
  { value: 'RECT', label: 'Rectangular' },
]

function etiquetaPieza({ kind, item }) {
  if (kind === 'table') return `mesa ${item.number}`
  return (PIEZAS.find((p) => p.type === item.type)?.label || 'elemento').toLowerCase()
}

export default function Distribucion() {
  const [zones, setZones] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [selected, setSelected] = useState(null) // { kind, item }
  const [clipboard, setClipboard] = useState(null) // { kind, item }, sobrevive al cambio de zona
  const [pasteCount, setPasteCount] = useState(0)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState(null) // { title, message, onConfirm }
  const [blockMode, setBlockMode] = useState(false)
  const [notice, setNotice] = useState('')
  const [lastSnapshot, setLastSnapshot] = useState(null) // deshacer: un solo nivel
  const saveTimer = useRef(null)
  const resizeTimer = useRef(null)
  const rotateTimer = useRef(null)
  const blockTimer = useRef(null)
  const pendingSnapshot = useRef(null) // snapshot tomado al iniciar un gesto (arrastrar/girar/pintar)

  const zone = zones.find((z) => z.id === activeId)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const data = await api('/zones')
    setZones(data)
    setActiveId((prev) => prev || data[0]?.id || null)
  }

  function show(err) {
    setError(err.message)
    setTimeout(() => setError(''), 4000)
  }

  function notify(msg) {
    setNotice(msg)
    setTimeout(() => setNotice(''), 2000)
  }

  // --- Deshacer (Ctrl+Z) -----------------------------------------------------
  // Un solo nivel: guardamos como "antes de esto" el estado de la zona activa
  // justo antes de cada accion que cambia algo. Deshacer compara ese estado
  // contra el actual y revierte mesa por mesa, elemento por elemento, con los
  // mismos endpoints que ya existen (crear lo que falta, borrar lo nuevo,
  // actualizar lo que cambio) en vez de inventar un mecanismo aparte.
  function snapshotActual() {
    if (!zone) return null
    return {
      zoneId: zone.id,
      tables: zone.tables.map((t) => ({ ...t })),
      elements: zone.elements.map((e) => ({ ...e })),
      blockedCells: (zone.blockedCells || []).map((c) => ({ ...c })),
      gridCols: zone.gridCols,
      gridRows: zone.gridRows,
    }
  }

  // Para acciones de un solo paso (agregar, editar un campo, pegar...): se
  // sabe de una que algo va a cambiar, as que se guarda directo.
  function snapshot() {
    const s = snapshotActual()
    if (s) setLastSnapshot(s)
  }

  // Para gestos de arrastre (mover, redimensionar, girar, pintar celdas): un
  // clic para solo seleccionar tambien dispara pointerdown/pointerup, y no
  // deberia borrar el deshacer anterior si al final no se movio nada.
  function iniciarGesto() {
    pendingSnapshot.current = snapshotActual()
  }

  function terminarGesto() {
    const antes = pendingSnapshot.current
    pendingSnapshot.current = null
    if (!antes) return
    const ahora = snapshotActual()
    if (JSON.stringify(antes) !== JSON.stringify(ahora)) {
      setLastSnapshot(antes)
    }
  }

  async function deshacer() {
    const snap = lastSnapshot
    if (!snap || snap.zoneId !== activeId) {
      setLastSnapshot(null)
      return
    }
    setLastSnapshot(null)
    setSelected(null)
    setSaving(true)
    try {
      await restaurarSnapshot(snap)
      notify('Deshecho')
    } catch (err) {
      show(err)
    } finally {
      setSaving(false)
    }
  }

  async function restaurarSnapshot(snap) {
    const current = zones.find((z) => z.id === snap.zoneId)
    if (!current) return

    for (const pt of snap.tables) {
      const ct = current.tables.find((t) => t.id === pt.id)
      if (!ct) {
        await api('/tables', {
          method: 'POST',
          body: {
            zoneId: snap.zoneId,
            number: pt.number,
            seats: pt.seats,
            shape: pt.shape,
            gridX: pt.gridX,
            gridY: pt.gridY,
            width: pt.width,
            height: pt.height,
          },
        })
      } else if (
        ct.number !== pt.number ||
        ct.seats !== pt.seats ||
        ct.shape !== pt.shape ||
        ct.gridX !== pt.gridX ||
        ct.gridY !== pt.gridY ||
        ct.width !== pt.width ||
        ct.height !== pt.height
      ) {
        await api(`/tables/${pt.id}`, {
          method: 'PATCH',
          body: {
            number: pt.number,
            seats: pt.seats,
            shape: pt.shape,
            gridX: pt.gridX,
            gridY: pt.gridY,
            width: pt.width,
            height: pt.height,
          },
        })
      }
    }
    for (const ct of current.tables) {
      if (!snap.tables.find((pt) => pt.id === ct.id)) {
        await api(`/tables/${ct.id}`, { method: 'DELETE' })
      }
    }

    for (const pe of snap.elements) {
      const ce = current.elements.find((e) => e.id === pe.id)
      if (!ce) {
        await api('/elements', {
          method: 'POST',
          body: {
            zoneId: snap.zoneId,
            type: pe.type,
            label: pe.label,
            gridX: pe.gridX,
            gridY: pe.gridY,
            width: pe.width,
            height: pe.height,
            rotation: pe.rotation,
          },
        })
      } else if (
        ce.label !== pe.label ||
        ce.gridX !== pe.gridX ||
        ce.gridY !== pe.gridY ||
        ce.width !== pe.width ||
        ce.height !== pe.height ||
        ce.rotation !== pe.rotation
      ) {
        await api(`/elements/${pe.id}`, {
          method: 'PATCH',
          body: {
            label: pe.label,
            gridX: pe.gridX,
            gridY: pe.gridY,
            width: pe.width,
            height: pe.height,
            rotation: pe.rotation,
          },
        })
      }
    }
    for (const ce of current.elements) {
      if (!snap.elements.find((pe) => pe.id === ce.id)) {
        await api(`/elements/${ce.id}`, { method: 'DELETE' })
      }
    }

    const zonePatch = {}
    if (current.gridCols !== snap.gridCols) zonePatch.gridCols = snap.gridCols
    if (current.gridRows !== snap.gridRows) zonePatch.gridRows = snap.gridRows
    if (JSON.stringify(current.blockedCells || []) !== JSON.stringify(snap.blockedCells || [])) {
      zonePatch.blockedCells = snap.blockedCells || []
    }
    if (Object.keys(zonePatch).length) {
      await api(`/zones/${snap.zoneId}`, { method: 'PATCH', body: zonePatch })
    }

    await load()
  }

  // --- Mover piezas --------------------------------------------------------
  // Se actualiza el estado local al instante y se guarda con debounce: arrastrar
  // dispara decenas de eventos y no vale la pena una peticion por cada uno.
  function move(kind, id, gridX, gridY) {
    setZones((prev) =>
      prev.map((z) =>
        z.id !== activeId
          ? z
          : {
              ...z,
              tables: z.tables.map((t) => (t.id === id ? { ...t, gridX, gridY } : t)),
              elements: z.elements.map((e) => (e.id === id ? { ...e, gridX, gridY } : e)),
            }
      )
    )

    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaving(true)
      try {
        const path = kind === 'table' ? `/tables/${id}` : `/elements/${id}`
        await api(path, { method: 'PATCH', body: { gridX, gridY } })
      } catch (err) {
        show(err)
        load()
      } finally {
        setSaving(false)
      }
    }, 400)
  }

  // Redimensionar: misma idea que mover, estado local al instante y PATCH con
  // debounce para no disparar una peticion por cada pixel arrastrado.
  function resize(kind, id, width, height) {
    setZones((prev) =>
      prev.map((z) =>
        z.id !== activeId
          ? z
          : {
              ...z,
              tables: z.tables.map((t) => (t.id === id ? { ...t, width, height } : t)),
              elements: z.elements.map((e) => (e.id === id ? { ...e, width, height } : e)),
            }
      )
    )
    setSelected((prev) => (prev?.item.id === id ? { ...prev, item: { ...prev.item, width, height } } : prev))

    clearTimeout(resizeTimer.current)
    resizeTimer.current = setTimeout(async () => {
      setSaving(true)
      try {
        const path = kind === 'table' ? `/tables/${id}` : `/elements/${id}`
        await api(path, { method: 'PATCH', body: { width, height } })
      } catch (err) {
        show(err)
        load()
      } finally {
        setSaving(false)
      }
    }, 400)
  }

  // Rotar: solo elementos (pared, barra, puerta...). Las mesas no tienen
  // campo de rotacion: girar una cuadrada/rectangular es lo mismo que
  // intercambiar ancho y alto, y una redonda no cambia de aspecto.
  function rotateElemento(id, rotation) {
    setZones((prev) =>
      prev.map((z) =>
        z.id !== activeId ? z : { ...z, elements: z.elements.map((e) => (e.id === id ? { ...e, rotation } : e)) }
      )
    )
    setSelected((prev) => (prev?.item.id === id ? { ...prev, item: { ...prev.item, rotation } } : prev))

    clearTimeout(rotateTimer.current)
    rotateTimer.current = setTimeout(async () => {
      setSaving(true)
      try {
        await api(`/elements/${id}`, { method: 'PATCH', body: { rotation } })
      } catch (err) {
        show(err)
        load()
      } finally {
        setSaving(false)
      }
    }, 400)
  }

  // Bloquear celdas: pinta el salon con forma de L, recortes, etc. sobre la
  // misma cuadricula, sin volverla un rectangulo perfecto. El contorno vive en
  // la zona (blockedCells), no en cada pieza.
  function setBlockedCell(x, y, blocked) {
    setZones((prev) =>
      prev.map((z) => {
        if (z.id !== activeId) return z
        const cells = z.blockedCells || []
        const exists = cells.some((c) => c.x === x && c.y === y)
        let next = cells
        if (blocked && !exists) next = [...cells, { x, y }]
        else if (!blocked && exists) next = cells.filter((c) => !(c.x === x && c.y === y))

        clearTimeout(blockTimer.current)
        blockTimer.current = setTimeout(async () => {
          setSaving(true)
          try {
            await api(`/zones/${activeId}`, { method: 'PATCH', body: { blockedCells: next } })
          } catch (err) {
            show(err)
            load()
          } finally {
            setSaving(false)
          }
        }, 400)

        return { ...z, blockedCells: next }
      })
    )
  }

  async function limpiarForma() {
    snapshot()
    try {
      await api(`/zones/${activeId}`, { method: 'PATCH', body: { blockedCells: [] } })
      await load()
    } catch (err) {
      show(err)
    }
  }

  // --- Agregar -------------------------------------------------------------
  async function agregar(pieza) {
    snapshot()
    try {
      if (pieza.type === 'TABLE') {
        const usados = zones.flatMap((z) => z.tables.map((t) => Number(t.number))).filter(Boolean)
        const siguiente = String((usados.length ? Math.max(...usados) : 0) + 1).padStart(2, '0')
        await api('/tables', {
          method: 'POST',
          body: { zoneId: activeId, number: siguiente, seats: 4, gridX: 0, gridY: 0 },
        })
      } else {
        await api('/elements', {
          method: 'POST',
          body: {
            zoneId: activeId,
            type: pieza.type,
            label: pieza.type === 'BAR' || pieza.type === 'DOOR' ? pieza.label : null,
            gridX: 0,
            gridY: 0,
            width: pieza.w,
            height: pieza.h,
          },
        })
      }
      await load()
    } catch (err) {
      show(err)
    }
  }

  async function actualizarSeleccion(patch) {
    const { kind, item } = selected
    const path = kind === 'table' ? `/tables/${item.id}` : `/elements/${item.id}`
    snapshot()
    try {
      const updated = await api(path, { method: 'PATCH', body: patch })
      setSelected({ kind, item: updated })
      await load()
    } catch (err) {
      show(err)
    }
  }

  function eliminarSeleccion() {
    if (!selected) return
    const { kind, item } = selected
    setConfirm({
      title: kind === 'table' ? 'Eliminar mesa' : 'Eliminar elemento',
      message: `¿Seguro que quieres eliminar ${etiquetaPieza(selected)}? No se puede deshacer.`,
      onConfirm: async () => {
        const path = kind === 'table' ? `/tables/${item.id}` : `/elements/${item.id}`
        snapshot()
        try {
          await api(path, { method: 'DELETE' })
          setSelected(null)
          await load()
        } catch (err) {
          show(err)
        }
      },
    })
  }

  // --- Copiar y pegar -------------------------------------------------------
  // El portapapeles sobrevive al cambio de zona a proposito: copiar una mesa
  // en "Salon Principal" y pegarla en "Terraza" es el caso que importa, no
  // solo duplicar dentro de la misma zona.
  function copiar() {
    if (!selected) return
    setClipboard(selected)
    setPasteCount(0)
  }

  async function pegar() {
    if (!clipboard || !activeId) return
    const { kind, item } = clipboard
    const paso = pasteCount + 1
    const cols = zone?.gridCols || 16
    const rows = zone?.gridRows || 10
    const gridX = Math.max(0, Math.min(item.gridX + paso, cols - item.width))
    const gridY = Math.max(0, Math.min(item.gridY + paso, rows - item.height))

    snapshot()
    try {
      if (kind === 'table') {
        const usados = zones.flatMap((z) => z.tables.map((t) => Number(t.number))).filter(Boolean)
        const siguiente = String((usados.length ? Math.max(...usados) : 0) + 1).padStart(2, '0')
        await api('/tables', {
          method: 'POST',
          body: {
            zoneId: activeId,
            number: siguiente,
            seats: item.seats,
            shape: item.shape,
            gridX,
            gridY,
            width: item.width,
            height: item.height,
          },
        })
      } else {
        await api('/elements', {
          method: 'POST',
          body: {
            zoneId: activeId,
            type: item.type,
            label: item.label,
            gridX,
            gridY,
            width: item.width,
            height: item.height,
            rotation: item.rotation,
          },
        })
      }
      setPasteCount(paso)
      await load()
    } catch (err) {
      show(err)
    }
  }

  // Ctrl/Cmd+C, Ctrl/Cmd+V, Ctrl/Cmd+Z y Delete, salvo que el foco este en un
  // campo de texto (ahi el copiar/pegar/deshacer nativo del navegador sigue
  // normal) o ya haya un modal de confirmacion abierto.
  useEffect(() => {
    function onKeyDown(e) {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (confirm) return

      // En teclados Mac la tecla "delete" manda "Backspace", no "Delete".
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault()
        eliminarSeleccion()
        return
      }

      if (!e.metaKey && !e.ctrlKey) return
      if (e.key.toLowerCase() === 'c' && selected) {
        e.preventDefault()
        copiar()
      } else if (e.key.toLowerCase() === 'v' && clipboard) {
        e.preventDefault()
        pegar()
      } else if (e.key.toLowerCase() === 'z' && lastSnapshot) {
        e.preventDefault()
        deshacer()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  async function nuevaZona() {
    const name = prompt('Nombre de la zona (ej: Calle, VIP, Barra)')
    if (!name?.trim()) return
    try {
      await api('/zones', { method: 'POST', body: { name: name.trim(), sortOrder: zones.length } })
      await load()
    } catch (err) {
      show(err)
    }
  }

  function eliminarZona() {
    if (!zone) return
    setConfirm({
      title: 'Eliminar zona',
      message: `¿Seguro que quieres eliminar la zona "${zone.name}"? No se puede deshacer.`,
      onConfirm: async () => {
        try {
          await api(`/zones/${activeId}`, { method: 'DELETE' })
          setActiveId(null)
          setSelected(null)
          await load()
        } catch (err) {
          show(err)
        }
      },
    })
  }

  return (
    <div className="p-5 md:p-7 max-w-[1500px] mx-auto">
      <header className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-bold">Distribución del bar</h1>
          <p className="text-muted text-sm mt-1">
            Arrastra las piezas para armar el plano, el cuadro ámbar de la esquina para
            agrandarlas o achicarlas, y el círculo de arriba para girar pared, barra y demás
            elementos. Los cambios se guardan solos. Copia una pieza (Ctrl+C) y pégala en esta u
            otra zona (Ctrl+V), o deshaz el último cambio (Ctrl+Z).
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastSnapshot && (
            <button onClick={deshacer} className="btn-ghost h-9 px-3 text-xs">
              <Icon.undo width={16} height={16} />
              Deshacer
            </button>
          )}
          <span className={`text-xs ${saving ? 'text-amber' : 'text-muted'}`}>
            {saving ? 'Guardando…' : 'Guardado'}
          </span>
        </div>
      </header>

      {error && (
        <p className="mb-4 text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
          {error}
        </p>
      )}
      {notice && (
        <p className="mb-4 text-sm text-amber border border-amber/30 bg-amber/10 rounded-xl px-3 py-2.5">
          {notice}
        </p>
      )}

      {/* Zonas */}
      <div className="flex gap-2 flex-wrap mb-5">
        {zones.map((z) => {
          const I = zoneIcon[z.icon] || Icon.tables
          return (
            <button
              key={z.id}
              onClick={() => {
                setActiveId(z.id)
                setSelected(null)
                setBlockMode(false)
                setLastSnapshot(null)
              }}
              className={`flex items-center gap-2 h-11 px-4 rounded-xl text-sm font-semibold border transition-colors ${
                z.id === activeId
                  ? 'bg-amber text-night border-amber'
                  : 'bg-surface text-muted border-edge hover:text-ink'
              }`}
            >
              <I />
              {z.name}
              <span className="opacity-60 font-normal">{z.tables.length}</span>
            </button>
          )
        })}
        <button onClick={nuevaZona} className="btn-ghost">
          <Icon.plus />
          Zona
        </button>
        {clipboard && (
          <button onClick={pegar} className="btn-ghost">
            <Icon.clipboard />
            Pegar {etiquetaPieza(clipboard)}
          </button>
        )}
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">
        <FloorPlan
          zone={zone}
          editable
          blockMode={blockMode}
          selectedId={selected?.item.id}
          onSelect={(kind, item) => setSelected({ kind, item })}
          onMove={move}
          onResize={resize}
          onRotate={rotateElemento}
          onBlockCell={setBlockedCell}
          onGestureStart={iniciarGesto}
          onGestureEnd={terminarGesto}
        />

        <div className="space-y-5">
          <section className="card p-4">
            <h2 className="font-semibold mb-3">Agregar pieza</h2>
            <div className="grid grid-cols-3 gap-2">
              {PIEZAS.map((p) => {
                const I = p.icon
                return (
                  <button
                    key={p.type}
                    onClick={() => agregar(p)}
                    disabled={!activeId}
                    className="flex flex-col items-center justify-center gap-1.5 h-20 rounded-xl
                               bg-raised border border-edge text-muted text-xs font-medium
                               hover:border-amber hover:text-ink transition-colors disabled:opacity-40"
                  >
                    <I />
                    {p.label}
                  </button>
                )
              })}
            </div>
          </section>

          <section className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">
                {selected
                  ? selected.kind === 'table'
                    ? `Mesa ${selected.item.number}`
                    : PIEZAS.find((p) => p.type === selected.item.type)?.label || 'Elemento'
                  : 'Pieza seleccionada'}
              </h2>
              {selected && (
                <button onClick={copiar} className="text-xs font-semibold text-amber flex items-center gap-1">
                  <Icon.copy width={14} height={14} />
                  Copiar
                </button>
              )}
            </div>

            {!selected && (
              <p className="text-sm text-muted">
                Toca una mesa o un elemento del plano para editarlo.
              </p>
            )}

            {selected?.kind === 'table' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Número</label>
                    <input
                      className="field"
                      defaultValue={selected.item.number}
                      onBlur={(e) =>
                        e.target.value !== selected.item.number &&
                        actualizarSeleccion({ number: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="label">Puestos</label>
                    <input
                      type="number"
                      min="1"
                      className="field"
                      defaultValue={selected.item.seats}
                      onBlur={(e) => actualizarSeleccion({ seats: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div>
                  <label className="label">Forma</label>
                  <div className="flex gap-2">
                    {FORMAS.map((f) => (
                      <button
                        key={f.value}
                        onClick={() => actualizarSeleccion({ shape: f.value })}
                        className={`flex-1 h-10 rounded-xl text-xs font-semibold border transition-colors ${
                          selected.item.shape === f.value
                            ? 'bg-amber text-night border-amber'
                            : 'bg-raised text-muted border-edge hover:text-ink'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                <TamanoControl item={selected.item} onChange={actualizarSeleccion} />

                <button onClick={eliminarSeleccion} className="btn-danger w-full">
                  <Icon.trash />
                  Eliminar mesa
                </button>
              </div>
            )}

            {selected?.kind === 'element' && (
              <div className="space-y-3">
                <div>
                  <label className="label">Etiqueta</label>
                  <input
                    className="field"
                    defaultValue={selected.item.label || ''}
                    placeholder="Sin etiqueta"
                    onBlur={(e) => actualizarSeleccion({ label: e.target.value })}
                  />
                </div>
                <TamanoControl item={selected.item} onChange={actualizarSeleccion} />
                <button onClick={eliminarSeleccion} className="btn-danger w-full">
                  <Icon.trash />
                  Eliminar elemento
                </button>
              </div>
            )}
          </section>

          <section className="card p-4">
            <h2 className="font-semibold mb-3">Tamaño de la zona</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Ancho (celdas)</label>
                <input
                  type="number"
                  min="4"
                  max="30"
                  className="field"
                  value={zone?.gridCols || 14}
                  onChange={async (e) => {
                    const gridCols = Number(e.target.value)
                    snapshot()
                    await api(`/zones/${activeId}`, { method: 'PATCH', body: { gridCols } })
                    load()
                  }}
                />
              </div>
              <div>
                <label className="label">Alto (celdas)</label>
                <input
                  type="number"
                  min="4"
                  max="30"
                  className="field"
                  value={zone?.gridRows || 9}
                  onChange={async (e) => {
                    const gridRows = Number(e.target.value)
                    snapshot()
                    await api(`/zones/${activeId}`, { method: 'PATCH', body: { gridRows } })
                    load()
                  }}
                />
              </div>
            </div>

            {zone && (
              <div className="mt-4 pt-4 border-t border-edge space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="label mb-0">Forma del salón</label>
                  {!!zone.blockedCells?.length && (
                    <button onClick={limpiarForma} className="text-xs font-semibold text-muted hover:text-ink">
                      Limpiar forma
                    </button>
                  )}
                </div>
                <button
                  onClick={() => {
                    setBlockMode((v) => !v)
                    setSelected(null)
                  }}
                  className={`w-full h-10 rounded-xl text-sm font-semibold border transition-colors ${
                    blockMode
                      ? 'bg-amber text-night border-amber'
                      : 'bg-raised text-muted border-edge hover:text-ink'
                  }`}
                >
                  {blockMode ? 'Listo' : 'Editar forma'}
                </button>
                {blockMode && (
                  <p className="text-xs text-muted">
                    Haz clic y arrastra sobre las celdas para sacarlas del salón (plano en L, recortes).
                    Vuelve a hacer clic para devolverlas.
                  </p>
                )}
              </div>
            )}

            {zone && (
              <button onClick={eliminarZona} disabled={!!zone.tables.length} className="btn-danger w-full mt-3">
                <Icon.trash />
                {zone.tables.length ? `Eliminar zona (tiene ${zone.tables.length} mesas)` : 'Eliminar zona'}
              </button>
            )}
          </section>
        </div>
      </div>

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            await confirm.onConfirm()
            setConfirm(null)
          }}
        />
      )}
    </div>
  )
}

function TamanoControl({ item, onChange }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="label">Ancho</label>
        <input
          type="number"
          min="1"
          max="8"
          className="field"
          defaultValue={item.width}
          onBlur={(e) => onChange({ width: Number(e.target.value) })}
        />
      </div>
      <div>
        <label className="label">Alto</label>
        <input
          type="number"
          min="1"
          max="8"
          className="field"
          defaultValue={item.height}
          onBlur={(e) => onChange({ height: Number(e.target.value) })}
        />
      </div>
    </div>
  )
}
