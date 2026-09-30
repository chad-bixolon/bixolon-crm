import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(import.meta.url);
const followUp = require(path.join(root, 'lib/trade-show-follow-up.ts'));
const config = require(path.join(root, 'lib/configuration.ts'));
const { can, taskScope } = require(path.join(root, 'lib/authorization.ts'));
const lead = (overrides = {}) => ({ id: 12, tradeShowId: 4, routing: 'BIXOLON_SALES', assignedSalesRepUserId: 7, firstName: 'Jane', lastName: 'Smith', sourceCompany: 'Acme Corp', email: 'jane@example.test', productInterest: 'XD5-40', accountId: 21, contactId: 31, ...overrides });
function fixture() {
  const tasks = [], events = [];
  let eligible = true, failCreate = false, activities = 0, setting = null;
  const tx = {
    task: {
      findFirst: async () => [...tasks].reverse().find(t => t.source === followUp.TRADE_SHOW_FOLLOW_UP_SOURCE && t.tradeShowLeadId === 12 && !t.archivedAt && ['OPEN', 'IN_PROGRESS'].includes(t.status)) ?? null,
      create: async ({ data }) => { if (failCreate) throw Error('Task write failed'); const task = { id: tasks.length + 1, archivedAt: null, ...data }; tasks.push(task); return task; },
      update: async ({ where, data }) => Object.assign(tasks.find(t => t.id === where.id), data),
    },
    taskAssignmentEvent: { create: async ({ data }) => events.push(data) },
    user: { findFirst: async () => eligible ? { id: 7 } : null },
    tradeShow: { findUnique: async () => ({ name: 'NRF 2026' }) },
    activity: { create: async () => activities++ },
    systemSetting: { findUnique: async () => setting === 'unavailable' ? Promise.reject(Error('settings unavailable')) : setting === null ? null : { value: setting } },
  };
  return { tx, tasks, events, setEligible: value => eligible = value, setFailCreate: value => failCreate = value, setSetting: value => setting = value, activityCount: () => activities };
}

test('new assignment creates a normal open Task with source, CRM links, concise context and audit', async () => {
  const f = fixture();
  await followUp.syncTradeShowFollowUp(f.tx, null, lead(), 99, new Date('2026-09-28T15:00:00Z'));
  assert.equal(f.tasks.length, 1);
  assert.deepEqual({ assignee: f.tasks[0].assignedToId, original: f.tasks[0].originalAssigneeId, status: f.tasks[0].status, priority: f.tasks[0].priority, showLead: f.tasks[0].tradeShowLeadId, account: f.tasks[0].accountId, contact: f.tasks[0].contactId }, { assignee: 7, original: 7, status: 'OPEN', priority: 'NORMAL', showLead: 12, account: 21, contact: 31 });
  assert.equal(f.tasks[0].subject, 'Follow up with Trade Show lead — Acme Corp');
  assert.match(f.tasks[0].description, /Trade Show: NRF 2026\nLead: Jane Smith\nCompany: Acme Corp\nEmail: jane@example.test\nProduct interest: XD5-40/);
  assert.equal(f.tasks[0].dueDate.toISOString(), '2026-09-30T12:00:00.000Z');
  assert.equal(f.events[0].toUserId, 7);
  assert.equal(f.activityCount(), 0);
});

test('due dates advance two New York business days, including Friday and weekend assignments', () => {
  for (const [assigned, due] of [
    ['2026-10-01T15:00:00Z', '2026-10-05'],
    ['2026-10-02T15:00:00Z', '2026-10-06'],
    ['2026-10-03T15:00:00Z', '2026-10-06'],
    ['2026-10-06T02:00:00Z', '2026-10-07'],
  ]) assert.equal(followUp.followUpDueDate(new Date(assigned)).toISOString().slice(0, 10), due);
});

test('Admin setting defaults to two, supports one and five days, and falls back if invalid or unavailable', async () => {
  const f = fixture();
  assert.equal(await config.tradeShowFollowUpBusinessDays(f.tx), 2);
  f.setSetting(1); assert.equal(await config.tradeShowFollowUpBusinessDays(f.tx), 1);
  f.setSetting(5); assert.equal(await config.tradeShowFollowUpBusinessDays(f.tx), 5);
  for (const invalid of [0, -1, 31, NaN, 'unavailable']) { f.setSetting(invalid); assert.equal(await config.tradeShowFollowUpBusinessDays(f.tx), 2); }
  assert.equal(followUp.followUpDueDate(new Date('2026-10-02T15:00:00Z'), 1).toISOString().slice(0, 10), '2026-10-05');
  assert.equal(followUp.followUpDueDate(new Date('2026-10-02T15:00:00Z'), 5).toISOString().slice(0, 10), '2026-10-09');
});

test('new setting affects only new Tasks; open reassignment and rep edits retain due dates', async () => {
  const f = fixture(), friday = new Date('2026-10-02T15:00:00Z');
  f.setSetting(1);
  await followUp.syncTradeShowFollowUp(f.tx, null, lead(), 99, friday, await config.tradeShowFollowUpBusinessDays(f.tx));
  assert.equal(f.tasks[0].dueDate.toISOString().slice(0, 10), '2026-10-05');
  f.setSetting(5);
  assert.equal(f.tasks[0].dueDate.toISOString().slice(0, 10), '2026-10-05');
  const edited = new Date('2026-11-20T12:00:00Z'); f.tasks[0].dueDate = edited;
  await followUp.syncTradeShowFollowUp(f.tx, lead(), lead({ assignedSalesRepUserId: 8 }), 99, friday, await config.tradeShowFollowUpBusinessDays(f.tx));
  await followUp.syncTradeShowFollowUp(f.tx, lead({ assignedSalesRepUserId: 8 }), lead({ assignedSalesRepUserId: 8, sourceCompany: 'Changed' }), 99, friday, await config.tradeShowFollowUpBusinessDays(f.tx));
  assert.equal(f.tasks[0].dueDate, edited); assert.equal(f.tasks.length, 1);
  f.tasks[0].status = 'COMPLETED';
  await followUp.syncTradeShowFollowUp(f.tx, lead({ assignedSalesRepUserId: 8 }), lead({ assignedSalesRepUserId: 9 }), 99, friday, await config.tradeShowFollowUpBusinessDays(f.tx));
  assert.equal(f.tasks[0].dueDate, edited);
  assert.equal(f.tasks[1].dueDate.toISOString().slice(0, 10), '2026-10-09');
});

test('title falls back to contact name then generic title', () => {
  assert.equal(followUp.followUpTitle(lead({ sourceCompany: null })), 'Follow up with Trade Show lead — Jane Smith');
  assert.equal(followUp.followUpTitle(lead({ sourceCompany: null, firstName: '', lastName: '' })), 'Follow up with Trade Show lead');
});

test('unchanged rep or source edits do not duplicate or overwrite user due date', async () => {
  const f = fixture();
  await followUp.syncTradeShowFollowUp(f.tx, null, lead(), 99);
  const customDue = new Date('2026-11-20T12:00:00Z'); f.tasks[0].dueDate = customDue;
  await followUp.syncTradeShowFollowUp(f.tx, lead(), lead({ sourceCompany: 'New company', productInterest: 'Other' }), 99);
  assert.equal(f.tasks.length, 1); assert.equal(f.tasks[0].dueDate, customDue); assert.equal(f.events.length, 1);
});

test('open auto Task moves to new rep without changing due date or touching manual Task', async () => {
  const f = fixture(); await followUp.syncTradeShowFollowUp(f.tx, null, lead(), 99);
  f.tasks.push({ id: 2, source: null, tradeShowLeadId: 12, assignedToId: 7, status: 'OPEN', archivedAt: null });
  f.tasks[0].dueDate = new Date('2026-11-20T12:00:00Z');
  await followUp.syncTradeShowFollowUp(f.tx, lead(), lead({ assignedSalesRepUserId: 8 }), 99);
  assert.equal(f.tasks[0].assignedToId, 8); assert.equal(f.tasks[0].originalAssigneeId, 7);
  assert.equal(f.tasks[0].dueDate.toISOString().slice(0, 10), '2026-11-20');
  assert.equal(f.tasks[1].assignedToId, 7); assert.deepEqual(f.events[1], { taskId: 1, fromUserId: 7, toUserId: 8, actorId: 99 });
});

test('completed Task remains history and reassignment creates a new active Task', async () => {
  const f = fixture(); await followUp.syncTradeShowFollowUp(f.tx, null, lead(), 99);
  f.tasks[0].status = 'COMPLETED';
  await followUp.syncTradeShowFollowUp(f.tx, lead(), lead({ assignedSalesRepUserId: 8 }), 99);
  assert.equal(f.tasks.length, 2); assert.equal(f.tasks[0].status, 'COMPLETED'); assert.equal(f.tasks[0].assignedToId, 7); assert.equal(f.tasks[1].assignedToId, 8);
  assert.equal(f.activityCount(), 0);
});

test('unassignment cancels open auto Task without deletion and leaves manual Tasks untouched', async () => {
  const f = fixture(); await followUp.syncTradeShowFollowUp(f.tx, null, lead(), 99);
  f.tasks.push({ id: 2, source: null, tradeShowLeadId: 12, assignedToId: 7, status: 'OPEN', archivedAt: null });
  await followUp.syncTradeShowFollowUp(f.tx, lead(), lead({ routing: 'MARKETING_FOLLOW_UP', assignedSalesRepUserId: null }), 99);
  assert.equal(f.tasks[0].status, 'CANCELLED'); assert.equal(f.tasks[1].status, 'OPEN'); assert.equal(f.tasks.length, 2);
});

test('ineligible assignee and Task write failure surface errors without creating invalid Task', async () => {
  const f = fixture(); f.setEligible(false);
  await assert.rejects(followUp.syncTradeShowFollowUp(f.tx, null, lead(), 99), /cannot receive Tasks/);
  assert.equal(f.tasks.length, 0);
  f.setEligible(true); f.setFailCreate(true);
  await assert.rejects(followUp.syncTradeShowFollowUp(f.tx, null, lead(), 99), /Task write failed/);
  assert.equal(f.tasks.length, 0);
});

test('migration is additive, has active source uniqueness, and never backfills historical leads', () => {
  const sql = fs.readFileSync(path.join(root, 'prisma/migrations/20260929120000_trade_show_follow_up_tasks/migration.sql'), 'utf8');
  assert.match(sql, /CREATE UNIQUE INDEX "Task_active_trade_show_follow_up_key"/);
  assert.match(sql, /"source" = 'TRADE_SHOW_LEAD_FOLLOW_UP'/);
  assert.doesNotMatch(sql, /INSERT INTO|UPDATE "TradeShowLead"|DELETE FROM/i);
});

test('assigned Sales sees Tasks through the normal scope and Read Only cannot edit', () => {
  const sales = { id: 7, role: 'SALES', active: true, archivedAt: null };
  const readOnly = { id: 8, role: 'READ_ONLY', active: true, archivedAt: null };
  assert.deepEqual(taskScope(sales), { assignedToId: 7 });
  assert.equal(can(sales, 'tasks.write'), true);
  assert.equal(can(readOnly, 'tasks.write'), false);
});
