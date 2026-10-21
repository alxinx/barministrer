# CLAUDE.md — LicorPlus

POS multitenant para bares. El piloto es un bar de barrio en Medellín (15 mesas,
3 sectores). El objetivo a mediano plazo es venderlo a varios bares, así que
todo se diseña multitenant desde el modelo de datos, pero **sin** maquinaria SaaS
(registro self-service, planes, cobros) hasta que haya un segundo cliente real.

## Cómo quiere trabajar Alejo

- Directo y conciso. Sin preámbulos ni relleno.
- **Cuestiona antes de validar.** Si propone algo con un punto débil, empieza por
  ahí. Señala suposiciones flojas incluso cuando suene seguro.
- Entrega incremental hacia sub-objetivos. No construir de más.
- Soluciones simples y funcionales por encima de las sobre-diseñadas.
- Si una decisión depende de algo que solo sabe el dueño del bar, pregúntalo en
  vez de asumirlo.

## Stack

Node.js + Express · React (Vite) · MySQL + Prisma · TailwindCSS · Docker.
Despliegue final en AWS self-hosted bajo CodeDream.

```
api/   Express + Prisma. Rutas en src/routes, auth en src/middleware/auth.js
web/   React + Vite + Tailwind. Páginas en src/pages, UI en src/components
```

Arranque: `cp .env.example .env && docker compose up --build`.
Web `:5173` · API `:4000` · MySQL `:3307`.

Usuarios de prueba: `admin@licorplus.co`/`admin123`, `caja@licorplus.co`/`caja123`,
`mesera@licorplus.co`/`mesa123`. PIN de todos: `12345`.

## Reglas del dominio (no negociables)

Estas salieron de una conversación con el dueño del bar. Cambiarlas requiere
preguntarle a él, no decidirlo en el código.

### Multitenant
`tenantId` en toda tabla de negocio. **Sale siempre del JWT, nunca del cliente.**
Ninguna ruta acepta `tenantId` por body, query o parámetro. Esa es la única
barrera entre bares.

### Categorías
Jerárquicas con `parentId` (dos niveles bastan: `Licores > Aguardiente`). El flag
`allowsPour` vive en la **categoría**, no en el producto ni en el nombre:

- Evita que alguien venda papas en shots.
- Si está mal categorizado, el operador lo nota porque no aparece la opción.
- Una subcategoría nueva **hereda** el flag del padre, para que no se quede por
  fuera en silencio.
- Solo ADMIN puede tocar categorías y ese flag.

Desactivar una categoría **nunca** escribe `active=false` en sus productos. La
disponibilidad se calcula: `producto.active && categoría.active`. Así reactivar
la categoría devuelve cada producto a su estado individual.

### Productos, presentaciones y recetas
- `Variant` = presentaciones **selladas**. Siempre se cuentan en **unidades**,
  sea cerveza, botella o chicle. Media, botella y garrafa son objetos físicos
  distintos con stock propio, no fracciones.
- **Los shots NO son variantes.** Un shot es una receta de un solo ingrediente:
  `Shot Antioqueño = { Antioqueño: 30 ml }`. Un cóctel y un cubetazo usan el
  mismo mecanismo (`Recipe` + `RecipeItem`). No crear una tabla "especiales"
  aparte: sería un segundo mecanismo haciendo lo mismo.
- Un shot se vincula a una **marca concreta**, no a "aguardiente" en general.
- No hay campo `unidadMedida` en producto. El stock siempre es unidades; los ml
  solo existen dentro de una botella abierta.
- Compra por empaque (caja de 100 chicles, canasta de 30 cervezas) se resuelve en
  la **entrada de inventario** con `unitsPerPack`, no en el producto.

### Botellas abiertas y ml
- Abrir una botella saca 1 unidad del stock y crea un `OpenContainer` con su
  capacidad en **ml**. Los ml son la unidad contable, nunca una instrucción de
  servicio: nadie mide al servir.
- La UI **nunca muestra ml** en operación. Muestra "quedan ~12 shots", siempre
  aproximado.
- Pueden haber varias botellas abiertas del mismo licor a la vez. Se descuenta de
  la más antigua. No se cierran por fin de noche; viven hasta acabarse.
- **Nunca bloquear una venta** por un número teórico. Si llega a 0 y todavía hay
  trago, se vende y se marca sobreconsumo. Bloquear empuja a vender por fuera del
  sistema.
- Los ajustes de nivel ("quedan como 5, no 12") van como un **movimiento más**
  (`type: 'adjustment'`), nunca sobrescribiendo el restante: perder el rastro de
  los 7 shots que faltan es perder el dato que importa.

> **Nota de implementación (oct-2026):** `OpenContainer` todavía no existe en el
> código. Esta sección describe la regla de dominio acordada, no algo ya
> construido — los shots/cócteles hoy no tienen ningún stock propio que
> descontar. Antes de construirlo, revisar esta sección.

### Inventario de presentaciones (`Variant.stock`)
Aplica solo a presentaciones selladas (STOCK), no a shots/cócteles (ver nota
arriba). Reglas acordadas con Alejo en oct-2026:

- El stock se descuenta **al llegar a la barra**, no al crear el pre-pedido: si
  lo crea el admin nace `ACTIVE` y descuenta de una; si lo crea mesera/cajero
  queda `PENDING` y descuenta recién cuando `POST /orders/:id/send` lo aprueba.
  Un pre-pedido nunca tocado (borrado o rechazado) no descontó nada.
- Devolver (`/void`) repone el stock, pero solo si el item ya estaba `ACTIVE`
  (si seguía `PENDING`, nunca se le había restado nada).
- **Igual que las botellas abiertas: nunca bloquea una venta.** Si el stock
  llega a 0 o negativo, se sigue vendiendo — el catálogo de la mesera solo lo
  marca en rojo ("Agotado") para que cajero/admin lo note, no para impedir la
  venta a nadie, tampoco al mesero. Es un aviso, no un permiso diferenciado por
  rol.
- Cada movimiento (compra, venta, devolución, merma) queda en `StockMovement`
  con su tipo (`PURCHASE`/`SALE`/`VOID_RESTORE`/`WASTE`) — nunca se sobrescribe
  el stock a mano, siempre es un movimiento más.
- **Merma/pérdida manual** (unidad rota, vencida): modal dentro de "Ver
  productos", solo ADMIN real (no delegable con `cajeroGestionaInventario`) y
  pide PIN. A diferencia de la venta, **sí tiene techo**: nunca se puede mermar
  más de lo que hay en stock. Genera un `ShiftExpense` tipo `GASTO` automático
  por `cantidad × costo unitario` (nunca el precio de venta) y requiere turno
  abierto — igual que un abono a fiado, si no hay turno abierto no se deja
  registrar. Imprime comprobante igual que una venta o un abono.

### Lo que el sistema mide
El valor del producto es la **diferencia entre lo que debería haber y lo que
hay**, por botella, por turno y por persona. Los reportes:

- Solo con botellas cerradas por completo (los ajustes a mitad son estimaciones).
- Mínimo 5 botellas antes de alertar, para no gritar por ruido.
- Separar faltante de sobrante: son problemas distintos.
- **No acusar.** El sistema no sabe si fue desperdicio, robo o vaso grande. Un
  desfase constante en todas las botellas suele ser **calibración** (el vaso es
  de 35 ml, no 30), no robo. Concentrado en un turno o persona, ya es otra cosa.
- Tolerancia configurable por bar.

### Gastos (no inventario)
Hielo, limones y pasabocas de cortesía son **gasto de caja menor**, no
inventario. Nadie va a contar limones. Se controlan por proporción contra las
ventas de las categorías que los consumen (`expense_category_drivers`, con
herencia desde la categoría padre), no contra la venta total: el aguardiente no
usa hielo y el whisky no usa limón.

### Operación
- **Flujo del pedido (decisión de Alejo, oct-2026 — invierte la anterior):**
  la mesera registra el pedido y le da enviar, pero queda como **pre-pedido**
  (`OrderItem.status = PENDING`): no suma al total ni llega a la barra. Por
  WebSocket le llega el aviso en vivo a admin **y cajero** (número de mesa en
  ámbar en el plano + listado en el panel lateral): los dos se enteran de que
  hay un pre-pedido esperando, y **cualquiera de los dos puede aprobarlo y
  enviarlo a la barra** (`POST /orders/:id/send`, pasa todo a `ACTIVE`) — la
  mesera no. Esto es a propósito el cuello de botella que la regla anterior
  evitaba — si en operación real trae problemas (admin ocupado, pedidos
  atascados), es decisión suya revertirlo,
  no algo para decidir en el código.
- Al cobrar, las líneas en *listo* sin entregar se muestran y hay que resolverlas
  (entregar o anular con motivo). Nada queda en el limbo. (Pendiente: todavía
  no hay estados *listo*/*entregado* separados, solo pre-pedido → activo.)
- "No hay" sí existe aunque el inventario diga que sí (cerveza caliente, botella
  rota, venta sin registrar). El stock es un aviso, no un bloqueo.
- **Permisos:** la mesera crea pedidos y agrega productos. No aplica descuentos,
  no borra productos ya enviados, no cambia precios, no cierra caja. Anular
  requiere PIN del encargado y queda con motivo.
- **Módulo de usuarios** (`/usuarios`, solo ADMIN): crear, editar rol, resetear
  clave/PIN y desactivar. Gestionar usuarios es configuración, igual que
  catálogo e inventario — CAJERO no entra aquí. Nunca se borra un usuario de
  verdad: `createdById`/`voidedById`/`closedBy` en pedidos, turnos y
  movimientos apuntan a él, y borrarlo rompería ese rastro. Se desactiva
  (`active=false`), igual que categorías y productos. La API bloquea dejar el
  tenant sin ningún ADMIN activo (no quedaría quién revierta el cambio). Cada
  mesero/a tiene pantalla de "mi cuenta": la clave y el PIN los fija el admin.
- **Cortesías:** el usuario logueado dice quién registró; el PIN del encargado
  autoriza. Para eventos (el artista), se abre una cuenta de cortesía con cupo
  **antes** del evento en vez de aprobar cada cerveza. El PIN no se rota por
  calendario: se cambia cuando sale un empleado o hay sospecha.
- **Propinas:** fuera del sistema. No van en la factura.
- **Turnos:** el turno no es el día calendario (el viernes termina a las 3 am).
  Toda venta va atada a un turno. Cierre con base inicial, medios de pago
  separados (efectivo / Nequi / transferencia / datáfono), fiados como cuentas
  por cobrar, retiros registrados, y **conteo ciego**: el cajero cuenta sin ver lo
  esperado. Turno cerrado queda bloqueado; las correcciones son ajustes con
  autor y motivo.
- **Abonos a fiado:** un abono es plata real entrando a caja, no una venta
  nueva. Necesita turno abierto (si no hay, no se deja registrar) y un medio
  de pago; ese monto se suma a lo esperado de ese medio en el cuadre del
  cierre, aparte del total vendido. Cada abono genera un comprobante
  imprimible (tirilla), igual que una venta.
- **Consecutivo de facturas:** una sola secuencia por bar (`Tenant.lastInvoiceNumber`),
  nunca se reinicia por turno ni por día. Se asigna solo al **cerrar** la
  cuenta (antes de eso no es una factura todavía), con un increment atómico
  dentro de la misma transacción del cierre para que dos cierres a la vez
  nunca repitan número. Las cuentas cerradas antes de este campo quedan sin
  número — no se rellena hacia atrás.
- **Descuentos al cerrar:** escondido igual que la cortesía (triple clic,
  ahora sobre el número de "Total a cobrar"), y solo lo puede usar el ADMIN o
  un cajero con `cajeroAplicaDescuentos`. No es un porcentaje: se edita
  directamente el valor que se va a cobrar, y la diferencia contra el total de
  los items es el descuento. Se reparte entre las líneas según la utilidad de
  cada una (precio − costo): el producto que más margen deja absorbe más del
  descuento — así, si el total a cobrar no cae por debajo del costo total de
  la cuenta, ninguna línea queda vendida a pérdida individualmente. Si cae por
  debajo, el botón de pagar se bloquea y el modal avisa en rojo: nunca se
  cierra una cuenta a pérdida. La factura imprime valor original, descuento y
  valor pagado por separado; dividir el comprobante entre personas reparte el
  valor **ya con descuento**, no el original. El costo de un shot/cóctel se
  deriva de su receta (costo por ml de las presentaciones del ingrediente),
  no es un campo propio — si un producto nunca tuvo costo registrado en el
  catálogo, cuenta como costo 0 (margen = precio completo), así que absorbe
  más descuento del que le tocaría de verdad: ponerle costo real es lo que
  arregla eso, no el código.

### Precios con horario
`active_from`/`active_until` **no** sirve para "los martes de 5 a 7": eso es
recurrente. Va en una tabla de reglas de precio con `days_of_week`, `start_time`,
`end_time`. El producto conserva su precio normal y la regla lo reemplaza en el
horario. Reglas que chocan: gana el precio más bajo.

- El precio se congela **al momento del pedido**, no al cobrar. Si piden a las
  6:55 y pagan a las 8:30, mantienen la promo.
- El servidor va en UTC; convertir a la zona del tenant o la promo de 5 pm se
  activa al mediodía.
- Combos que solo existen en el partido: eso es **disponibilidad**, no precio.
  Mismo formato de horario, concepto distinto.

### Imágenes
Librería global de productos comerciales (Corona, Águila, Poker): la imagen vive
una vez y los tenants la referencian, no se copia por bar. Las fotos propias del
bar (canasta, jirafa, cóctel de la casa) sí son por tenant. Son **ilustrativas**:
recorte y fondo, nada de IA generativa, que deforma etiquetas de marca. Comprimir
y redimensionar en el navegador antes de subir (máx 800 px, ~200 KB). La imagen
es **opcional**: si no hay, se muestra el nombre sobre el color de la categoría.

El logo del bar es distinto: banner, no ícono, máx **200×70 px**, siempre
**webp**, y vive en **Cloudflare R2** (no en la base de datos — `Tenant.logoUrl`
es solo la URL pública). El navegador redimensiona y convierte antes de subir
(`web/src/lib/image.js`); el backend (`POST /tenant/logo`) solo decodifica y
sube a R2 con el SDK de S3 (`api/src/lib/r2.js`). Las credenciales de R2
(`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
`R2_PUBLIC_URL`) viven **solo en `.env`**, nunca llegan al frontend ni a la
base de datos.

## Diseño de UI

El bar opera de noche con poca luz. Interfaz **oscura**, tokens en
`web/tailwind.config.js`. El cambio a claro es editar tokens, no código.

- Acento: ámbar `#E8A33D`. Un solo lugar donde ser audaz.
- Estados de mesa: libre verde, reservada ámbar, ocupada roja. Convencional a
  propósito: se leen de un vistazo.
- **El número de mesa es el héroe.** Grande, pesado (`text-mesa`). Todo lo demás,
  callado.
- Botones grandes, texto legible a metro y medio, pensado para un celular con la
  pantalla sucia a las 11 pm.
- Los productos más pedidos a uno o dos toques. Si registrar una cerveza toma más
  que anotarla en papel, van a anotar en papel.
- Una lista de texto es más rápida que una cuadrícula de fotos en la pantalla de
  la mesera. Las fotos importan en la carta del QR, no en el POS.
- Foco visible siempre (la caja se opera con teclado), `prefers-reduced-motion`
  respetado.
- Español de Colombia, voz activa, sentence case. El botón dice exactamente lo
  que pasa: "Enviar pedido a la barra", no "Confirmar".

## Convenciones de código

- ES modules en ambos lados.
- Los comentarios explican **por qué**, no qué. Sobre todo las reglas de dominio
  de arriba, que no son obvias leyendo el código.
- Nombres de dominio en español (mesa, mesero, cubetazo, trago); nombres técnicos
  en inglés (tenantId, variant, stock).
- Errores de API en español y accionables: `"La presentación X necesita su
  volumen en ml para poder vender shots"`, no `"validation failed"`.
- La disponibilidad se **calcula**, nunca se guarda en dos lugares. Aplica a
  productos, a shots restantes y a disponibilidad de combos (el ingrediente que
  se acabe primero).
- Mutaciones de configuración: solo ADMIN. Mutaciones de operación (estado de
  mesa): cualquier rol. La distinción está en `PATCH /tables/:id`.
- **Permisos delegables:** por defecto catálogo, inventario, distribución,
  usuarios y descuentos son solo-ADMIN. El dueño puede prenderle cada uno a
  CAJERO puntualmente desde `/configuracion/permisos`
  (`Tenant.cajeroEditaCatalogo` / `cajeroGestionaInventario` /
  `cajeroGestionaDistribucion` / `cajeroGestionaUsuarios` /
  `cajeroAplicaDescuentos`, todos `false` por defecto). El middleware
  `requirePermission(flag)` deja pasar a ADMIN siempre; a CAJERO solo si su
  tenant tiene ese flag en `true`. Aunque se le delegue usuarios, un cajero
  **nunca** puede crear ni tocar una cuenta ADMIN — evita que un permiso
  puntual se use para escalar a dueño. La página de permisos misma es siempre
  ADMIN real, nunca delegable (si no, un cajero podría otorgarse más acceso a
  sí mismo).

## Estado actual

Hecho: auth con roles, aislamiento por tenant, catálogo (categorías, productos,
variantes), editor de distribución (zonas, mesas y elementos arrastrables sobre
cuadrícula), pantalla de venta con plano y pedido, movimientos de inventario
(compra, venta/devolución automáticas al enviar/devolver un pedido, merma
manual con PIN), turnos y cierre de caja, pre-pedido de la mesera con
aprobación del admin por WebSocket (ver Operación arriba), módulo de usuarios
(`/usuarios`), datos del bar y permisos delegables (`/configuracion`).

Falta, en orden: estados *listo*/*entregado* dentro del pedido ya aprobado →
reglas de precio → recetas y combos en UI → reportes → QR en mesa (fase 2).

Pendientes conocidos:

- `Variant.stock` sigue siendo un campo (`Int`), no una agregación en vivo de
  `StockMovement` — se mantiene sincronizado a mano en cada ruta que lo toca
  (compra, venta, devolución, merma). Funciona, pero si alguna vez se
  desincroniza no hay un recálculo automático desde los movimientos.
- `OpenContainer` (botellas abiertas/ml para shots y cócteles) no existe
  todavía — ver nota en "Botellas abiertas y ml". El inventario por movimientos
  solo cubre presentaciones selladas.
- El Dockerfile de la API corre `prisma db push`. Antes de producción: migraciones
  reales con `prisma migrate deploy`.

## Decisiones ya tomadas (no volver a abrir sin motivo nuevo)

- **Sin offline en v1.** Nube + router con respaldo 4G. Si algún bar lo exige, es
  un add-on con servidor local y hardware, no parte del producto base: 20 mini PCs
  que actualizar matan el margen. Diseñar con UUIDs e inventario por eventos deja
  la puerta abierta sin costo.
- **Sin integración de Spotify.** La API no escala (modo desarrollo limita a 5
  usuarios por app; cuota extendida exige 250k MAU) y usar una cuenta personal en
  un negocio va contra los términos. Si hay demanda, la oportunidad es una rocola
  por QR, que es lógica propia.
- **Sin propina en factura**, sin control de hielo/limones como inventario, sin
  cócteles preparados en v1 (por ahora solo prefabricados tipo Smirnoff Ice).
