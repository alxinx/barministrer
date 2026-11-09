import { useEffect, useState } from 'react'
import { decodificarTicket } from '../lib/ticketDecoder'
import { Icon } from './Icons'

/**
 * Montado una vez en Shell.jsx (asi queda activo sin importar que pantalla
 * este abierta: venta, abono, egreso, merma, turno, o la tirilla de prueba
 * de DatosBar). Escucha el evento que printer.js dispara cuando el modo
 * simulador esta prendido (ver modoSimulador) y muestra lo que se habria
 * mandado a la impresora termica, decodificado en vez de impreso.
 *
 * Acumula en una cola en vez de reemplazar: una venta en efectivo dispara
 * DOS eventos seguidos (la tirilla y despues el pulso del cajon, ver
 * abrirCajon en printer.js) -- si el segundo pisara al primero, nunca se
 * alcanzaria a ver la tirilla.
 */
export default function SimuladorImpresora() {
  const [cola, setCola] = useState([])

  useEffect(() => {
    let siguienteId = 0
    function alRecibir(e) {
      siguienteId += 1
      setCola((prev) => [{ id: siguienteId, ...decodificarTicket(e.detail) }, ...prev])
    }
    window.addEventListener('ticket-simulado', alRecibir)
    return () => window.removeEventListener('ticket-simulado', alRecibir)
  }, [])

  if (!cola.length) return null

  function quitar(id) {
    setCola((prev) => prev.filter((r) => r.id !== id))
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4" onClick={() => setCola([])}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-sm p-5 space-y-4 max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold flex items-center gap-2">
            <Icon.printer width={17} height={17} />
            Simulador de impresora
          </h2>
          <button type="button" onClick={() => setCola([])} className="text-muted hover:text-ink">
            <Icon.x width={18} height={18} />
          </button>
        </div>

        {cola.map((resultado) => (
          <div key={resultado.id} className="space-y-2 pb-4 border-b border-edge last:border-0 last:pb-0">
            {resultado.tipo === 'cajon' && (
              <p className="text-sm text-amberText bg-amber/10 border border-amber/30 rounded-xl px-3 py-2.5">
                El cajón de dinero se habría abierto aquí.
              </p>
            )}

            {resultado.tipo === 'imagen' && (
              <div className="bg-white rounded-lg p-2">
                <img src={resultado.dataUrl} alt="Tirilla simulada" className="w-full" />
              </div>
            )}

            {resultado.tipo === 'texto' &&
              (resultado.lineas.length ? (
                <div className="bg-white text-[#111] rounded-lg p-3 font-mono text-xs space-y-0.5">
                  {resultado.lineas.map((l, i) => (
                    <p key={i}>{l}</p>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">No se pudo leer nada de texto en estos bytes.</p>
              ))}

            <button type="button" onClick={() => quitar(resultado.id)} className="text-xs text-muted hover:text-ink">
              Quitar
            </button>
          </div>
        ))}

        <p className="text-xs text-muted">
          Esto es exactamente lo que se habría mandado a la impresora térmica, decodificado en vez de impreso.
        </p>
      </div>
    </div>
  )
}
