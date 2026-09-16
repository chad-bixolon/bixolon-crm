import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
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
const { accountWhere, setAccountArchived } = loadTs('lib/accounts.ts');
function form(entries) { const f = new FormData(); for (const [key, value] of entries) f.append(key, value); return f; }
test('account validation requires a name and rejects unsafe fields', () => {
  const result = parseAccountForm(form([['name', ' '], ['website', 'javascript:alert(1)'], ['phone', 'abc'], ['roles', 'INVALID'], ['ownerId', '-2']]));
  assert.deepEqual(Object.keys(result.errors).sort(), ['name', 'ownerId', 'phone', 'roles', 'website']);
});
test('account validation accepts multiple unique roles and trims fields', () => {
  const result = parseAccountForm(form([['name', '  Example  '], ['status', 'INACTIVE'], ['roles', 'VAR'], ['roles', 'ISV'], ['roles', 'VAR'], ['website', 'https://example.com'], ['strategicAccount', 'on']]));
  assert.deepEqual(result.errors, {});
  assert.equal(result.value.name, 'Example');
  assert.deepEqual(result.value.roles, ['VAR', 'ISV']);
  assert.equal(result.value.strategicAccount, true);
});
test('filter accepts supported role only', () => {
  assert.deepEqual(accountWhere({ role: 'BOGUS' }), {});
  assert.deepEqual(accountWhere({ role: 'VAR', strategic: 'yes' }), { businessRoles: { some: { role: 'VAR' } }, strategicAccount: true });
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
