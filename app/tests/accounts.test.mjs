import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
Module._extensions['.ts'] = (mod, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  mod._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
};
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadTs(relative) {
  const filename = path.resolve(__dirname, '..', relative);
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = new Module(filename);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(output, filename);
  return mod.exports;
}
const { parseAccountForm } = loadTs('lib/account-validation.ts');
const { accountWhere, accountView, accountHref, listAccounts, PAGE_SIZE, checkAccountReferences, setAccountArchived } = loadTs('lib/accounts.ts');
const { routeAccess } = loadTs('lib/authorization.ts');
const { parseLookup } = loadTs('lib/lookups.ts');
function form(entries) { const f = new FormData(); for (const [key, value] of entries) f.append(key, value); return f; }
test('account validation requires a name and rejects unsafe fields', () => {
  const result = parseAccountForm(form([['name', ' '], ['website', 'javascript:alert(1)'], ['phone', 'abc'], ['roles', 'INVALID'], ['ownerId', '-2']]));
  assert.deepEqual(Object.keys(result.errors).sort(), ['name', 'ownerId', 'phone', 'roles', 'website']);
});
test('account validation accepts multiple unique roles and trims fields', () => {
  const result = parseAccountForm(form([['name', '  Example  '], ['status', 'INACTIVE'], ['roles', 'VAR'], ['roles', 'ISV'], ['roles', 'VAR'], ['website', 'https://example.com'], ['strategicAccount', 'on'], ['addressLine1', '  123 Main St  '], ['city', ' Boston ']]));
  assert.deepEqual(result.errors, {});
  assert.equal(result.value.name, 'Example');
  assert.deepEqual(result.value.roles, ['VAR', 'ISV']);
  assert.equal(result.value.strategicAccount, true);
  assert.equal(result.value.addressLine1, '123 Main St');
  assert.equal(result.value.city, 'Boston');
  assert.equal(result.value.country, null);
});
test('address fields remain optional and enforce length limits', () => {
  const valid = parseAccountForm(form([['name', 'Example']]));
  assert.equal(valid.value.addressLine1, null);
  const invalid = parseAccountForm(form([['name', 'Example'], ['postalCode', 'x'.repeat(31)]]));
  assert.match(invalid.errors.postalCode, /30 characters/);
});
test('filter accepts supported role only', () => {
  assert.deepEqual(accountWhere({ role: 'BOGUS' }), {});
  assert.deepEqual(accountWhere({ role: 'VAR', strategic: 'yes' }), { businessRoles: { some: { role: 'VAR' } }, strategicAccount: true });
});
test('All Accounts keeps the existing unscoped query for every role', async () => {
  const calls = [];
  const client = { account: {
    count: async (args) => { calls.push(args); return 1; },
    findMany: async (args) => { calls.push(args); return [{ id: 1 }]; },
  } };
  for (const view of [undefined, 'all', 'unknown']) {
    const result = await listAccounts(client, { view }, 7);
    assert.equal(accountView({ view }), 'all');
    assert.equal(result.accounts.length, 1);
    assert.deepEqual(calls.splice(0).map(({ where }) => where), [{}, {}]);
  }
  for (const role of ['SALES', 'SALES_MANAGER', 'ADMIN', 'MARKETING_MANAGER', 'READ_ONLY']) {
    assert.equal(routeAccess('/accounts?view=all', { id: 7, role, active: true, archivedAt: null }), 'allowed');
  }
});
test('Accounts defaults by role and honors explicit URL views', () => {
  for (const role of ['SALES', 'SALES_MANAGER']) {
    assert.equal(accountView({}, role), 'my');
    assert.equal(accountView({ q: 'Acme', page: '2' }, role), 'my');
    assert.equal(accountView({ view: 'all' }, role), 'all');
  }
  for (const role of ['ADMIN', 'MARKETING_MANAGER', 'READ_ONLY']) {
    assert.equal(accountView({}, role), 'all');
    assert.equal(accountView({ view: 'my' }, role), 'my');
  }
});
test('My Accounts scopes count and rows to the authenticated CRM user', async () => {
  const calls = [];
  const client = { account: {
    count: async (args) => { calls.push(args); return 2; },
    findMany: async (args) => { calls.push(args); return [{ id: 1 }, { id: 2 }]; },
  } };
  await listAccounts(client, { view: 'my' }, 7);
  assert.deepEqual(calls.map(({ where }) => where), [{ ownerId: 7 }, { ownerId: 7 }]);
  await listAccounts(client, { view: 'my' }, 8);
  assert.deepEqual(calls.slice(2).map(({ where }) => where), [{ ownerId: 8 }, { ownerId: 8 }]);
  await assert.rejects(listAccounts(client, { view: 'my' }), /CRM user is required/);
});
test('My Accounts combines ownership with every existing filter', () => {
  assert.deepEqual(accountWhere({ view: 'my', q: '  Acme  ', status: 'ACTIVE', role: 'VAR', territory: 'WEST', industry: 'RETAIL', strategic: 'yes' }, 7), {
    ownerId: 7, name: { contains: 'Acme', mode: 'insensitive' }, status: 'ACTIVE',
    businessRoles: { some: { role: 'VAR' } }, territory: 'WEST', industry: 'RETAIL', strategicAccount: true,
  });
});
test('pagination uses the count within the selected view', async () => {
  const queries = [];
  const client = { account: {
    count: async () => PAGE_SIZE + 1,
    findMany: async (args) => { queries.push(args); return []; },
  } };
  for (const view of ['my', 'all']) {
    const result = await listAccounts(client, { view, page: '2', q: 'Acme', status: 'ACTIVE' }, 7);
    assert.equal(result.page, 2);
    assert.equal(result.pages, 2);
    const query = queries.at(-1);
    assert.equal(query.skip, PAGE_SIZE);
    assert.equal(query.take, PAGE_SIZE);
    assert.deepEqual(query.where, { ...(view === 'my' ? { ownerId: 7 } : {}), name: { contains: 'Acme', mode: 'insensitive' }, status: 'ACTIVE' });
  }
});
test('view links retain filters and pagination links retain the view', () => {
  const filters = { view: 'my', q: 'Acme & Co', status: 'ACTIVE', role: 'VAR', territory: 'WEST', industry: 'RETAIL', strategic: 'no', page: '3' };
  const tab = new URL(accountHref(filters, { view: 'all' }), 'http://localhost');
  assert.equal(tab.searchParams.get('view'), 'all');
  assert.equal(tab.searchParams.get('page'), null);
  for (const key of ['q', 'status', 'role', 'territory', 'industry', 'strategic']) assert.equal(tab.searchParams.get(key), filters[key]);
  const next = new URL(accountHref(filters, { page: '4' }), 'http://localhost');
  assert.equal(next.searchParams.get('view'), 'my');
  assert.equal(next.searchParams.get('page'), '4');
});
test('unauthorized Accounts access remains denied for inactive and missing users', () => {
  assert.equal(routeAccess('/accounts?view=my', null), 'sign-in');
  assert.equal(routeAccess('/accounts?view=my', { id: 7, role: 'SALES', active: false, archivedAt: null }), 'denied');
  assert.equal(routeAccess('/accounts?view=all', { id: 7, role: 'ADMIN', active: true, archivedAt: new Date() }), 'denied');
});
test('existing inactive lookup values remain valid on edit, but new inactive selections do not', async () => {
  const client = {
    account: { findUnique: async () => ({ industry: 'OLD', territory: 'WEST' }) },
    industry: { findFirst: async () => null },
    territory: { findFirst: async () => null },
    user: { findFirst: async () => null },
  };
  const input = { industry: 'OLD', territory: 'WEST', ownerId: null };
  assert.deepEqual(await checkAccountReferences(client, input, 1), {});
  assert.deepEqual(await checkAccountReferences(client, { ...input, industry: 'OTHER' }, 1), { industry: 'Choose an active industry.' });
});
test('lookup administration validates stable codes and sort order', () => {
  assert.deepEqual(parseLookup(form([['code', ' RETAIL '], ['name', ' Retail '], ['sortOrder', '2'], ['active', 'on']]), false).value,
    { code: 'RETAIL', name: 'Retail', sortOrder: 2, active: true });
  assert.match(parseLookup(form([['code', 'R'], ['name', 'Retail'], ['sortOrder', '-1']]), false).errors.sortOrder, /zero or more/);
});
test('archive and reactivate update status and timestamp; repeated action fails', async () => {
  let row = { status: 'ACTIVE', archivedAt: null };
  const client = { $transaction: async (fn) => fn({ account: {
    findUnique: async () => ({ status: row.status }),
    update: async ({ data }) => { row = { ...row, ...data }; },
  } }) };
  await setAccountArchived(client, 7, true);
  assert.equal(row.status, 'ARCHIVED'); assert.ok(row.archivedAt instanceof Date);
  await assert.rejects(setAccountArchived(client, 7, true), /already archived/);
  await setAccountArchived(client, 7, false);
  assert.deepEqual(row, { status: 'ACTIVE', archivedAt: null });
});
