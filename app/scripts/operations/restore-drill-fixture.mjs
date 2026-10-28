// Invoked only inside the disposable --network=none drill container.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { PrismaClient } from '@prisma/client';
import { backup } from './backup-postgres.mjs';
import { restore, validateRestored } from './restore-postgres.mjs';
import { connection, pgEnvironment, recoveryLogger, runPg } from './recovery-common.mjs';

try {
  if (process.env.SALESHUB_DISPOSABLE_DRILL !== 'fixture-only') throw Error('Disposable drill guard required');
  const sourceUrl = 'postgresql://postgres:drill_only@localhost:55439/saleshub_fixture?sslmode=disable';
  const targetUrl = 'postgresql://postgres:drill_only@localhost:55439/saleshub_restore_drill?sslmode=disable';
  const admin = connection(sourceUrl.replace('/saleshub_fixture?', '/postgres?'));
  const sql = (text, c = admin) => runPg('psql', ['-X', '-w', '-v', 'ON_ERROR_STOP=1', '-At', '-c', text], { c, capture: true });
  await sql('CREATE DATABASE saleshub_fixture');
  await sql('CREATE DATABASE saleshub_restore_drill');
  const prisma = (command, url) => execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', command], {
    cwd: '/app', env: { PATH: process.env.PATH, DATABASE_URL: url, CHECKPOINT_DISABLE: '1' }, stdio: 'pipe', timeout: 180_000,
  }).toString();
  prisma('deploy', sourceUrl);
  const source = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
  try {
    const user = await source.user.create({ data: { email: 'restore-drill@example.test', firstName: 'Restore', lastName: 'Fixture' } });
    const account = await source.account.create({ data: { name: 'Restore fixture account', ownerId: user.id } });
    const stage = await source.salesStage.create({ data: { name: 'Restore fixture stage', sortOrder: 999 } });
    await source.opportunity.create({ data: { name: 'Restore fixture opportunity', stageId: stage.id, ownerId: user.id, legacyAccountId: account.id } });
    await source.project.create({ data: { name: 'Restore fixture project', primaryAccountRole: 'END_CUSTOMER', primaryAccountId: account.id, createdById: user.id } });
    await source.priceException.create({ data: { status: 'ACTIVE', sourceType: 'EXTERNAL_EXPORT', sourceKey: 'restore-drill', createdById: user.id } });
    await source.supportCase.create({ data: { caseNumber: 'DRILL-1', accountId: account.id, subject: 'Fixture', description: 'Synthetic drill only', source: 'PHONE', createdById: user.id, updatedById: user.id } });
  } finally { await source.$disconnect(); }
  await sql("CREATE ROLE saleshub_backup LOGIN PASSWORD 'drill_reader_only'");
  await sql('GRANT CONNECT ON DATABASE saleshub_fixture TO saleshub_backup');
  await sql('GRANT USAGE ON SCHEMA public TO saleshub_backup', connection(sourceUrl));
  await sql('GRANT SELECT ON ALL TABLES IN SCHEMA public TO saleshub_backup', connection(sourceUrl));
  await sql('GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO saleshub_backup', connection(sourceUrl));

  const objects = new Map();
  const store = {
    async put(key, file, size, metadata) { objects.set(key, { body: await readFile(file), size, metadata }); },
    async head(key) { const object = objects.get(key); return { size: object.size, metadata: object.metadata }; },
    async get(key) { return Readable.from([objects.get(key).body]); },
  };
  const env = {
    BACKUP_DATABASE_URL: 'postgresql://saleshub_backup:drill_reader_only@localhost:55439/saleshub_fixture?sslmode=verify-full&sslrootcert=/tmp/drill-cert.pem',
    BACKUP_DATABASE_NAME: 'saleshub_fixture', BACKUP_ENVIRONMENT: 'drill', BACKUP_DOCUMENTS_BUCKET: 'fixture-documents',
    BACKUP_SPACES_REGION: 'atl1', BACKUP_SPACES_ENDPOINT: 'https://atl1.digitaloceanspaces.com', BACKUP_SPACES_BUCKET: 'fixture-backups',
    BACKUP_SPACES_ACCESS_KEY_ID: 'unused-fixture', BACKUP_SPACES_SECRET_ACCESS_KEY: 'unused-fixture', BACKUP_MAX_DUMP_BYTES: '67108864',
    RESTORE_PRODUCTION_DATABASE_URL: 'postgresql://identity@production.example.invalid/saleshub',
    RESTORE_TARGET_DATABASE_URL: targetUrl, RESTORE_CONFIRM: 'restore-disposable-database',
  };
  // Preserve expected refusal events in the host's captured stdout evidence too.
  const log = recoveryLogger(line => console.log(line));
  // Verify fixture backup identity cannot mutate the source, independently of pg_dump's read-only session setting.
  for (const statement of [
    'CREATE TABLE public.restore_drill_forbidden (id int)',
    'ALTER TABLE public."Account" ADD COLUMN restore_drill_forbidden text',
    `INSERT INTO public."Account" (name,"updatedAt") VALUES ('Forbidden',now())`,
    `UPDATE public."Account" SET name='Forbidden'`,
    'DELETE FROM public."Account"',
  ]) assert.throws(() => execFileSync('psql', ['-X', '-w', '-v', 'ON_ERROR_STOP=1', '-c', statement], {
    env: pgEnvironment(connection(env.BACKUP_DATABASE_URL)), stdio: 'pipe',
  }));
  const b = await backup(env, { store, log, now: new Date('2026-11-01T02:00:00Z') });
  assert.equal(objects.size, 3);
  env.RESTORE_OBJECT_KEY = b.objectKey; env.RESTORE_EXPECTED_SHA256 = b.sha256;
  await restore(env, { store, log });
  const validation = await validateRestored(env);
  for (const name of ['User', 'Account', 'Opportunity', 'Project', 'PriceException', 'SupportCase']) assert.equal(validation[name], 1);
  assert.match(prisma('status', targetUrl), /up to date/);
  const restored = new PrismaClient({ datasources: { db: { url: targetUrl } } });
  try {
    const row = await restored.opportunity.findFirst({ include: { owner: true, legacyAccount: true, stage: true } });
    assert.equal(row.owner.email, 'restore-drill@example.test');
    assert.equal(row.legacyAccount.name, 'Restore fixture account');
    assert.equal(row.stage.name, 'Restore fixture stage');
    // Sequence state survived the custom archive too.
    const extra = await restored.account.create({ data: { name: 'Sequence fixture' } });
    assert.ok(extra.id > 1);
    await restored.account.delete({ where: { id: extra.id } });
  } finally { await restored.$disconnect(); }
  await assert.rejects(restore(env, { store, log }), error => error.stage === 'target-not-empty');
  await restore({ ...env, RESTORE_MODE: 'clean', RESTORE_ALLOW_CLEAN: 'replace-disposable-objects' }, { store, log });
  assert.deepEqual(await validateRestored(env), validation);
  assert.equal((await readdir('/tmp')).filter(name => name.startsWith('saleshub-recovery-')).length, 0);
  console.log(JSON.stringify({ event: 'drill.completed', storage: 'in-memory object-store adapter; no live Spaces', tls: 'verify-full', readOnlyBackupRole: true, prismaStatus: 'up to date', validation, sizeBytes: b.sizeBytes, sha256: b.sha256, cleanRestore: 'passed', tempCleanup: 'passed' }));
} catch (error) {
  // Even synthetic passwords/SQL must not leak through Node's default uncaught
  // exception renderer. Keep only an optional code location for diagnosis.
  const line = /restore-drill-fixture\.mjs:(\d+):(\d+)/.exec(error?.stack || '');
  console.error(JSON.stringify({ event: 'drill.failed', ...(line ? { location: `restore-drill-fixture.mjs:${line[1]}:${line[2]}` } : {}) }));
  process.exitCode = 1;
}
