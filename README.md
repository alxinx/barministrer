# LicorPlus

POS multitenant para bares. Esta es la base: autenticación con roles, aislamiento
por bar, catálogo de productos y editor de distribución del local.

## Arrancar

```bash
cp .env.example .env
docker compose up --build
```

- Web: http://localhost:5173
- API: http://localhost:4000
- MySQL: localhost:3307

El contenedor de la API corre `prisma db push` y el seed en cada arranque, así que
la primera vez queda con el bar de prueba listo.

### Usuarios de prueba

| Correo | Clave | Rol |
|---|---|---|
| admin@licorplus.co | admin123 | Administrador |
| caja@licorplus.co | caja123 | Cajero |
| mesera@licorplus.co | mesa123 | Mesero |

El PIN de todos es `1234` (se usará para autorizar cortesías y anulaciones).

## Estructura

```
api/
  prisma/schema.prisma   modelo de datos
  prisma/seed.js         bar de prueba con 15 mesas y catálogo
  src/routes/            auth, catalog, layout
  src/middleware/auth.js JWT + aislamiento por tenant
web/
  src/components/        Shell, FloorPlan, Icons
  src/pages/             Login, NuevaVenta, Distribucion, Productos
```

## Decisiones del modelo

**Multitenant.** Toda tabla lleva `tenantId` y el middleware lo toma del JWT,
nunca del cliente. Ninguna ruta acepta un `tenantId` por parámetro.

**Categorías jerárquicas.** `parentId` permite `Licores > Aguardiente`, para
reportar a cualquier nivel. El flag `allowsPour` vive en la categoría, no en el
producto: así no aparece la opción de vender shots en unas papas, y una
subcategoría nueva hereda el flag del padre en vez de quedarse por fuera en
silencio.

**Desactivar una categoría no toca los productos.** La disponibilidad se calcula
(`producto activo && categoría activa`), así que reactivar la categoría devuelve
cada producto a su estado individual.

**Producto ≠ lo que se vende.** `Variant` son las presentaciones selladas y
siempre se cuentan en unidades. Los shots no son presentaciones: son recetas
(`Recipe`), igual que los cócteles y los cubetazos. Un shot es una receta de un
solo ingrediente, así que el mismo mecanismo cubre los tres casos.

**Plano del bar.** Las mesas y los elementos (pared, barra, puerta, planta,
tarima) se posicionan en celdas de una cuadrícula. El canvas libre de la fase 2
usa este mismo modelo cambiando la unidad a píxeles, sin migrar datos.

**Interfaz oscura.** El bar opera de noche con poca luz: una pantalla clara
encandila y se lee peor. Los colores son tokens de Tailwind, así que cambiar a
claro es editar `tailwind.config.js`.

## Lo que falta

El siguiente paso son los movimientos de inventario: entradas por compra con
`unitsPerPack`, ventas, apertura de botella (`OpenContainer` en ml), salidas no
vendidas con motivo, y ajustes de conteo. Sobre eso se montan los turnos y los
reportes de diferencia por botella.
