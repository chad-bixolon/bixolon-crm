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
const { accountWhere, checkAccountReferences, setAccountArchived } = loadTs('lib/accounts.ts');
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
