FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src

EXPOSE 4000

# db push + seed en cada arranque de desarrollo; en produccion usar prisma migrate deploy
CMD sh -c "npx prisma db push --accept-data-loss && node prisma/seed.js && npm start"
