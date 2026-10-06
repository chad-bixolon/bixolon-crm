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
const { peNotificationCandidates, peNotificationRecipient, evaluatePeNotifications } = require(path.join(root, 'lib/pe-notification-evaluator.ts'));
const { notificationWhere, notificationSummary, notificationPage, updateNotification } = require(path.join(root, 'lib/notifications.ts'));
const today = new Date('2026-10-05T00:00:00Z');
const add = days => new Date(today.getTime() + days * 86400000);
const pe = { id: 12, peCode: 'PE-12', status: 'ACTIVE', archivedAt: null, expirationDate: add(60), assignedSalesRepUserId: 7, followUp: null };

test('notification states are per-user and active excludes dismissed and resolved', () => {
  assert.deepEqual(notificationWhere(7, 'active'), { userId: 7, dismissedAt: null, resolvedAt: null });
  assert.deepEqual(notificationWhere(7, 'unread'), { userId: 7, readAt: null, dismissedAt: null, resolvedAt: null });
  assert.deepEqual(notificationWhere(7, 'dismissed'), { userId: 7, dismissedAt: { not: null } });
  assert.deepEqual(notificationWhere(7, 'resolved'), { userId: 7, resolvedAt: { not: null } });
});

test('bell is bounded and notification mutations use effective-user identity and PE scope', async () => {
  const queries = [];
  const actor = { id: 7, role: 'SALES', active: true, archivedAt: null };
  const db = {
    notification: {
      findMany: async args => { queries.push(args); return args.distinct ? [{ entityId: 12 }] : []; },
      findFirst: async args => { queries.push(args); return { entityType: 'PRICE_EXCEPTION', entityId: 12 }; },
      count: async args => { queries.push(args); return 1; },
      updateMany: async args => { queries.push(args); return { count: 1 }; },
    },
    priceException: { findMany: async args => { queries.push(args); return [{ id: 12 }]; }, findFirst: async args => { queries.push(args); return { id: 12 }; } },
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
