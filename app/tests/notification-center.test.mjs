import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(fileURLToPath(import.meta.url));
const { peNotificationCandidates, peNotificationRecipient, evaluatePeNotifications, notifyPeFollowUpAssignment } = require(path.join(root, 'lib/pe-notification-evaluator.ts'));
const { notificationWhere, notificationSummary, notificationPage, notificationBulkActionAvailability, updateNotification } = require(path.join(root, 'lib/notifications.ts'));
const { notificationDisplayMessage, notificationEntityLabels } = require(path.join(root, 'lib/notification-presentation.ts'));
const today = new Date('2026-10-05T00:00:00Z');
const add = days => new Date(today.getTime() + days * 86400000);
const pe = { id: 12, peCode: 'PE-12', status: 'ACTIVE', archivedAt: null, expirationDate: add(60), assignedSalesRepUserId: 7, followUp: null };

test('notification presentation uses category labels while retaining business identifiers', () => {
  assert.equal(notificationEntityLabels.TASK, 'Task');
  assert.equal(notificationEntityLabels.OPPORTUNITY, 'Opportunity');
  assert.equal(notificationEntityLabels.PRICE_EXCEPTION, 'Price Exception');
  assert.deepEqual(Object.values(notificationEntityLabels).filter(label => /#\d/.test(label)), []);
  assert.equal(notificationDisplayMessage({ entityType: 'TASK', entityId: 3, message: 'Call the account' }), 'Call the account');
  assert.equal(notificationDisplayMessage({ entityType: 'OPPORTUNITY', entityId: 8, message: 'Renewal' }), 'Renewal');
  assert.equal(notificationDisplayMessage({ entityType: 'TASK', entityId: 3, message: 'Task #3 is overdue' }), 'Task is overdue');
  assert.equal(notificationDisplayMessage({ entityType: 'OPPORTUNITY', entityId: 8, message: 'Opportunity #8 needs review' }), 'Opportunity needs review');
  assert.equal(notificationDisplayMessage({ entityType: 'PRICE_EXCEPTION', entityId: 12, message: 'PE-12 expires in 30 days.' }), 'PE-12 expires in 30 days.');
  assert.equal(notificationDisplayMessage({ entityType: 'PRICE_EXCEPTION', entityId: 12, message: 'PE #12 expires in 30 days.' }), 'Price Exception expires in 30 days.');
  assert.equal(notificationDisplayMessage({ entityType: 'PRICE_EXCEPTION', entityId: 12, message: 'PE #123 expires in 30 days.' }), 'PE #123 expires in 30 days.');
});

test('unnumbered PE notifications use a business label in new messages', async () => {
  assert.equal(peNotificationCandidates({ ...pe, peCode: null }, 7, today)[0].message, 'Price Exception expires in 60 days.');
  const rows = [];
  const db = {
    priceException: { findUnique: async () => ({ peCode: null, assignedSalesRepUserId: 7 }) },
    user: { findUnique: async () => ({ active: true, archivedAt: null, role: 'SALES' }) },
    notification: { createMany: async ({ data }) => { rows.push(...data); return { count: data.length }; } },
  };
  await notifyPeFollowUpAssignment(db, 12, 7, 5, 9, today);
  assert.equal(rows[0].message, 'Price Exception follow-up was assigned to you.');
  assert.equal(rows[0].entityId, 12);
  assert.equal(rows[0].actionUrl, '/price-exceptions/12');
});

test('notification states are per-user and active excludes dismissed and resolved', () => {
  assert.deepEqual(notificationWhere(7, 'active'), { userId: 7, dismissedAt: null, resolvedAt: null });
  assert.deepEqual(notificationWhere(7, 'unread'), { userId: 7, readAt: null, dismissedAt: null, resolvedAt: null });
  assert.deepEqual(notificationWhere(7, 'dismissed'), { userId: 7, dismissedAt: { not: null } });
  assert.deepEqual(notificationWhere(7, 'resolved'), { userId: 7, resolvedAt: { not: null } });
});

test('bulk button availability uses the same visible active scope as bulk actions', async () => {
  const queries = [];
  const db = {
    notification: {
      findMany: async ({ where }) => where.entityType === 'TASK' ? [{ entityId: 4 }] : [],
      count: async ({ where }) => { queries.push(where); return where.readAt === null ? 2 : 0; },
    },
    task: { findMany: async () => [{ id: 4 }] },
    priceException: { findMany: async () => [] },
    opportunity: { findMany: async () => [] },
  };
  const actor = { id: 7, role: 'SALES', active: true, archivedAt: null };
  assert.deepEqual(await notificationBulkActionAvailability(db, actor), { canMarkAllRead: true, canDismissRead: false });
  assert.equal(queries.length, 2);
  assert.ok(queries.every(where => where.userId === 7 && where.dismissedAt === null && where.resolvedAt === null));
  assert.deepEqual(queries.map(where => where.readAt), [null, { not: null }]);
  assert.deepEqual(queries[0].AND[0].OR, [{ entityType: 'TASK', entityId: { in: [4] } }]);
});

test('bell is bounded and notification mutations use effective-user identity and PE scope', async () => {
  const queries = [];
  const actor = { id: 7, role: 'SALES', active: true, archivedAt: null };
  const db = {
    notification: {
      findMany: async args => { queries.push(args); return args.distinct ? (args.where.entityType === 'PRICE_EXCEPTION' ? [{ entityId: 12 }] : []) : []; },
      findFirst: async args => { queries.push(args); return { entityType: 'PRICE_EXCEPTION', entityId: 12 }; },
      count: async args => { queries.push(args); return 1; },
      updateMany: async args => { queries.push(args); return { count: 1 }; },
    },
    priceException: { findMany: async args => { queries.push(args); return [{ id: 12 }]; }, findFirst: async args => { queries.push(args); return { id: 12 }; } },
    task: { findMany: async () => [] }, opportunity: { findMany: async () => [] },
  };
  const summary = await notificationSummary(db, actor);
  assert.equal(summary.unread, 1);
  assert.equal(queries.find(q => q.take === 7).take, 7);
  const page = await notificationPage(db, actor, 'unread', 2, 20);
  assert.equal(page.page, 1);
  assert.equal(queries.find(q => q.take === 20).skip, 0);
  assert.equal(await updateNotification(db, actor, 4, 'dismiss'), true);
  assert.deepEqual(queries.at(-1).where, { id: 4, userId: 7, dismissedAt: null });
  assert.ok(queries.some(q => JSON.stringify(q.where ?? {}).includes('assignedSalesRepUserId')));
  db.notification.findFirst = async ({ where }) => where.userId === 8 ? null : { entityType: 'PRICE_EXCEPTION', entityId: 12 };
  assert.equal(await updateNotification(db, { ...actor, id: 8 }, 4, 'read'), false);
});

test('New York thresholds and overdue follow-up use one source key per condition', () => {
  assert.equal(peNotificationCandidates(pe, 7, today)[0].sourceKey, 'PE:12:7:EXPIRING_60');
  assert.equal(peNotificationCandidates({ ...pe, expirationDate: add(30) }, 7, today)[0].severity, 'WARNING');
  assert.equal(peNotificationCandidates({ ...pe, expirationDate: add(-1), followUp: { status: 'NOT_STARTED', nextFollowUpAt: add(-2) } }, 7, today)[0].severity, 'CRITICAL');
  assert.equal(peNotificationCandidates({ ...pe, expirationDate: add(-1), followUp: { status: 'NOT_STARTED', nextFollowUpAt: add(-2) } }, 7, today)[1].sourceKey, 'PE:12:7:FOLLOW_UP_OVERDUE:2026-10-03');
  assert.equal(peNotificationCandidates({ ...pe, followUp: { status: 'COMPLETED', nextFollowUpAt: add(-2) } }, 7, today).length, 1);
});

test('recipient follows PE ownership without team-wide broadcasts or inaccessible Sales alerts', () => {
  const users = new Map([[7, { role: 'SALES' }], [8, { role: 'SALES_MANAGER' }], [9, { role: 'ADMIN' }]]);
  assert.equal(peNotificationRecipient(pe, users), 7);
  assert.equal(peNotificationRecipient({ ...pe, assignedSalesRepUserId: null }, users), null);
  assert.equal(peNotificationRecipient({ ...pe, followUp: { ownerId: 8, status: 'NOT_STARTED', nextFollowUpAt: null } }, users), 8);
  assert.equal(peNotificationRecipient({ ...pe, followUp: { ownerId: null, status: 'NOT_STARTED', nextFollowUpAt: null } }, users), null);
  assert.equal(peNotificationRecipient({ ...pe, followUp: { ownerId: 9, status: 'NOT_STARTED', nextFollowUpAt: null } }, users), 9);
  assert.equal(peNotificationRecipient({ ...pe, assignedSalesRepUserId: 8, followUp: { ownerId: 7, status: 'NOT_STARTED', nextFollowUpAt: null } }, users), null);
});

test('evaluator dedupes reruns, supersedes thresholds, and resolves overdue when date moves forward', async () => {
  const row = { ...pe };
  const notifications = [];
  const db = {
    user: { findMany: async () => [{ id: 7, role: 'SALES', active: true, archivedAt: null }] },
    priceException: { findMany: async ({ where }) => where.id.gt < row.id ? [row] : [] },
    notification: {
      findMany: async () => notifications.filter(n => !n.resolvedAt && n.type !== 'PE_FOLLOW_UP_ASSIGNED').map(n => ({ id: n.id, sourceKey: n.sourceKey })),
      createMany: async ({ data }) => { for (const item of data) if (!notifications.some(n => n.sourceKey === item.sourceKey)) notifications.push({ ...item, id: notifications.length + 1, resolvedAt: null }); return { count: 1 }; },
      updateMany: async ({ where, data }) => { for (const n of notifications) if (where.id?.in?.includes(n.id) || where.sourceKey === n.sourceKey) Object.assign(n, data); return { count: 1 }; },
    },
  };
  const now = new Date('2026-10-05T18:00:00Z');
  await evaluatePeNotifications(db, now);
  await evaluatePeNotifications(db, now);
  assert.equal(notifications.length, 1);
  row.expirationDate = add(30);
  await evaluatePeNotifications(db, now);
  assert.equal(notifications.length, 2);
  assert.ok(notifications[0].resolvedAt);
  row.expirationDate = add(-1);
  row.followUp = { ownerId: 7, status: 'NOT_STARTED', nextFollowUpAt: add(-2) };
  await evaluatePeNotifications(db, now);
  assert.equal(notifications.length, 4);
  assert.ok(notifications[1].resolvedAt);
  row.followUp.nextFollowUpAt = add(2);
  await evaluatePeNotifications(db, now);
  assert.ok(notifications[3].resolvedAt);
});

test('category and severity filters preserve per-user scope and page boundaries', async () => {
  const actor = { id: 7, role: 'SALES', active: true, archivedAt: null };
  const queries = [];
  const db = {
    notification: {
      findMany: async args => { queries.push(args); return args.distinct ? [{ entityId: args.where.entityType === 'TASK' ? 4 : 8 }] : []; },
      count: async args => { queries.push(args); return 41; },
    },
    task: { findMany: async args => { queries.push(args); return [{ id: 4 }]; } },
    opportunity: { findMany: async args => { queries.push(args); return [{ id: 8 }]; } },
  };
  const tasks = await notificationPage(db, actor, 'unread', 3, 20, 'tasks', 'WARNING');
  assert.deepEqual([tasks.count, tasks.page, tasks.pages], [41, 3, 3]);
  const query = queries.find(item => item.take === 20);
  assert.equal(query.skip, 40);
  assert.equal(query.where.userId, 7);
  assert.equal(query.where.severity, 'WARNING');
  assert.deepEqual(query.where.AND[0].OR, [{ entityType: 'TASK', entityId: { in: [4] } }]);
  assert.ok(queries.some(item => item.where?.assignedToId === 7));
  assert.equal(queries.some(item => item.where?.ownerId === 7), false);
});
