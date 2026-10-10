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
`mesera@licorplus.co`/`mesa123`. PIN de todos: `1234`.

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
- **Flujo del pedido:** mesera pide → entra a la mesa como *pendiente* y la barra
  lo ve en tiempo real → barra marca *listo* → **mesera marca *entregado*** y ahí
  suma a la cuenta. El cajero **no** aprueba al inicio: se vuelve cuello de
  botella y si se le olvida uno, las cervezas salen sin quedar en la cuenta.
- Al cobrar, las líneas en *listo* sin entregar se muestran y hay que resolverlas
  (entregar o anular con motivo). Nada queda en el limbo.
- "No hay" sí existe aunque el inventario diga que sí (cerveza caliente, botella
  rota, venta sin registrar). El stock es un aviso, no un bloqueo.
- **Permisos:** la mesera crea pedidos y agrega productos. No aplica descuentos,
  no borra productos ya enviados, no cambia precios, no cierra caja. Anular
  requiere PIN del encargado y queda con motivo.
- **Cortesías:** el usuario logueado dice quién registró; el PIN del encargado
  autoriza. Para eventos (el artista), se abre una cuenta de cortesía con cupo
  **antes** del evento en vez de aprobar cada cerveza. El PIN no se rota por
  calendario: se cambia cuando sale un empleado o hay sospecha.
- **Propinas:** fuera del sistema. No van en la factura.
- **Turnos:** el turno no es el día calendario (el viernes termina a las 3 am).
  Toda venta va atada a un turno. Cierre con base inicial, medios de pago
  separados (efectivo / Nequi / Daviplata / datáfono), fiados como cuentas por
  cobrar, retiros registrados, y **conteo ciego**: el cajero cuenta sin ver lo
  esperado. Turno cerrado queda bloqueado; las correcciones son ajustes con
  autor y motivo.

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

## Estado actual

Hecho: auth con roles, aislamiento por tenant, catálogo (categorías, productos,
variantes), editor de distribución (zonas, mesas y elementos arrastrables sobre
cuadrícula), pantalla de venta con plano y pedido en memoria.

Falta, en orden: movimientos de inventario → pedidos (mesera/barra/entregado) →
turnos y cierre de caja → reglas de precio → recetas y combos en UI → reportes →
QR en mesa (fase 2).

Pendientes conocidos:

- El botón "Enviar pedido a la barra" no hace nada todavía.
- `Variant.stock` es un número suelto. Se vuelve derivado de los movimientos.
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
