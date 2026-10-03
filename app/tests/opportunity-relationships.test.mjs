import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(fileURLToPath(import.meta.url));
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { saveOpportunity } = require(path.join(root, 'lib/opportunities.ts'));
const actor = { id: 7, role: 'ADMIN', active: true, archivedAt: null };
const accountNames = new Map([[1, 'BlueStar'], [2, 'Operandi'], [3, 'Northwind']]);
const contactNames = new Map([[10, ['Jane', 'Smith']], [11, ['John', 'Doe']]]);
const projectNames = new Map([[20, 'SRP-S300II Deployment'], [21, 'Retail Rollout']]);
const participant = (accountId, ...roles) => ({ accountId, roles });
const input = (participants = [participant(1, 'VAR_RESELLER'), participant(2, 'END_USER')], contacts = [], projectIds = []) => ({
  name: 'Deal', description: null, ownerId: null, projectIds, stageId: 1, expectedCloseDate: null,
  probability: null, forecastCategory: 'PIPELINE', currencyCode: 'USD', participants,
  contacts: contacts.map(contactId => ({ contactId, isPrimary: false })), lines: [],
});

function fixture({ accounts = [[1, ['VAR_RESELLER']], [2, ['END_USER']]], contacts = [], projects = [], failHistory = false } = {}) {
  let state = { accounts: new Map(accounts), contacts: new Map(contacts.map(id => [id, false])), projects: new Set(projects) };
  const events = [];
  const client = { $transaction: async fn => {
    const working = { accounts: new Map([...state.accounts].map(([id, roles]) => [id, [...roles]])), contacts: new Map(state.contacts), projects: new Set(state.projects) };
    const pending = [];
    const tx = {
      opportunity: {
        findUnique: async () => ({ id: 5, name: 'Deal', archivedAt: null, stageId: 1, stage: { name: 'Open' }, ownerId: null, owner: null, forecastCategory: 'PIPELINE', expectedCloseDate: null, probability: null, currencyCode: 'USD',
          participants: [...working.accounts].map(([accountId]) => ({ accountId, account: { name: accountNames.get(accountId) } })),
          projects: [...working.projects].map(projectId => ({ projectId, project: { name: projectNames.get(projectId) } })) }),
        update: async () => ({}),
      },
      opportunityProduct: { findMany: async () => [] },
      opportunityHistoryEvent: { createMany: async ({ data }) => { if (failHistory) throw new Error('history unavailable'); pending.push(...data); return { count: data.length }; } },
      salesStage: { findUnique: async () => ({ id: 1, name: 'Open', active: true, isClosed: false, isWon: false }) },
      currency: { findUnique: async () => ({ active: true }) },
      user: { findUnique: async () => ({ id: 7, firstName: 'Ryan', lastName: 'Persaud', active: true, role: 'ADMIN' }) },
      account: { findMany: async ({ where }) => where.id.in.map(id => ({ id, name: accountNames.get(id) })) },
      contact: { findMany: async ({ where }) => where.id.in.map(id => ({ id, accountId: null, active: true, archivedAt: null, firstName: contactNames.get(id)[0], lastName: contactNames.get(id)[1] })) },
      product: { findMany: async () => [] },
      project: { findMany: async ({ where }) => where.id.in.map(id => ({ id, name: projectNames.get(id), archivedAt: null })) },
      opportunityAccount: {
        findMany: async () => [...working.accounts].map(([accountId, roles]) => ({ accountId, roles: roles.map(role => ({ role })) })),
        delete: async ({ where }) => { working.accounts.delete(where.opportunityId_accountId.accountId); },
        upsert: async ({ where }) => { const id = where.opportunityId_accountId.accountId; if (!working.accounts.has(id)) working.accounts.set(id, []); },
      },
      opportunityAccountRole: {
        deleteMany: async ({ where }) => { working.accounts.set(where.accountId, (working.accounts.get(where.accountId) ?? []).filter(role => !where.role || !where.role.in.includes(role))); },
        create: async ({ data }) => { working.accounts.get(data.accountId).push(data.role); },
      },
      opportunityContact: {
        findMany: async () => [...working.contacts].map(([contactId]) => ({ contactId, contact: { firstName: contactNames.get(contactId)[0], lastName: contactNames.get(contactId)[1] } })),
        delete: async ({ where }) => { working.contacts.delete(where.opportunityId_contactId.contactId); },
        updateMany: async () => { for (const id of working.contacts.keys()) working.contacts.set(id, false); },
        upsert: async ({ where, create }) => { working.contacts.set(where.opportunityId_contactId.contactId, create.isPrimary); },
      },
      opportunityProject: {
        create: async ({ data }) => { working.projects.add(data.projectId); },
        delete: async ({ where }) => { working.projects.delete(where.opportunityId_projectId.projectId); },
      },
    };
    const result = await fn(tx);
    state = working;
    events.push(...pending);
    return result;
  } };
  return { client, events, get state() { return state; } };
}

test('Account additions, removals, and role changes use names and structured role snapshots', async () => {
  const db = fixture();
  await saveOpportunity(db.client, input([participant(1, 'DISTRIBUTOR'), participant(3, 'OEM')]), 5, actor);
  assert.deepEqual(db.events.map(event => event.eventType), ['ACCOUNT_ROLE_CHANGED', 'ACCOUNT_REMOVED', 'ACCOUNT_ADDED']);
  assert.deepEqual(db.events.map(event => [event.relatedRecordId, event.relatedRecordName]), [[1, 'BlueStar'], [2, 'Operandi'], [3, 'Northwind']]);
  assert.deepEqual(db.events[0].oldRoles, ['VAR_RESELLER']);
  assert.deepEqual(db.events[0].newRoles, ['DISTRIBUTOR']);
  assert.deepEqual(db.events[2].newRoles, ['OEM']);
  assert.ok(db.events.every(event => event.actorId === 7 && event.actorName === 'Ryan Persaud'));
  db.events.length = 0;
  await saveOpportunity(db.client, input([participant(3, 'OEM'), participant(1, 'DISTRIBUTOR')]), 5, actor);
  assert.deepEqual(db.events, []);
});

test('reordered multi-role Accounts are unchanged, while a role-set edit makes one event', async () => {
  const db = fixture({ accounts: [[1, ['VAR_RESELLER', 'DISTRIBUTOR']], [2, ['END_USER']]] });
  await saveOpportunity(db.client, input([participant(2, 'END_USER'), participant(1, 'DISTRIBUTOR', 'VAR_RESELLER')]), 5, actor);
  assert.deepEqual(db.events, []);
  await saveOpportunity(db.client, input([participant(1, 'DISTRIBUTOR', 'OEM'), participant(2, 'END_USER')]), 5, actor);
  assert.deepEqual(db.events.map(event => event.eventType), ['ACCOUNT_ROLE_CHANGED']);
  assert.deepEqual(db.events[0].oldRoles, ['DISTRIBUTOR', 'VAR_RESELLER']);
  assert.deepEqual(db.events[0].newRoles, ['DISTRIBUTOR', 'OEM']);
});

test('Contact add and remove events use names; unchanged membership stays quiet', async () => {
  const db = fixture({ contacts: [10] });
  await saveOpportunity(db.client, input(undefined, [11]), 5, actor);
  assert.deepEqual(db.events.map(event => [event.eventType, event.relatedRecordName]), [['CONTACT_REMOVED', 'Jane Smith'], ['CONTACT_ADDED', 'John Doe']]);
  db.events.length = 0;
  await saveOpportunity(db.client, input(undefined, [11]), 5, actor);
  assert.deepEqual(db.events, []);
});

test('Opportunity save records Project link and unlink once, with preserved names', async () => {
  const db = fixture({ projects: [20] });
  await saveOpportunity(db.client, input(undefined, [], [21]), 5, actor);
  assert.deepEqual(db.events.map(event => [event.eventType, event.relatedRecordName]), [['PROJECT_UNLINKED', 'SRP-S300II Deployment'], ['PROJECT_LINKED', 'Retail Rollout']]);
  db.events.length = 0;
  await saveOpportunity(db.client, input(undefined, [], [21]), 5, actor);
  assert.deepEqual(db.events, []);
});

test('history failure rolls back relationship mutations with the Opportunity save', async () => {
  const db = fixture({ failHistory: true });
  await assert.rejects(saveOpportunity(db.client, input([participant(1, 'DISTRIBUTOR'), participant(3, 'OEM')]), 5, actor), /history unavailable/);
  assert.deepEqual([...db.state.accounts], [[1, ['VAR_RESELLER']], [2, ['END_USER']]]);
  assert.deepEqual(db.events, []);
});
