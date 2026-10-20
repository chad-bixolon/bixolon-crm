import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const ext of ['.ts', '.tsx']) Module._extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(import.meta.url);
const { tradeShowQueueSql, loadTradeShowQueue, canViewTradeShowFollowUpQueue } = require(path.join(root, 'lib/trade-show-queue.ts'));
const { TradeShowFollowUpTask } = require(path.join(root, 'components/trade-show-follow-up-task.tsx'));
const { normalizeSavedQuery, savedQueryHref, canUseSavedViews } = require(path.join(root, 'lib/saved-views.ts'));
const { taskDuePeriodBounds } = require(path.join(root, 'lib/task-due-period.ts'));
const { resolveUserContext } = require(path.join(root, 'lib/dev-impersonation.ts'));
const { can } = require(path.join(root, 'lib/authorization.ts'));
const actor = (role = 'SALES', id = 7) => ({ id, role, active: true, archivedAt: null });
const now = new Date('2026-10-19T17:00:00Z');

test('queue rows show related open/completed Task and neutral no Task state without internal IDs', () => {
  const task = { id: 123456, subject: 'Call Jane', status: 'OPEN', dueDate: new Date('2026-10-18T12:00:00Z'), assignedTo: { firstName: 'Sales', lastName: 'Rep' } };
  const render = task => renderToStaticMarkup(React.createElement(TradeShowFollowUpTask, { task, now }));
  assert.match(render(task), /Call Jane.*Open.*Overdue.*Task due: 2026-10-18.*Task assignee: Sales Rep.*Open Task/);
  assert.match(render(task), /href="\/tasks\/123456"/);
  assert.doesNotMatch(render(task), />123456</);
  assert.match(render({ ...task, status: 'COMPLETED' }), /Completed/);
  assert.doesNotMatch(render({ ...task, status: 'COMPLETED' }), /Overdue/);
  assert.match(render(undefined), /No follow-up Task/);
});

test('rolling periods reuse Task boundaries; status/date/owner filters target the same latest Task', () => {
  for (const period of ['overdue', 'today', 'next-7-days']) {
    const query = tradeShowQueueSql(actor(), { duePeriod: period, ownerId: '8', mine: 'yes', tradeShowId: '12', q: 'Acme' }, now);
    const bounds = taskDuePeriodBounds({ duePeriod: period }, now);
    for (const date of Object.values(bounds)) assert.ok(query.values.some(value => value instanceof Date && value.getTime() === date.getTime()));
    assert.match(query.sql, /ORDER BY id DESC LIMIT 1/);
    assert.match(query.sql, /t.status IN \('OPEN', 'IN_PROGRESS'\)/);
    assert.match(query.sql, /l\."assignedSalesRepUserId" = \?/);
    assert.match(query.sql, /t\."assignedToId" = \?/);
    assert.ok(query.values.includes(7)); assert.ok(query.values.includes(8)); assert.ok(query.values.includes(12));
    assert.doesNotMatch(query.sql, /followUpAt/);
  }
  assert.match(tradeShowQueueSql(actor(), { taskStatus: 'none' }).sql, /t.id IS NULL/);
  const completed = tradeShowQueueSql(actor(), { taskStatus: 'completed', duePeriod: 'today' }, now);
  assert.ok(completed.values.includes('COMPLETED'));
  assert.doesNotMatch(completed.sql, /IN \('OPEN'/);
});

test('Saved Views preserve queue context and relative meaning when reopened later, excluding pagination', () => {
  const state = { view: 'all', tradeShowId: '4', ownerId: '8', assignedToId: '9', mine: 'yes', taskStatus: 'open', duePeriod: 'next-7-days', dueFrom: '2026-10-01', dueTo: '2026-10-02', q: 'Jane', page: '5' };
  const saved = normalizeSavedQuery('trade-show-follow-up', state);
  assert.deepEqual(saved, { view: 'all', tradeShowId: '4', ownerId: '8', assignedToId: '9', mine: 'yes', taskStatus: 'open', duePeriod: 'next-7-days', q: 'Jane' });
  const href = savedQueryHref('trade-show-follow-up', JSON.parse(JSON.stringify(saved)));
  const reloaded = Object.fromEntries(new URL(href, 'https://example.test').searchParams);
  const early = tradeShowQueueSql(actor(), reloaded, now), later = tradeShowQueueSql(actor(), reloaded, new Date('2026-10-26T17:00:00Z'));
  assert.notDeepEqual(early.values.filter(value => value instanceof Date), later.values.filter(value => value instanceof Date));
  assert.equal(canUseSavedViews(actor('MARKETING_MANAGER'), 'trade-show-follow-up'), true);
  assert.equal(canUseSavedViews(actor('READ_ONLY'), 'trade-show-follow-up'), false);
});

test('count and paged query share filters/snapshot; only page IDs and one Task per row are hydrated', async () => {
  const calls = []; let options;
  const tx = { $queryRaw: async query => { calls.push(query); return calls.length === 1 ? [{ count: 41 }] : calls.length === 2 ? [{ id: 4 }] : []; }, tradeShowLead: { findMany: async args => { calls.push(args); return [{ id: 4 }]; } } };
  const db = { $transaction: async (run, opts) => { options = opts; return run(tx); } };
  const result = await loadTradeShowQueue(db, actor(), { page: '999', q: 'Jane', taskStatus: 'completed' }, now);
  assert.equal(result.count, 41); assert.equal(result.page, 3); assert.equal(result.pages, 3);
  assert.equal(options.isolationLevel, 'RepeatableRead');
  assert.ok(calls[0].values.includes('Jane')); assert.ok(calls[1].values.includes('Jane'));
  assert.match(calls[1].sql, /LIMIT 20 OFFSET/); assert.equal(calls[1].values.at(-1), 40);
  assert.deepEqual(calls[2].where, { id: { in: [4] } }); assert.match(calls[3].sql, /ORDER BY id DESC LIMIT 1/); assert.deepEqual(calls[3].values, [4]);
});

test('effective impersonated identity controls queue ownership and grants no bulk or Task editing rights', async () => {
  const real = actor('ADMIN', 1), target = { ...actor('SALES', 8), firstName: 'Rep', lastName: 'Two', email: 'rep@example.test' };
  const { effective } = await resolveUserContext(real, '8', { user: { findUnique: async () => target } }, { NODE_ENV: 'development', ENABLE_DEV_IMPERSONATION: 'true' });
  const sql = tradeShowQueueSql(effective, { view: 'all', mine: 'yes' });
  assert.deepEqual(sql.values.filter(value => typeof value === 'number'), [8, 8]);
  assert.equal(can(effective, 'trade-shows.assign'), false);
  assert.equal(canViewTradeShowFollowUpQueue(actor('READ_ONLY')), false);
  assert.equal(can(actor('READ_ONLY'), 'tasks.write'), false);
});
