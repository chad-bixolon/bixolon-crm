FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma.config.ts ./
COPY scripts/prisma-generate.mjs ./scripts/prisma-generate.mjs

RUN npm ci

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
