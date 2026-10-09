import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compile = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
Module._extensions['.ts'] = compile;
Module._extensions['.tsx'] = compile;
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
  return resolveFilename.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...args);
};
const require = Module.createRequire(fileURLToPath(import.meta.url));
const { supportCaseListWhere, supportCaseListOrder, listSupportCases } = require(path.join(root, 'lib/support-cases.ts'));
const { supportAge, supportEventValue, supportHistoryItems } = require(path.join(root, 'lib/support-case-display.ts'));
const { SupportCaseHistory } = require(path.join(root, 'components/support-case-history.tsx'));
const { routeAccess } = require(path.join(root, 'lib/authorization.ts'));
const actor = role => ({ id: 1, role, active: true, archivedAt: null });
test('case list combines server filters, search, archive and database order', async () => {
  const from = new Date('2026-10-01T00:00:00Z'), to = new Date('2026-11-01T00:00:00Z');
  const where = supportCaseListWhere(actor('SUPPORT'), { assignedToId: 2, status: 'OPEN', priority: 'HIGH', categoryId: 3, account: 'Acme', product: 'SRP', openedFrom: from, openedTo: to, search: 'Smith' });
  assert.equal(where.archivedAt, null);
  assert.equal(where.assignedToId, 2); assert.equal(where.status, 'OPEN'); assert.equal(where.priority, 'HIGH'); assert.equal(where.categoryId, 3);
  assert.deepEqual(where.openedAt, { gte: from, lt: to });
  assert.equal(where.account.name.contains, 'Acme'); assert.equal(where.productSku.partNumber.contains, 'SRP');
  assert.equal(where.OR.length, 6);
  assert.equal(supportCaseListWhere(actor('SUPPORT'), { search: 'bxs-2026-000001' }).caseNumber, 'BXS-2026-000001');
  assert.deepEqual(supportCaseListWhere(actor('ADMIN'), { archive: 'archived' }).archivedAt, { not: null });
  assert.equal(supportCaseListWhere(actor('ADMIN'), { archive: 'all' }).archivedAt, undefined);
  assert.deepEqual(supportCaseListOrder('priority'), [{ priority: 'desc' }, { openedAt: 'desc' }, { id: 'desc' }]);
  assert.deepEqual(supportCaseListOrder(), [{ status: 'asc' }, { openedAt: 'desc' }, { id: 'desc' }]);
  let query;
  const db = { supportCase: { count: async () => 44, findMany: async args => { query = args; return []; } } };
  const page = await listSupportCases(db, actor('ADMIN'), { page: 3, sort: 'updated', search: 'BXS' });
  assert.equal(page.pages, 3); assert.equal(page.page, 3); assert.equal(query.skip, 40); assert.equal(query.take, 20);
  assert.deepEqual(query.orderBy, [{ updatedAt: 'desc' }, { id: 'desc' }]);
  assert.equal(query.where.OR[0].caseNumber.contains, 'BXS');
});
test('route access exposes read-only detail and blocks create/edit', () => {
  for (const role of ['SUPPORT', 'ADMIN']) assert.equal(routeAccess('/support/cases/new', actor(role)), 'allowed');
  for (const role of ['SALES', 'SALES_MANAGER', 'READ_ONLY', 'MARKETING_MANAGER']) { assert.equal(routeAccess('/support/cases', actor(role)), 'allowed'); assert.equal(routeAccess('/support/cases/1', actor(role)), 'allowed'); assert.equal(routeAccess('/support/cases/new', actor(role)), 'denied'); assert.equal(routeAccess('/support/cases/1/edit', actor(role)), 'denied'); }
  assert.equal(routeAccess('/administration/support-case-categories', actor('SUPPORT')), 'denied');
});
test('age stops when resolved or closed and history labels avoid raw reference IDs', () => {
  const opened = new Date('2026-10-01T00:00:00Z'), end = new Date('2026-10-03T00:00:00Z'), now = new Date('2026-10-15T00:00:00Z');
  assert.equal(supportAge(opened, 'OPEN', null, null, now), '14 days');
  assert.equal(supportAge(opened, 'RESOLVED', end, null, now), '2 days');
  assert.equal(supportAge(opened, 'CLOSED', end, end, now), '2 days');
  assert.equal(supportEventValue('assignedToId', '23', null, 'UTC'), 'Unavailable');
  assert.equal(supportEventValue('purchasedFromAccountId', '21', null, 'UTC'), 'Unavailable');
  assert.equal(supportEventValue('purchasedFromAccountId', '21', 'CDW Corporation', 'UTC'), 'CDW Corporation');
  assert.equal(supportEventValue('status', 'WAITING_ON_CUSTOMER', null, 'UTC'), 'Waiting on Customer');
});
test('creation history renders stored initial fields together while later edits stay separate', () => {
  const createdAt = new Date('2026-10-08T13:46:00Z');
  const actor = { firstName: 'Athan', lastName: 'Alcala' };
  const event = (id, field, newValue, changes = {}) => ({ id, supportCaseId: 4, field, oldValue: null, newValue, oldLabel: null, newLabel: null, actorId: 2, source: 'CRM', createdAt, actor, ...changes });
  const events = [
    event(1, 'CREATED', null),
    event(2, 'accountId', '7', { newLabel: '7-Eleven' }),
    event(3, 'subject', 'Media jam'),
    event(4, 'description', 'Store #302 called in with media jam issues. '.repeat(10)),
    event(5, 'status', 'NEW'),
    event(6, 'priority', 'NORMAL'),
    event(7, 'assignedToId', '23', { newLabel: 'Athan Alcala' }),
    event(8, 'productSkuId', '88', { newLabel: 'XL5-40CTWG/SEV' }),
    event(9, 'serialNumber', '1234567890123'),
    event(10, 'source', 'PHONE'),
    event(11, 'status', 'OPEN', { oldValue: 'NEW' }),
    event(12, 'priority', 'HIGH', { oldValue: 'NORMAL' }),
  ];
  const original = structuredClone(events);
  const items = supportHistoryItems(events, createdAt);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0].fields.map(field => field.field), events.slice(1, 10).map(field => field.field));
  assert.deepEqual(events, original);
  const html = renderToStaticMarkup(React.createElement(SupportCaseHistory, { events, caseCreatedAt: createdAt, viewerId: 2, zone: 'America/New_York' }));
  assert.equal((html.match(/<li /g) ?? []).length, 3);
  assert.match(html, /Case History \(12 events\)/);
  assert.match(html, /<strong>Case created<\/strong>/);
  for (const value of ['7-Eleven', 'Media jam', 'New', 'Normal', 'Athan Alcala', 'XL5-40CTWG/SEV', '1234567890123', 'Phone']) assert.ok(html.includes(value), value);
  assert.match(html, /Read full description/);
  assert.match(html, /<strong>Status<\/strong>/);
  assert.match(html, /New → Open/);
  assert.match(html, /<strong>Priority<\/strong>/);
  assert.match(html, /Normal → High/);
  assert.doesNotMatch(html, /<dt[^>]*>Contact<\/dt>|WAITING_ON_CUSTOMER|PHONE|>23<|>88</);
});
test('same timestamp alone does not join unrelated edits to creation', () => {
  const createdAt = new Date('2026-10-08T13:46:00Z');
  const base = { supportCaseId: 4, oldValue: null, oldLabel: null, newLabel: null, actorId: 2, source: 'CRM', createdAt, actor: { firstName: 'Athan', lastName: 'Alcala' } };
  const events = [
    { ...base, id: 1, field: 'CREATED', newValue: null },
    { ...base, id: 2, field: 'accountId', newValue: '7', newLabel: '7-Eleven' },
    { ...base, id: 3, field: 'subject', newValue: 'Media jam' },
    { ...base, id: 4, field: 'status', oldValue: 'NEW', newValue: 'OPEN' },
    { ...base, id: 5, field: 'priority', oldValue: 'NORMAL', newValue: 'HIGH' },
  ];
  assert.deepEqual(supportHistoryItems(events, createdAt).map(item => item.kind), ['creation', 'event', 'event']);
  assert.deepEqual(supportHistoryItems(events, new Date('2026-10-08T13:47:00Z')).map(item => item.kind), Array(5).fill('event'));
  assert.deepEqual(supportHistoryItems([events[0], { ...events[1], id: 3 }], createdAt).map(item => item.kind), ['creation', 'event']);
});
