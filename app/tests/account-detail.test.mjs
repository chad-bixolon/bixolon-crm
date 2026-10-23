import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(import.meta.url);
Module._extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { loadAccountContext, loadAccountTab, resolveAccountTab, visibleAccountTabs, accountTabs } = require(path.join(root, 'lib/account-detail.ts'));
const { loadRelatedWork } = require(path.join(root, 'lib/related-work-data.ts'));
const { loadDocumentList } = require(path.join(root, 'lib/document-list.ts'));
const { detailPage, detailPageHref } = require(path.join(root, 'lib/detail-pagination.ts'));
const { operationalOpportunityWhere, operationalActivityWhere, operationalTaskWhere } = require(path.join(root, 'lib/operational-where.ts'));
const { resolveUserContext } = require(path.join(root, 'lib/dev-impersonation.ts'));
const actor = role => ({ id: 7, role, active: true, archivedAt: null });
const counts = { Contacts: 125, Opportunities: 35, Projects: 35, Demos: 30, Activity: 150, Tasks: 60, Notes: 70 };
function mock() {
  const calls = [];
  const db = Object.fromEntries(['account', 'contact', 'opportunityAccount', 'project', 'demoRequest', 'activity', 'task', 'note', 'productSku', 'priceException', 'document', 'terminologyLabel'].map(model => [model, Object.fromEntries(['findUnique', 'findFirst', 'findMany', 'count'].map(method => [method, async args => {
    calls.push({ model, method, args });
    if (model === 'account') return { id: 9, name: 'Account', status: 'ACTIVE', businessRoles: [], _count: { contacts: 125, opportunityMemberships: 35, demoRequests: 30, activities: 150, tasks: 60, notes: 70 } };
    return method === 'count' ? 35 : method === 'findMany' ? [] : null;
  }]))]));
  return { db, calls };
}
test('shared context uses filtered aggregate counts and no detail collections', async () => {
  const { db, calls } = mock();
  const result = await loadAccountContext(db, 9, actor('ADMIN'));
  assert.deepEqual(result.counts, counts);
  assert.deepEqual(calls.map(c => `${c.model}.${c.method}`), ['account.findUnique', 'project.count']);
  const select = calls[0].args.select;
  for (const key of ['contacts', 'opportunityMemberships', 'activities', 'tasks', 'notes', 'demoRequests']) assert.equal(select[key], undefined);
  assert.deepEqual(select._count.select.contacts, { where: { archivedAt: null } });
  assert.deepEqual(select._count.select.opportunityMemberships, { where: { opportunity: operationalOpportunityWhere } });
  assert.deepEqual(select._count.select.tasks, { where: operationalTaskWhere });
  assert.deepEqual(select._count.select.activities, { where: operationalActivityWhere });
});
test('Overview only loads bounded summary rows and its own PE/ODM sections', async () => {
  const { db, calls } = mock();
  await loadAccountTab(db, 9, actor('ADMIN'), 'Overview', {}, counts);
  assert.deepEqual(calls.filter(c => c.method === 'findMany').map(c => c.model).sort(), ['priceException', 'productSku']);
  for (const call of calls.filter(c => c.method === 'findMany')) assert.ok(call.args.take <= 25);
  assert.equal(calls.find(c => c.model === 'contact').method, 'findFirst');
  assert.ok(calls.filter(c => ['task', 'opportunityAccount'].includes(c.model)).every(c => c.method === 'count'));
});
for (const [tab, model] of [['Contacts', 'contact'], ['Opportunities', 'opportunityAccount'], ['Projects', 'project'], ['Demos', 'demoRequest']]) {
  test(`${tab} queries only its selected detail collection, with bounds`, async () => {
    const { db, calls } = mock();
    const result = await loadAccountTab(db, 9, actor('SALES'), tab, { page: '2' }, counts);
    assert.deepEqual(calls.map(c => c.model), [model]);
    assert.equal(calls[0].args.take, 25); assert.equal(calls[0].args.skip, 25);
    assert.equal(result.pagination.page, 2);
    assert.equal(calls[0].args.where.ownerId, undefined, 'cross-Sales reads remain unscoped');
  });
}
test('default, invalid, case-insensitive and restricted direct URLs retain their behavior', () => {
  for (const raw of [undefined, '', 'invalid']) assert.equal(resolveAccountTab(raw, actor('ADMIN')), 'Overview');
  assert.equal(resolveAccountTab('cOnTaCtS', actor('SALES')), 'Contacts');
  for (const role of ['ADMIN', 'SALES_MANAGER', 'SALES', 'READ_ONLY']) assert.deepEqual(visibleAccountTabs(actor(role)), accountTabs);
  assert.deepEqual(visibleAccountTabs(actor('MARKETING_MANAGER')), accountTabs.filter(t => t !== 'Demos'));
  assert.equal(resolveAccountTab('demos', actor('MARKETING_MANAGER')), 'Overview');
  assert.deepEqual(visibleAccountTabs(actor('SUPPORT')), ['Overview', 'Contacts', 'Support']);
  for (const tab of accountTabs) assert.equal(resolveAccountTab(tab, actor('SUPPORT')), ['Overview', 'Contacts', 'Support'].includes(tab) ? tab : 'Overview');
});
test('Support avoids hidden sales counts/details and Marketing cannot hydrate Demos', async () => {
  const { db, calls } = mock();
  await loadAccountContext(db, 9, actor('SUPPORT'));
  assert.deepEqual(calls[0].args.select._count.select, { contacts: { where: { archivedAt: null } } });
  calls.length = 0;
  await loadAccountTab(db, 9, actor('SUPPORT'), 'Overview', {}, counts);
  assert.deepEqual(calls.map(c => c.model), ['productSku']); // Existing bounded Overview section remains available.
  calls.length = 0;
  await loadAccountTab(db, 9, actor('MARKETING_MANAGER'), 'Demos', {}, counts);
  assert.equal(calls.length, 0);
});
test('effective impersonated role determines tabs and PE scope', async () => {
  const admin = { ...actor('ADMIN'), name: 'Admin', email: 'admin@example.test' };
  const user = { ...actor('SALES'), firstName: 'Sales', lastName: 'Rep', email: 'sales@example.test' };
  const context = await resolveUserContext(admin, '7', { user: { findUnique: async () => user } }, { NODE_ENV: 'development', ENABLE_DEV_IMPERSONATION: 'true' });
  const { db, calls } = mock();
  await loadAccountTab(db, 9, context.effective, 'Overview', {}, counts);
  const queries = calls.filter(c => c.model === 'priceException');
  assert.deepEqual(queries[0].args.where, queries[1].args.where);
  assert.equal(queries[0].args.where.AND[0].OR[0].assignedSalesRepUserId, 7);
});
for (const [kind, model] of [['activities', 'activity'], ['tasks', 'task'], ['notes', 'note']]) {
  test(`${kind} bounds and history filters use identical count/row predicates`, async () => {
    for (const visibility of ['active', 'archived', 'all']) {
      const { db, calls } = mock();
      await loadRelatedWork(db, { accountId: 9, kind, visibility, page: '2' });
      assert.deepEqual(calls.map(c => `${c.model}.${c.method}`), [`${model}.count`, `${model}.findMany`]);
      assert.deepEqual(calls[0].args.where, calls[1].args.where);
      assert.equal(calls[1].args.take, 25); assert.equal(calls[1].args.skip, 25);
      assert.deepEqual(calls[0].args.where.archivedAt, visibility === 'archived' ? { not: null } : visibility === 'active' ? null : undefined);
      if (kind !== 'notes') assert.equal(!!calls[0].args.where.AND, visibility === 'active');
    }
  });
}
test('Documents are bounded with matching archive/count filters and no storage payload', async () => {
  const { db, calls } = mock();
  await loadDocumentList(db, { type: 'account', id: 9 }, true, '2');
  assert.deepEqual(calls[0].args.where, { accountId: 9, archivedAt: { not: null } });
  assert.deepEqual(calls[1].args.where, calls[0].args.where);
  assert.equal(calls[1].args.take, 25); assert.equal(calls[1].args.skip, 25);
  assert.equal(calls[1].args.select.storageKey, undefined);
});
test('pagination clamps stale and invalid URLs and preserves filter query/hash', () => {
  for (const raw of [undefined, '', 'NaN', '-1', '1.5', '9007199254740992']) assert.equal(detailPage(100, raw).page, 1);
  assert.equal(detailPage(0, '20').page, 1);
  assert.equal(detailPage(26, '999').page, 2);
  assert.equal(detailPageHref('/accounts/9?tab=documents&documentsView=archived#documents', 'page', 2), '/accounts/9?tab=documents&documentsView=archived&page=2#documents');
});

test('the Account page waits for the selected tab before any Account database reads', async () => {
  const { db, calls } = mock();
  const originalLoad = Module._load;
  Module._extensions['.tsx'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, file);
  Module._load = function(request, parent, main) {
    if (request === '@/lib/prisma') return { prisma: db };
    if (request === '@/lib/current-user') return { currentUser: async () => actor('ADMIN') };
    if (request === 'next/navigation') return { notFound: () => { throw Error('not found'); } };
    if (request === 'next/link') return () => null;
    if (request.startsWith('@/components/')) return new Proxy({}, { get: () => () => null });
    return originalLoad.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, main);
  };
  let Page;
  try { Page = require(path.join(root, 'app/accounts/[id]/page.tsx')).default; }
  finally { Module._load = originalLoad; }
  let resolve;
  const searchParams = new Promise(done => { resolve = done; });
  const pending = Page({ params: Promise.resolve({ id: '9' }), searchParams });
  await new Promise(done => setImmediate(done));
  assert.equal(calls.length, 0, 'an unresolved tab must not preload Account collections');
  resolve({ tab: 'contacts' });
  await pending;
  assert.deepEqual(calls.filter(c => c.method === 'findMany').map(c => c.model).sort(), ['contact', 'terminologyLabel']);
  calls.length = 0;
  await assert.rejects(Page({ params: Promise.resolve({ id: 'invalid' }), searchParams: Promise.resolve({}) }), /not found/);
  assert.equal(calls.length, 0);
});
