import { useState } from 'react'
import { api } from '../lib/api'
import { resizeInsumoImage } from '../lib/image'
import { Icon } from './Icons'
import MoneyInput from './MoneyInput'

const PASOS = [
  { n: 1, label: 'Información general', subtitle: 'Datos básicos del insumo.', icon: Icon.box },
  { n: 2, label: 'Unidades y conversiones', subtitle: 'Cómo cuentas y compras este insumo.', icon: Icon.swap },
  { n: 3, label: 'Control de inventario', subtitle: 'Mínimo de stock y dónde se guarda.', icon: Icon.clipboard },
  { n: 4, label: 'Costos y proveedor', subtitle: 'Costo de compra y proveedor habitual.', icon: Icon.cash },
]

/**
 * Crea o edita un insumo (materia prima: jamón, pan, pimienta), por etapas:
 * un paso a la vez, con un indicador a la izquierda. Separado a propósito
 * del formulario de producto: un insumo no se vende directo (no tiene precio
 * de venta, solo costo de compra), vive en su propia categoría (nunca se
 * mezcla con las de producto) y su stock se cuenta en una unidad de
 * inventario propia con conversión desde la unidad en que se compra.
 */
export default function InsumoForm({
  insumo,
  nombreInicial,
  categorias,
  proveedores,
  unidades,
  onClose,
  onSaved,
  onCategoriaCreada,
  onProveedorCreado,
}) {
  const isEdit = Boolean(insumo)
  const [step, setStep] = useState(1)

  const [name, setName] = useState(insumo?.name || nombreInicial || '')
  const [categoriaId, setCategoriaId] = useState(insumo?.categoriaId || '')
  const [codigoInterno, setCodigoInterno] = useState(insumo?.codigoInterno || '')
  const [description, setDescription] = useState(insumo?.description || '')
  const [imageUrl, setImageUrl] = useState(insumo?.imageUrl || '')
  const [subiendoImagen, setSubiendoImagen] = useState(false)

  const [unidadInventario, setUnidadInventario] = useState(insumo?.unidadInventario || '')
  const [unidadCompra, setUnidadCompra] = useState(insumo?.unidadCompra || '')
  const [cantidadPromedioPorUnidad, setCantidadPromedioPorUnidad] = useState(insumo?.cantidadPromedioPorUnidad || '')

  const [stockMinimo, setStockMinimo] = useState(insumo?.stockMinimo ?? '')
  const [ubicacion, setUbicacion] = useState(insumo?.ubicacion || '')

  const [costoCompra, setCostoCompra] = useState(insumo?.costoCompra || '')
  const [proveedorId, setProveedorId] = useState(insumo?.proveedorId || '')

  const [nuevaCategoria, setNuevaCategoria] = useState(false)
  const [nombreCategoria, setNombreCategoria] = useState('')
  const [nuevoProveedor, setNuevoProveedor] = useState(false)
  const [nombreProveedor, setNombreProveedor] = useState('')

  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const unidadInv = unidades.find((u) => u.codigo === unidadInventario)
  const unidadCom = unidades.find((u) => u.codigo === unidadCompra)
  // Solo se puede elegir como unidad de compra algo de la misma magnitud que
  // la de inventario (peso con peso, volumen con volumen) -- salvo las de
  // conteo ("Unidad", "Paquete"), que siempre se ofrecen aparte: comprar por
  // unidad o por paquete y contar en otra magnitud/cantidad es el caso
  // especial de abajo (ej. lechugas por unidad, pan por paquete), no una
  // conversion fija real. "Paquete" nunca se ofrece como unidad de
  // inventario: no tiene sentido llevar el stock en paquetes.
  const opcionesCompra = unidadInv
    ? unidades.filter((u) => u.magnitud === unidadInv.magnitud || u.magnitud === 'conteo')
    : unidades
  const opcionesInventario = unidades.filter((u) => u.codigo !== 'paquete')
  const factor =
    unidadInv && unidadCom && unidadInv.magnitud === unidadCom.magnitud && unidadCom.factor != null && unidadInv.factor != null
      ? unidadCom.factor / unidadInv.factor
      : null
  // Sin conversion fija: la unidad de compra no tiene un tamano universal
  // (paquete) y/o se compra por conteo pero se cuenta en otra magnitud
  // (lechugas por unidad, recetas en gramos). Se declara un promedio a mano.
  const esEspecial = Boolean(
    unidadCom && unidadInv && (unidadCom.factor == null || (unidadCom.magnitud === 'conteo' && unidadInv.magnitud !== 'conteo'))
  )

  // Solo los pasos 1 y 2 tienen campos obligatorios; 3 y 4 son opcionales de
  // principio a fin. Se reusa al avanzar con "Siguiente" y otra vez al
  // guardar, por si alguien vuelve a un paso anterior y lo deja incompleto.
  function validarPaso(n) {
    if (n === 1) {
      if (!name.trim()) return 'El insumo necesita un nombre'
      if (!categoriaId) return 'Elige una categoría'
    }
    if (n === 2) {
      if (!unidadInventario || !unidadCompra) return 'Elige la unidad de inventario y la unidad de compra'
      if (esEspecial) {
        if (!cantidadPromedioPorUnidad || Number(cantidadPromedioPorUnidad) <= 0) {
          return `Escribe el promedio de ${unidadInv.nombre.split(' ')[0].toLowerCase()} por ${unidadCom.nombre.split(' ')[0].toLowerCase()}`
        }
      } else if (!factor) {
        return 'La unidad de compra y la de inventario deben ser de la misma magnitud'
      }
    }
    return null
  }

  function avanzar() {
    const err = validarPaso(step)
    if (err) return setError(err)
    setError('')
    setStep((s) => Math.min(4, s + 1))
  }
  function retroceder() {
    setError('')
    setStep((s) => Math.max(1, s - 1))
  }

  async function crearCategoria() {
    if (!nombreCategoria.trim()) return
    setError('')
    try {
      const creada = await api('/insumo-categorias', { method: 'POST', body: { name: nombreCategoria.trim() } })
      onCategoriaCreada(creada)
      setCategoriaId(creada.id)
      setNuevaCategoria(false)
      setNombreCategoria('')
    } catch (err) {
      setError(err.message)
    }
  }

  async function crearProveedor() {
    if (!nombreProveedor.trim()) return
    setError('')
    try {
      const creado = await api('/proveedores', { method: 'POST', body: { name: nombreProveedor.trim() } })
      onProveedorCreado(creado)
      setProveedorId(creado.id)
      setNuevoProveedor(false)
      setNombreProveedor('')
    } catch (err) {
      setError(err.message)
    }
  }

  async function subirImagen(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setSubiendoImagen(true)
    setError('')
    try {
      const webp = await resizeInsumoImage(file)
      const { imageUrl: url } = await api('/insumos/image', { method: 'POST', body: { image: webp } })
      setImageUrl(url)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubiendoImagen(false)
    }
  }

  async function submit(e) {
    e?.preventDefault()
    const err = validarPaso(1) || validarPaso(2)
    if (err) {
      setError(err)
      setStep(validarPaso(1) ? 1 : 2)
      return
    }
    setError('')

    const body = {
      name: name.trim(),
      categoriaId,
      codigoInterno: codigoInterno.trim() || null,
      description: description.trim() || null,
      imageUrl: imageUrl || null,
      unidadInventario,
      unidadCompra,
      stockMinimo: stockMinimo === '' ? null : Number(stockMinimo),
      ubicacion: ubicacion.trim() || null,
      costoCompra: Number(costoCompra) || 0,
      cantidadPromedioPorUnidad: esEspecial ? Number(cantidadPromedioPorUnidad) : null,
      proveedorId: proveedorId || null,
    }

    setSaving(true)
    try {
      const saved = isEdit
        ? await api(`/insumos/${insumo.id}`, { method: 'PATCH', body })
        : await api('/insumos', { method: 'POST', body })
      onSaved(saved)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const paso = PASOS[step - 1]

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5 space-y-5"
      >
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">{isEdit ? 'Editar insumo' : 'Nuevo insumo'}</h2>
            <p className="text-xs text-muted mt-0.5">Registra un ingrediente o materia prima de tu negocio.</p>
          </div>
          <button type="button" onClick={onClose} className="text-muted hover:text-ink shrink-0">
            <Icon.x />
          </button>
        </header>

        {error && (
          <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
            {error}
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-5">
          {/* Indicador de pasos: en celular es una fila horizontal arriba, en
              pantalla ancha una columna a la izquierda. Se puede saltar a
              cualquier paso con un clic (no solo con Siguiente/Atrás), para
              volver a corregir algo sin perder lo ya escrito. */}
          <nav className="flex sm:flex-col gap-1.5 sm:w-44 sm:shrink-0 overflow-x-auto sm:overflow-visible">
            {PASOS.map((p) => (
              <button
                key={p.n}
                type="button"
                onClick={() => setStep(p.n)}
                className={`flex items-center gap-2.5 shrink-0 text-left px-2.5 py-2 rounded-lg transition-colors ${
                  step === p.n ? 'bg-amber/10' : 'hover:bg-raised'
                }`}
              >
                <span
                  className={`w-6 h-6 rounded-full grid place-items-center text-xs font-bold shrink-0 ${
                    step === p.n ? 'bg-amber text-night' : 'bg-raised border border-edge text-muted'
                  }`}
                >
                  {p.n}
                </span>
                <span className={`text-xs leading-tight whitespace-nowrap sm:whitespace-normal ${step === p.n ? 'text-ink font-semibold' : 'text-muted'}`}>
                  {p.label}
                </span>
              </button>
            ))}
          </nav>

          <div className="flex-1 min-w-0 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <paso.icon width={16} height={16} className="text-amberText shrink-0" />
              <span>
                {step}. {paso.label}
              </span>
            </div>
            <p className="text-xs text-muted -mt-2">{paso.subtitle}</p>

            {step === 1 && (
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <span className="w-16 h-16 rounded-xl grid place-items-center overflow-hidden shrink-0 bg-raised border border-edge">
                    {imageUrl ? (
                      <img src={imageUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Icon.box width={22} height={22} className="text-muted" />
                    )}
                  </span>
                  <label className="btn-ghost cursor-pointer text-sm">
                    {subiendoImagen ? 'Subiendo…' : imageUrl ? 'Cambiar imagen' : 'Subir imagen'}
                    <input type="file" accept="image/*" className="hidden" onChange={subirImagen} disabled={subiendoImagen} />
                  </label>
                </div>

                <div>
                  <label className="label">Nombre del insumo</label>
                  <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Jamón de cerdo" autoFocus />
                </div>

                <div>
                  <label className="label">Categoría</label>
                  {nuevaCategoria ? (
                    <div className="flex gap-2">
                      <input
                        className="field h-9 flex-1"
                        value={nombreCategoria}
                        onChange={(e) => setNombreCategoria(e.target.value)}
                        placeholder="Ej: Carnes y embutidos"
                        autoFocus
                      />
                      <button type="button" onClick={crearCategoria} className="btn-ghost h-9 px-3 text-sm">
                        Crear
                      </button>
                      <button type="button" onClick={() => setNuevaCategoria(false)} className="text-muted hover:text-ink px-1">
                        <Icon.x width={16} height={16} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <select className="field flex-1" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
                        <option value="" disabled hidden>
                          Elige una categoría
                        </option>
                        {categorias.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <button type="button" onClick={() => setNuevaCategoria(true)} className="btn-ghost h-10 px-3 text-xs whitespace-nowrap">
                        <Icon.plus width={14} height={14} /> Nueva
                      </button>
                    </div>
                  )}
                  <p className="text-xs text-muted mt-1.5">Propia de insumos: no se mezcla con las categorías de productos.</p>
                </div>

                <div>
                  <label className="label">Código interno (opcional)</label>
                  <input className="field" value={codigoInterno} onChange={(e) => setCodigoInterno(e.target.value)} placeholder="INS-001" />
                </div>

                <div>
                  <label className="label">Descripción (opcional)</label>
                  <textarea
                    className="field resize-none"
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Una breve descripción…"
                  />
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="label">Unidad de inventario</label>
                    <select
                      className="field h-9"
                      value={unidadInventario}
                      onChange={(e) => {
                        setUnidadInventario(e.target.value)
                        // Cambiar la unidad de inventario puede dejar la de
                        // compra de otra magnitud (ej: tenia litro y paso a
                        // gramo): se limpia para no guardar una conversion
                        // que no existe. Las de conteo ("Unidad", "Paquete")
                        // nunca se limpian aqui: son validas para cualquier
                        // magnitud (ver esEspecial).
                        const nueva = unidades.find((u) => u.codigo === e.target.value)
                        if (nueva && unidadCom && unidadCom.magnitud !== 'conteo' && nueva.magnitud !== unidadCom.magnitud) {
                          setUnidadCompra('')
                        }
                      }}
                    >
                      <option value="" disabled hidden>
                        Elige una unidad
                      </option>
                      {opcionesInventario.map((u) => (
                        <option key={u.codigo} value={u.codigo}>
                          {u.nombre}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="label">Unidad de compra</label>
                    <select className="field h-9" value={unidadCompra} onChange={(e) => setUnidadCompra(e.target.value)} disabled={!unidadInventario}>
                      <option value="" disabled hidden>
                        Elige una unidad
                      </option>
                      {opcionesCompra.map((u) => (
                        <option key={u.codigo} value={u.codigo}>
                          {u.nombre}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {esEspecial ? (
                  <div className="bg-raised border border-edge rounded-xl p-3 space-y-2">
                    <p className="text-[10px] font-bold tracking-wide text-muted uppercase">
                      Promedio de {unidadInv.nombre.split(' ')[0].toLowerCase()} por {unidadCom.nombre.split(' ')[0].toLowerCase()}
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="field h-9 flex-1"
                        value={cantidadPromedioPorUnidad}
                        onChange={(e) => setCantidadPromedioPorUnidad(e.target.value)}
                        placeholder="Ej: 500"
                        autoFocus
                      />
                      <span className="text-sm text-muted shrink-0">
                        {unidadInv.nombre.split(' ')[0]} por {unidadCom.nombre.split(' ')[0].toLowerCase()}
                      </span>
                    </div>
                    <p className="text-xs text-muted">
                      Cada {unidadCom.nombre.split(' ')[0].toLowerCase()} trae una cantidad distinta, así que esto
                      solo estima el costo de las recetas. Al registrar la compra vas a poder escribir la cantidad
                      real que llegó.
                    </p>
                  </div>
                ) : (
                  factor !== null && (
                    <div className="bg-raised border border-edge rounded-xl p-3">
                      <p className="text-[10px] font-bold tracking-wide text-muted uppercase">Conversión automática</p>
                      <p className="text-sm font-semibold mt-1">
                        1 {unidadCom.nombre.split(' ')[0]} = {factor.toLocaleString('es-CO')} {unidadInv.nombre.split(' ')[0]}
                      </p>
                      <p className="text-xs text-muted mt-1">El sistema convertirá las compras a {unidadInv.nombre.toLowerCase()}.</p>
                    </div>
                  )
                )}
              </div>
            )}

            {step === 3 && (
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="label">Stock mínimo (opcional)</label>
                  <input
                    type="number"
                    min="0"
                    className="field h-9"
                    value={stockMinimo}
                    onChange={(e) => setStockMinimo(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="flex-1">
                  <label className="label">Ubicación (opcional)</label>
                  <input className="field h-9" value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} placeholder="Refrigerador 1" />
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-3">
                <div>
                  <label className="label">Costo de compra</label>
                  <MoneyInput className="field" value={costoCompra} onChange={setCostoCompra} />
                  {unidadCom && <p className="text-xs text-muted mt-1.5">El costo se refiere a una unidad de compra ({unidadCom.nombre}).</p>}
                </div>

                <div>
                  <label className="label">Proveedor habitual (opcional)</label>
                  {nuevoProveedor ? (
                    <div className="flex gap-2">
                      <input
                        className="field h-9 flex-1"
                        value={nombreProveedor}
                        onChange={(e) => setNombreProveedor(e.target.value)}
                        placeholder="Nombre del proveedor"
                        autoFocus
                      />
                      <button type="button" onClick={crearProveedor} className="btn-ghost h-9 px-3 text-sm">
                        Crear
                      </button>
                      <button type="button" onClick={() => setNuevoProveedor(false)} className="text-muted hover:text-ink px-1">
                        <Icon.x width={16} height={16} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <select className="field flex-1" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
                        <option value="">Sin proveedor asignado</option>
                        {proveedores.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <button type="button" onClick={() => setNuevoProveedor(true)} className="btn-ghost h-10 px-3 text-xs whitespace-nowrap">
                        <Icon.plus width={14} height={14} /> Nuevo
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          {step === 1 ? (
            <button type="button" onClick={onClose} className="btn-ghost flex-1">
              Cancelar
            </button>
          ) : (
            <button type="button" onClick={retroceder} className="btn-ghost flex-1">
              <Icon.chevronLeft width={14} height={14} /> Atrás
            </button>
          )}

          {step < 4 ? (
            <button type="button" onClick={avanzar} className="btn-primary flex-1">
              Siguiente →
            </button>
          ) : (
            // A proposito type="button" (no "submit"): este mismo elemento
            // es "Siguiente" en los pasos 1-3 y cambia a este boton en el
            // paso 4. Si fuera type="submit", React muta el atributo del
            // MISMO nodo DOM al re-renderizar tras el clic de "Siguiente",
            // y el navegador evalua el type ya mutado para el "default
            // action" de ESE MISMO clic -- enviando el formulario de
            // inmediato al llegar al paso 4, antes de que el usuario vea
            // sus campos. Con onClick explicito no depende de ese orden.
            <button type="button" onClick={submit} disabled={saving} className="btn-primary flex-1">
              {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Guardar insumo'}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
