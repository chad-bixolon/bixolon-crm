import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(import.meta.url);
Module._extensions['.ts'] = Module._extensions['.tsx'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, file);
const { caseHistoryPage, caseHistorySource, caseHistoryOptions, caseNoteForReading } = require(`${root}/lib/support-case-history.ts`);
const { caseHistoryView, caseNotePreviews } = require(`${root}/lib/support-case-timeline.ts`);
const actor = (role = 'SUPPORT') => ({ id: 7, role, active: true, archivedAt: null });
const at = new Date('2026-10-20T12:00:00Z');
const base = { supportCaseId: 1, actorId: 7, actor: { firstName: 'Sam', lastName: 'Support' }, source: 'CRM', createdAt: at, oldValue: null, oldLabel: null, newLabel: null };
function fixture({ visible = true, status = 'OPEN', archivedAt = null } = {}) {
  const queries = [], calls = [];
  const initial = [{ ...base, id: 1, field: 'CREATED', newValue: null }, { ...base, id: 2, field: 'subject', newValue: 'Original issue' }];
  const tx = {
    supportCase: { findFirst: async args => { calls.push(['case', args]); return visible ? { id: 1, caseNumber: 'BXS-TEST', subject: 'History Case', createdAt: at, status, archivedAt } : null; } },
    supportCaseLifecycleEvent: { findMany: async args => { calls.push(['lifecycle', args]); return args.orderBy ? initial : [{ ...base, id: 81, field: 'TASK_COMPLETED', source: 'TASK:99', newValue: '{"status":"COMPLETED"}', newLabel: 'Check logs' }]; } },
    task: { findMany: async args => { calls.push(['task', args]); return []; } },
    $queryRaw: async query => {
      queries.push(query);
      if (query.sql.includes('count(*)')) return [{ count: 52n }];
      if (query.sql.includes('SELECT key, id')) return [{ key: 'history-81', id: 81, at, model: 'lifecycle' }];
      return [];
    },
  };
  return { tx, calls, queries, $transaction: async (fn, options) => { assert.equal(options.isolationLevel, 'RepeatableRead'); return fn(tx); } };
}

test('pagination options reject arrays, unsafe numbers and unknown filter input', () => {
  assert.deepEqual(caseHistoryOptions({ page: '2', type: 'notes' }), { page: 2, type: 'notes' });
  for (const page of ['0', '-1', '1e3', '99999999999999999999999', ['2'], undefined]) assert.equal(caseHistoryOptions({ page }).page, 1);
  assert.equal(caseHistoryOptions({ type: 'toString' }).type, 'all');
  assert.equal(caseHistoryOptions({ type: 'unknown' }).type, 'all');
  assert.equal(caseHistoryOptions({ type: ['notes'] }).type, 'all');
});

test('history pages keys in SQL with exact counts, stable order and bounded hydration; deleted Task stays neutral', async () => {
  for (const [requested, expected, offset] of [['1', 1, 0], ['2', 2, 25], ['3', 3, 50], ['999', 3, 50]]) {
    const db = fixture(), result = await caseHistoryPage(db, actor(), 1, { page: requested, type: 'tasks' });
    assert.equal(result.count, 52); assert.equal(result.pages, 3); assert.equal(result.page, expected);
    const query = db.queries[1];
    assert.match(query.sql, /ORDER BY at DESC, key COLLATE "C" DESC LIMIT \? OFFSET \?/);
    assert.deepEqual(query.values.slice(-2), [25, offset]);
    assert.ok(query.values.includes('tasks'));
    assert.ok(db.calls.every(([, args]) => !args.take || args.take <= 25));
    assert.equal(result.items.length, 1); assert.equal(result.items[0].title, 'Task completed');
    assert.equal(result.items[0].href, undefined); assert.equal(result.items[0].unavailable, 'Task unavailable');
    assert.doesNotMatch(JSON.stringify(result.items), /\{"status"|TASK:/);
  }
});

test('creation grouping and completion de-duplication are applied to the lifetime SQL before paging/counting', async () => {
  const db = fixture(); await caseHistoryPage(db, actor(), 1);
  const query = db.queries[0];
  assert.match(query.sql, /e.id NOT IN/); assert.ok(query.values.includes(2));
  const sql = caseHistorySource(1, []).sql;
  for (const source of ['SupportCaseLifecycleEvent', 'Activity', 'Task', 'Note', 'SupportCaseAttachment', 'SupportCaseEmail']) assert.ok(sql.includes(`"${source}"`));
  assert.match(sql, /NOT EXISTS.*SELECT 1 FROM "SupportCaseLifecycleEvent"/s);
  assert.match(sql, /e\."createdAt" = t\."completedAt"/);
});

test('closed and archived Cases remain readable under exactly the existing Case scope', async () => {
  for (const role of ['SUPPORT', 'ADMIN', 'SALES', 'SALES_MANAGER', 'MARKETING_MANAGER', 'READ_ONLY']) {
    const db = fixture({ status: 'CLOSED', archivedAt: at });
    const result = await caseHistoryPage(db, actor(role), 1);
    assert.equal(result.row.status, 'CLOSED'); assert.equal(result.row.archivedAt, at);
    const where = db.calls[0][1].where;
    assert.equal(where.archivedAt, undefined);
    assert.deepEqual(where.accountId, ['SUPPORT', 'ADMIN'].includes(role) ? undefined : { not: null });
  }
});

test('denied/invisible Cases cannot query any history; inactive impersonated actors are denied', async () => {
  const db = fixture({ visible: false });
  assert.equal(await caseHistoryPage(db, actor('SALES'), 1), null); assert.equal(db.queries.length, 0);
  for (const current of [{ ...actor(), active: false }, { ...actor('ADMIN'), archivedAt: at }]) await assert.rejects(caseHistoryPage(db, current, 1), /Access denied/);
  assert.equal(await caseHistoryPage(db, actor(), -1), null);
});

test('full Note read is parent-scoped, read-only, supports long formatted text and never uses the edit service', async () => {
  const body = `${'Long note '.repeat(1000)}\n\n  Indented diagnostic line\nEND OF NOTE`;
  const calls = [];
  const db = { note: { findFirst: async args => { calls.push(args); return args.where.id === 9 && args.where.supportCaseId === 1 ? { id: 9, body, createdAt: at, supportCase: { id: 1 } } : null; } } };
  for (const role of ['SUPPORT', 'ADMIN', 'READ_ONLY', 'SALES']) {
    assert.equal((await caseNoteForReading(db, actor(role), 1, 9)).body, body);
    const args = calls.at(-1);
    assert.equal(args.where.archivedAt, null); assert.equal(args.select.body, true);
    assert.deepEqual(args.where.supportCase.is, ['SUPPORT', 'ADMIN'].includes(role) ? {} : { accountId: { not: null } });
  }
  assert.equal(await caseNoteForReading(db, actor(), 2, 9), null);
  assert.equal(await caseNoteForReading(db, actor(), 1, 0), null);
});

test('Note previews truncate in PostgreSQL for recent and paginated history, with no full-body select', async () => {
  const queries = [], db = { $queryRaw: async query => { queries.push(query); return []; } };
  await caseNotePreviews(db, 1);
  await caseNotePreviews(db, 1, [3, 4]);
  await caseNotePreviews(db, 1, []);
  assert.equal(queries.length, 2);
  for (const query of queries) { assert.match(query.sql, /left\(n.body, 241\) AS body/); assert.doesNotMatch(query.sql, /SELECT n\.\*/); }
  assert.equal(queries[0].values.at(-1), 40); assert.equal(queries[1].values.at(-1), 2);
});

test('recent Case work and lifecycle limits remain fixed even with many entries', async () => {
  const calls = [];
  const empty = { findMany: async args => { calls.push(args); return []; } };
  const db = { supportCaseLifecycleEvent: empty, activity: empty, task: empty, supportCaseAttachment: empty, supportCaseEmail: empty, $queryRaw: async query => { assert.equal(query.values.at(-1), 40); return Array.from({ length: 40 }, (_, id) => ({ id, createdAt: at, body: 'preview', createdBy: null })); } };
  const view = await caseHistoryView(db, 1, at, 'UTC', true);
  assert.ok(view.timeline.length <= 80); assert.equal(view.timeline.length, 40);
  assert.deepEqual(calls.map(call => call.take), [81, 40, 40, 40, 40, 24]);
  assert.ok(view.timeline.every(item => item.noteHref.startsWith('/support/cases/1/notes/')));
});

// Render the same Note link and neutral unavailable states used in both history views.
const original = Module._load;
Module._load = function(name, parent, isMain) {
  if (name === 'next/link') return { __esModule: true, default: ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children) };
  if (name.startsWith('@/')) return require(path.join(root, name.slice(2)));
  return original.call(this, name, parent, isMain);
};
const { CaseTimelineEntry } = require(`${root}/components/support-case-timeline.tsx`);
test('full Note link is a read-only Case route, with no edit controls or raw HTML', () => {
  const html = renderToStaticMarkup(React.createElement(CaseTimelineEntry, { zone: 'UTC', item: { key: 'note-9', at, source: 'Note', title: 'Note added', detail: '<script>unsafe</script>', noteHref: '/support/cases/1/notes/9' } }));
  assert.match(html, /View full note/); assert.match(html, /href="\/support\/cases\/1\/notes\/9"/);
  assert.doesNotMatch(html, /\/edit|<script>|<form/);
  assert.match(html, /&lt;script&gt;/);
});
