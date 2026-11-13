# LicorPlus / Barministrer — Guía de despliegue

Este documento es contexto para Claude Code (u otra sesión) que vaya a
desplegar cambios de este proyecto a producción. Resume el procedimiento
acordado y los errores reales que ya nos han pasado, para no repetirlos.

Datos de referencia:

- Instancia EC2: `i-04e6a01f15bf1b2f7`, región `us-east-1`, tipo `t4g.small`
  (Graviton/ARM — todos los builds van con `--platform linux/arm64`)
- Carpeta en el servidor: `/opt/barministrer`
- Repos en ECR: `barministrer-app` (backend), `barministrer-web` (frontend)
- Dominio: `https://app.barministrer.com`
- Acceso al servidor: solo por SSM (`aws ssm start-session --target
  i-04e6a01f15bf1b2f7 --region us-east-1`), nunca SSH directo
- Carpeta local del repo (Mac): `~/Documents/CLIENTES/licorplus`
- Repo backend: Prisma + MySQL (`api/prisma/schema.prisma`)
- Repo frontend: React/Vite servido con nginx (`web/Dockerfile.prod`,
  `web/nginx.conf`)
- Rama de trabajo: `main` (confirmado 2026-11-13 — una nota anterior de
  este documento decía `tenant`, pero esa rama está vieja y suelta, sin
  nada del trabajo reciente; `main` es la que de verdad está sincronizada
  con `origin` y lista para desplegar)

## 0. Antes de cualquier deploy: confirma qué cambió realmente

**No despliegues basado solo en la descripción de lo que "se cambió".**
Varias veces el cambio descrito no coincidía con lo que de verdad había en
el repo (código editado solo dentro de un contenedor corriendo, o en otro
checkout, nunca llegó a git). Antes de tocar nada:

```
cd ~/Documents/CLIENTES/licorplus
git status
git log --oneline -3
git diff HEAD~1 -- api/prisma/schema.prisma   # si se mencionó cambio de schema
```

Si lo que describen no aparece en `git status`/`git log`, **para ahí** y
ubica dónde está realmente el cambio antes de construir nada — desplegar
sin esto reconstruye lo mismo que ya está en producción.

Si el cambio sí toca `schema.prisma`, evalúa el riesgo antes de seguir:
- Aditivo (tabla nueva, columna nullable o con default, enum con valores
  agregados al final): riesgo bajo, se puede seguir.
- Modifica tipo, renombra o elimina algo existente: alto riesgo de pérdida
  de datos con `prisma db push` (el Dockerfile de `api` corre `db push` en
  cada arranque del contenedor, no hay migraciones versionadas con
  `migrate deploy`). Revisar el diff línea por línea antes de continuar.

## 1. Backup antes de desplegar (siempre)

Entra al servidor:

```
aws ssm start-session --target i-04e6a01f15bf1b2f7 --region us-east-1
sudo -i
cd /opt/barministrer
pwd
```

**Confirma que `pwd` devuelve `/opt/barministrer`** antes de seguir — si
quedaste en `/root` (pasa fácil tras el `sudo -i`), el `source .env.prod`
del siguiente paso falla silenciosamente y el backup sale corrupto o vacío
sin aviso claro.

```
set -a
source .env.prod
set +a

mkdir -p /opt/backups
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

docker exec licorplus_db mysqldump \
  -u root -p"${MYSQL_ROOT_PASSWORD}" \
  --single-transaction --set-gtid-purged=OFF \
  "${MYSQL_DATABASE}" > "/opt/backups/licorplus_${TIMESTAMP}.sql"

ls -lh /opt/backups/
```

Confirma que el archivo nuevo tiene un tamaño razonable (no 0 bytes) antes
de seguir. Si sale en 0 bytes, revisa que `.env.prod` tenga de verdad
`MYSQL_ROOT_PASSWORD` y `MYSQL_DATABASE` con valores.

## 2. Build y push de la imagen que cambió (en tu Mac)

Solo construye y sube la imagen del servicio que realmente cambió — y
verifica primero con el paso 0 cuál cambió de verdad, no cuál dijiste que
cambiaste.

**El token de login a ECR expira cada ~12 horas.** Si el `docker push` da
`403 Forbidden` o "unexpected status from HEAD request", vuelve a loguear:

```
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 211125394239.dkr.ecr.us-east-1.amazonaws.com
```

### Si cambió el backend (`api/`)

```
cd ~/Documents/CLIENTES/licorplus

docker build --platform linux/arm64 -t 211125394239.dkr.ecr.us-east-1.amazonaws.com/barministrer-app:latest ./api
docker push 211125394239.dkr.ecr.us-east-1.amazonaws.com/barministrer-app:latest
```

Anota el `digest` del `docker push` (línea `latest: digest: sha256:...`).

### Si cambió el frontend (`web/`)

```
cd ~/Documents/CLIENTES/licorplus

docker build --platform linux/arm64 -t 211125394239.dkr.ecr.us-east-1.amazonaws.com/barministrer-web:latest ./web -f ./web/Dockerfile.prod --build-arg VITE_API_URL=https://app.barministrer.com
docker push 211125394239.dkr.ecr.us-east-1.amazonaws.com/barministrer-web:latest
```

Mismo punto: anota el digest final.

Si cambiaron **ambos**, corre los dos bloques.

## 3. Entrar al servidor

Si ya cerraste la sesión del paso 1:

```
aws ssm start-session --target i-04e6a01f15bf1b2f7 --region us-east-1
sudo -i
cd /opt/barministrer
pwd
```

**Vuelve a confirmar `pwd` = `/opt/barministrer`, y sobre todo confirma
que el prompt es `root@ip-172-31-72-69`, no `apple@...` o el nombre de tu
Mac.** Este es el error más repetido de todos: correr los comandos del
servidor en la terminal de la Mac. El entorno local de desarrollo en la
Mac usa los **mismos nombres de contenedor** (`licorplus_api`,
`licorplus_db`, `licorplus_web`) que producción, así que un `docker
compose ps` corrido por error en la Mac puede devolver un resultado que
parece válido pero es tu stack local, no el servidor real. Verifica
siempre el prompt antes de confiar en cualquier output.

Login a ECR desde el servidor (usa el IAM role de la instancia, no pide
credenciales):

```
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 211125394239.dkr.ecr.us-east-1.amazonaws.com
```

## 4. Pull y verificación del digest

Pull **solo** del servicio que actualizaste:

```
# Si actualizaste el backend:
docker compose --env-file .env.prod -f docker-compose.prod.yml pull api

# Si actualizaste el frontend:
docker compose --env-file .env.prod -f docker-compose.prod.yml pull web
```

Verifica que el digest que bajó coincide con el que anotaste en el paso 2
**antes de reiniciar nada**:

```
# backend
docker image inspect 211125394239.dkr.ecr.us-east-1.amazonaws.com/barministrer-app:latest --format='{{index .RepoDigests 0}}'

# frontend
docker image inspect 211125394239.dkr.ecr.us-east-1.amazonaws.com/barministrer-web:latest --format='{{index .RepoDigests 0}}'
```

Si no coincide, no sigas — algo falló en el pull (o lo corriste en la Mac
por error, ver paso 3).

## 5. Recrear solo el contenedor que cambió

`--no-deps` hace que Docker Compose recree únicamente el servicio
indicado, sin reiniciar `db` ni el otro servicio:

```
# Si actualizaste el backend:
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --no-deps api

# Si actualizaste el frontend:
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --no-deps web
```

## 6. Verificar

```
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
```

Confirma en `CREATED`/`STATUS` que **solo** el servicio que tocaste
aparece recién creado — `db` (y el otro servicio si no lo tocaste) deben
seguir con su tiempo de actividad de antes. **Confirma también que los
puertos salen como `127.0.0.1:xxxx->xxxx/tcp`** — si ves `0.0.0.0:xxxx`,
estás viendo el stack local de la Mac, no el servidor (ver paso 3).

Si actualizaste el backend, revisa los logs para confirmar que levantó
bien y que el `db push` no reportó ningún cambio destructivo:

```
docker logs licorplus_api --tail 50
```

Busca que solo mencione sync/columnas-tablas agregadas ("Your database is
now in sync", "Added the column/table"). Si aparece cualquier mención de
"drop" o pérdida de datos, detente — no sigas verificando en el navegador,
revisa primero qué pasó.

Prueba el dominio real:

```
curl -s -H "Host: app.barministrer.com" http://127.0.0.1/api/
curl -s -H "Host: app.barministrer.com" http://127.0.0.1/ | head -5
```

Y por último, entra a `https://app.barministrer.com` desde el navegador
con **hard refresh** (Cmd+Shift+R en Mac, Ctrl+Shift+R en Windows — el
frontend sirve assets con cache agresivo y más de una vez un cambio
"no se vio" por esto, no por el deploy), confirma que el cambio
funciona, y que los datos que ya había (mesas, pedidos, usuarios) siguen
intactos.

## Si el cambio SÍ incluye un cambio de schema (`schema.prisma`)

El Dockerfile de `api` corre `prisma db push --accept-data-loss` contra
los datos reales de producción apenas el contenedor arranque — sin
preguntar. Antes de desplegar un cambio de schema:

1. Revisa el diff exacto de `schema.prisma` (ver paso 0) y confirma qué
   cambia a nivel de columnas/tablas.
2. Si el cambio es aditivo (tabla nueva, columna nullable o con default,
   relación opcional), el riesgo es bajo.
3. Si modifica o elimina algo existente (renombrar columna, cambiar tipo,
   quitar un campo), el backup del paso 1 es tu única red de seguridad —
   tenlo fresco y confirma que es restaurable antes de desplegar.
4. El pendiente de fondo sigue siendo migrar de `db push` a `prisma
   migrate deploy` antes de que haya más que un piloto operando con datos
   que de verdad importen.

## Backup diario (automático) + backup manual desde /plataforma

Además del backup antes de cada deploy (paso 1), hay dos formas más de
generar un backup, independientes de cualquier deploy:

1. **Automático**: corre solo, todos los días (ver abajo).
2. **Manual**: botón "Hacer backup ahora" en `/plataforma/backups` (solo
   plataforma, no lo ve ningún tenant) — llama a `POST /api/platform/backups`
   (`api/src/lib/backups.js`), que corre `mysqldump` **dentro del propio
   contenedor `api`** (conectándose a `db` por red, con el mismo usuario de
   `DATABASE_URL`, no con root) y sube el resultado al mismo bucket/prefijo
   que el automático — por eso ambos salen juntos en una sola lista,
   distinguidos por un badge "Manual"/"Automático" según el nombre del
   archivo (`licorplus_manual_...sql` vs `licorplus_...sql`).
   - La imagen de `api` necesita `mysql-client` **y** `mariadb-connector-c`
     (`api/Dockerfile`) — sin el segundo, `mysqldump` truena con *"Plugin
     caching_sha2_password could not be loaded"* al conectarse a MySQL 8
     (el paquete `mysql-client` de Alpine no trae los plugins de
     autenticación por separado).
   - **Importante para el deploy**: el contenedor `api` necesita
     `R2_BACKUPS_BUCKET` / `R2_BACKUPS_ACCESS_KEY_ID` /
     `R2_BACKUPS_SECRET_ACCESS_KEY` en su `environment:` (ver
     `docker-compose.prod.yml` del repo). El `docker-compose.prod.yml` que
     ya está en `/opt/barministrer` del servidor es una copia vieja que
     **no** las tiene — un deploy normal (pasos 1-6, con `--no-deps`) nunca
     sincroniza ese archivo, solo las imágenes. La primera vez que
     despliegues este feature, copia el `docker-compose.prod.yml`
     actualizado del repo al servidor (reemplaza el de `/opt/barministrer`)
     antes del paso 4, o el botón va a fallar con "R2_BACKUPS_BUCKET is not
     defined" o similar.

Backup automático:

- **Qué hace**: `mysqldump` de la base + sube el `.sql` a un bucket R2
  **privado** llamado `backups` (prefijo `db/`), separado del `R2_BUCKET`
  público que sirve fotos/logos — nunca se mezclan, porque ese bucket es
  público y un dump con hashes de contraseña/PIN y datos de clientes no
  puede quedar expuesto por URL.
- **Dónde vive**: `/opt/barministrer/backup-diario.sh` en el servidor +
  `barminister-backup.service`/`.timer` en `/etc/systemd/system/` (corre
  via `systemd`, no `cron` — esta imagen de Amazon Linux 2023 no trae
  `cron` instalado).
- **Cuándo corre**: todos los días a las 07:00 UTC = 2am hora de Colombia
  (`Persistent=true`: si el servidor estuvo apagado a esa hora, corre el
  backup pendiente apenas vuelve a prender).
- **Retención**: 7 días en el disco del servidor (`/opt/backups`, solo
  para recuperación rápida) + 90 días en R2 vía una Object Lifecycle Rule
  del propio bucket (prefijo `db/`, borrar después de 90 días) — **esa
  regla se configura a mano en el dashboard de Cloudflare** (R2 → bucket
  `backups` → Settings → Object Lifecycle Rules), el token con permiso
  "Object Read & Write" no puede leerla/crearla por API (`AccessDenied`
  al intentar `Put/GetBucketLifecycleConfiguration`).
- **Credenciales**: `R2_BACKUPS_BUCKET` / `R2_BACKUPS_ACCESS_KEY_ID` /
  `R2_BACKUPS_SECRET_ACCESS_KEY` en `.env.prod` del servidor (nunca en
  git) — un API token de Cloudflare scoped **solo** al bucket `backups`,
  distinto del que usa `R2_ACCESS_KEY_ID` para las fotos/logos.

**No lo toca un deploy normal** (pasos 1-6 de arriba): esos solo
reconstruyen los contenedores `api`/`web` vía `docker compose`, nunca
tocan archivos sueltos de `/opt/barministrer` ni nada de `systemd`.

**Si el servidor se reconstruye desde cero**, la fuente real para volver a
instalarlo es `ops/backup/` en este repo (`backup-diario.sh`,
`barminister-backup.service`, `barminister-backup.timer`) — cópialos a
`/opt/barministrer/backup-diario.sh` y `/etc/systemd/system/`
respectivamente, agrega las 3 variables `R2_BACKUPS_*` a `.env.prod`
(crea un API token nuevo en Cloudflare si hay que regenerar las
credenciales), y corre:

```
chmod 750 /opt/barministrer/backup-diario.sh
systemctl daemon-reload
systemctl enable --now barminister-backup.timer
```

Y no olvides recrear la Object Lifecycle Rule en el dashboard (prefijo
`db/`, 90 días) — eso vive solo en Cloudflare, no hay forma de
versionarlo en este repo.

## Otras cosas aprendidas en el camino

- **Variables de entorno nuevas**: si el cambio agrega una integración que
  necesita credenciales nuevas (ej. subida de imágenes a Cloudflare R2:
  `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
  `R2_PUBLIC_URL`), confirma que `.env.prod` en el servidor las tiene
  **antes** de desplegar — funcionar en local no implica que el servidor
  las tenga. Verificar sin exponer valores: `grep -c "^R2_" .env.prod`.
- **Content-Security-Policy** (`web/nginx.conf`): si el frontend agrega
  algo que genera vistas previas de imagen con `URL.createObjectURL()`
  (`blob:` URLs), el header CSP necesita `blob:` en `img-src`, si no el
  navegador las bloquea silenciosamente (se ve en la consola, no como
  error de red).
- **Impresión térmica / cajón registradora**: implementado con Web Serial
  API (`navigator.serial`) en `web/src/lib/printer.js` +
  `web/src/lib/escpos.js` — sin diálogo de impresión, con fallback a
  `window.print()` si el navegador no soporta Web Serial (solo
  Chrome/Edge de escritorio) o no hay impresora emparejada.
