FROM node:20-alpine AS development

WORKDIR /app

COPY package*.json ./

COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma.config.ts ./
COPY scripts/prisma-generate.mjs ./scripts/prisma-generate.mjs

RUN npm ci

COPY . .

RUN chown -R node:node /app

USER node

EXPOSE 3000

CMD ["npm", "run", "dev"]

# Build and runtime dependencies use the same OS and OpenSSL libraries, so
# Prisma's native engine matches the runtime environment.
FROM node:22-bookworm-slim AS production-base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

FROM production-base AS production-dependencies
WORKDIR /app
COPY package*.json ./
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma.config.ts ./
COPY scripts/prisma-generate.mjs ./scripts/prisma-generate.mjs
RUN npm ci --omit=dev

FROM production-base AS production-build
WORKDIR /app
COPY package*.json ./
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma.config.ts ./
COPY scripts/prisma-generate.mjs ./scripts/prisma-generate.mjs
RUN npm ci
COPY . .
RUN npm run build && rm -rf .next/cache

FROM production-base AS production
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-build --chown=node:node /app/.next ./.next
COPY --from=production-build --chown=node:node /app/public ./public
COPY --from=production-build --chown=node:node /app/package.json ./package.json
COPY --from=production-build --chown=node:node /app/prisma ./prisma
COPY --from=production-build --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --from=production-build --chown=node:node /app/scripts/seed-sales-stages.mjs ./scripts/seed-sales-stages.mjs
COPY --from=production-build --chown=node:node /app/scripts/seed-activity-types.mjs ./scripts/seed-activity-types.mjs
COPY --from=production-build --chown=node:node /app/scripts/operations/audit-production-cleanup.mjs ./scripts/operations/audit-production-cleanup.mjs
USER node
EXPOSE 3000
CMD ["npm", "start"]
