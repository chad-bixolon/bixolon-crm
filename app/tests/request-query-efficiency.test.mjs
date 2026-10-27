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
const { validateSavedViewRows } = require(path.join(root, 'lib/saved-view-store.ts'));
const { reconcileNotificationBatch } = require(path.join(root, 'lib/notification-batch.ts'));
const { evaluateWorkNotifications } = require(path.join(root, 'lib/work-notification-evaluator.ts'));
const { evaluateSupportNotifications } = require(path.join(root, 'lib/support-notifications.ts'));
const { evaluatePeNotifications } = require(path.join(root, 'lib/pe-notification-evaluator.ts'));

test('50 saved views batch owner and relationship validation while preserving sentinels and scope', async () => {
  const calls = {};
  const model = (name, accepted) => ({ findMany: async ({ where, select }) => { calls[name] = (calls[name] ?? 0) + 1; assert.deepEqual(select, { id: true }); assert.ok(where); return accepted.map(id => ({ id })); } });
  const db = {
    user: model('user', [7]), account: model('account', [3]), project: model('project', [4]), opportunity: model('opportunity', [8]),
    tradeShow: model('tradeShow', []), salesStage: model('salesStage', []), competitorOption: model('competitorOption', []), supportCaseCategory: model('supportCaseCategory', []),
  };
  const actor = { id: 7, role: 'ADMIN', active: true, archivedAt: null };
  const rows = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, name: `View ${i}`, isDefault: false, queryState: { ownerId: i % 2 ? '7' : '9', accountId: '3', projectId: '4' } }));
  const result = await validateSavedViewRows(db, 'opportunities', actor, rows);
  assert.deepEqual(calls, { account: 1, project: 1, user: 1 });
  assert.equal(result.filter(row => row.omitted.includes('Owner')).length, 25);
  assert.equal(result.every(row => row.query.accountId === '3' && row.query.projectId === '4'), true);
  const sentinel = await validateSavedViewRows(db, 'contacts', actor, [{ id: 1, name: 'Unassigned', isDefault: false, queryState: { accountId: 'unassigned' } }]);
  assert.equal(sentinel[0].query.accountId, 'unassigned');
  assert.deepEqual(sentinel[0].omitted, []);
});

test('notification batches keep reads and writes bounded at 200 records and honor disabled preferences', async () => {
  const counts = { notices: 0, preferences: 0, create: 0, resolve: 0 };
  const db = {
    notification: {
      findMany: async () => { counts.notices++; return [{ id: 1, entityId: 1, sourceKey: 'obsolete' }]; },
      updateMany: async ({ where }) => { counts.resolve++; return { count: where.id.in.length }; },
      createMany: async ({ data }) => { counts.create++; return { count: data.length }; },
    },
    notificationPreference: { findMany: async () => { counts.preferences++; return [{ userId: 8, enabled: false }]; } },
  };
  const entries = Array.from({ length: 200 }, (_, i) => ({ entityId: i + 1, userId: i % 2 ? 8 : 7, candidates: [{ type: 'TASK_OVERDUE', severity: 'WARNING', title: 'Due', message: 'Task', sourceKey: `TASK:${i + 1}` }] }));
  const result = await reconcileNotificationBatch(db, 'TASK', ['TASK_OVERDUE'], entries, new Date('2026-10-26T00:00:00Z'));
  assert.equal(result.created, 100);
  assert.equal(result.resolved, 1);
  assert.equal(result.allowedSourceKeys.size, 100);
  assert.deepEqual(counts, { notices: 1, preferences: 1, create: 1, resolve: 1 });
});

test('scheduled Task, Support and PE evaluation reads 200 records in bounded batches', async () => {
  const now = new Date('2026-10-26T16:00:00Z');
  const tasks = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, subject: `Task ${i}`, assignedToId: 7, supportCaseId: null, dueDate: new Date('2026-10-25T12:00:00Z'), status: 'OPEN', archivedAt: null }));
  const cases = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, caseNumber: `CASE-${i}`, assignedToId: 7, status: 'OPEN', archivedAt: null, nextFollowUpAt: new Date('2026-10-25T12:00:00Z') }));
  const pes = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, peCode: `PE-${i}`, status: 'ACTIVE', archivedAt: null, expirationDate: new Date('2026-11-10T12:00:00Z'), assignedSalesRepUserId: 7, followUp: { ownerId: 7, status: 'NOT_STARTED', nextFollowUpAt: null } }));
  const counts = { task: 0, opportunity: 0, support: 0, pe: 0, users: 0, notices: 0, preferences: 0, creates: 0 };
  const batch = (name, rows) => ({ findMany: async ({ where }) => { counts[name]++; return where.id.gt !== undefined ? where.id.gt === 0 ? rows : [] : rows; } });
  const db = {
    systemSetting: { findMany: async () => [] },
    task: batch('task', tasks), opportunity: batch('opportunity', []), supportCase: batch('support', cases), priceException: batch('pe', pes),
    user: { findMany: async () => { counts.users++; return [{ id: 7, role: 'SALES', active: true, archivedAt: null }]; } },
    notificationPreference: { findMany: async () => { counts.preferences++; return []; } },
    notification: { findMany: async () => { counts.notices++; return []; }, createMany: async ({ data }) => { counts.creates++; return { count: data.length }; }, updateMany: async () => ({ count: 0 }) },
  };
  const work = await evaluateWorkNotifications(db, now);
  const support = await evaluateSupportNotifications(db, now);
  const pe = await evaluatePeNotifications(db, now);
  assert.equal(work.evaluated.tasks, 200);
  assert.equal(support.evaluated, 200);
  assert.equal(pe.evaluated, 200);
  assert.equal(counts.task, 3); // page, operational set, empty next page
  assert.equal(counts.support, 2);
  assert.equal(counts.pe, 2);
  assert.ok(counts.users <= 5);
  assert.equal(counts.notices, 3);
  assert.equal(counts.preferences, 3);
  assert.equal(counts.creates, 3);
});
