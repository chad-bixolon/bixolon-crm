import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(import.meta.url);
const { notificationEnabled } = require(path.join(root, 'lib/notification-preferences.ts'));
const { snoozeUntil, notificationWhere, snoozeUserNotification } = require(path.join(root, 'lib/notifications.ts'));
const { jobState, beginJobRun, finishJobRun, recordJobResult } = require(path.join(root, 'lib/scheduled-job-runs.ts'));

test('notification preferences default on, are per-user and category, and cannot suppress Critical', async () => {
  const rows = new Map([['7:TASK', false], ['8:SUPPORT_CASE', false], ['7:PRICE_EXCEPTION', false]]);
  const db = { notificationPreference: { findUnique: async ({ where: { userId_category: { userId, category } } }) => rows.has(`${userId}:${category}`) ? { enabled: rows.get(`${userId}:${category}`) } : null } };
  for (const category of ['TASK', 'OPPORTUNITY', 'PRICE_EXCEPTION', 'SUPPORT_CASE']) assert.equal(await notificationEnabled(db, 9, category, 'WARNING'), true);
  assert.equal(await notificationEnabled(db, 7, 'TASK', 'WARNING'), false);
  assert.equal(await notificationEnabled(db, 8, 'TASK', 'WARNING'), true);
  assert.equal(await notificationEnabled(db, 7, 'PRICE_EXCEPTION', 'INFO'), false);
  assert.equal(await notificationEnabled(db, 8, 'SUPPORT_CASE', 'WARNING'), false);
  assert.equal(await notificationEnabled(db, 7, 'TASK', 'CRITICAL'), true);
  assert.equal(await notificationEnabled(db, 7, 'PRICE_EXCEPTION', 'CRITICAL'), true);
});

test('snooze presets respect the user time zone and expired snoozes return to Active', () => {
  const now = new Date('2026-10-12T18:30:00Z'); // 14:30 New York
  assert.equal(snoozeUntil('later-today', now, 'America/New_York').toISOString(), '2026-10-13T03:59:00.000Z');
  assert.equal(snoozeUntil('tomorrow', now, 'America/New_York').toISOString(), '2026-10-13T13:00:00.000Z');
  assert.equal(snoozeUntil('three-days', now, 'America/Los_Angeles').toISOString(), '2026-10-15T16:00:00.000Z');
  assert.equal(snoozeUntil('custom', now, 'America/New_York', '2026-10-14T10:15').toISOString(), '2026-10-14T14:15:00.000Z');
  assert.equal(snoozeUntil('custom', now, 'America/New_York', '2026-10-12T10:15'), null);
  assert.deepEqual(notificationWhere(7, 'active', now).OR, [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }]);
  assert.equal(notificationWhere(7, 'all', now).OR, undefined);
});

test('snooze mutation is limited to the current user and a visible active entity', async () => {
  const actor = { id: 7, role: 'SUPPORT', active: true, archivedAt: null };
  let updates = 0;
  const db = {
    notification: {
      findFirst: async ({ where }) => where.id === 12 && where.userId === 7 ? { entityType: 'SUPPORT_CASE' } : null,
      findMany: async () => [{ entityId: 44 }],
      updateMany: async ({ where }) => { assert.equal(where.userId, 7); updates++; return { count: 1 }; },
    },
    supportCase: { findMany: async () => [{ id: 44 }] },
  };
  const future = new Date(Date.now() + 3600000);
  assert.equal(await snoozeUserNotification(db, { ...actor, id: 8 }, 12, future), false);
  assert.equal(updates, 0);
  assert.equal(await snoozeUserNotification(db, actor, 12, future), true);
  assert.equal(updates, 1);
});

test('job health requires recent completed success and marks failures conservatively', () => {
  const now = new Date('2026-10-12T18:00:00Z');
  assert.equal(jobState(null, 'CALENDAR_SYNC', now), 'Stale');
  assert.equal(jobState({ status: 'RUNNING', startedAt: now, completedAt: null }, 'CALENDAR_SYNC', now), 'Stale');
  assert.equal(jobState({ status: 'SUCCEEDED', startedAt: now, completedAt: new Date(now.getTime() - 30 * 60000) }, 'CALENDAR_SYNC', now), 'Healthy');
  assert.equal(jobState({ status: 'SUCCEEDED', startedAt: now, completedAt: new Date(now.getTime() - 61 * 60000) }, 'CALENDAR_SYNC', now), 'Stale');
  assert.equal(jobState({ status: 'FAILED', startedAt: now, completedAt: now }, 'NOTIFICATION_EVALUATOR', now), 'Failed');
  assert.equal(jobState({ status: 'SUCCEEDED', startedAt: now, completedAt: new Date(now.getTime() - 47 * 3600000) }, 'NOTIFICATION_EVALUATOR', now), 'Healthy');
});

test('job run recording keeps bounded summaries and never interrupts the job on monitoring failure', async () => {
  let write;
  const db = { scheduledJobRun: { create: async ({ data }) => { assert.equal(data.jobType, 'CALENDAR_SYNC'); return { id: 12 }; }, update: async ({ where, data }) => { assert.equal(where.id, 12); write = data; } } };
  const run = await beginJobRun(db, 'CALENDAR_SYNC');
  await finishJobRun(db, run.id, { status: 'FAILED', processedCount: 3, errorSummary: 'x'.repeat(400) });
  assert.equal(write.status, 'FAILED');
  assert.equal(write.processedCount, 3);
  assert.equal(write.errorSummary.length, 300);
  assert.equal((await beginJobRun({ scheduledJobRun: { create: async () => { throw new Error('monitor unavailable'); } } }, 'CALENDAR_SYNC')), null);
  await finishJobRun({ scheduledJobRun: { update: async () => { throw new Error('monitor unavailable'); } } }, 12, { status: 'SUCCEEDED' });
});

test('job result recording does not wait for start or completion writes', async () => {
  let releaseCreate, releaseUpdate;
  const writes = [];
  const db = { scheduledJobRun: {
    create: () => new Promise(resolve => { releaseCreate = resolve; }),
    update: ({ data }) => { writes.push(data); return new Promise(resolve => { releaseUpdate = resolve; }); },
  } };
  const start = beginJobRun(db, 'CALENDAR_SYNC');
  assert.equal(typeof releaseCreate, 'function');
  assert.equal(recordJobResult(db, start, { status: 'SUCCEEDED' }), undefined);
  assert.equal(writes.length, 0);
  releaseCreate({ id: 8 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes[0].status, 'SUCCEEDED');
  assert.equal(typeof releaseUpdate, 'function');
  releaseUpdate();
});
