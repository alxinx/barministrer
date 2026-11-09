// Linea fija de marca que sale SIEMPRE al final de cada tirilla (venta,
// abono, egreso, merma, cierre de turno), debajo del pie de pagina propio
// del negocio si tiene uno (ver Tenant.receiptFooter). A proposito no vive
// en la base de datos ni en ningun campo editable desde /configuracion/datos:
// ningun tenant la puede quitar ni cambiar. Solo se edita tocando este
// archivo -- es decir, solo Alejo.
export const PIE_PAGINA_SISTEMA = 'Sistema POS · Barminister · barminister.com'
