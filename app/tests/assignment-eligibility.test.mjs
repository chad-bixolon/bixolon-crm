import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(import.meta.url);
const { eligibleUser, eligibleUserWhere, activeSalesRepWhere } = require(path.join(root, 'lib/assignment-eligibility.ts'));
const { accountOptions, checkAccountReferences, saveAccount } = require(path.join(root, 'lib/accounts.ts'));
const { parseAccountForm } = require(path.join(root, 'lib/account-validation.ts'));
const { opportunityOptions } = require(path.join(root, 'lib/opportunities.ts'));
const { saveTask } = require(path.join(root, 'lib/work.ts'));

const users = [
  { id: 1, firstName: 'Active', lastName: 'Sales', role: 'SALES', active: true, archivedAt: null },
  { id: 2, firstName: 'Read', lastName: 'Only', role: 'READ_ONLY', active: true, archivedAt: null },
  { id: 3, firstName: 'Inactive', lastName: 'Sales', role: 'SALES', active: false, archivedAt: null },
  { id: 4, firstName: 'Archived', lastName: 'Sales', role: 'SALES', active: true, archivedAt: new Date() },
  { id: 5, firstName: 'Active', lastName: 'Marketing', role: 'MARKETING_MANAGER', active: true, archivedAt: null },
];
function matches(where, user) {
  return user.active === where.active && user.archivedAt === where.archivedAt && where.role.in.includes(user.role);
}
function userClient() {
  return { user: { findMany: async ({ where }) => users.filter(user => matches(where, user)) } };
}

test('Account and Opportunity owner pickers include only active users with record write capability', async () => {
  const client = {
    ...userClient(),
    industry: { findMany: async () => [] }, territory: { findMany: async () => [] },
    account: { findMany: async () => [] }, contact: { findMany: async () => [] },
    salesStage: { findMany: async () => [] }, currency: { findMany: async () => [] },
    product: { count: async () => 0 }, project: { findMany: async () => [] },
    productCategory: { findMany: async () => [] }, competitorOption: { findMany: async () => [] },
  };
  assert.deepEqual((await accountOptions(client)).owners.map(user => user.id), [1, 5]);
  assert.deepEqual((await opportunityOptions(client)).owners.map(user => user.id), [1]);
});

test('Project owners and Task assignees use their own write permissions; forecast reps stay sales only', () => {
  assert.deepEqual(users.filter(user => matches(eligibleUserWhere('projects.write'), user)).map(user => user.id), [1]);
  assert.deepEqual(users.filter(user => matches(eligibleUserWhere('tasks.write'), user)).map(user => user.id), [1, 5]);
  assert.equal(eligibleUser(users[1], 'accounts.write'), false);
  assert.equal(eligibleUser(users[2], 'sales.write'), false);
  assert.equal(eligibleUser(users[3], 'tasks.write'), false);
  assert.deepEqual(users.filter(user => matches(activeSalesRepWhere(), user)).map(user => user.id), [1]);
});

test('Account historical owner survives edits, while new selections of ineligible users fail', async () => {
  const client = {
    account: { findUnique: async () => ({ industry: null, territory: null, ownerId: 2 }) },
    industry: { findFirst: async () => null }, territory: { findFirst: async () => null },
    user: { findFirst: async ({ where }) => users.find(user => user.id === where.id && matches(where, user)) ?? null },
  };
  const input = { industry: null, territory: null, ownerId: 2 };
  assert.deepEqual(await checkAccountReferences(client, input, 1), {});
  assert.deepEqual(await checkAccountReferences(client, input), { ownerId: 'Choose an eligible owner.' });
  assert.deepEqual(await checkAccountReferences(client, { ...input, ownerId: 3 }, 1), { ownerId: 'Choose an eligible owner.' });
  assert.deepEqual(await checkAccountReferences(client, { ...input, ownerId: 4 }, 1), { ownerId: 'Choose an eligible owner.' });
  assert.deepEqual(await checkAccountReferences(client, { ...input, ownerId: 1 }, 1), {});
});

test('Account save enforces eligibility even when called without form reference checks', async () => {
  const form = new FormData(); form.set('name', 'Existing');
  const value = { ...parseAccountForm(form).value, ownerId: 2 };
  let existing = { id: 10, status: 'ACTIVE', ownerId: 2 };
  const tx = {
    account: { findUnique: async () => existing, update: async ({ data }) => ({ ...existing, ...data }) },
    accountBusinessRole: { deleteMany: async () => ({ count: 0 }) },
    user: { findFirst: async ({ where }) => users.find(user => user.id === where.id && matches(where, user)) ?? null },
  };
  const client = { $transaction: async callback => callback(tx) };
  assert.equal(await saveAccount(client, value, 10), 10);
  existing = { ...existing, ownerId: 1 };
  await assert.rejects(saveAccount(client, value, 10), /eligible owner/);
});

test('Task assignment permits Marketing Managers, rejects read-only users, and preserves a historical assignee', async () => {
  let existing = null;
  const tx = {
    task: { findUnique: async () => existing, create: async ({ data }) => ({ id: 10, ...data }), update: async ({ data }) => ({ ...existing, ...data }) },
    user: { findFirst: async ({ where }) => users.find(user => user.id === where.id && matches(where, user)) ?? null },
  };
  const client = { $transaction: async callback => callback(tx) };
  const value = { subject: 'Follow up', description: null, accountId: null, opportunityId: null, projectId: null, status: 'OPEN', priority: 'NORMAL', dueDate: null, assignedToId: 5 };
  assert.equal((await saveTask(client, value)).assignedToId, 5);
  await assert.rejects(saveTask(client, { ...value, assignedToId: 2 }), /eligible assignee/);
  existing = { id: 10, assignedToId: 2, completedAt: null, archivedAt: null };
  assert.equal((await saveTask(client, { ...value, assignedToId: 2 }, 10)).assignedToId, 2);
});
