import { useState } from 'react'
import { api } from '../lib/api'
import { Icon } from './Icons'

const COLORES = [
  '#E8A33D',
  '#C97B2E',
  '#A8641F',
  '#D65C5C',
  '#4C9BD6',
  '#5FD18C',
  '#8E7CC3',
  '#6B7280',
]

// "Sin alcohol", no "sin alcohol" ni "SIN ALCOHOL": sentence case, como el
// resto del catalogo. Se filtra mientras se escribe para no depender de que
// el operador lo tipee bien.
function normalizarNombre(raw) {
  if (!raw) return raw
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
}

/**
 * Crear o editar una categoria. El padre solo se elige al crear (reparentar
 * una categoria existente no esta soportado: cambia a quien le hereda el
 * allowsPour y complica mas de lo que vale). Una subcategoria nueva hereda el
 * flag del padre en vez de preguntarlo, para que no se quede por fuera en
 * silencio.
 */
export default function CategoriaForm({ category, categories, onClose, onSaved }) {
  const esNueva = !category
  const padreActual = category && categories.find((c) => c.id === category.parentId)
  const tieneHijas = category && categories.some((c) => c.parentId === category.id)

  const [name, setName] = useState(category?.name || '')
  const [parentId, setParentId] = useState('')
  const [color, setColor] = useState(category?.color || COLORES[0])
  const [allowsPour, setAllowsPour] = useState(category?.allowsPour || false)
  const [active, setActive] = useState(category?.active ?? true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmando, setConfirmando] = useState(false)

  const opcionesPadre = categories.filter((c) => !c.parentId)
  const padreSeleccionado = opcionesPadre.find((c) => c.id === parentId)

  async function guardar() {
    if (!name.trim()) return setError('La categoría necesita un nombre')
    setError('')
    setSaving(true)
    try {
      if (esNueva) {
        await api('/categories', {
          method: 'POST',
          body: {
            name: name.trim(),
            parentId: parentId || null,
            color,
            // Con padre, se omite para que el backend herede su allowsPour.
            ...(parentId ? {} : { allowsPour }),
          },
        })
      } else {
        await api(`/categories/${category.id}`, {
          method: 'PATCH',
          body: { name: name.trim(), color, ...(padreActual ? {} : { allowsPour }), active },
        })
      }
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function eliminar() {
    setSaving(true)
    setError('')
    try {
      await api(`/categories/${category.id}`, { method: 'DELETE' })
      onSaved()
    } catch (err) {
      setError(err.message)
      setSaving(false)
      setConfirmando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-sm p-5 space-y-4">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{esNueva ? 'Nueva categoría' : 'Editar categoría'}</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-ink">
            <Icon.x />
          </button>
        </header>

        {error && (
          <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
            {error}
          </p>
        )}

        {confirmando ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              ¿Eliminar "{category.name}"? No se puede deshacer. Si todavía tiene productos o
              subcategorías, no se va a dejar.
            </p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setConfirmando(false)} className="btn-ghost flex-1">
                Cancelar
              </button>
              <button type="button" onClick={eliminar} disabled={saving} className="btn-danger flex-1">
                {saving ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div>
              <label className="label">Nombre</label>
              <input
                className="field"
                value={name}
                onChange={(e) => setName(normalizarNombre(e.target.value))}
                autoFocus
              />
            </div>

            {esNueva ? (
              <div>
                <label className="label">Categoría padre (opcional)</label>
                <select className="field" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                  <option value="">Ninguna · categoría principal</option>
                  {opcionesPadre.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              padreActual && (
                <p className="text-xs text-muted">
                  Subcategoría de <span className="text-ink font-medium">{padreActual.name}</span>
                </p>
              )
            )}

            <div>
              <label className="label">Color</label>
              <div className="flex gap-2 flex-wrap">
                {COLORES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={`Color ${c}`}
                    className={`w-8 h-8 rounded-full border-2 ${
                      color === c ? 'border-ink' : 'border-transparent'
                    }`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between bg-raised border border-edge rounded-xl p-3">
              <div>
                <p className="text-sm font-medium">Vende por ml</p>
                <p className="text-xs text-muted">
                  {parentId
                    ? `Hereda de ${padreSeleccionado?.name || 'la categoría padre'}: ${
                        padreSeleccionado?.allowsPour ? 'sí' : 'no'
                      }`
                    : padreActual
                      ? `Hereda de ${padreActual.name}: ${padreActual.allowsPour ? 'sí' : 'no'}`
                      : 'Habilita shots/tragos sueltos en esta categoría'}
                </p>
              </div>
              <button
                type="button"
                disabled={Boolean(parentId) || Boolean(padreActual)}
                onClick={() => setAllowsPour((v) => !v)}
                className={`h-7 w-12 rounded-pill relative transition-colors shrink-0 disabled:opacity-40 ${
                  (parentId ? padreSeleccionado?.allowsPour : padreActual ? padreActual.allowsPour : allowsPour)
                    ? 'bg-amber'
                    : 'bg-raised border border-edge'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full transition-transform ${
                    (parentId ? padreSeleccionado?.allowsPour : padreActual ? padreActual.allowsPour : allowsPour)
                      ? 'translate-x-5 bg-night'
                      : 'bg-muted'
                  }`}
                />
              </button>
            </div>

            {!esNueva && (
              <div className="flex items-center justify-between bg-raised border border-edge rounded-xl p-3">
                <div>
                  <p className="text-sm font-medium">Activa</p>
                  <p className="text-xs text-muted">Desactivarla oculta sus productos sin borrar nada</p>
                </div>
                <button
                  type="button"
                  onClick={() => setActive((v) => !v)}
                  className={`h-7 w-12 rounded-pill relative transition-colors shrink-0 ${
                    active ? 'bg-amber' : 'bg-raised border border-edge'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full transition-transform ${
                      active ? 'translate-x-5 bg-night' : 'bg-muted'
                    }`}
                  />
                </button>
              </div>
            )}

            <div className="flex gap-3 pt-1">
              {!esNueva && (
                <button
                  type="button"
                  onClick={() => setConfirmando(true)}
                  className="btn-ghost text-ocupada"
                  aria-label="Eliminar categoría"
                >
                  <Icon.trash width={16} height={16} />
                </button>
              )}
              <button type="button" onClick={onClose} className="btn-ghost flex-1">
                Cancelar
              </button>
              <button type="button" onClick={guardar} disabled={saving} className="btn-primary flex-1">
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
