import { spawnSync } from 'node:child_process';
import { databaseUrl } from './constants.mjs';

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('docker', ['compose', '-f', '../compose.e2e.yml', '-p', 'saleshub-e2e', 'up', '-d', '--wait']);
const env = { ...process.env, DATABASE_URL: databaseUrl };
run('node', ['scripts/prisma-generate.mjs'], env);
run('./node_modules/.bin/prisma', ['migrate', 'deploy'], env);
run('node', ['e2e/seed.mjs'], env);
