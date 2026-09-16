FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma.config.ts ./
COPY scripts/prisma-generate.mjs ./scripts/prisma-generate.mjs

RUN npm ci

COPY . .

# The Node images built-in "node" user is UID/GID 1000.
# Make the application and node_modules writable by that user.
RUN chown -R node:node /app

USER node

EXPOSE 3000

CMD ["npm", "run", "dev"]
