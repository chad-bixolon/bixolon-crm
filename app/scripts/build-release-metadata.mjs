import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
const temp = mkdtempSync(join(tmpdir(), 'saleshub-release-'));
try {
  const schema = readFileSync('prisma/schema.prisma');
  const normalized = join(temp, 'schema.prisma');
  writeFileSync(normalized, schema);
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'format', '--schema', normalized], { stdio: 'pipe' });
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const sha = process.env.RELEASE_GIT_SHA;
  const manifest = { format: 1, commit: sha?.length === 40 && /^[a-f0-9]{40}$/i.test(sha) ? sha : null,
    branch: process.env.RELEASE_BRANCH?.slice(0, 120) || null, builtAt: new Date().toISOString(), version: pkg.version,
    schemaHash: hash(schema), normalizedSchemaHash: hash(readFileSync(normalized)), prismaVersion: pkg.dependencies['@prisma/client'],
    migrations: readdirSync('prisma/migrations', { withFileTypes: true }).filter(d => d.isDirectory()).map(d => ({ name: d.name, checksum: hash(readFileSync(resolve('prisma/migrations', d.name, 'migration.sql'))) })) };
  writeFileSync('release-metadata.json', JSON.stringify(manifest, null, 2) + '\n');
} finally { rmSync(temp, { recursive: true, force: true }); }
