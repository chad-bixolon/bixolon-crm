import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(fileURLToPath(import.meta.url));
const projects = require(path.join(root, 'lib/projects.ts'));
const opportunities = require(path.join(root, 'lib/opportunities.ts'));
const { routeAccess } = require(path.join(root, 'lib/authorization.ts'));
const actor = (role, id = 7) => ({ id, role, active: true, archivedAt: null });
function form(entries) { const value = new FormData(); for (const [key, item] of entries) value.append(key, item); return value; }
const base = [['name', 'RFID SPSF'], ['primaryAccountId', '1'], ['primaryAccountRole', 'PROGRAM_OWNER'], ['status', 'PLANNING']];

test('Project parser accepts multiple roles and rejects duplicate or Primary Account participation', () => {
  const valid = projects.parseProject(form([...base, ['accountId', '2'], ['participantRoles', 'SERVICE_PROVIDER,CONNECTIVITY_PROVIDER']]));
  assert.deepEqual(valid.errors, {});
  assert.deepEqual(valid.value.participants, [{ accountId: 2, roles: ['SERVICE_PROVIDER', 'CONNECTIVITY_PROVIDER'] }]);
  assert.equal(valid.value.ownerId, null);
  assert.equal(valid.value.status, 'PLANNING');
  const primary = projects.parseProject(form([...base, ['accountId', '1'], ['participantRoles', 'END_CUSTOMER']]));
  assert.match(primary.errors.participants, /Primary Account/);
  const duplicate = projects.parseProject(form([...base, ['accountId', '2'], ['participantRoles', 'ISV'], ['accountId', '2'], ['participantRoles', 'OEM']]));
  assert.match(duplicate.errors.participants, /only once/);
  const noRole = projects.parseProject(form([...base, ['accountId', '2'], ['participantRoles', '']]));
  assert.match(noRole.errors.participants, /at least one/);
});

test('SALES can read active Projects and edit only owned Project or Primary Account', () => {
  assert.deepEqual(projects.projectReadWhere(actor('SALES')).OR[0], { archivedAt: null });
  assert.equal(projects.canEditProject(actor('SALES'), { ownerId: 7, primaryAccount: { ownerId: 8 } }), true);
  assert.equal(projects.canEditProject(actor('SALES'), { ownerId: 8, primaryAccount: { ownerId: 7 } }), true);
  assert.equal(projects.canEditProject(actor('SALES'), { ownerId: 8, primaryAccount: { ownerId: 9 }, participants: [{ account: { ownerId: 7 } }] }), false);
  for (const role of ['ADMIN', 'SALES_MANAGER']) assert.equal(projects.canEditProject(actor(role), { ownerId: 8, primaryAccount: { ownerId: 9 } }), true);
  for (const role of ['MARKETING_MANAGER', 'READ_ONLY']) {
    assert.equal(projects.canEditProject(actor(role), { ownerId: 7, primaryAccount: { ownerId: 7 } }), false);
    assert.equal(routeAccess('/projects/new', actor(role)), 'denied');
    assert.equal(routeAccess('/projects', actor(role)), 'allowed');
  }
});

test('Project create and edit save participants transactionally; changing Primary Account removes collision first', async () => {
  const calls = [];
  let stored = null;
  let memberships = [];
  const tx = {
    project: {
      findUnique: async () => stored && { ...stored, primaryAccount: { ownerId: 7 }, participants: memberships },
      create: async ({ data }) => { calls.push('create Project'); stored = { id: 10, archivedAt: null, ...data }; return stored; },
      update: async ({ data }) => { calls.push('update Project'); stored = { ...stored, ...data }; return stored; },
    },
    account: { findMany: async ({ where }) => where.id.in.map(id => ({ id })) },
    user: { findFirst: async () => ({ id: 7 }) },
    projectAccount: {
      upsert: async ({ create }) => { calls.push(`add ${create.accountId}`); memberships.push({ accountId: create.accountId, roles: [] }); },
      delete: async ({ where }) => { calls.push(`remove ${where.projectId_accountId.accountId}`); memberships = memberships.filter(p => p.accountId !== where.projectId_accountId.accountId); },
    },
    projectAccountRole: {
      create: async ({ data }) => { calls.push(`role ${data.role}`); memberships.find(p => p.accountId === data.accountId)?.roles.push({ role: data.role }); },
      deleteMany: async ({ where }) => { calls.push(`remove roles ${where.accountId}`); },
    },
  };
  const client = { $transaction: async fn => fn(tx) };
  const first = projects.parseProject(form([...base, ['ownerId', '7'], ['accountId', '2'], ['participantRoles', 'ISV,OEM']])).value;
  assert.equal(await projects.saveProject(client, first, actor('SALES')), 10);
  assert.deepEqual(memberships[0].roles.map(r => r.role), ['ISV', 'OEM']);
  calls.length = 0;
  const edited = { ...first, primaryAccountId: 2, participants: [{ accountId: 1, roles: ['END_CUSTOMER'] }] };
  assert.equal(await projects.saveProject(client, edited, actor('SALES'), 10), 10);
  assert.deepEqual(calls.slice(0, 3), ['remove roles 2', 'remove 2', 'update Project']);
  assert.equal(stored.primaryAccountId, 2);
  assert.ok(calls.includes('add 1'));
  await assert.rejects(projects.saveProject(client, edited, actor('MARKETING_MANAGER'), 10), /Access denied/);
});

test('Account Projects query includes primary and participant relationships once each', async () => {
  const rows = [
    { id: 10, primaryAccountId: 1, primaryAccountRole: 'PROGRAM_OWNER', participants: [] },
    { id: 11, primaryAccountId: 2, primaryAccountRole: 'PROGRAM_OWNER', participants: [{ accountId: 1, roles: [{ role: 'SERVICE_PROVIDER' }] }] },
  ];
  let where;
  const client = { project: { findMany: async args => { where = args.where; return rows; } } };
  assert.equal((await projects.listAccountProjects(client, 1, actor('SALES'))).length, 2);
  assert.deepEqual(where.AND[1].OR, [{ primaryAccountId: 1 }, { participants: { some: { accountId: 1 } } }]);
  assert.match(projects.accountProjectRelationship(rows[0], 1), /Primary Account/);
  assert.match(projects.accountProjectRelationship(rows[1], 1), /Additional Participant · Service Provider/);
});

test('Opportunity remains valid without a Project and can link one without changing participants', async () => {
  const input = [['name', 'J.Crew RFID Deployment'], ['stageId', '3'], ['currencyCode', 'USD'], ['accountId', '4'], ['participantRoles', 'END_USER']];
  const without = opportunities.parseOpportunity(form(input));
  const withProject = opportunities.parseOpportunity(form([...input, ['projectId', '10']]));
  assert.equal(without.value.projectId, null);
  assert.equal(withProject.value.projectId, 10);
  assert.deepEqual(without.value.participants, withProject.value.participants);
  const saved = [];
  const tx = {
    salesStage: { findUnique: async () => ({ active: true }) }, currency: { findUnique: async () => ({ active: true }) },
    account: { findMany: async () => [{ id: 4 }] }, product: { findMany: async () => [] },
    project: { findUnique: async () => ({ id: 10, archivedAt: null }) },
    opportunity: { create: async ({ data }) => { saved.push(data); return { id: saved.length }; } },
    opportunityAccount: { findMany: async () => [], upsert: async () => {} },
    opportunityAccountRole: { create: async () => {} }, opportunityProduct: { findMany: async () => [] },
  };
  const client = { $transaction: async fn => fn(tx) };
  await opportunities.saveOpportunity(client, without.value);
  await opportunities.saveOpportunity(client, withProject.value);
  assert.deepEqual(saved.map(row => row.projectId), [null, 10]);
  assert.deepEqual(opportunities.opportunityWhere({ projectId: '10' }).projectId, 10);
  assert.equal(opportunities.opportunityWhere({ projectId: 'none' }).projectId, null);
});

test('Pipeline Project filter supports one Project, no Project, and all Projects', () => {
  assert.deepEqual(projects.pipelineProjectFilter('10'), { projectId: 10 });
  assert.deepEqual(projects.pipelineProjectFilter('none'), { projectId: null });
  assert.deepEqual(projects.pipelineProjectFilter(''), {});
});
