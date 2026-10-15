# LicorPlus — Actualizar backend o frontend sin tocar la base de datos

Este documento cubre el caso normal: cambios de código en `api/` (backend) o
`web/` (frontend) **sin cambios en `api/prisma/schema.prisma`**. Si el cambio
sí incluye un cambio de schema, no uses este procedimiento tal cual — ver la
nota al final.

Datos de referencia:

- Instancia EC2: `i-04e6a01f15bf1b2f7`, región `us-east-1`
- Carpeta en el servidor: `/opt/barministrer`
- Repos en ECR: `barministrer-app` (backend), `barministrer-web` (frontend)
- Dominio: `https://app.barministrer.com`

## 0. Backup antes de desplegar (siempre)

Aunque este procedimiento no debería tocar los datos, un backup previo es
innegociable — es la red de seguridad si algo no sale como se espera.

Entra al servidor:

```
aws ssm start-session --target i-04e6a01f15bf1b2f7 --region us-east-1
sudo -i
cd /opt/barministrer
```

Y corre el backup:

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

Confirma que el archivo nuevo tiene un tamaño razonable (no 0 bytes) antes de
seguir.

## 1. Build y push de la imagen que cambió (en tu Mac)

Solo construye y sube la imagen del servicio que realmente cambió. No hace
falta tocar la otra.

### Si cambió el backend (`api/`)

```
cd ~/Documents/CLIENTES/licorplus

aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 211125394239.dkr.ecr.us-east-1.amazonaws.com

docker build --platform linux/arm64 -t 211125394239.dkr.ecr.us-east-1.amazonaws.com/barministrer-app:latest ./api
docker push 211125394239.dkr.ecr.us-east-1.amazonaws.com/barministrer-app:latest
```

Anota el `digest` que imprime el `docker push` al final (línea
`latest: digest: sha256:...`) — lo vas a necesitar para verificar en el paso 3.

### Si cambió el frontend (`web/`)

```
cd ~/Documents/CLIENTES/licorplus

docker build --platform linux/arm64 -t 211125394239.dkr.ecr.us-east-1.amazonaws.com/barministrer-web:latest ./web -f ./web/Dockerfile.prod --build-arg VITE_API_URL=https://app.barministrer.com
docker push 211125394239.dkr.ecr.us-east-1.amazonaws.com/barministrer-web:latest
```

Mismo punto: anota el digest final.

Si cambiaron **ambos**, corre los dos bloques.

## 2. Entrar al servidor

Si ya cerraste la sesión del paso 0:

```
aws ssm start-session --target i-04e6a01f15bf1b2f7 --region us-east-1
sudo -i
cd /opt/barministrer
```

Login a ECR desde el servidor (usa el IAM role de la instancia, no pide
credenciales):

```
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 211125394239.dkr.ecr.us-east-1.amazonaws.com
```

## 3. Pull y verificación del digest

Pull **solo** del servicio que actualizaste:

```
# Si actualizaste el backend:
docker compose --env-file .env.prod -f docker-compose.prod.yml pull api

# Si actualizaste el frontend:
docker compose --env-file .env.prod -f docker-compose.prod.yml pull web
```

Verifica que el digest que bajó coincide con el que anotaste en el paso 1
**antes de reiniciar nada**:

```
# backend
docker image inspect 211125394239.dkr.ecr.us-east-1.amazonaws.com/barministrer-app:latest --format='{{index .RepoDigests 0}}'

# frontend
docker image inspect 211125394239.dkr.ecr.us-east-1.amazonaws.com/barministrer-web:latest --format='{{index .RepoDigests 0}}'
```

Si no coincide, no sigas — algo falló en el pull.

## 4. Recrear solo el contenedor que cambió

Esto es lo que evita tocar la base de datos: `--no-deps` hace que Docker
Compose recree únicamente el servicio indicado, sin reiniciar `db` (ni `web`
si solo tocaste `api`, o viceversa).

```
# Si actualizaste el backend:
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --no-deps api

# Si actualizaste el frontend:
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --no-deps web
```

## 5. Verificar

```
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
```

Confirma en el `CREATED`/`STATUS` que **solo** el servicio que tocaste
aparece recién creado — `db` (y el otro servicio si no lo tocaste) deben
seguir con el tiempo de actividad de antes, sin reinicio.

Si actualizaste el backend, revisa los logs para confirmar que levantó bien
y que el `db push` no reportó ningún cambio destructivo:

```
docker logs licorplus_api --tail 40
```

Prueba el dominio real:

```
curl -s -H "Host: app.barministrer.com" http://127.0.0.1/api/
curl -s -H "Host: app.barministrer.com" http://127.0.0.1/ | head -5
```

Y por último, entra a `https://app.barministrer.com` desde el navegador,
confirma que el cambio se ve/funciona, y que los datos que ya había
(mesas, pedidos, usuarios) siguen intactos.

## Si el cambio SÍ incluye un cambio de schema (`schema.prisma`)

Este documento asume que no tocaste el schema. Si lo hiciste, el paso 4 va a
disparar automáticamente `prisma db push --accept-data-loss` contra los
datos reales de producción apenas el contenedor de `api` arranque — sin
preguntar. Antes de seguir con este procedimiento en ese caso:

1. Revisa el diff exacto de `schema.prisma` y confirma qué cambia a nivel de
   columnas/tablas.
2. Si el cambio es aditivo (agregar una tabla o columna nueva, nullable o con
   default), el riesgo es bajo.
3. Si el cambio modifica o elimina algo existente (renombrar columna, cambiar
   tipo, quitar un campo), el backup del paso 0 es tu única red de
   seguridad — tenlo fresco y confirma que es restaurable antes de
   desplegar.
4. El pendiente de fondo sigue siendo migrar de `db push` a
   `prisma migrate deploy` antes de que haya más que un piloto operando con
   datos que de verdad importen — ese cambio evita este riesgo de raíz en
   vez de mitigarlo con backups cada vez.
