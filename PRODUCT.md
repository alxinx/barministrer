# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Dos capas de usuario:

- **Cliente del producto (futuro):** dueños de bares de barrio. El piloto es un
  bar de Medellín, 15 mesas, 3 sectores.
- **Usuarios finales dentro de un bar**, cada uno con su trabajo:
  - **Mesera/o:** crea pedidos, agrega productos, marca entregado. Opera un
    celular con pantalla sucia, de noche, con afán. No aplica descuentos, no
    borra productos enviados, no cambia precios, no cierra caja.
  - **Cajero:** cobra, cierra turno (base inicial, medios de pago separados,
    fiados, retiros, conteo ciego).
  - **Administrador/dueño:** configura categorías, productos, variantes,
    reglas de precio; es el único que toca el flag `allowsPour`.
  - **Barra:** prepara pedidos y los marca "listo". *Abierto:* el repo no deja
    claro si tiene login/rol propio o comparte pantalla con caja/admin.

## Product Purpose

POS multitenant para bares que operan de noche. Resuelve el inventario real de
licor (botellas abiertas, mililitros, shots) en vez de tratarlo como unidades
fraccionables, y mide la diferencia entre lo que debería haber y lo que hay —
sin bloquear nunca una venta por un número teórico. Éxito = el flujo de salón
(pedido → barra → entregado) es más rápido que anotar en papel, y el reporte de
faltante/sobrante es útil sin acusar a nadie.

## Positioning

Lo que un POS genérico no modela:

- Un solo mecanismo (`Recipe` + `RecipeItem`) cubre shots, cócteles y
  cubetazos — un shot es una receta de un ingrediente vinculada a una marca
  concreta, no una variante ni una tabla "especiales" aparte.
- Las botellas abiertas son objetos vivos contados en ml, no una instrucción de
  servicio: se descuentan de la más antigua, no se cierran por fin de turno, y
  nunca bloquean una venta aunque lleguen a 0 teórico.
- El reporte de variancia separa faltante de sobrante, exige volumen mínimo
  antes de alertar y no acusa: un desfase constante en todas las botellas es
  calibración de vaso, no robo.
- Multitenant desde el modelo de datos (`tenantId` en toda tabla de negocio,
  siempre del JWT) pero sin maquinaria SaaS hasta el segundo cliente real.

## Operating Context

- Bar nocturno, poca luz, celular con pantalla sucia a las 11pm.
- Flujo de pedido en tiempo real: mesera pide (pendiente) → barra ve y marca
  listo → mesera marca entregado y ahí suma a la cuenta. El cajero no aprueba
  al inicio.
- Turno ≠ día calendario (el viernes cierra a las 3am). Toda venta va atada a
  un turno; cierre con conteo ciego y correcciones quedan como ajustes con
  autor y motivo.
- Reglas de precio por horario recurrente (ej. martes 5-7pm), distintas de
  vigencia por fecha. El precio se congela al pedir, no al cobrar.
- Gastos de caja menor (hielo, limones, cortesías) se controlan por proporción
  contra ventas de las categorías que los consumen, no como inventario.
- Cortesías: el PIN del encargado autoriza; para eventos se abre cuenta de
  cortesía con cupo antes del evento.

## Capabilities and Constraints

- Categorías jerárquicas (2 niveles), `allowsPour` vive en la categoría y se
  hereda a subcategorías nuevas. Solo ADMIN toca categorías.
- Desactivar categoría nunca escribe `active=false` en productos; la
  disponibilidad siempre se calcula (`producto.active && categoría.active`).
- `Variant` = presentaciones selladas, siempre en unidades. No existe
  `unidadMedida` en producto. Compra por empaque (`unitsPerPack`) se resuelve
  en la entrada de inventario, no en el producto.
- Tolerancia de variancia configurable por bar; mínimo 5 botellas cerradas
  antes de alertar.
- Sin offline en v1 (nube + router 4G de respaldo). Sin integración de
  Spotify. Sin propina en factura. Sin cócteles preparados en v1 (solo
  prefabricados tipo Smirnoff Ice).
- *Abierto:* estándar de accesibilidad formal no definido; los compromisos
  actuales (foco visible, `prefers-reduced-motion`, texto legible a distancia)
  son de diseño, no un requisito certificado.
- *Abierto:* el Dockerfile de la API corre `prisma db push`; antes de
  producción falta migrar a `prisma migrate deploy`.

## Brand Commitments

- Nombre del producto: **LicorPlus**.
- Acento ámbar `#E8A33D`, único lugar donde ser audaz.
- Estados de mesa semáforo convencional: libre verde, reservada ámbar,
  ocupada roja.
- Español de Colombia, voz activa, sentence case; el botón dice exactamente lo
  que pasa ("Enviar pedido a la barra", no "Confirmar").
- Imágenes de producto: nunca generadas por IA (deforma etiquetas de marca);
  recorte y fondo, opcional, comprimidas en navegador (máx 800px, ~200KB).
- *Abierto:* el bar piloto (el cliente real en Medellín) no tiene nombre o
  marca propia confirmada en el repo más allá de ser "el piloto" de LicorPlus.

## Evidence on Hand

- Usuarios de prueba reales: `admin@licorplus.co`/`admin123`,
  `caja@licorplus.co`/`caja123`, `mesera@licorplus.co`/`mesa123`, PIN `1234`
  para todos.
- Seed con bar de prueba: 15 mesas, 3 sectores, catálogo base.
- Sin testimonios, casos de estudio, prensa, ni assets de marca del bar real
  todavía — no inventar ninguno.

## Product Principles

1. El inventario nunca bloquea una venta; el sistema registra el desfase, no
   lo impide.
2. La disponibilidad se calcula siempre, nunca se guarda en dos lugares.
3. El sistema mide, no acusa: separa faltante de sobrante y exige volumen
   mínimo antes de alertar.
4. Multitenant desde el modelo de datos, sin maquinaria SaaS hasta que haya un
   segundo cliente real.
5. Diseño para operación nocturna con afán: menos toques, texto legible a
   metro y medio, foco siempre visible.

## Accessibility & Inclusion

No hay un estándar formal (WCAG u otro) establecido todavía. Compromisos de
diseño ya tomados: foco visible siempre (la caja se opera con teclado),
`prefers-reduced-motion` respetado, botones grandes y texto legible para
operación con poca luz.
