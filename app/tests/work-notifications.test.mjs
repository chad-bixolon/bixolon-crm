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
const { taskNotificationCandidates, opportunityNotificationCandidates, evaluateWorkNotifications, notifyTaskAssignment, notifyOpportunityAssignment } = require(path.join(root, 'lib/work-notification-evaluator.ts'));
const { saveTask } = require(path.join(root, 'lib/work.ts'));
const date = value => new Date(`${value}T12:00:00Z`);
const now = new Date('2026-10-06T16:00:00Z');
const today = date('2026-10-06');

test('Task candidates use one New York date condition and exclude completed, cancelled and archived Tasks', () => {
  const task = { id: 4, subject: 'Call account', assignedToId: 7, dueDate: today, status: 'OPEN', archivedAt: null };
  assert.equal(taskNotificationCandidates(task, today)[0].sourceKey, 'TASK:4:7:DUE_TODAY:2026-10-06');
  assert.equal(taskNotificationCandidates({ ...task, dueDate: date('2026-10-05') }, today)[0].sourceKey, 'TASK:4:7:OVERDUE:2026-10-05');
  for (const change of [{ status: 'COMPLETED' }, { status: 'CANCELLED' }, { archivedAt: now }, { assignedToId: null }, { dueDate: date('2026-10-07') }]) assert.equal(taskNotificationCandidates({ ...task, ...change }, today).length, 0);
});

test('Opportunity candidates exclude closed and archived records and version conditions', () => {
  const opp = { id: 8, name: 'Renewal', ownerId: 7, expectedCloseDate: date('2026-10-05'), forecastCategory: 'COMMIT', archivedAt: null, stage: { isClosed: false }, activities: [], historyEvents: [{ id: 33 }] };
  const candidates = opportunityNotificationCandidates(opp, today, true);
  assert.deepEqual(candidates.map(item => item.type), ['OPP_CLOSE_DATE_OVERDUE', 'OPP_COMMIT_NO_ACTIVITY']);
  assert.match(candidates[1].sourceKey, /:33:NONE$/);
  assert.notEqual(opportunityNotificationCandidates({ ...opp, activities: [{ id: 9, activityDate: today }] }, today, true)[1].sourceKey, candidates[1].sourceKey);
  for (const change of [{ stage: { isClosed: true } }, { archivedAt: now }, { ownerId: null }]) assert.equal(opportunityNotificationCandidates({ ...opp, ...change }, today, true).length, 0);
  assert.equal(opportunityNotificationCandidates({ ...opp, forecastCategory: 'PIPELINE', expectedCloseDate: today }, today, false).length, 0);
});

test('shared evaluator creates, dedupes, resolves and supersedes personal conditions', async () => {
  const task = { id: 4, subject: 'Call account', assignedToId: 7, dueDate: date('2026-10-05'), status: 'OPEN', archivedAt: null };
  const opp = { id: 8, name: 'Renewal', ownerId: 7, expectedCloseDate: date('2026-10-05'), forecastCategory: 'COMMIT', archivedAt: null, stage: { isClosed: false }, activities: [], historyEvents: [{ id: 33 }] };
  const notifications = [];
  const db = {
    systemSetting: { findMany: async () => [] },
    user: { findFirst: async ({ where }) => where.id === 7 ? { id: 7 } : null },
    task: {
      findMany: async ({ where }) => where.id.gt < task.id ? [{ id: task.id }] : [],
      findUnique: async () => task,
      findFirst: async () => task.archivedAt ? null : { id: task.id },
    },
    opportunity: {
      findMany: async ({ where }) => where.id.gt < opp.id ? [{ id: opp.id }] : [],
      findUnique: async () => opp,
      findFirst: async ({ where }) => {
        if (opp.archivedAt || opp.stage.isClosed) return null;
        if (where.AND?.some(item => item.forecastCategory === 'COMMIT')) return opp.forecastCategory === 'COMMIT' && !opp.activities.some(activity => activity.activityDate >= new Date('2026-09-23T04:00:00Z')) ? { id: opp.id } : null;
        return { id: opp.id };
      },
    },
    notification: {
      findMany: async ({ where }) => notifications.filter(item => item.entityType === where.entityType && item.entityId === where.entityId && where.type.in.includes(item.type) && !item.resolvedAt).map(item => ({ id: item.id, sourceKey: item.sourceKey })),
      createMany: async ({ data }) => { const item = data[0]; if (notifications.some(row => row.sourceKey === item.sourceKey)) return { count: 0 }; notifications.push({ ...item, id: notifications.length + 1, resolvedAt: null }); return { count: 1 }; },
      updateMany: async ({ where, data }) => { let count = 0; for (const item of notifications) if (where.id.in.includes(item.id)) { Object.assign(item, data); count++; } return { count }; },
    },
  };
  const first = await evaluateWorkNotifications(db, now);
  assert.deepEqual(first.created, { tasks: 1, opportunities: 2 });
  assert.deepEqual(first.evaluated, { tasks: 1, opportunities: 1 });
  assert.deepEqual((await evaluateWorkNotifications(db, now)).created, { tasks: 0, opportunities: 0 });
  task.dueDate = today;
  const dueToday = await evaluateWorkNotifications(db, now);
  assert.deepEqual([dueToday.created.tasks, dueToday.resolved.tasks], [1, 1]);
  task.status = 'COMPLETED'; opp.expectedCloseDate = date('2026-10-07'); opp.activities = [{ id: 9, activityDate: now }];
  assert.deepEqual((await evaluateWorkNotifications(db, now)).resolved, { tasks: 1, opportunities: 2 });
  assert.equal(notifications.length, 4);
  task.status = 'OPEN'; task.dueDate = date('2026-10-04'); opp.expectedCloseDate = date('2026-10-04'); opp.activities[0].activityDate = date('2026-09-01');
  assert.deepEqual((await evaluateWorkNotifications(db, now)).created, { tasks: 1, opportunities: 2 });
  task.assignedToId = 9; opp.ownerId = 9;
  assert.deepEqual((await evaluateWorkNotifications(db, now)).resolved, { tasks: 1, opportunities: 2 });
  assert.equal(notifications.every(item => item.userId === 7), true);
});

test('assignment keys use event identity and deliver only to the chosen user', async () => {
  const rows = [];
  const db = { user: { findFirst: async ({ where }) => where.id === 7 ? { id: 7 } : null }, notification: { createMany: async ({ data }) => { rows.push(data[0]); return { count: 1 }; } } };
  await notifyTaskAssignment(db, 4, 7, 11);
  await notifyTaskAssignment(db, 4, 7, 12);
  await notifyOpportunityAssignment(db, 8, 7, 33);
  await notifyOpportunityAssignment(db, 8, 9, 34);
  assert.deepEqual(rows.map(row => row.sourceKey), ['TASK:4:7:ASSIGNED:11', 'TASK:4:7:ASSIGNED:12', 'OPP:8:7:ASSIGNED:33']);
  assert.ok(rows.every(row => row.userId === 7 && row.severity === 'INFO'));
});

test('Task save creates one assignment event and notice for each new assignee', async () => {
  let task = null, nextEvent = 1;
  const events = [], notifications = [];
  const tx = {
    user: { findFirst: async ({ where }) => ({ id: where.id }) },
    task: {
      findUnique: async () => task,
      findFirst: async () => task,
      create: async ({ data }) => (task = { id: 4, archivedAt: null, ...data }),
      update: async ({ data }) => (task = { ...task, ...data }),
    },
    taskAssignmentEvent: { create: async ({ data }) => { const row = { id: nextEvent++, ...data }; events.push(row); return row; } },
    notification: {
      findMany: async () => [],
      createMany: async ({ data }) => { notifications.push(data[0]); return { count: 1 }; },
    },
  };
  const client = { $transaction: fn => fn(tx) };
  const input = { subject: 'Follow up', description: null, accountId: null, opportunityId: null, projectId: null, assignedToId: 7, dueDate: null, status: 'OPEN', priority: 'NORMAL' };
  await saveTask(client, input, undefined, undefined, 3);
  await saveTask(client, { ...input, assignedToId: 8 }, 4, undefined, 3);
  assert.deepEqual(events.map(row => [row.fromUserId, row.toUserId]), [[null, 7], [7, 8]]);
  assert.deepEqual(notifications.map(row => [row.userId, row.sourceKey]), [[7, 'TASK:4:7:ASSIGNED:1'], [8, 'TASK:4:8:ASSIGNED:2']]);
});
