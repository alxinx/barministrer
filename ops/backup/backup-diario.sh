#!/bin/bash
# Backup diario de la base de datos de produccion (Barminister/LicorPlus),
# subido a un bucket R2 privado (sin acceso publico), separado del bucket
# R2_BUCKET que sirve fotos/logos. Corre via systemd timer a las 2am hora
# de Colombia (07:00 UTC, el servidor esta en UTC -- ver
# barminister-backup.timer en esta misma carpeta).
#
# Copia versionada de lo que vive en /opt/barministrer/backup-diario.sh en
# el servidor (ver ../../despliegue.md, seccion "Backup diario") -- si el
# servidor se reconstruye desde cero, este archivo es la fuente real para
# volver a instalarlo. No la toca ningun despliegue normal de api/web.
set -euo pipefail

cd /opt/barministrer
set -a
source .env.prod
set +a

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
ARCHIVO="/opt/backups/licorplus_${TIMESTAMP}.sql"

docker exec licorplus_db mysqldump \
  -u root -p"${MYSQL_ROOT_PASSWORD}" \
  --single-transaction --set-gtid-purged=OFF \
  "${MYSQL_DATABASE}" > "${ARCHIVO}"

AWS_ACCESS_KEY_ID="${R2_BACKUPS_ACCESS_KEY_ID}" \
AWS_SECRET_ACCESS_KEY="${R2_BACKUPS_SECRET_ACCESS_KEY}" \
aws s3 cp "${ARCHIVO}" "s3://${R2_BACKUPS_BUCKET}/db/$(basename "${ARCHIVO}")" \
  --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  --region auto

# Retencion local: solo 7 dias en el disco del servidor (poco espacio, es
# solo para recuperacion rapida). El historico de 90 dias vive en R2 via
# su propia Lifecycle Rule sobre el prefijo db/, no se borra desde aqui
# para no arriesgar borrar de mas por un bug en este script.
find /opt/backups -maxdepth 1 -name 'licorplus_*.sql' -mtime +7 -delete

echo "Backup OK: ${ARCHIVO} -> s3://${R2_BACKUPS_BUCKET}/db/$(basename "${ARCHIVO}")"
