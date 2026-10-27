import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(import.meta.url);
let scope = {}, sessionUser = { id: 7, name: 'First User', email: 'first@example.com', role: 'SALES', active: true };
let moduleRows = [], brandingRow = null;
const calls = { auth: 0, users: 0, modules: 0, branding: 0 };
const prisma = {
  user: { findMany: async () => { calls.users++; return Array.from({ length: 60 }, (_, i) => ({ id: i + 1, firstName: 'Sales', lastName: String(i + 1) })); } },
  deploymentModuleVisibility: { findMany: async () => { calls.modules++; return moduleRows; } },
  deploymentBranding: { findUnique: async () => { calls.branding++; return brandingRow; } },
};
const mockCache = fn => {
  const requests = new WeakMap();
  return (...args) => {
    let values = requests.get(scope);
    if (!values) { values = new Map(); requests.set(scope, values); }
    const key = JSON.stringify(args);
    if (!values.has(key)) values.set(key, fn(...args));
    return values.get(key);
  };
};
const originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
  if (name === 'react') return { cache: mockCache };
  if (name === '@/auth') return { auth: async () => { calls.auth++; return { crmUser: sessionUser }; } };
  if (name === 'next/headers') return { cookies: async () => ({ get: () => undefined }) };
  if (name === 'next/navigation') return { redirect: path => { throw new Error(`redirect:${path}`); }, notFound: () => { throw new Error('notFound'); } };
  if (name === '@/lib/prisma' || name === './prisma') return { prisma };
  if (name === './authorization') return { can: () => true, assertPermission: () => {} };
  return originalLoad.call(this, name, parent, isMain);
};
const { userContext, currentUser, getRealAuthenticatedUser } = require(path.join(root, 'lib/current-user.ts'));
const { listEligibleUserOptions } = require(path.join(root, 'lib/assignment-eligibility.ts'));
// Compile this implementation directly so the suite's isolated module-policy preload
// cannot replace the service under test with its all-enabled stub.
const availabilityPath = path.join(root, 'lib/module-availability.ts');
const availabilityModule = new Module(availabilityPath);
availabilityModule.filename = availabilityPath;
availabilityModule.paths = Module._nodeModulePaths(path.dirname(availabilityPath));
availabilityModule._compile(ts.transpileModule(fs.readFileSync(availabilityPath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, availabilityPath);
const { getModuleAvailability } = availabilityModule.exports;
const { getBranding } = require(path.join(root, 'lib/deployment-branding.ts'));
Module._load = originalLoad;

test('identity, eligibility, modules and branding reuse only within one request', async () => {
  const [context, actor, real] = await Promise.all([userContext(), currentUser(), getRealAuthenticatedUser()]);
  assert.equal(context.effective.id, 7);
  assert.equal(actor.id, 7);
  assert.equal(real.id, 7);
  assert.equal(calls.auth, 1);
  const populations = await Promise.all([listEligibleUserOptions(prisma, 'account-owner'), listEligibleUserOptions(prisma, 'opportunity-owner'), listEligibleUserOptions(prisma, 'pe-follow-up')]);
  assert.equal(populations.every(users => users.length === 60), true);
  await Promise.all([getModuleAvailability(), getModuleAvailability(), getBranding(prisma), getBranding(prisma)]);
  assert.deepEqual(calls, { auth: 1, users: 1, modules: 1, branding: 1 });
  scope = {};
  sessionUser = { id: 8, name: 'Second User', email: 'second@example.com', role: 'READ_ONLY', active: true };
  moduleRows = [{ module: 'SUPPORT_CASES', enabled: false }];
  brandingRow = { companyName: 'Updated', productName: 'SalesHub', logoStorageKey: null, logoMimeType: null };
  assert.equal((await currentUser()).id, 8);
  await listEligibleUserOptions(prisma, 'account-owner');
  assert.equal((await getModuleAvailability()).effective.has('SUPPORT_CASES'), false);
  assert.equal((await getBranding(prisma)).companyName, 'Updated');
  assert.deepEqual(calls, { auth: 2, users: 2, modules: 2, branding: 2 });
  scope = {};
  sessionUser = { id: 8, name: 'Second User', email: 'second@example.com', role: 'ADMIN', active: true };
  assert.equal((await currentUser()).role, 'ADMIN');
  scope = {};
  sessionUser = null;
  await assert.rejects(currentUser(), /redirect:\/access-denied\?reason=inactive/);
});
