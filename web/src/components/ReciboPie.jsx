import { PIE_PAGINA_SISTEMA } from '../lib/brand'

// Pie de pagina compartido por las 5 tirillas. Tenant.receiptFooter es el
// texto propio del negocio, opcional (horario, redes, politica de
// devoluciones...). PIE_PAGINA_SISTEMA sale SIEMPRE debajo, fija en el
// codigo -- ningun tenant la puede editar ni quitar desde /configuracion/datos.
export default function ReciboPie({ tenant }) {
  return (
    <>
      <div className="my-2 border-t border-dashed border-black/40" />
      {tenant?.receiptFooter && <p className="text-center text-[10px] text-black/60">{tenant.receiptFooter}</p>}
      <p className="text-center text-[10px] text-black/60">{PIE_PAGINA_SISTEMA}</p>
    </>
  )
}
