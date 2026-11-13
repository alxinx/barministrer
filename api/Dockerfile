FROM node:20-alpine

WORKDIR /app

# mysql-client: trae mysqldump (lib/backups.js, backup manual desde
# /plataforma). mariadb-connector-c aparte: mysql-client por si solo no
# trae los plugins de autenticacion (ej. caching_sha2_password, el que usa
# MySQL 8 por defecto) -- sin esto mysqldump truena con "Plugin
# caching_sha2_password could not be loaded" al conectarse a la base.
RUN apk add --no-cache openssl mysql-client mariadb-connector-c

COPY package.json ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src

EXPOSE 4000

# db push + seed en cada arranque de desarrollo; en produccion usar prisma migrate deploy
CMD sh -c "npx prisma db push --accept-data-loss && node prisma/seed.js && npm start"
