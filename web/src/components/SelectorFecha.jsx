import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DayPicker } from 'react-day-picker'
import { es } from 'date-fns/locale'
import 'react-day-picker/dist/style.css'
import { Icon } from './Icons'
import { formatCorto, isoLocal, parseISOLocal } from '../lib/fechas'

// Selector de UNA fecha (fecha de compra, vencimiento, etc.), mismo
// calendario y mismo tema (rdp-licorplus) que ya usa RangoFechas para
// rangos -- aqui en mode="single". value/onChange trabajan en ISO
// (YYYY-MM-DD) para calzar directo con los campos que antes usaban un
// <input type="date">, sin tener que tocar el resto del formulario.
export default function SelectorFecha({ value, onChange, placeholder = 'Elegir fecha', clearable = false }) {
  const [abierto, setAbierto] = useState(false)
  const [alinear, setAlinear] = useState('left')
  const contenedorRef = useRef(null)
  const popoverRef = useRef(null)

  const seleccionada = value ? parseISOLocal(value) : undefined

  // Igual que RangoFechas: mide donde cae el popover ya abierto y, si se sale
  // de la ventana por la derecha, lo voltea una vez en vez de adivinar.
  useLayoutEffect(() => {
    if (!abierto) return
    const el = popoverRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setAlinear(rect.right > window.innerWidth - 8 ? 'right' : 'left')
  }, [abierto])

  useEffect(() => {
    if (!abierto) return
    function alClickFuera(e) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target)) setAbierto(false)
    }
    document.addEventListener('mousedown', alClickFuera)
    return () => document.removeEventListener('mousedown', alClickFuera)
  }, [abierto])

  function elegir(fecha) {
    if (!fecha) return
    onChange(isoLocal(fecha))
    setAbierto(false)
  }

  return (
    <div className="relative" ref={contenedorRef}>
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        className="field flex items-center justify-between gap-2 text-left"
      >
        <span className={value ? '' : 'text-muted/60'}>{value ? formatCorto(seleccionada) : placeholder}</span>
        <Icon.calendar width={16} height={16} className="text-muted shrink-0" />
      </button>

      {abierto && (
        <div
          ref={popoverRef}
          className={`absolute z-20 mt-2 card p-3 shadow-2xl max-w-[calc(100vw-2.5rem)] overflow-x-auto ${
            alinear === 'left' ? 'left-0' : 'right-0'
          }`}
        >
          <DayPicker
            mode="single"
            locale={es}
            selected={seleccionada}
            onSelect={elegir}
            defaultMonth={seleccionada}
            className="rdp-licorplus"
            weekStartsOn={1}
          />
          {clearable && value && (
            <button
              type="button"
              onClick={() => {
                onChange('')
                setAbierto(false)
              }}
              className="text-xs text-muted hover:text-ink underline block mx-auto mt-1"
            >
              Quitar fecha
            </button>
          )}
        </div>
      )}
    </div>
  )
}
