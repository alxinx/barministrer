// Encabezado compartido por las 5 tirillas (venta, abono, egreso, merma,
// cierre de turno): logo, razon social (o nombre si no hay razon social
// registrada), direccion y datos tributarios. Un solo lugar para no repetir
// este bloque 5 veces -- ver tambien ReciboPie para el pie de pagina.
export default function ReciboEncabezado({ tenant }) {
  const nombre = tenant?.legalName || tenant?.name || 'Barminister'
  const datosFiscales = [tenant?.taxId && `NIT ${tenant.taxId}`, tenant?.taxRegime].filter(Boolean).join(' · ')

  return (
    <div className="text-center space-y-0.5">
      {tenant?.logoUrl && (
        <img src={tenant.logoUrl} alt="" className="max-h-[52px] max-w-[180px] mx-auto mb-1.5 object-contain" />
      )}
      <p className="font-bold text-sm uppercase">{nombre}</p>
      {tenant?.address && <p className="text-[11px]">{tenant.address}</p>}
      {datosFiscales && <p className="text-[11px]">{datosFiscales}</p>}
    </div>
  )
}
