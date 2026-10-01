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
const { saveOpportunity, opportunityOptions } = require(path.join(root, 'lib/opportunities.ts'));
const { saveActivity } = require(path.join(root, 'lib/work.ts'));
const { activityChoices } = require(path.join(root, 'lib/activity-relations.ts'));
const { searchActivityContacts } = require(path.join(root, 'lib/activity-contact-picker.ts'));

const active = { id: 20, accountId: 10, active: true, archivedAt: null };
const inactive = { ...active, active: false };
const archived = { ...active, active: false, archivedAt: new Date('2026-09-01') };
const opportunityInput = { name: 'Updated fleet', description: null, ownerId: null, projectIds: [], stageId: 1, expectedCloseDate: null, probability: null, forecastCategory: null, currencyCode: 'USD', participants: [{ accountId: 10, roles: ['END_USER'] }], contacts: [{ contactId: 20, isPrimary: true }], lines: [] };

function opportunityDb(contact, initialLinks = [20]) {
  const links = new Set(initialLinks);
  let name = 'Fleet';
  const tx = {
    opportunity: { findUnique: async () => ({ id: 5, name, archivedAt: null, stageId: 1, competitorId: null, ownerId: null, projects: [] }), update: async ({ data }) => { name = data.name; } },
    opportunityProduct: { findMany: async () => [] },
    salesStage: { findUnique: async () => ({ id: 1, active: true, isClosed: false }) },
    currency: { findUnique: async () => ({ active: true }) },
    account: { findMany: async () => [{ id: 10 }] },
    contact: { findMany: async ({ where }) => where.id.in.includes(contact.id) ? [contact] : [] },
    product: { findMany: async () => [] }, project: { findMany: async () => [] },
    opportunityAccount: { findMany: async () => [{ accountId: 10, roles: [{ role: 'END_USER' }] }], upsert: async () => {} },
    opportunityAccountRole: { deleteMany: async () => {}, create: async () => {} },
    opportunityContact: {
      findMany: async () => [...links].map(contactId => ({ contactId })),
      delete: async ({ where }) => { links.delete(where.opportunityId_contactId.contactId); },
      updateMany: async () => {},
      upsert: async ({ create }) => { links.add(create.contactId); },
    },
  };
  return { client: { $transaction: async fn => fn(tx) }, links, get name() { return name; } };
}

test('Opportunity retains active, inactive, and archived historical Contacts on unrelated edits', async () => {
  for (const contact of [active, inactive, archived]) {
    const db = opportunityDb(contact);
    await saveOpportunity(db.client, opportunityInput, 5);
    assert.deepEqual([...db.links], [20]);
    assert.equal(db.name, 'Updated fleet');
  }
});

test('Opportunity blocks new inactive or archived links and cannot re-add after removal', async () => {
  const activeDb = opportunityDb(active, []);
  await saveOpportunity(activeDb.client, opportunityInput, 5);
  assert.deepEqual([...activeDb.links], [20]);
  for (const contact of [inactive, archived]) {
    const db = opportunityDb(contact, []);
    await assert.rejects(saveOpportunity(db.client, opportunityInput, 5), /Choose active Contacts/);
    assert.deepEqual([...db.links], []);
  }
  const db = opportunityDb(inactive);
  await saveOpportunity(db.client, { ...opportunityInput, contacts: [] }, 5);
  assert.deepEqual([...db.links], []);
  await assert.rejects(saveOpportunity(db.client, opportunityInput, 5), /Choose active Contacts/);
});

test('Contact history exception does not change Opportunity owner permissions', async () => {
  const db = opportunityDb(inactive);
  await assert.rejects(saveOpportunity(db.client, opportunityInput, 5, { id: 7, role: 'SALES', active: true, archivedAt: null }), /Sales users may edit only their own Opportunities/);
  assert.deepEqual([...db.links], [20]);
});

test('Opportunity picker offers only active Contacts while its edit and detail views label historical links', async () => {
  let where;
  const client = {
    account: { findMany: async () => [] }, contact: { findMany: async args => { where = args.where; return []; } },
    user: { findMany: async () => [] }, salesStage: { findMany: async () => [] }, currency: { findMany: async () => [] },
    product: { count: async () => 0 }, project: { findMany: async () => [] }, productCategory: { findMany: async () => [] }, competitorOption: { findMany: async () => [] },
  };
  await opportunityOptions(client);
  assert.equal(where.active, true);
  assert.equal(where.archivedAt, null);
  const edit = fs.readFileSync(path.join(root, 'app/opportunities/[id]/edit/page.tsx'), 'utf8');
  const form = fs.readFileSync(path.join(root, 'components/opportunity-form.tsx'), 'utf8');
  const detail = fs.readFileSync(path.join(root, 'app/opportunities/[id]/page.tsx'), 'utf8');
  assert.match(edit, /linkedContacts=\{linkedContacts\}/);
  assert.match(form, /historical\?\.archivedAt/);
  assert.match(form, /!historical\.active/);
  assert.match(detail, /!link\.contact\.active/);
});

const activityInput = { subject: 'Call updated', description: null, accountId: 10, opportunityId: null, projectId: null, userId: null, type: 'CALL', activityDate: new Date('2026-09-01'), direction: 'NA', outcome: null, nextStep: null, followUpDate: null, contactIds: [20], createFollowUpTask: false, followUpTaskCreateKey: null };
function activityDb(contact, initialLinks = [20]) {
  const links = new Set(initialLinks);
  const tx = {
    account: { findFirst: async () => ({ id: 10 }) },
    activity: { findFirst: async () => ({ id: 7, accountId: 10, opportunityId: null, projectId: null, type: 'CALL', userId: null, archivedAt: null }), update: async ({ data }) => ({ id: 7, ...data }) },
    activityType: { findFirst: async () => ({ code: 'CALL' }) },
    contact: { findMany: async ({ where }) => where.id.in.includes(contact.id) ? [contact] : [] },
    activityContact: {
      findMany: async () => [...links].map(contactId => ({ contactId })),
      createMany: async ({ data }) => { data.forEach(link => links.add(link.contactId)); },
      deleteMany: async ({ where }) => { where.contactId.in.forEach(id => links.delete(id)); },
    },
  };
  return { client: { $transaction: async fn => fn(tx) }, links };
}

test('Activity preserves inactive and archived history, removes links, and rejects new inactive links', async () => {
  const activeDb = activityDb(active, []);
  await saveActivity(activeDb.client, activityInput, 7);
  assert.deepEqual([...activeDb.links], [20]);
  for (const contact of [inactive, archived]) {
    const db = activityDb(contact);
    await saveActivity(db.client, activityInput, 7);
    assert.deepEqual([...db.links], [20]);
    await saveActivity(db.client, { ...activityInput, contactIds: [] }, 7);
    assert.deepEqual([...db.links], []);
    await assert.rejects(saveActivity(db.client, activityInput, 7), /Choose an active Contact/);
  }
  const db = activityDb(inactive, []);
  await assert.rejects(saveActivity(db.client, activityInput, 7), /Choose an active Contact/);
});

test('Activity picker keeps linked history visible but excludes inactive and archived Contacts from add choices', () => {
  const rows = [
    { id: 20, name: 'Jane Inactive', accountId: 10, active: false, archivedAt: null },
    { id: 21, name: 'Sam Archived', accountId: 10, active: false, archivedAt: new Date() },
    { id: 22, name: 'Ada Active', accountId: 10, active: true, archivedAt: null },
  ];
  const choices = activityChoices(10, 10, [], [], rows, { contactIds: [20, 21] }).contacts;
  assert.deepEqual(choices.map(row => row.id), [20, 21, 22]);
  assert.deepEqual(searchActivityContacts(choices, '', []).map(row => row.id), [22]);
  const changedAccount = activityChoices(11, 10, [], [], rows, { contactIds: [20, 21] }).contacts;
  assert.deepEqual(changedAccount.map(row => row.id), [20, 21]);
  assert.deepEqual(searchActivityContacts(changedAccount, '', []), []);
  const picker = fs.readFileSync(path.join(root, 'components/activity-contact-picker.tsx'), 'utf8');
  assert.match(picker, /contact\?\.archivedAt/);
  assert.match(picker, /!contact\.active/);
});
