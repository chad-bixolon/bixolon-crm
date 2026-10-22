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
const lib = name => require(path.join(root, 'lib', `${name}.ts`));
const { can, predefinedCapabilities, opportunityReadWhere } = lib('authorization');
const { saveUser, assertUsableAdminRemains } = lib('users');
const { eligibleUser, eligibleUserWhere, eligibilityRoles, taskAssigneePolicy } = lib('assignment-eligibility');
const { productDetailData } = lib('product-detail-data');
const { assertTaskEdit, taskEditWhere } = lib('task-policy');
const { bulkTaskWhere } = lib('bulk-actions');
const { syncTaskNotifications, notifyTaskAssignment } = lib('work-notification-evaluator');
const actor = role => ({ id: 1, role, active: true, archivedAt: null });
const input = { firstName: 'New', lastName: 'User', email: 'new@example.com', role: 'SALES', active: true };
const noDb = new Proxy({}, { get() { throw new Error('Database must not be accessed'); } });
test('user persistence independently rejects unauthorized/unavailable actors, including forged Admin payloads', async () => {
  for (const who of [null, ...['READ_ONLY','SALES','SUPPORT','SALES_MANAGER','MARKETING_MANAGER'].map(actor), { ...actor('ADMIN'), active: false }, { ...actor('ADMIN'), archivedAt: new Date() }]) {
    await assert.rejects(saveUser(noDb, who, { ...input, role: 'ADMIN' }), /Access denied/);
  }
});
function userDb(users) {
  const state = { writes: 0, locks: 0 };
  const tx = { adminMaintenanceEvent: { create: async () => ({}) }, task: { count: async () => 0 }, supportCase: { count: async () => 0 }, $queryRaw: async () => { state.locks++; return []; }, user: {
    findUnique: async ({ where }) => users.find(user => user.id === where.id) ?? null,
    count: async ({ where }) => users.filter(user => user.id !== where.id.not && user.role === 'ADMIN' && user.active && !user.archivedAt).length,
    create: async ({ data }) => { state.writes++; const row = { ...data, id: 100 }; users.push(row); return row; },
    update: async ({ where, data }) => { state.writes++; const user = users.find(user => user.id === where.id); Object.assign(user, data); return user; },
  } };
  return { ...tx, $transaction: fn => fn(tx), state };
}
test('persisted actor defeats stale/forged Admin role, active status, or archive state', async () => {
  for (const persisted of [actor('SALES'), actor('READ_ONLY'), { ...actor('ADMIN'), active: false }, { ...actor('ADMIN'), archivedAt: new Date() }]) {
    const db = userDb([persisted]);
    await assert.rejects(saveUser(db, actor('ADMIN'), input), /Access denied/);
    assert.equal(db.state.writes, 0);
  }
});
test('Admin service validates roles/status and whitelists fields without identity writes', async () => {
  const db = userDb([actor('ADMIN')]);
  await assert.rejects(saveUser(db, actor('ADMIN'), { ...input, role: 'NOT_A_ROLE' }), /Invalid user/);
  await assert.rejects(saveUser(db, actor('ADMIN'), { ...input, active: 'ADMIN' }), /Invalid user/);
  assert.equal(await saveUser(db, actor('ADMIN'), { ...input, archivedAt: new Date(), externalIdentities: { create: {} } }), 100);
  const saved = await db.user.findUnique({ where: { id: 100 } });
  assert.equal(saved.archivedAt, undefined); assert.equal(saved.externalIdentities, undefined); assert.ok(db.state.locks >= 2);
});
test('last usable Admin cannot be demoted, deactivated, or archived; a second usable Admin permits it', async () => {
  for (const next of [{ role: 'SALES', active: true }, { role: 'ADMIN', active: false }, { role: 'ADMIN', active: true, archivedAt: new Date() }]) {
    const db = userDb([actor('ADMIN'), { ...actor('ADMIN'), id: 2, active: false }, { ...actor('ADMIN'), id: 3, archivedAt: new Date() }]);
    await assert.rejects(assertUsableAdminRemains(db, 1, next), /Keep at least one active/); assert.equal(db.state.writes, 0);
  }
  const db = userDb([actor('ADMIN')]);
  await assert.rejects(saveUser(db, actor('ADMIN'), { ...input, active: false }, 1), /Keep at least one active/);
  await saveUser(db, actor('ADMIN'), { ...input, role: 'ADMIN' });
  await saveUser(db, actor('ADMIN'), { ...input, active: false }, 1);
  assert.equal((await db.user.findUnique({ where: { id: 1 } })).active, false);
});
test('eligibility populations are explicit, independent of capabilities, and exclude inactive/archived users', () => {
  const expected = { 'account-owner': ['SALES','SALES_MANAGER'], 'opportunity-owner': ['SALES','SALES_MANAGER'], 'project-owner': ['SALES','SALES_MANAGER'], 'sales-plan-owner': ['SALES','SALES_MANAGER'], 'general-task': ['ADMIN','SALES','SALES_MANAGER','MARKETING_MANAGER'], 'support-task': ['ADMIN','SALES','SALES_MANAGER','MARKETING_MANAGER','SUPPORT','SUPPORT_MANAGER'], 'support-case': ['ADMIN','SUPPORT','SUPPORT_MANAGER'], 'trade-show-sales': ['SALES','SALES_MANAGER'], 'marketing-owner': ['MARKETING_MANAGER'] };
  for (const policy of Object.keys(eligibilityRoles)) {
    assert.deepEqual(eligibleUserWhere(policy).role.in, expected[policy]);
    for (const role of Object.keys(predefinedCapabilities)) {
      assert.equal(eligibleUser(actor(role), policy), expected[policy].includes(role));
      assert.equal(eligibleUser({ ...actor(role), active: false }, policy), false);
      assert.equal(eligibleUser({ ...actor(role), archivedAt: new Date() }, policy), false);
    }
  }
  assert.equal(can(actor('ADMIN'), 'accounts.write'), true); assert.equal(eligibleUser(actor('ADMIN'), 'account-owner'), false);
  assert.equal(can(actor('SUPPORT'), 'tasks.write'), false);
  assert.equal(eligibleUser(actor('SUPPORT'), taskAssigneePolicy({ supportCaseId: 1 })), true);
  assert.equal(eligibleUser(actor('SUPPORT'), taskAssigneePolicy({ supportCaseId: null })), false);
});
test('READ_ONLY has no business mutation capabilities; shared Sales browsing stays unrestricted', () => {
  for (const permission of new Set(Object.values(predefinedCapabilities).flat())) if (/\.(write|create|share|manage|allocate|assign|resolve|route)$/.test(permission)) assert.equal(can(actor('READ_ONLY'), permission), false, permission);
  assert.deepEqual(opportunityReadWhere(actor('SALES')), {});
});
test('Product data excludes negotiated fields and does not fetch them, retaining catalog tiers and customer metadata', async () => {
  const sensitive = { customerPrice: '987.65', previousPrice: '876.54', tariffPercent: '25', tariffAmount: '246.91', finalUnitPrice: '1234.56', notes: 'Private negotiated note' };
  let query;
  const db = { product: { findUnique: async request => { query = request; return { id: 1, skus: [{ prices: [{ amount: '10', tier: 'LIST' }], odmCustomers: [{ account: { name: 'Customer' }, prices: [sensitive] }] }] }; } } };
  for (const role of ['SUPPORT', 'SUPPORT_MANAGER', 'EXECUTIVE']) {
  const denied = await productDetailData(db, actor(role), 1);
  assert.equal(query.include.skus.include.odmCustomers.include.prices, false);
  for (const key of Object.keys(sensitive)) assert.equal(JSON.stringify(denied).includes(key), false, key);
  assert.equal(denied.skus[0].prices[0].amount, '10');
  }
  for (const role of ['ADMIN','SALES_MANAGER','SALES','MARKETING_MANAGER','READ_ONLY']) assert.equal((await productDetailData(db, actor(role), 1)).skus[0].odmCustomers[0].prices[0].notes, sensitive.notes);
});
function matches(row, where) {
  return Object.entries(where).every(([key, value]) => key === 'AND' ? value.every(part => matches(row, part)) : key === 'OR' ? value.some(part => matches(row, part)) : value && typeof value === 'object' ? !!row[key] && matches(row[key], value) : row[key] === value);
}
test('individual/bulk Task scope parity for own, foreign, Project, case and unassigned work', async () => {
  const who = actor('SALES');
  for (const [task, allowed] of [
    [{ assignedToId: 1, projectId: null }, true], [{ assignedToId: 2, projectId: null }, false], [{ assignedToId: null, projectId: null }, false],
    [{ assignedToId: 1, projectId: 4, project: { ownerId: 1 } }, true], [{ assignedToId: 1, projectId: 4, project: { ownerId: 2, primaryAccount: { ownerId: 1 } } }, true], [{ assignedToId: 1, projectId: 4, project: { ownerId: 2, primaryAccount: { ownerId: 2 } } }, false],
    [{ assignedToId: 1, projectId: null, supportCaseId: 5 }, true], [{ assignedToId: 2, projectId: null, supportCaseId: 5 }, false],
  ]) {
    const row = { id: 1, ...task }, db = { task: { findFirst: async ({ where }) => matches(row, where) ? row : null } };
    if (allowed) assert.equal((await assertTaskEdit(db, who, 1)).id, 1);
    else await assert.rejects(assertTaskEdit(db, who, 1), /unavailable/);
    assert.equal(matches(row, bulkTaskWhere(who).AND[1]), allowed);
    assert.deepEqual(bulkTaskWhere(who).AND[1], taskEditWhere(who));
  }
  for (const role of ['READ_ONLY','SUPPORT']) assert.throws(() => taskEditWhere(actor(role)), /Access denied/);
});
test('Support receives case Task assignment/due notices, but no general Task assignment notice', async () => {
  const support = actor('SUPPORT'), notices = []; let supportCaseId = 5;
  const db = {
    task: { findUnique: async () => ({ id: 4, assignedToId: 1, supportCaseId, subject: 'Case work', status: 'OPEN', archivedAt: null, dueDate: new Date('2026-10-01T12:00:00Z') }), findFirst: async () => ({ id: 4 }) },
    user: { findFirst: async ({ where }) => where.role.in.includes(support.role) ? support : null },
    notification: { findMany: async () => [], createMany: async ({ data }) => { notices.push(...data); return { count: data.length }; } },
  };
  await notifyTaskAssignment(db, 4, 1, 7); await syncTaskNotifications(db, 4, new Date('2026-10-02T16:00:00Z'));
  assert.deepEqual(notices.map(n => n.type), ['TASK_ASSIGNED','TASK_OVERDUE']);
  supportCaseId = null;
  await notifyTaskAssignment(db, 4, 1, 8); await syncTaskNotifications(db, 4, new Date('2026-10-02T16:00:00Z'));
  assert.equal(notices.length, 2);
});

// Invoke exported server actions directly, with the real capability implementation
// and a database trap. Page/proxy access cannot make these tests pass.
let effective = actor('READ_ONLY');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'server-only') return {};
  if (request === 'next/cache') return { revalidatePath: () => {} };
  if (request === 'next/navigation') return { redirect: () => { throw new Error('Unexpected redirect'); } };
  if (request === '@/lib/current-user') return { currentUser: async () => effective, requireMutation: async permission => { if (!can(effective, permission)) throw new Error('Access denied'); return effective; } };
  if (request === '@/lib/prisma' || request === './prisma') return { prisma: noDb };
  if (request.startsWith('@/lib/')) return require(path.join(root, request.slice(2) + '.ts'));
  return originalLoad.call(this, request, parent, isMain);
};
const actions = {};
try {
  for (const name of ['accounts','contacts','opportunities','projects','products','tasks','activities','notes','administration/users','support/cases','price-exceptions/[id]']) actions[name] = require(path.join(root, 'app', name, 'actions.ts'));
} finally { Module._load = originalLoad; }
for (const role of ['READ_ONLY', 'EXECUTIVE']) test(`${role} direct business action invocations are denied without touching persistence`, async () => {
  effective = actor(role);
  const form = new FormData();
  for (const [key,value] of Object.entries({ subject:'Work', status:'OPEN', priority:'NORMAL', createKey:'d7054358-5d57-4398-8550-506157266184', role:'ADMIN', active:'true', supportCaseId:'5' })) form.set(key,value);
  const calls = [
    () => actions.accounts.submitAccount(null, {}, form), () => actions.accounts.changeArchiveState(1, true, {}),
    () => actions.contacts.submitContact(null, {}, form), () => actions.opportunities.submitOpportunity(null, {}, form),
    () => actions.projects.submitProject(null, {}, form), () => actions.products.submitProduct(null, {}, form),
    () => actions.products.submitProductSku(1, null, {}, form), () => actions.products.changeProductState(1, 'archived', {}),
    () => actions.tasks.submitTask(null, {}, form), () => actions.tasks.submitTask(1, {}, form), () => actions.tasks.archiveTask(1, {}), () => actions.tasks.reactivateTask(1, {}),
    () => actions.activities.setActivityArchived(form), () => actions.notes.archiveNote(1, {}), () => actions.notes.reactivateNote(1, {}),
    () => actions['administration/users'].resetGoogleIdentity(1, 1, {}, form),
    () => actions['administration/users'].submitUser(null, {}, form), () => actions['support/cases'].saveSupportCase(null, {}, form),
    () => actions['price-exceptions/[id]'].archivePriceException(form),
  ];
  for (const call of calls) {
    let denied = false;
    try { const result = await call(); denied = /Access denied/.test(result?.message ?? ''); }
    catch (error) { assert.match(error.message, /Access denied/); denied = true; }
    assert.equal(denied, true, call.toString());
  }
});
