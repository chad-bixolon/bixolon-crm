import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma, type PrismaClient } from '@prisma/client';
import { assertAdmin } from './admin-maintenance';
import type { Actor } from './authorization';

export type Manifest = { format: number; commit: string | null; branch: string | null; builtAt: string; version: string; schemaHash: string; normalizedSchemaHash: string; prismaVersion: string; migrations: { name: string; checksum: string }[] };
export type Migration = { migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null };
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const validSha = (value: unknown): value is string => typeof value === 'string' && value.length === 40 && /^[a-f0-9]{40}$/i.test(value);
const branchName = (value: unknown) => typeof value === 'string' && value === value.trim() && /^[a-z0-9][a-z0-9._/-]{0,119}$/i.test(value) ? value : null;
export function migrationStatus(expected: Manifest['migrations'] | null, rows: Migration[] | null) {
  const applied = rows?.filter(r => r.finished_at && !r.rolled_back_at) ?? [];
  const failed = rows?.filter(r => !r.finished_at && !r.rolled_back_at).length ?? null;
  const status = failed ? 'Migration failed' : !expected?.length || !rows ? 'Unable to verify'
    : applied.some(r => !expected.some(e => e.name === r.migration_name && e.checksum === r.checksum)) ? 'Unable to verify'
    : expected.some(e => !applied.some(r => r.migration_name === e.name)) ? 'Migration pending' : 'Up to date';
  return { status, expected: expected?.length ?? null, applied: rows ? applied.length : null, failed };
}
export function runtimeStatus(manifest: Manifest | null, source: string | null, generated: string | null, embedded: string | null, installed: string | null, running: string | null) {
  if (!manifest || !source || !generated || !embedded || !installed || !running) return 'Unable to verify';
  return hash(source) === manifest.schemaHash && hash(generated) === manifest.normalizedSchemaHash && generated === embedded && installed === manifest.prismaVersion && installed === running ? 'Verified' : 'Attention needed';
}
export function overallStatus(identity: boolean, migration: string, runtime: string) {
  if (['Migration pending', 'Migration failed'].includes(migration) || runtime === 'Attention needed') return 'Attention needed';
  if (identity && migration === 'Up to date' && runtime === 'Verified') return 'Verified';
  return identity || migration === 'Up to date' || runtime === 'Verified' ? 'Partially verified' : 'Unable to verify';
}
export function readManifest(): Manifest | null {
  try {
    const m = JSON.parse(readFileSync(resolve(process.cwd(), 'release-metadata.json'), 'utf8'));
    if (m.format !== 1 || !Array.isArray(m.migrations) || !m.migrations.every((r: { name: unknown; checksum: string }) => typeof r.name === 'string' && /^[a-f0-9]{64}$/.test(r.checksum)) || !m.schemaHash || !m.normalizedSchemaHash) return null;
    return m;
  } catch { return null; }
}
export async function releaseStatus(db: PrismaClient, actor: Actor) {
  assertAdmin(actor);
  const manifest = readManifest();
  let rows: Migration[] | null = null, runtime = 'Unable to verify';
  try { rows = await db.$queryRaw<Migration[]>`SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations`; } catch { /* No database internals leave this boundary. */ }
  try {
    const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
    // Same embedded-schema check as release:check; no generation or connection request.
    const embedded = (db as unknown as { _engineConfig?: { inlineSchema?: string } })._engineConfig?.inlineSchema ?? null;
    runtime = runtimeStatus(manifest, read('prisma/schema.prisma'), read('node_modules/.prisma/client/schema.prisma'), embedded, JSON.parse(read('node_modules/@prisma/client/package.json')).version, Prisma.prismaVersion.client);
  } catch { /* Fail closed if Prisma changes its internal runtime representation. */ }
  const migrations = migrationStatus(manifest?.migrations ?? null, rows);
  // Hosting providers can supply deployed identity at runtime for Docker builds.
  // Only validated identity leaves this boundary; build evidence stays immutable.
  const runtimeSha = process.env.RELEASE_GIT_SHA;
  const commit = validSha(runtimeSha) ? runtimeSha : validSha(manifest?.commit) ? manifest.commit : null;
  const branch = branchName(process.env.RELEASE_BRANCH) ?? branchName(manifest?.branch);
  return { commit, branch, builtAt: manifest?.builtAt ?? null, version: manifest?.version ?? null, migrations, runtime, overall: overallStatus(Boolean(commit), migrations.status, runtime), checkedAt: new Date() };
}

export async function gmailStatus(configured: boolean, readConnection: () => Promise<{ connected: boolean }>) {
  if (!configured) return 'Not configured';
  try { return (await readConnection()).connected ? 'Configured · connection recorded' : 'Configured · not connected'; }
  catch { return 'Configured · unable to verify connection'; }
}

export function jobSummary(row: { status: string; resultSummary?: string | null } | null, calendar = false) {
  if (!row) return 'Unable to verify';
  if (row.status === 'FAILED') return 'Last run had failures';
  if (row.status !== 'SUCCEEDED') return 'Run in progress or interrupted';
  if (!calendar) return 'Last run successful';
  // processedCount counts events, not connections. Only parse the writer's fixed grammar.
  const match = /^(\d+) of (\d+) connections succeeded\.$/.exec(row.resultSummary ?? '');
  if (!match || Number(match[1]) > Number(match[2])) return 'Last run completed — connection count unavailable';
  if (match[1] !== match[2]) return 'Last run had failures';
  return Number(match[2]) ? `Last run successful — ${Number(match[2])} connections processed` : 'Last run completed — no active connections';
}
