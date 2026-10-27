import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { baseDatabaseUrl, databaseUrl } from './constants.mjs';

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Hosted CI provides the same fixed, localhost-only test database as a service.
// Keep Compose as the default for developers and fail closed on an accidental override.
if (process.env.SALESHUB_E2E_EXTERNAL_POSTGRES === 'true') {
  if (process.env.CI !== 'true') throw new Error('External E2E PostgreSQL is only supported in CI.');
  const service = new PrismaClient({ datasources: { db: { url: baseDatabaseUrl } } });
  try {
    const rows = await service.$queryRaw`SELECT current_database() AS name`;
    if (rows[0]?.name !== 'saleshub_e2e') throw new Error('Unexpected E2E PostgreSQL database.');
  } finally { await service.$disconnect(); }
} else {
  run('docker', ['compose', '-f', '../compose.e2e.yml', '-p', 'saleshub-e2e', 'up', '-d', '--wait']);
}
if (databaseUrl !== baseDatabaseUrl) {
  const bootstrap = new PrismaClient({datasources:{db:{url:baseDatabaseUrl}}});
  try {
    const name = new URL(databaseUrl).pathname.slice(1);
    const existing = await bootstrap.$queryRaw`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    if (!existing.length) await bootstrap.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally { await bootstrap.$disconnect(); }
}
const env = { ...process.env, DATABASE_URL: databaseUrl };
run('node', ['scripts/prisma-generate.mjs'], env);
run('./node_modules/.bin/prisma', ['migrate', 'deploy'], env);
run('node', ['e2e/seed.mjs'], env);
