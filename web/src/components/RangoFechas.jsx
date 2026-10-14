import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DayPicker } from 'react-day-picker'
import { es } from 'date-fns/locale'
import 'react-day-picker/dist/style.css'
import { Icon } from './Icons'
import { formatCorto, isoLocal } from '../lib/fechas'

// Dos meses lado a lado no caben en una pantalla angosta: el popover
// quedaria cortado contra el borde de la ventana, con el primer mes
// inalcanzable. Por debajo del breakpoint se muestra un mes solo.
function useUnMesSolo() {
  const [unMes, setUnMes] = useState(() => window.innerWidth < 640)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const actualizar = (e) => setUnMes(e.matches)
    mq.addEventListener('change', actualizar)
    return () => mq.removeEventListener('change', actualizar)
  }, [])
  return unMes
}

// Boton con la etiqueta del periodo activo que despliega un calendario de
// rango (fecha A a fecha B). Vive al lado de los pills de "N dias": elegir
// un pill limpia el rango explicito, elegir un rango explicito aqui no toca
// los pills (el que llama decide cual gana). Se abre sin nada seleccionado
// a proposito: si se precarga con el rango ya aplicado, un solo clic mueve
// el extremo mas cercano de ESE rango (el comportamiento normal de un
// calendario de rango) en vez de empezar una seleccion nueva de fecha A a
// fecha B, que es lo que se pidio.
export default function RangoFechas({ rango, onElegir, activo = false, labelOcioso }) {
  const [abierto, setAbierto] = useState(false)
  const [seleccion, setSeleccion] = useState(undefined)
  const [alinear, setAlinear] = useState('right')
  const contenedorRef = useRef(null)
  const popoverRef = useRef(null)
  const unMesSolo = useUnMesSolo()

  useEffect(() => {
    if (abierto) setSeleccion(undefined)
  }, [abierto])

  // El boton puede quedar pegado a cualquier borde segun el ancho de
  // pantalla (en movil queda a la izquierda, en desktop junto a los pills a
  // la derecha): se mide donde cae el popover ya abierto y, si se sale de la
  // ventana, se voltea una vez en vez de adivinar la alineacion de antemano.
  useLayoutEffect(() => {
    if (!abierto) return
    const el = popoverRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.left < 8) setAlinear('left')
    else if (rect.right > window.innerWidth - 8) setAlinear('right')
  }, [abierto, unMesSolo])

  useEffect(() => {
    if (!abierto) return
    function alClickFuera(e) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target)) setAbierto(false)
    }
    document.addEventListener('mousedown', alClickFuera)
    return () => document.removeEventListener('mousedown', alClickFuera)
  }, [abierto])

  function elegir(nuevaSeleccion) {
    setSeleccion(nuevaSeleccion)
    if (nuevaSeleccion?.from && nuevaSeleccion?.to) {
      onElegir({ desde: isoLocal(nuevaSeleccion.from), hasta: isoLocal(nuevaSeleccion.to) })
      setAbierto(false)
    }
  }

  return (
    <div className="relative" ref={contenedorRef}>
      <button
        type="button"
        onClick={() => {
          setAlinear('right')
          setAbierto((a) => !a)
        }}
        className={`h-9 px-3.5 rounded-xl text-xs border flex items-center gap-1.5 whitespace-nowrap transition-colors ${
          activo ? 'bg-amber text-night border-amber font-semibold' : 'bg-surface text-muted border-edge hover:text-ink'
        }`}
      >
        <Icon.calendar width={14} height={14} />
        {activo || !labelOcioso ? `${formatCorto(rango.from)} – ${formatCorto(rango.to)}` : labelOcioso}
      </button>

      {abierto && (
        <div
          ref={popoverRef}
          className={`absolute z-20 mt-2 card p-3 shadow-2xl max-w-[calc(100vw-2.5rem)] overflow-x-auto ${
            alinear === 'left' ? 'left-0' : 'right-0'
          }`}
        >
          <DayPicker
            mode="range"
            locale={es}
            numberOfMonths={unMesSolo ? 1 : 2}
            selected={seleccion}
            onSelect={elegir}
            defaultMonth={rango.from}
            className="rdp-licorplus"
            weekStartsOn={1}
          />
        </div>
      )}
    </div>
  )
}
