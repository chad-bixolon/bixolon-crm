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
let linkedIdentity = null;
let savedId = 42;
let saveError;
let savedInput;
let effectiveActor = { id: 1, role: 'ADMIN', active: true, archivedAt: null };
const { assertPermission } = (() => {
  Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
  return require(path.join(root, 'lib/authorization.ts'));
})();
const redirects = [];
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'next/cache') return { revalidatePath: () => {} };
  if (request === 'next/navigation') return { redirect: (url) => { redirects.push(url); throw redirectSignal; }, notFound: () => { throw new Error('not found'); } };
  if (request === '@/lib/authorization') return require(path.join(root, 'lib/authorization.ts'));
  if (request === '@/lib/user-lifecycle') return require(path.join(root, 'lib/user-lifecycle.ts'));
  if (request === '@/lib/user-history-display') return require(path.join(root, 'lib/user-history-display.ts'));
  if (request === '@/lib/user-time-zone') return require(path.join(root, 'lib/user-time-zone.ts'));
  if (request === '@/components/google-identity-reset') return { GoogleIdentityReset: () => null };
  if (request === '@/lib/prisma') return { prisma: { externalIdentity: { findFirst: async () => linkedIdentity }, adminMaintenanceEvent: { findMany: async () => [] }, user: { findMany: async () => [], count: async () => 2, findUnique: async () => ({ id: 42, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', role: 'SALES_MANAGER', active: true, archivedAt: null }) } } };
  if (request === '@/lib/users') return {
    parseUser: (form) => require(path.join(root, 'lib/users.ts')).parseUser(form),
    saveUser: async (_client, actor, input) => { savedInput = input; if (saveError) throw saveError; return savedId; },
  };
  if (request === '@/lib/current-user') return { requirePermission: async permission => { assertPermission(effectiveActor, permission); return effectiveActor; }, requireMutation: async permission => { assertPermission(effectiveActor, permission); return effectiveActor; } };
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
const { userTimeZoneOptions } = require(path.join(root, 'lib/user-time-zone.ts'));
const { roleLabels } = require(path.join(root, 'lib/role-labels.ts'));
const EditUserPage = require(path.join(root, 'app/administration/users/[id]/edit/page.tsx')).default;
Module._load = originalLoad;

const entries = [['firstName', 'Ada'], ['lastName', 'Lovelace'], ['email', 'ADA@example.com'], ['role', 'SALES_MANAGER'], ['active', 'false']];
const form = (values = entries) => { const data = new FormData(); for (const [key, value] of values) data.set(key, value); return data; };

test('role labels use consistent capitalization in the User form', () => {
  assert.deepEqual(roleLabels, { SUPPORT_MANAGER: 'Support Manager', EXECUTIVE: 'Executive', ADMIN: 'Administrator', SUPPORT: 'Support', SALES_MANAGER: 'Sales Manager', SALES: 'Sales', MARKETING_MANAGER: 'Marketing Manager', READ_ONLY: 'Read Only' });
  const html = renderToStaticMarkup(React.createElement(UserForm, { timeZoneOptions: userTimeZoneOptions(), trueAdmin: true }));
  for (const label of Object.values(roleLabels)) assert.ok(html.includes(`>${label}</option>`));
});

test('newly created User form shows its confirmation', () => {
  const html = renderToStaticMarkup(React.createElement(UserForm, { timeZoneOptions: userTimeZoneOptions(), id: 42, created: true }));
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
test('delegated-access eligibility error tells an Admin how to correct the User form', async () => {
  saveError = new Error('User Administration Access requires an active Sales Manager. Set it to No before changing role or status.');
  const result = await submitUser(42, { errors: {} }, form());
  assert.match(result.message, /Set it to No/);
  saveError = undefined;
});

for (const actor of [null, ...['READ_ONLY', 'SALES', 'SUPPORT', 'SALES_MANAGER', 'MARKETING_MANAGER'].map(role => ({ id: 2, role, active: true })), { id: 1, role: 'ADMIN', active: false }, { id: 1, role: 'ADMIN', active: true, archivedAt: new Date() }]) {
  test(`direct submitUser rejects ${JSON.stringify(actor)} before persistence, including forged Admin payloads`, async () => {
    effectiveActor = actor;
    savedInput = undefined;
    try {
      for (const id of [null, 42]) {
        const data = form(); data.set('role', 'ADMIN'); data.set('active', 'true'); data.set('actorId', '1');
        await assert.rejects(submitUser(id, { errors: {} }, data), /Access denied/);
        assert.equal(savedInput, undefined);
      }
    } finally { effectiveActor = { id: 1, role: 'ADMIN', active: true }; }
  });
}
test('Admin forged unknown roles and statuses are rejected without persistence', async () => {
  for (const [key, value] of [['role', 'INVALID_ROLE'], ['active', 'yes']]) {
    savedInput = undefined;
    const data = form(); data.set(key, value);
    const result = await submitUser(null, { errors: {} }, data);
    assert.ok(result.errors[key]); assert.equal(savedInput, undefined);
  }
});

 test('User Administration Access uses plain wording and stays Admin-only', () => {
  const html = renderToStaticMarkup(React.createElement(UserForm, { timeZoneOptions: userTimeZoneOptions(), trueAdmin: true }));
  for (const text of ['User Administration Access', '>No</option>', 'Yes — Allow user administration', 'This does not grant System Health', 'active Sales Manager who is not archived']) assert.ok(html.includes(text), text);
  const delegated = renderToStaticMarkup(React.createElement(UserForm, { timeZoneOptions: userTimeZoneOptions(), trueAdmin: false }));
  assert.doesNotMatch(delegated, /name="delegatedUserAdministrationEnabled"/);
 });
 test('timezone select preserves international values and accepted stored aliases', () => {
  for (const zone of ['America/New_York', 'Asia/Seoul', 'US/Eastern']) {
    const html = renderToStaticMarkup(React.createElement(UserForm, { timeZoneOptions: userTimeZoneOptions(zone), initial: {firstName:'Ada',lastName:'Lovelace',email:'ada@example.com',role:'SALES',active:true,timeZone:zone} }));
    assert.match(html, /<select[^>]*id="timeZone"/);
    assert.ok(html.includes(`value="${zone}" selected=""`));
    assert.match(html, /Eastern Time — America\/New_York/);
    assert.match(html, /Seoul — Asia\/Seoul/);
  }
 });
 test('Google sign-in states and history empty state are plain-language', async () => {
  for (const linked of [false, true]) {
    linkedIdentity = linked ? {id:1} : null;
    const html = renderToStaticMarkup(await EditUserPage({params:Promise.resolve({id:'42'}), searchParams:Promise.resolve({})}));
    assert.ok(html.includes(linked ? '>Linked<' : '>Not yet linked<'));
    assert.match(html, /Google sign-in/);
    if (!linked) assert.match(html, /first successful Google sign-in/);
    assert.match(html, /No recorded changes yet\./);
    assert.doesNotMatch(html, /identity subject|issuer/);
  }
  linkedIdentity = null;
 });
 test('invalid timezone submission is rejected before persistence', async () => {
  savedInput = undefined;
  const data = form(); data.set('timeZone', 'Invalid/Zone');
  const result = await submitUser(null, {errors:{}}, data);
  assert.ok(result.errors.timeZone);
  assert.equal(savedInput, undefined);
 });
 test('history translates evidence without changing old/new values', () => {
  const {userHistoryDescription} = require(path.join(root, 'lib/user-history-display.ts'));
  for (const [action, oldValue, newValue, expected] of [
    ['Role changed','SALES','SALES_MANAGER','Role changed from Sales to Sales Manager'],
    ['Delegation changed','false','true','User Administration Access enabled'],
    ['Timezone changed','America/New_York','Asia/Seoul','Timezone changed from Eastern Time to Seoul'],
    ['Status changed','true','false','Status changed from Active to Inactive'],
    ['Identity reset',null,null,'Google sign-in link reset'],
  ]) {
    const evidence = Object.freeze({action,oldValue,newValue});
    assert.equal(userHistoryDescription(evidence), expected);
  }
 });
