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
  const rows = new Map(), events = [];
  const tx = {
    account: { findFirst: async ({ where }) => where.id === 11 ? { id: 11 } : null, findMany: async () => [{ id: 11, name: 'Customer' }] },
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
      create: async ({ data }) => { const row = { id: ++nextId, status: 'NEW', priority: 'NORMAL', contactId: null, categoryId: null, assignedToId: null, productSkuId: null, serialNumber: null, nextFollowUpAt: null, resolvedAt: null, closedAt: null, resolutionSummary: null, archivedAt: null, ...data }; rows.set(row.id, row); return row; },
      findUnique: async ({ where }) => rows.get(where.id) ?? null,
      update: async ({ where, data }) => { const row = { ...rows.get(where.id), ...data }; rows.set(row.id, row); return row; },
      findFirst: async ({ where }) => {
        const row = rows.get(where.id) ?? null;
        return where.archivedAt === null && row?.archivedAt ? null : row;
      },
      findMany: async () => [...rows.values()], count: async () => rows.size,
    },
    supportCaseLifecycleEvent: { createMany: async ({ data }) => { events.push(...data); } },
  };
  return { db: { ...tx, $transaction: async fn => fn(tx) }, rows, events };
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
  const row = await service.createSupportCase(f.db, actor('SUPPORT'), { ...input, contactId: 12, categoryId: 13, productSkuId: 14, serialNumber: 'SN-1', assignedToId: 2, status: 'CLOSED', caseNumber: 'tampered' });
  assert.match(row.caseNumber, /^BXS-\d{4}-000001$/);
  assert.equal(row.status, 'NEW'); assert.equal(row.priority, 'NORMAL'); assert.equal(row.serialNumber, 'SN-1');
  assert.equal(f.events[0].field, 'CREATED');
  for (const field of ['accountId', 'contactId', 'categoryId', 'productSkuId', 'assignedToId', 'source', 'serialNumber']) assert.ok(f.events.some(e => e.field === field && e.actorId === 2));
  assert.equal(f.events.find(e => e.field === 'accountId').newLabel, 'Customer');
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
test('read services gate by role and preserve Account visibility policy', async () => {
  const f = fixture(); const row = await service.createSupportCase(f.db, actor('SUPPORT'), input);
  assert.equal((await service.getSupportCaseById(f.db, actor('SALES'), row.id)).id, row.id);
  assert.equal((await service.listSupportCases(f.db, actor('SALES_MANAGER'))).count, 1);
  await assert.rejects(service.updateSupportCase(f.db, actor('SALES'), row.id, { priority: 'CRITICAL' }), /Access denied/);
  await assert.rejects(service.archiveSupportCase(f.db, actor('MARKETING_MANAGER'), row.id), /Access denied/);
  await assert.rejects(service.restoreSupportCase(f.db, actor('READ_ONLY'), row.id), /Access denied/);
  await assert.rejects(service.getSupportCaseById(f.db, { ...actor('SUPPORT'), active: false }, row.id), /Access denied/);
  assert.deepEqual(service.supportCaseReadWhere(actor('SALES')), { archivedAt: null });
});
test('Account changes require a Contact on the new Account; status transitions are conservative', async () => {
  const f = fixture(); const row = await service.createSupportCase(f.db, actor('SUPPORT'), { ...input, contactId: 12 });
  await assert.rejects(service.updateSupportCase(f.db, actor('SUPPORT'), row.id, { accountId: 99 }), /active Account/);
  assert.equal(service.validSupportTransition('CLOSED', 'WAITING_ON_CUSTOMER'), false);
  await service.changeSupportCaseStatus(f.db, actor('SUPPORT'), row.id, 'CLOSED');
  await assert.rejects(service.changeSupportCaseStatus(f.db, actor('SUPPORT'), row.id, 'WAITING_ON_CUSTOMER'), /transition/);
  await service.updateSupportCase(f.db, actor('SUPPORT'), row.id, { serialNumber: 'SN-2', subject: 'Updated', description: 'More details', source: 'EMAIL' });
  for (const field of ['serialNumber', 'subject', 'description', 'source']) assert.ok(f.events.some(e => e.field === field));
  assert.equal(f.rows.get(row.id).caseNumber, row.caseNumber);
  const eventCount = f.events.length;
  await service.updateSupportCase(f.db, actor('SUPPORT'), row.id, { caseNumber: 'SUP-2026-999999' });
  assert.equal(f.rows.get(row.id).caseNumber, row.caseNumber);
  assert.equal(f.events.length, eventCount);
});
