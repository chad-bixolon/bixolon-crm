import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { schemaFingerprint } from '../lib/prisma-schema-fingerprint.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const schema = readFileSync('prisma/schema.prisma');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const sha = process.env.RELEASE_GIT_SHA;
const manifest = { format: 2, commit: sha?.length === 40 && /^[a-f0-9]{40}$/i.test(sha) ? sha : null,
  branch: process.env.RELEASE_BRANCH?.slice(0, 120) || null, builtAt: new Date().toISOString(), version: pkg.version,
  schemaHash: hash(schema), normalizedSchemaHash: schemaFingerprint(schema), prismaVersion: pkg.dependencies['@prisma/client'],
  migrations: readdirSync('prisma/migrations', { withFileTypes: true }).filter(d => d.isDirectory()).sort((a, b) => a.name.localeCompare(b.name, 'en')).map(d => ({ name: d.name, checksum: hash(readFileSync(resolve('prisma/migrations', d.name, 'migration.sql'))) })) };
writeFileSync('release-metadata.json', JSON.stringify(manifest, null, 2) + '\n');
