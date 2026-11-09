# Barminister

POS multitenant para bares. El piloto es un bar de barrio en Medellín (15
mesas, 3 sectores); pensado desde el modelo de datos para venderse a varios
bares más adelante, pero sin maquinaria SaaS (registro self-service, planes,
cobros) hasta que haya un segundo cliente real.

Las reglas de dominio -- qué es negociable, qué no, y por qué -- viven en
[`CLAUDE.md`](./CLAUDE.md). Es la fuente de verdad: léelo antes de tocar algo
que no sea obvio desde el código.

## Arrancar

```bash
cp .env.example .env
docker compose up --build
```

- Web: http://localhost:5173
- API: http://localhost:4000
- MySQL: localhost:3307

El contenedor de la API corre `prisma db push` (y el seed si el tenant de
prueba no existe todavía) en cada arranque.

### Usuarios de prueba

| Correo | Clave | Rol |
|---|---|---|
| admin@barminister.co | admin123 | Administrador |
| caja@barminister.co | caja123 | Cajero |
| mesera@barminister.co | mesa123 | Mesero |

PIN de todos: `12345`.

## Estructura

```
api/
  prisma/schema.prisma   modelo de datos
  prisma/seed.js         bar de prueba con mesas y catálogo
  src/routes/             auth, catalog, layout, orders, inventory, shifts,
                          customers, users, tenant, reports, cajasBancos,
                          insumos, compras, platform
  src/middleware/         auth (JWT + aislamiento por tenant), permissions,
                          rateLimit, modules
  src/lib/                unidades, costos, pin, realtime, r2, ticketRaster...
web/
  src/pages/              NuevaVenta, Caja, Distribucion, Productos, Insumos,
                          Recetas, Compras, Proveedores, CajasBancos,
                          Clientes, Usuarios, Reportes, Configuracion,
                          plataforma/...
  src/components/         Shell, FloorPlan, formularios y modales de tirilla
```

## Qué hay construido

- **Venta y plano:** mesas y zonas en cuadrícula, pre-pedido de mesera con
  aprobación en vivo por WebSocket, fusión de mesas, descuentos escondidos.
- **Catálogo:** categorías jerárquicas, productos con presentaciones
  (`Variant`), recetas (`Recipe`/`RecipeItem`) para shots, cócteles y
  sánduches.
- **Inventario:** insumos (materia prima) con conversión de unidad, recetas
  con costeo real y PIN para editarlas, alerta de stock bajo con lista de
  compras (imprimir o enviar por WhatsApp), y un módulo de Compras y
  Proveedores (activable por tenant) que cubre tanto insumos como productos
  de consumo final -- cerveza, gaseosa, pan empacado -- en la misma orden:
  recepción con PIN, pago en efectivo de turno / cuenta financiera / crédito,
  factura adjunta en R2.
- **Caja:** turnos con conteo ciego, Cajas y Bancos (cuentas, traslados,
  activable por tenant), clientes y cuentas por cobrar (fiado).
- **Impresión:** tirilla térmica por USB (Web Serial) con fallback a
  `window.print()`, simulador sin hardware, comprobantes de venta, abono,
  egreso, merma, traslado y movimiento.
- **Plataforma:** panel aparte (`/plataforma`) para crear tenants, activar
  módulos por bar y definir tarifas.

Qué falta y en qué orden: ver "Estado actual" en `CLAUDE.md` (y tenerlo
presente: esa sección se actualiza a mano, puede ir un paso atrás de lo que
ya hay construido).
