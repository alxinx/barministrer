import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { platformApi } from '../../lib/platformApi'
import { money } from '../../lib/api'
import { Icon } from '../../components/Icons'

const PERIODOS = [
  { value: 'MENSUAL', label: 'Mensual' },
  { value: 'TRIMESTRAL', label: 'Trimestral' },
  { value: 'SEMESTRAL', label: 'Semestral' },
  { value: 'ANUAL', label: 'Anual' },
]

const PERIODO_LABEL = Object.fromEntries(PERIODOS.map((p) => [p.value, p.label]))

export default function Tarifas() {
  const navigate = useNavigate()
  const [plans, setPlans] = useState(null)
  const [error, setError] = useState('')
  const [editando, setEditando] = useState(null) // null = cerrado, {} = nuevo, {...plan} = editar

  async function cargar() {
    try {
      setPlans(await platformApi('/rental-plans'))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    cargar()
  }, [])

  async function toggleActivo(plan) {
    try {
      await platformApi(`/rental-plans/${plan.id}`, { method: 'PATCH', body: { active: !plan.active } })
      cargar()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between gap-3 mb-8">
          <div>
            <button type="button" onClick={() => navigate('/plataforma')} className="text-sm text-muted hover:text-ink mb-2 flex items-center gap-1">
              <Icon.chevronLeft width={14} height={14} />
              Bares
            </button>
            <h1 className="text-2xl font-bold">Tarifas de renta</h1>
            <p className="text-sm text-muted mt-1">Lo que cada bar paga por usar LicorPlus.</p>
          </div>
          <button type="button" className="btn-primary" onClick={() => setEditando({})}>
            <Icon.plus width={16} height={16} />
            Nuevo plan
          </button>
        </div>

        {error && (
          <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5 mb-5">
            {error}
          </p>
        )}

        {plans === null && !error && <p className="text-muted text-sm">Cargando…</p>}
        {plans?.length === 0 && <p className="text-muted text-sm">Todavia no hay ningun plan creado.</p>}

        <div className="space-y-3">
          {plans?.map((p) => (
            <div key={p.id} className="card p-4 flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <p className="font-semibold flex items-center gap-2">
                  {p.name}
                  {!p.active && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-muted border border-edge bg-raised rounded-pill px-2 py-0.5">
                      Inactivo
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted mt-0.5">
                  {money(p.price)} · {PERIODO_LABEL[p.period]}
                </p>
              </div>
              <button type="button" className="btn-ghost" onClick={() => setEditando(p)}>
                Editar
              </button>
              <button type="button" className="btn-ghost" onClick={() => toggleActivo(p)}>
                {p.active ? 'Desactivar' : 'Activar'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {editando !== null && (
        <PlanModal
          plan={editando}
          onClose={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null)
            cargar()
          }}
        />
      )}
    </div>
  )
}

function PlanModal({ plan, onClose, onGuardado }) {
  const esNuevo = !plan.id
  const [name, setName] = useState(plan.name || '')
  const [price, setPrice] = useState(plan.price ?? '')
  const [period, setPeriod] = useState(plan.period || 'MENSUAL')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (esNuevo) {
        await platformApi('/rental-plans', { method: 'POST', body: { name, price, period } })
      } else {
        await platformApi(`/rental-plans/${plan.id}`, { method: 'PATCH', body: { name, price, period } })
      }
      onGuardado()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-sm p-6 space-y-4"
      >
        <h2 className="text-lg font-bold">{esNuevo ? 'Nuevo plan' : 'Editar plan'}</h2>

        <div>
          <label className="label">Nombre</label>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Valor</label>
            <input
              type="number"
              min="0"
              className="field"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Periodo</label>
            <select className="field" value={period} onChange={(e) => setPeriod(e.target.value)}>
              {PERIODOS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button type="button" className="btn-ghost flex-1" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary flex-1" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  )
}
