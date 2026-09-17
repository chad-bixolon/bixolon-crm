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
const require = Module.createRequire(fileURLToPath(import.meta.url));
const redirectSignal = Symbol('redirect');
let savedId = 42;
let saveError;
let savedInput;
const redirects = [];
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'next/cache') return { revalidatePath: () => {} };
  if (request === 'next/navigation') return { redirect: (url) => { redirects.push(url); throw redirectSignal; }, notFound: () => { throw new Error('not found'); } };
  if (request === '@/lib/prisma') return { prisma: { user: { findUnique: async () => ({ id: 42, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', role: 'SALES_MANAGER', active: true, archivedAt: null }) } } };
  if (request === '@/lib/users') return {
    parseUser: (form) => require(path.join(root, 'lib/users.ts')).parseUser(form),
    saveUser: async (_client, input) => { savedInput = input; if (saveError) throw saveError; return savedId; },
  };
  if (request === '@/lib/current-user') return { requireMutation: async () => {} };
  if (request === '@/lib/identity') return { unlinkGoogleIdentity: async () => {} };
  if (request === '@/lib/submit-guard') return { useSubmitGuard: () => () => {} };
  if (request === '@/app/administration/users/actions') return { submitUser: async () => {} };
  if (request === '@/lib/role-labels') return require(path.join(root, 'lib/role-labels.ts'));
  if (request === '@/components/shell') return { Content: ({ children }) => React.createElement('main', null, children), PageHeader: ({ title }) => React.createElement('h1', null, title) };
  if (request === '@/components/user-form') return { UserForm: ({ created }) => React.createElement('form', null, created && 'User created successfully.') };
  if (request === 'next/link') return function Link({ href, children, ...props }) { return React.createElement('a', { href, ...props }, children); };
  return originalLoad.call(this, request, parent, isMain);
};
for (const ext of ['.ts', '.tsx']) Module._extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
const { submitUser } = require(path.join(root, 'app/administration/users/actions.ts'));
const { UserForm } = require(path.join(root, 'components/user-form.tsx'));
const { roleLabels } = require(path.join(root, 'lib/role-labels.ts'));
const EditUserPage = require(path.join(root, 'app/administration/users/[id]/edit/page.tsx')).default;
Module._load = originalLoad;

const entries = [['firstName', 'Ada'], ['lastName', 'Lovelace'], ['email', 'ADA@example.com'], ['role', 'SALES_MANAGER'], ['active', 'false']];
const form = (values = entries) => { const data = new FormData(); for (const [key, value] of values) data.set(key, value); return data; };

test('role labels use consistent capitalization in the User form', () => {
  assert.deepEqual(roleLabels, { ADMIN: 'Administrator', SALES_MANAGER: 'Sales Manager', SALES: 'Sales', MARKETING_MANAGER: 'Marketing Manager', READ_ONLY: 'Read Only' });
  const html = renderToStaticMarkup(React.createElement(UserForm));
  for (const label of Object.values(roleLabels)) assert.ok(html.includes(`>${label}</option>`));
});

test('newly created User form shows its confirmation', () => {
  const html = renderToStaticMarkup(React.createElement(UserForm, { id: 42, created: true }));
  assert.match(html, /User created successfully\./);
});

test('creating a User redirects to its edit page with a success marker', async () => {
  redirects.length = 0;
  saveError = undefined;
  await assert.rejects(submitUser(null, { errors: {} }, form()), error => error === redirectSignal);
  assert.deepEqual(redirects, ['/administration/users/42/edit?saved=created']);
  assert.equal(savedInput.email, 'ada@example.com');
});

test('created User page displays the success confirmation', async () => {
  const page = await EditUserPage({ params: Promise.resolve({ id: '42' }), searchParams: Promise.resolve({ saved: 'created' }) });
  assert.match(renderToStaticMarkup(page), /User created successfully\./);
});

test('editing a User stays on the page and confirms the save', async () => {
  redirects.length = 0;
  const result = await submitUser(42, { errors: {} }, form());
  assert.equal(result.message, 'User updated successfully.');
  assert.equal(result.success, true);
  assert.deepEqual(redirects, []);
});

test('validation failure preserves entered User values and errors', async () => {
  const result = await submitUser(null, { errors: {} }, form([['firstName', ''], ...entries.slice(1)]));
  assert.match(result.errors.firstName, /required/i);
  assert.equal(result.values.firstName, '');
  assert.equal(result.values.email, 'ADA@example.com');
  assert.equal(result.values.role, 'SALES_MANAGER');
  assert.equal(result.values.active, 'false');
});

test('duplicate email keeps the existing error and entered values', async () => {
  saveError = new Error('That email address is already in use.');
  const result = await submitUser(null, { errors: {} }, form());
  assert.equal(result.message, 'That email address is already in use.');
  assert.equal(result.values.email, 'ADA@example.com');
  assert.equal(result.success, undefined);
  saveError = undefined;
});
