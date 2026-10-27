import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { verifyClient } from './release-check.mjs';

const require = createRequire(import.meta.url);
const directory = mkdtempSync(resolve(tmpdir(), 'saleshub-ci-prisma-'));
try {
  const schema = resolve(directory, 'schema.prisma');
  cpSync('prisma/schema.prisma', schema);
  const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'format', '--schema', schema], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: 'postgresql://generation:generation@127.0.0.1:1/generation' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  else console.log(verifyClient(schema).detail);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
