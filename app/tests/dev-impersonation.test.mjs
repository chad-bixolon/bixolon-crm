import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(fileURLToPath(import.meta.url));
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const policy = require(path.join(root, 'lib/dev-impersonation.ts'));
const { can, routeAccess, opportunityScope, taskScope } = require(path.join(root, 'lib/authorization.ts'));
const { tradeShowReadWhere, tradeShowLeadReadWhere } = require(path.join(root, 'lib/trade-shows.ts'));
const realAdmin = { id: 1, name: 'Chad Admin', email: 'admin@example.test', role: 'ADMIN', active: true };
const target = (role = 'SALES') => ({ id: 7, firstName: 'Ryan', lastName: 'Example', email: 'ryan@example.test', role, active: true, archivedAt: null });
const db = (user = target()) => ({ user: { findUnique: async ({ where }) => where.id === 7 ? user : null } });
const dev = { NODE_ENV: 'development', ENABLE_DEV_IMPERSONATION: 'true' };

test('both gates are required and production ignores a stale cookie without querying the target', async () => {
  for (const env of [{ ...dev, NODE_ENV: 'production' }, { ...dev, ENABLE_DEV_IMPERSONATION: 'false' }]) {
    assert.equal(policy.devImpersonationEnabled(env), false);
    const client = { user: { findUnique: async () => { throw new Error('Unexpected target lookup'); } } };
    const result = await policy.resolveUserContext(realAdmin, '7', client, env);
    assert.equal(result.effective.id, realAdmin.id);
    assert.equal(result.clearCookie, true);
    assert.equal(result.impersonating, false);
  }
});

test('real Admin is required; unauthenticated and every non Admin role cannot impersonate', async () => {
  for (const real of [null, ...['SALES_MANAGER','SALES','MARKETING_MANAGER','READ_ONLY'].map(role => ({ ...realAdmin, role }))]) {
    const result = await policy.resolveUserContext(real, '7', db(), dev);
    assert.equal(result.impersonating, false);
    assert.equal(result.effective?.id, real?.id);
  }
});

test('active existing user becomes effective while real Google Admin remains separate', async () => {
  const result = await policy.resolveUserContext(realAdmin, '7', db(), dev);
  assert.equal(result.real.id, 1);
  assert.equal(result.effective.id, 7);
  assert.equal(result.effective.role, 'SALES');
  assert.equal(result.impersonating, true);
  assert.deepEqual(opportunityScope(result.effective), { ownerId: 7 });
  assert.deepEqual(taskScope(result.effective), { assignedToId: 7 });
  assert.equal(can(result.effective, 'users.manage'), false);
  assert.equal(routeAccess('/administration', result.effective), 'denied');
  assert.equal(can(result.real, 'users.manage'), true);
  assert.equal(routeAccess('/trade-shows/12', result.effective), 'allowed');
  assert.deepEqual(tradeShowReadWhere(result.effective), {});
  assert.deepEqual(tradeShowLeadReadWhere(result.effective), { assignedSalesRepUserId: 7 });
  assert.equal(can(result.effective, 'trade-shows.manage'), false);
  assert.equal(routeAccess('/trade-shows/12/edit', result.effective), 'denied');
});

test('selected roles receive existing permissions, including Marketing and Read Only restrictions', async () => {
  const marketing = (await policy.resolveUserContext(realAdmin, '7', db(target('MARKETING_MANAGER')), dev)).effective;
  assert.equal(can(marketing, 'marketing.write'), true);
  assert.equal(can(marketing, 'sales-plan.manage'), false);
  const readonly = (await policy.resolveUserContext(realAdmin, '7', db(target('READ_ONLY')), dev)).effective;
  assert.equal(can(readonly, 'accounts.read'), true);
  assert.equal(can(readonly, 'accounts.write'), false);
  assert.equal(routeAccess('/accounts/new', readonly), 'denied');
});

test('invalid, deleted, inactive and archived users are rejected and ignored', async () => {
  for (const raw of ['0','abc','7x','9007199254740992','999']) {
    const result = await policy.resolveUserContext(realAdmin, raw, db(), dev);
    assert.equal(result.effective.id, realAdmin.id);
    assert.equal(result.clearCookie, true);
    await assert.rejects(policy.validateImpersonationTarget(db(), raw));
  }
  for (const user of [{ ...target(), active: false }, { ...target(), archivedAt: new Date() }]) {
    const result = await policy.resolveUserContext(realAdmin, '7', db(user), dev);
    assert.equal(result.effective.id, realAdmin.id);
    await assert.rejects(policy.validateImpersonationTarget(db(user), '7'));
  }
  assert.equal(await policy.validateImpersonationTarget(db(), '7'), 7);
});

test('no cookie preserves normal login behavior', async () => {
  const result = await policy.resolveUserContext(realAdmin, undefined, db(), dev);
  assert.equal(result.effective, realAdmin);
  assert.equal(result.impersonating, false);
});

test('server actions reject production, disabled flag, unauthenticated and non Admin callers; Admin can start and return', async () => {
  let real = realAdmin;
  const jar = new Map();
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'next/headers') return { cookies: async () => ({ set: (key, value) => jar.set(key, value), delete: key => jar.delete(key) }) };
    if (request === 'next/navigation') return { redirect: destination => { throw Object.assign(new Error('redirect'), { destination }); } };
    if (request === '@/lib/current-user') return { getRealAuthenticatedUser: async () => real };
    if (request === '@/lib/dev-impersonation') return policy;
    if (request === '@/lib/prisma') return { prisma: db() };
    return originalLoad.call(this, request, parent, isMain);
  };
  const actions = require(path.join(root, 'app/dev/impersonation/actions.ts'));
  Module._load = originalLoad;
  const form = new FormData(); form.set('userId', '7');
  const oldFlag = process.env.ENABLE_DEV_IMPERSONATION, oldEnv = process.env.NODE_ENV;
  try {
    jar.set(policy.DEV_IMPERSONATION_COOKIE, '7');
    process.env.NODE_ENV = 'production'; process.env.ENABLE_DEV_IMPERSONATION = 'true';
    await assert.rejects(actions.startImpersonation(form), /unavailable/);
    assert.equal(jar.get(policy.DEV_IMPERSONATION_COOKIE), '7');
    jar.clear();
    for (const [environment, flag, user] of [['production','true',realAdmin], ['development','false',realAdmin], ['development','true',null], ['development','true',{ ...realAdmin, role: 'SALES_MANAGER' }]]) {
      process.env.NODE_ENV = environment; process.env.ENABLE_DEV_IMPERSONATION = flag; real = user;
      await assert.rejects(actions.startImpersonation(form), /unavailable/);
      assert.equal(jar.size, 0);
    }
    process.env.NODE_ENV = 'development'; process.env.ENABLE_DEV_IMPERSONATION = 'true'; real = realAdmin;
    await assert.rejects(actions.startImpersonation(form), error => error.destination === '/');
    assert.equal(jar.get(policy.DEV_IMPERSONATION_COOKIE), '7');
    await assert.rejects(actions.endImpersonation(), error => error.destination === '/');
    assert.equal(jar.size, 0);
  } finally {
    if (oldFlag === undefined) delete process.env.ENABLE_DEV_IMPERSONATION; else process.env.ENABLE_DEV_IMPERSONATION = oldFlag;
    if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv;
  }
});

test('sign out deletes impersonation cookie before ending the Google session', async () => {
  const jar = new Map([[policy.DEV_IMPERSONATION_COOKIE, '7']]);
  let signedOut = false;
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'next/headers') return { cookies: async () => ({ delete: key => jar.delete(key) }) };
    if (request === '@/auth') return { signOut: async () => { assert.equal(jar.size, 0); signedOut = true; } };
    if (request === '@/lib/dev-impersonation') return policy;
    return originalLoad.call(this, request, parent, isMain);
  };
  const { signOutAction } = require(path.join(root, 'app/sign-out-action.ts'));
  Module._load = originalLoad;
  await signOutAction();
  assert.equal(signedOut, true);
});
