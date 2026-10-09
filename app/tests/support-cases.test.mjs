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
const service = require(path.join(root, 'lib/support-cases.ts'));
const category = require(path.join(root, 'lib/support-case-categories.ts'));
const { can, routeAccess } = require(path.join(root, 'lib/authorization.ts'));
const { eligibleUserWhere } = require(path.join(root, 'lib/assignment-eligibility.ts'));
const actor = role => ({ id: role === 'ADMIN' ? 1 : 2, role, active: true, archivedAt: null });
const input = { accountId: 11, subject: 'Printer stops', description: 'Error at startup', source: 'PHONE' };
function fixture() {
  const sequenceByYear = new Map(); let nextId = 0;
  const rows = new Map(), events = [], notifications = [];
  const tx = {
    account: { findFirst: async ({ where }) => [11, 21, 22].includes(where.id) && where.archivedAt === null && where.status === 'ACTIVE' ? { id: where.id } : null, findMany: async () => [{ id: 11, name: 'Customer' }, { id: 21, name: 'CDW Corporation' }, { id: 22, name: 'POSGuys' }] },
    contact: { findFirst: async ({ where }) => where.id === 12 && where.accountId === 11 ? { id: 12 } : null, findMany: async () => [{ id: 12, firstName: 'Jane', lastName: 'Smith' }] },
    supportCaseCategory: { findFirst: async ({ where }) => where.id === 13 ? { id: 13 } : null, findMany: async () => [{ id: 13, name: 'Hardware' }] },
    productSku: { findFirst: async ({ where }) => where.id === 14 ? { id: 14 } : null, findMany: async () => [{ id: 14, partNumber: 'SKU-14' }] },
    user: { findFirst: async ({ where }) => where.id === 2 ? { id: 2 } : null, findMany: async () => [{ id: 2, firstName: 'Support', lastName: 'Rep' }] },
    $queryRaw: async (strings, year) => {
      if (!String(strings[0]).startsWith('INSERT')) return [{ id: 1 }];
      const lastNumber = (sequenceByYear.get(year) ?? 0) + 1;
      sequenceByYear.set(year, lastNumber);
      return [{ lastNumber }];
    },
    supportCase: {
      create: async ({ data }) => { const row = { id: ++nextId, status: 'NEW', priority: 'NORMAL', contactId: null, categoryId: null, assignedToId: null, productSkuId: null, serialNumber: null, purchaseSourceText: null, purchasedFromAccountId: null, nextFollowUpAt: null, resolvedAt: null, closedAt: null, resolutionSummary: null, archivedAt: null, ...data }; rows.set(row.id, row); return row; },
      findUnique: async ({ where }) => rows.get(where.id) ?? null,
      update: async ({ where, data }) => { const row = { ...rows.get(where.id), ...data }; rows.set(row.id, row); return row; },
      findFirst: async ({ where }) => {
        const row = rows.get(where.id) ?? null;
        return where.archivedAt === null && row?.archivedAt || where.accountId?.not === null && row?.accountId == null ? null : row;
      },
      findMany: async () => [...rows.values()], count: async () => rows.size,
    },
    supportCaseLifecycleEvent: { createMany: async ({ data }) => { for(const event of data) events.push({ ...event, id: events.length + 1 }); }, findMany: async ({ take }) => events.slice(-take).reverse() },
    notification: { findMany: async () => [], createMany: async ({data}) => {notifications.push(...data);return { count: data.length };}, updateMany: async () => ({ count: 0 }) },
  };
  return { db: { ...tx, $transaction: async fn => fn(tx) }, rows, events, notifications };
}
async function withFixedDate(iso, callback) {
  const OriginalDate = globalThis.Date;
  globalThis.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [iso])); }
  };
  try { return await callback(); } finally { globalThis.Date = OriginalDate; }
}
test('Support role and existing CRM permissions remain separate', () => {
  for (const permission of ['accounts.read', 'contacts.read', 'products.read', 'support-cases.read', 'support-cases.write']) assert.equal(can(actor('SUPPORT'), permission), true);
  for (const permission of ['sales-plan.manage', 'sales.write', 'products.write', 'users.manage', 'pricing.read', 'projects.read']) assert.equal(can(actor('SUPPORT'), permission), false);
  for (const role of ['SALES', 'SALES_MANAGER', 'READ_ONLY', 'MARKETING_MANAGER']) { assert.equal(can(actor(role), 'support-cases.read'), true); assert.equal(can(actor(role), 'support-cases.write'), false); }
  assert.equal(can(actor('ADMIN'), 'support-cases.write'), true);
  assert.equal(can(actor('SUPPORT'), 'support-categories.manage'), false);
  assert.equal(routeAccess('/administration', actor('SUPPORT')), 'denied');
  assert.equal(routeAccess('/sales-plan', actor('SUPPORT')), 'denied');
  assert.deepEqual(eligibleUserWhere('support-cases.write').role.in.sort(), ['ADMIN', 'SUPPORT']);
});
test('creation validates Account and relationships and records baseline', async () => {
  const f = fixture();
  await assert.rejects(service.createSupportCase(f.db, actor('SUPPORT'), { ...input, accountId: 99 }), /active Account/);
  await assert.rejects(service.createSupportCase(f.db, actor('SUPPORT'), { ...input, contactId: 99 }), /Contact/);
  await assert.rejects(service.createSupportCase(f.db, actor('SUPPORT'), { ...input, categoryId: 99 }), /category/);
  await assert.rejects(service.createSupportCase(f.db, actor('SUPPORT'), { ...input, productSkuId: 99 }), /Product\/SKU/);
  await assert.rejects(service.createSupportCase(f.db, actor('SALES'), input), /Access denied/);
  const row = await service.createSupportCase(f.db, actor('SUPPORT'), { ...input, contactId: 12, categoryId: 13, productSkuId: 14, serialNumber: 'SN-1', assignedToId: 2, caseNumber: 'tampered' });
  assert.match(row.caseNumber, /^BXS-\d{4}-000001$/);
  assert.equal(row.status, 'NEW'); assert.equal(row.priority, 'NORMAL'); assert.equal(row.serialNumber, 'SN-1');
  assert.equal(f.events[0].field, 'CREATED');
  for (const field of ['accountId', 'contactId', 'categoryId', 'productSkuId', 'assignedToId', 'source', 'serialNumber']) assert.ok(f.events.some(e => e.field === field && e.actorId === 2));
  assert.equal(f.events.find(e => e.field === 'accountId').newLabel, 'Customer');
});
test('direct New, Open, Resolved, and Closed creation uses one atomic baseline', async () => {
  const f = fixture();
  for (const status of ['NEW', 'OPEN']) {
    const row = await service.createSupportCase(f.db, actor('SUPPORT'), { ...input, status });
    assert.equal(row.status, status);
    assert.equal(row.resolvedAt, null);
    assert.equal(row.closedAt, null);
  }
  for (const status of ['RESOLVED', 'CLOSED']) {
    const before = f.events.length;
    const row = await service.createSupportCase(f.db, actor('SUPPORT'), { ...input, status, assignedToId: 2, priority: 'CRITICAL', resolutionSummary: 'Replaced cable during intake', nextFollowUpAt: new Date('2026-10-01T10:00:00Z') });
    const events = f.events.slice(before);
    assert.equal(row.status, status);
    assert.equal(row.resolutionSummary, 'Replaced cable during intake');
    assert.equal(row.nextFollowUpAt, null);
    assert.equal(row.resolvedAt?.getTime() ?? null, status === 'RESOLVED' ? row.openedAt.getTime() : null);
    assert.equal(row.closedAt?.getTime() ?? null, status === 'CLOSED' ? row.openedAt.getTime() : null);
    assert.equal(events[0].field, 'CREATED');
    assert.ok(events.some(e => e.field === 'status' && e.oldValue === null && e.newValue === status));
    assert.ok(events.some(e => e.field === 'resolutionSummary' && e.newValue === 'Replaced cable during intake'));
    assert.equal(events.some(e => e.field === 'status' && e.oldValue === 'NEW'), false);
    assert.equal(f.notifications.length, 0);
  }
});
test('create and edit require a resolution summary for Resolved or Closed', async () => {
  const f = fixture();
  for (const status of ['RESOLVED', 'CLOSED']) {
    await assert.rejects(service.createSupportCase(f.db, actor('SUPPORT'), { ...input, status, resolutionSummary: '  ' }), /Resolution Summary is required/);
  }
  const row = await service.createSupportCase(f.db, actor('SUPPORT'), input);
  for (const status of ['RESOLVED', 'CLOSED']) {
    await assert.rejects(service.updateSupportCase(f.db, actor('SUPPORT'), row.id, { status }), /Resolution Summary is required/);
  }
  await service.updateSupportCase(f.db, actor('SUPPORT'), row.id, { status: 'RESOLVED', resolutionSummary: 'Fixed during callback' });
  await service.updateSupportCase(f.db, actor('SUPPORT'), row.id, { status: 'CLOSED' });
  assert.equal(f.rows.get(row.id).resolutionSummary, 'Fixed during callback');
});
test('counter SQL assigns distinct numbers across concurrent creations', async () => {
  const f = fixture();
  const rows = await withFixedDate('2026-10-08T12:00:00Z', () => Promise.all([service.createSupportCase(f.db, actor('SUPPORT'), input), service.createSupportCase(f.db, actor('SUPPORT'), input)]));
  assert.equal(new Set(rows.map(row => row.caseNumber)).size, 2);
  assert.deepEqual(rows.map(row => row.caseNumber).sort(), ['BXS-2026-000001', 'BXS-2026-000002']);
  const migration = fs.readFileSync(path.join(root, 'prisma/migrations/20261008120000_support_case_foundation/migration.sql'), 'utf8');
  assert.match(migration, /CREATE UNIQUE INDEX "SupportCase_caseNumber_key"/);
  assert.match(migration, /support_case_immutable_number/);
  assert.match(migration, /support_case_event_append_only/);
});
test('Support lifecycle sends one Critical assignment notice and a reopen notice to its assignee', async () => {
  const f = fixture();
  const critical = await service.createSupportCase(f.db, actor('SUPPORT'), { ...input, assignedToId: 2, priority: 'CRITICAL' });
  assert.deepEqual(f.notifications.map(n => n.type), ['SUPPORT_CRITICAL']);
  assert.equal(f.notifications[0].userId, 2);
  assert.match(f.notifications[0].sourceKey, new RegExp(`^SUPPORT:${critical.id}:2:CRITICAL:`));
  await service.changeSupportCaseStatus(f.db, actor('SUPPORT'), critical.id, 'RESOLVED', 'Resolved issue');
  await service.changeSupportCaseStatus(f.db, actor('SUPPORT'), critical.id, 'OPEN');
  assert.deepEqual(f.notifications.map(n => n.type), ['SUPPORT_CRITICAL','SUPPORT_REOPENED']);
});
test('counter resets each UTC year without changing prior numbers', async () => {
  const f = fixture();
  const first = await withFixedDate('2026-12-31T23:59:59Z', () => service.createSupportCase(f.db, actor('SUPPORT'), input));
  const nextYear = await withFixedDate('2027-01-01T00:00:00Z', () => service.createSupportCase(f.db, actor('SUPPORT'), input));
  const second = await withFixedDate('2026-12-31T23:59:59Z', () => service.createSupportCase(f.db, actor('SUPPORT'), input));
  assert.deepEqual([first.caseNumber, nextYear.caseNumber, second.caseNumber], ['BXS-2026-000001', 'BXS-2027-000001', 'BXS-2026-000002']);
});
test('archived historical SUP numbers remain readable with their lifecycle history', async () => {
  const f = fixture();
  const row = await service.createSupportCase(f.db, actor('SUPPORT'), input);
  const originalEventCount = f.events.length;
  f.rows.set(row.id, { ...row, caseNumber: 'SUP-2026-000001', archivedAt: new Date('2026-10-08T12:00:00Z') });
  assert.equal(await service.getSupportCaseById(f.db, actor('SUPPORT'), row.id), null);
  assert.equal((await service.getSupportCaseById(f.db, actor('SUPPORT'), row.id, true)).caseNumber, 'SUP-2026-000001');
  assert.equal(f.events.length, originalEventCount);
});
test('status, field edits, no-op, archive, and restore are audited', async () => {
  const f = fixture(); const row = await service.createSupportCase(f.db, actor('SUPPORT'), input); f.events.length = 0;
  await service.updateSupportCase(f.db, actor('SUPPORT'), row.id, { priority: 'HIGH', assignedToId: 2, contactId: 12, categoryId: 13, productSkuId: 14, nextFollowUpAt: new Date('2026-10-10T12:00:00Z') });
  for (const field of ['priority', 'assignedToId', 'contactId', 'categoryId', 'productSkuId', 'nextFollowUpAt']) assert.ok(f.events.some(e => e.field === field));
  const length = f.events.length;
  await service.updateSupportCase(f.db, actor('SUPPORT'), row.id, { priority: 'HIGH' }); assert.equal(f.events.length, length);
  await service.changeSupportCaseStatus(f.db, actor('SUPPORT'), row.id, 'RESOLVED', 'Replaced cable');
  assert.ok(f.rows.get(row.id).resolvedAt); assert.ok(f.events.some(e => e.field === 'resolutionSummary'));
  await service.changeSupportCaseStatus(f.db, actor('SUPPORT'), row.id, 'CLOSED'); assert.ok(f.rows.get(row.id).closedAt);
  await service.changeSupportCaseStatus(f.db, actor('SUPPORT'), row.id, 'OPEN'); assert.equal(f.rows.get(row.id).closedAt, null); assert.equal(f.rows.get(row.id).resolvedAt, null);
  await service.archiveSupportCase(f.db, actor('SUPPORT'), row.id); assert.ok(f.rows.get(row.id).archivedAt);
  await assert.rejects(service.updateSupportCase(f.db, actor('SUPPORT'), row.id, { subject: 'x' }), /Restore/);
  await service.restoreSupportCase(f.db, actor('SUPPORT'), row.id); assert.equal(f.rows.get(row.id).archivedAt, null);
  assert.ok(f.events.some(e => e.source === 'ARCHIVE'));
  assert.ok(f.events.some(e => e.source === 'RESTORE'));
});
test('category configuration is Admin only', async () => {
  const db = { supportCaseCategory: { create: async ({ data }) => data, update: async ({ data }) => data } };
  await assert.rejects(category.saveSupportCaseCategory(db, actor('SUPPORT'), { name: 'Hardware', sortOrder: 0, active: true }), /Access denied/);
  assert.equal((await category.saveSupportCaseCategory(db, actor('ADMIN'), { name: ' Hardware ', sortOrder: 0, active: true })).name, 'Hardware');
});
test('category administration saves name, activation, and order without deleting historical rows', async () => {
  const rows = new Map(); let nextId = 0;
  const db = { supportCaseCategory: {
    create: async ({ data }) => { const row = { id: ++nextId, ...data }; rows.set(row.id, row); return row; },
    update: async ({ where, data }) => { const row = { ...rows.get(where.id), ...data }; rows.set(row.id, row); return row; },
  } };
  const admin = actor('ADMIN');
  const first = await category.saveSupportCaseCategory(db, admin, { name: ' Hardware ', sortOrder: 10, active: true });
  const second = await category.saveSupportCaseCategory(db, admin, { name: 'Software', sortOrder: 20, active: true });
  assert.deepEqual([first.name, second.name], ['Hardware', 'Software']);
  await category.saveSupportCaseCategory(db, admin, { name: 'Device hardware', sortOrder: 0, active: false }, first.id);
  await category.saveSupportCaseCategory(db, admin, { name: 'Software', sortOrder: 5, active: true }, second.id);
  assert.equal(rows.get(first.id).name, 'Device hardware'); assert.equal(rows.get(first.id).active, false); assert.equal(rows.get(first.id).sortOrder, 0);
  assert.equal(rows.get(second.id).sortOrder, 5); assert.equal(rows.size, 2);
  await category.saveSupportCaseCategory(db, admin, { name: 'Device hardware', sortOrder: 0, active: true }, first.id);
  assert.equal(rows.get(first.id).active, true);
  await assert.rejects(category.saveSupportCaseCategory(db, actor('SALES'), { name: 'Unauthorized', sortOrder: 0, active: true }), /Access denied/);
});
test('read services gate by role and preserve Account visibility policy', async () => {
  const f = fixture(); const row = await service.createSupportCase(f.db, actor('SUPPORT'), input);
  assert.equal((await service.getSupportCaseById(f.db, actor('SALES'), row.id)).id, row.id);
  assert.equal((await service.listSupportCases(f.db, actor('SALES_MANAGER'))).count, 1);
  await assert.rejects(service.updateSupportCase(f.db, actor('SALES'), row.id, { priority: 'CRITICAL' }), /Access denied/);
  await assert.rejects(service.archiveSupportCase(f.db, actor('MARKETING_MANAGER'), row.id), /Access denied/);
  await assert.rejects(service.restoreSupportCase(f.db, actor('READ_ONLY'), row.id), /Access denied/);
  await assert.rejects(service.getSupportCaseById(f.db, { ...actor('SUPPORT'), active: false }, row.id), /Access denied/);
  assert.deepEqual(service.supportCaseReadWhere(actor('SALES')), { accountId: { not: null }, archivedAt: null });
});
test('unresolved customer can be opened and later linked without losing intake text', async () => {
  const f = fixture();
  await assert.rejects(service.createSupportCase(f.db, actor('SUPPORT'), { ...input, accountId: null }), /Enter a customer\/end user/);
  const raw = await service.createSupportCase(f.db, actor('SUPPORT'), { ...input, accountId: null, customerNameText: '  ABC Restaurant Group  ' });
  assert.equal(raw.customerNameText, 'ABC Restaurant Group');
  assert.equal(raw.accountId, null);
  assert.equal(raw.contactId, null);
  assert.equal((await service.getSupportCaseById(f.db, actor('SALES'), raw.id)), null);
  assert.equal((await service.getSupportCaseById(f.db, actor('SUPPORT'), raw.id)).id, raw.id);
  await service.updateSupportCase(f.db, actor('SUPPORT'), raw.id, { accountId: 11 });
  assert.equal(f.rows.get(raw.id).customerNameText, 'ABC Restaurant Group');
  assert.equal(f.events.find(e => e.field === 'customerNameText').newValue, 'ABC Restaurant Group');
  assert.equal(f.events.find(e => e.field === 'accountId').newLabel, 'Customer');
  assert.equal((await service.getSupportCaseById(f.db, actor('SALES'), raw.id)).id, raw.id);
  await assert.rejects(service.updateSupportCase(f.db, actor('SUPPORT'), raw.id, { accountId: null, customerNameText: null }), /Enter a customer\/end user/);
});
test('Account changes require a Contact on the new Account; status transitions are conservative', async () => {
  const f = fixture(); const row = await service.createSupportCase(f.db, actor('SUPPORT'), { ...input, contactId: 12 });
  await assert.rejects(service.updateSupportCase(f.db, actor('SUPPORT'), row.id, { accountId: 99 }), /active Account/);
  assert.equal(service.validSupportTransition('CLOSED', 'WAITING_ON_CUSTOMER'), false);
  await service.changeSupportCaseStatus(f.db, actor('SUPPORT'), row.id, 'CLOSED', 'Closed issue');
  await assert.rejects(service.changeSupportCaseStatus(f.db, actor('SUPPORT'), row.id, 'WAITING_ON_CUSTOMER'), /transition/);
  await service.updateSupportCase(f.db, actor('SUPPORT'), row.id, { serialNumber: 'SN-2', subject: 'Updated', description: 'More details', source: 'EMAIL' });
  for (const field of ['serialNumber', 'subject', 'description', 'source']) assert.ok(f.events.some(e => e.field === field));
  assert.equal(f.rows.get(row.id).caseNumber, row.caseNumber);
  const eventCount = f.events.length;
  await service.updateSupportCase(f.db, actor('SUPPORT'), row.id, { caseNumber: 'SUP-2026-999999' });
  assert.equal(f.rows.get(row.id).caseNumber, row.caseNumber);
  assert.equal(f.events.length, eventCount);
});

test('Purchased From accepts neither, text, link, or both without changing the customer Account', async () => {
  const f = fixture();
  const variants = [{}, { purchaseSourceText: '  Local reseller  ' }, { purchasedFromAccountId: 21 }, { purchaseSourceText: '  CDW-G ', purchasedFromAccountId: 21 }];
  for (const variant of variants) {
    const row = await service.createSupportCase(f.db, actor('SUPPORT'), { ...input, ...variant });
    assert.equal(row.accountId, 11);
    assert.equal(row.purchaseSourceText, variant.purchaseSourceText?.trim() ?? null);
    assert.equal(row.purchasedFromAccountId, variant.purchasedFromAccountId ?? null);
  }
  assert.equal(f.events.find(e => e.field === 'purchasedFromAccountId').newLabel, 'CDW Corporation');
  assert.ok(f.events.some(e => e.field === 'purchaseSourceText' && e.newValue === 'CDW-G'));
  await assert.rejects(service.createSupportCase(f.db, actor('SUPPORT'), { ...input, purchasedFromAccountId: 99 }), /active purchased-from Account/);
  await assert.rejects(service.createSupportCase(f.db, actor('SUPPORT'), { ...input, purchaseSourceText: 'x'.repeat(501) }), /Purchased From/);
});

test('Purchased From sparse edits audit text and Account names; no-op and permissions stay quiet', async () => {
  const f = fixture();
  const row = await service.createSupportCase(f.db, actor('SUPPORT'), input);
  f.events.length = 0;
  await service.updateSupportCase(f.db, actor('SUPPORT'), row.id, { purchaseSourceText: '  CDW-G  ' });
  await service.updateSupportCase(f.db, actor('SUPPORT'), row.id, { purchasedFromAccountId: 21 });
  await service.updateSupportCase(f.db, actor('SUPPORT'), row.id, { purchasedFromAccountId: 22 });
  await service.updateSupportCase(f.db, actor('SUPPORT'), row.id, { purchasedFromAccountId: null });
  const count = f.events.length;
  await service.updateSupportCase(f.db, actor('SUPPORT'), row.id, { purchaseSourceText: 'CDW-G', purchasedFromAccountId: null });
  assert.equal(f.events.length, count);
  assert.deepEqual(f.events.filter(e => e.field === 'purchasedFromAccountId').map(e => [e.oldLabel, e.newLabel]), [[null, 'CDW Corporation'], ['CDW Corporation', 'POSGuys'], ['POSGuys', null]]);
  assert.deepEqual(f.events.filter(e => e.field === 'purchaseSourceText').map(e => [e.oldValue, e.newValue]), [[null, 'CDW-G']]);
  assert.equal(f.rows.get(row.id).accountId, 11);
  assert.equal(f.rows.get(row.id).purchaseSourceText, 'CDW-G');
  await assert.rejects(service.updateSupportCase(f.db, actor('SALES'), row.id, { purchaseSourceText: 'Other' }), /Access denied/);
  await assert.rejects(service.updateSupportCase(f.db, actor('SUPPORT'), row.id, { purchasedFromAccountId: 99 }), /active purchased-from Account/);
  assert.equal(f.events.length, count);
});
