import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const require = Module.createRequire(fileURLToPath(import.meta.url));
const { DEFAULT_USER_TIME_ZONE, USER_TIME_ZONE_OPTIONS, saveOwnTimeZone } = require(path.join(root, 'lib/user-time-zone.ts'));
const { formatDateTimeForUser } = require(path.join(root, 'lib/display-format.ts'));

test('existing and new users default to the same IANA zone', () => {
  const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
  const migration = fs.readFileSync(path.join(root, 'prisma/migrations/20261007130000_user_time_zone/migration.sql'), 'utf8');
  assert.equal(DEFAULT_USER_TIME_ZONE, 'America/New_York');
  assert.match(schema, /timeZone\s+String\s+@default\("America\/New_York"\)/);
  assert.match(migration, /ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'America\/New_York'/);
  assert.equal(USER_TIME_ZONE_OPTIONS.length, 7);
});

test('a personal update uses only the real authenticated user, including during impersonation', async () => {
  const users = new Map([[1, { timeZone: DEFAULT_USER_TIME_ZONE }], [2, { timeZone: DEFAULT_USER_TIME_ZONE }]]);
  const calls = [];
  const client = { user: { updateMany: async ({ where, data }) => {
    calls.push({ where, data });
    if (!users.has(where.id)) return { count: 0 };
    users.get(where.id).timeZone = data.timeZone;
    return { count: 1 };
  } } };
  const realAdmin = { id: 1, active: true, archivedAt: null };
  // An impersonation target and a forged form userId never enter the personal API.
  const form = new FormData(); form.set('timeZone', 'America/Los_Angeles'); form.set('userId', '2');
  await saveOwnTimeZone(client, realAdmin, form.get('timeZone'));
  assert.equal(users.get(1).timeZone, 'America/Los_Angeles');
  assert.equal(users.get(2).timeZone, DEFAULT_USER_TIME_ZONE);
  assert.deepEqual(calls[0].where, { id: 1, active: true, archivedAt: null });
  await assert.rejects(saveOwnTimeZone(client, realAdmin, 'Etc/Unknown'), /supported time zone/);
  await assert.rejects(saveOwnTimeZone(client, null, 'America/Chicago'), /Sign in/);
  assert.equal(calls.length, 1);
});

test('Calendar timestamps follow the saved zone and DST, independent of host time zone', () => {
  const instant = new Date('2026-10-07T12:47:00.000Z');
  const before = instant.toISOString();
  const originalTZ = process.env.TZ;
  try {
    for (const hostTZ of ['UTC', 'Pacific/Auckland']) {
      process.env.TZ = hostTZ;
      assert.equal(formatDateTimeForUser(instant, 'America/New_York'), 'Oct 7, 2026 at 8:47 AM EDT');
      assert.equal(formatDateTimeForUser(instant, 'America/Los_Angeles'), 'Oct 7, 2026 at 5:47 AM PDT');
      assert.equal(formatDateTimeForUser(new Date('2026-01-07T12:47:00.000Z'), 'America/New_York'), 'Jan 7, 2026 at 7:47 AM EST');
      assert.equal(formatDateTimeForUser(new Date('2026-01-07T12:47:00.000Z'), 'America/Los_Angeles'), 'Jan 7, 2026 at 4:47 AM PST');
    }
  } finally { if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ; }
  assert.equal(instant.toISOString(), before);
});

test('My integrations renders all visible Calendar timestamps through the personal formatter', () => {
  const page = fs.readFileSync(path.join(root, 'app/my-integrations/page.tsx'), 'utf8');
  const actions = fs.readFileSync(path.join(root, 'app/my-integrations/actions.ts'), 'utf8');
  assert.match(page, /getRealAuthenticatedUser\(\)/);
  assert.match(page, /formatDateTimeForUser\(value, user\.timeZone\)/);
  for (const field of ['lastConnectedAt', 'lastSuccessfulSyncAt', 'lastSyncCompletedAt']) assert.match(page, new RegExp(`displayTime\\(connection\\.${field}\\)`));
  assert.doesNotMatch(page, /toLocaleString/);
  assert.match(actions, /saveOwnTimeZone\(prisma, real, form\.get\('timeZone'\)\)/);
});
