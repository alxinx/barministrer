import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { Icon } from '../components/Icons'

export const TIPO_ID_LABEL = { NIT: 'NIT', CEDULA: 'Cédula' }
export const CONDICION_LABEL = { CONTADO: 'Contado', CREDITO: 'Crédito' }

export default function Proveedores() {
  const navigate = useNavigate()
  const [proveedores, setProveedores] = useState([])
  const [search, setSearch] = useState('')
  const [verInactivos, setVerInactivos] = useState(false)
  const [editando, setEditando] = useState(undefined) // undefined = cerrado, null = nuevo, proveedor = editar

  useEffect(() => {
    load()
  }, [verInactivos])

  async function load() {
    setProveedores(await api(`/proveedores${verInactivos ? '?todos=1' : ''}`))
  }

  const visibles = useMemo(() => {
    const term = search.trim().toLowerCase()
    return proveedores.filter(
      (p) => !term || p.name.toLowerCase().includes(term) || p.nombreComercial?.toLowerCase().includes(term)
    )
  }, [proveedores, search])

  function cerrarForm() {
    setEditando(undefined)
  }
  function guardado() {
    cerrarForm()
    load()
  }

  return (
    <div className="p-5 md:p-7 max-w-[1500px] mx-auto">
      <header className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <p className="text-xs text-muted mb-1">Inventario &gt; Proveedores</p>
          <h1 className="text-2xl font-bold">Proveedores</h1>
          <p className="text-muted text-sm mt-1">
            A quién le compras los insumos: datos de contacto, condición de pago y su historial de compras.
          </p>
        </div>
        <button onClick={() => setEditando(null)} className="btn-primary">
          <Icon.plus />
          Nuevo proveedor
        </button>
      </header>

      <div className="flex items-center gap-3 flex-wrap mb-6">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
            <Icon.search />
          </span>
          <input
            className="field pl-10"
            placeholder="Buscar proveedor"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
          <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} />
          Ver inactivos
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {visibles.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => navigate(`/proveedores/${p.id}`)}
            className="card p-4 text-left flex flex-col gap-2 hover:border-amber/50 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-sm leading-snug">{p.nombreComercial || p.name}</p>
              {!p.active && <span className="text-[10px] font-semibold text-muted shrink-0">Inactivo</span>}
            </div>
            {p.nombreComercial && <p className="text-xs text-muted -mt-1.5">{p.name}</p>}
            <p className="text-xs text-muted">
              {p.contacto || p.telefono || 'Sin contacto registrado'}
            </p>
            <span
              className={`text-[10px] font-semibold px-2 py-1 rounded-pill border self-start mt-auto ${
                p.condicionPago === 'CREDITO'
                  ? 'text-amberText border-amber/40 bg-amber/10'
                  : 'text-muted border-edge bg-raised'
              }`}
            >
              {CONDICION_LABEL[p.condicionPago]}
              {p.condicionPago === 'CREDITO' && p.diasCredito ? ` · ${p.diasCredito} días` : ''}
            </span>
          </button>
        ))}

        {visibles.length === 0 && (
          <p className="card px-4 py-10 text-center text-muted text-sm col-span-full">
            {proveedores.length === 0 ? 'Todavía no hay proveedores registrados.' : 'No hay proveedores con ese filtro.'}
          </p>
        )}
      </div>

      {editando !== undefined && (
        <ProveedorForm proveedor={editando} onClose={cerrarForm} onSaved={guardado} />
      )}
    </div>
  )
}

export function ProveedorForm({ proveedor, onClose, onSaved }) {
  const esNuevo = !proveedor
  const [name, setName] = useState(proveedor?.name || '')
  const [nombreComercial, setNombreComercial] = useState(proveedor?.nombreComercial || '')
  const [tipoIdentificacion, setTipoIdentificacion] = useState(proveedor?.tipoIdentificacion || '')
  const [numeroIdentificacion, setNumeroIdentificacion] = useState(proveedor?.numeroIdentificacion || '')
  const [contacto, setContacto] = useState(proveedor?.contacto || '')
  const [telefono, setTelefono] = useState(proveedor?.telefono || '')
  const [whatsapp, setWhatsapp] = useState(proveedor?.whatsapp || '')
  const [email, setEmail] = useState(proveedor?.email || '')
  const [direccion, setDireccion] = useState(proveedor?.direccion || '')
  const [ciudad, setCiudad] = useState(proveedor?.ciudad || '')
  const [observaciones, setObservaciones] = useState(proveedor?.observaciones || '')
  const [condicionPago, setCondicionPago] = useState(proveedor?.condicionPago || 'CONTADO')
  const [diasCredito, setDiasCredito] = useState(proveedor?.diasCredito || '')
  const [active, setActive] = useState(proveedor?.active ?? true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function guardar() {
    if (!name.trim()) return setError('El proveedor necesita un nombre')
    setError('')
    setSaving(true)
    const body = {
      name: name.trim(),
      nombreComercial: nombreComercial.trim() || null,
      tipoIdentificacion: tipoIdentificacion || null,
      numeroIdentificacion: numeroIdentificacion.trim() || null,
      contacto: contacto.trim() || null,
      telefono: telefono.trim() || null,
      whatsapp: whatsapp.trim() || null,
      email: email.trim() || null,
      direccion: direccion.trim() || null,
      ciudad: ciudad.trim() || null,
      observaciones: observaciones.trim() || null,
      condicionPago,
      diasCredito: condicionPago === 'CREDITO' && diasCredito ? Number(diasCredito) : null,
    }
    try {
      if (esNuevo) {
        await api('/proveedores', { method: 'POST', body })
      } else {
        await api(`/proveedores/${proveedor.id}`, { method: 'PATCH', body: { ...body, active } })
      }
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-lg p-5 space-y-4 my-8">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{esNuevo ? 'Nuevo proveedor' : 'Editar proveedor'}</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-ink">
            <Icon.x />
          </button>
        </header>

        {error && (
          <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">{error}</p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Razón social</label>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label">Nombre comercial (opcional)</label>
            <input className="field" value={nombreComercial} onChange={(e) => setNombreComercial(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-[120px_1fr] gap-3">
          <div>
            <label className="label">Identificación</label>
            <select className="field" value={tipoIdentificacion} onChange={(e) => setTipoIdentificacion(e.target.value)}>
              <option value="">—</option>
              <option value="NIT">NIT</option>
              <option value="CEDULA">Cédula</option>
            </select>
          </div>
          <div>
            <label className="label">Número</label>
            <input
              className="field"
              value={numeroIdentificacion}
              onChange={(e) => setNumeroIdentificacion(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Contacto (opcional)</label>
            <input className="field" value={contacto} onChange={(e) => setContacto(e.target.value)} placeholder="Nombre de quien atiende" />
          </div>
          <div>
            <label className="label">Teléfono</label>
            <input className="field" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
          </div>
          <div>
            <label className="label">WhatsApp (opcional)</label>
            <input className="field" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
          </div>
          <div>
            <label className="label">Correo (opcional)</label>
            <input className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label">Ciudad (opcional)</label>
            <input className="field" value={ciudad} onChange={(e) => setCiudad(e.target.value)} />
          </div>
          <div>
            <label className="label">Dirección (opcional)</label>
            <input className="field" value={direccion} onChange={(e) => setDireccion(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">Condición de pago</label>
          <div className="flex gap-2">
            {Object.entries(CONDICION_LABEL).map(([valor, label]) => (
              <button
                key={valor}
                type="button"
                className={condicionPago === valor ? 'btn-primary flex-1' : 'btn-ghost flex-1'}
                onClick={() => setCondicionPago(valor)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {condicionPago === 'CREDITO' && (
          <div>
            <label className="label">Días de crédito</label>
            <input
              type="number"
              min="1"
              className="field"
              value={diasCredito}
              onChange={(e) => setDiasCredito(e.target.value)}
              placeholder="30"
            />
          </div>
        )}

        <div>
          <label className="label">Observaciones (opcional)</label>
          <textarea
            className="field resize-none"
            rows={2}
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
          />
        </div>

        {!esNuevo && (
          <div className="flex items-center justify-between bg-raised border border-edge rounded-xl p-3">
            <div>
              <p className="text-sm font-medium">{active ? 'Proveedor activo' : 'Proveedor inactivo'}</p>
              <p className="text-xs text-muted">Desactivarlo lo oculta del selector de insumos y compras.</p>
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
          <button type="button" onClick={onClose} className="btn-ghost flex-1">
            Cancelar
          </button>
          <button type="button" onClick={guardar} disabled={saving} className="btn-primary flex-1">
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
