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
const contacts = require(path.join(root, 'lib/contacts.ts'));
const opportunities = require(path.join(root, 'lib/opportunities.ts'));
const drafts = require(path.join(root, 'lib/opportunity-draft.ts'));
const { partyLabels, opportunityPartyLabels } = require(path.join(root, 'lib/crm-validation.ts'));
const { defaultLabels } = require(path.join(root, 'lib/configuration.ts'));
const users = require(path.join(root, 'lib/users.ts'));
const visibility = require(path.join(root, 'lib/record-visibility.ts'));
function form(entries) { const f = new FormData(); for (const [key, value] of entries) f.append(key, value); return f; }
test('shared record visibility and opportunity filters include archived and all views', () => {
  assert.deepEqual(visibility.archivedWhere(visibility.recordVisibility(undefined)), { archivedAt: null });
  assert.deepEqual(visibility.archivedWhere(visibility.recordVisibility('archived')), { archivedAt: { not: null } });
  assert.deepEqual(visibility.archivedWhere(visibility.recordVisibility('all')), {});
  assert.deepEqual(opportunities.opportunityWhere({ archived: 'yes' }).archivedAt, { not: null });
  assert.equal('archivedAt' in opportunities.opportunityWhere({ archived: 'all' }), false);
});
test('contact validation and lifecycle enforce active primary contacts', async () => {
  const invalid = contacts.parseContact(form([['accountId', '0'], ['firstName', ''], ['lastName', 'Doe'], ['email', 'bad'], ['phone', 'abc'], ['active', 'false'], ['isPrimary', 'on']]));
  assert.deepEqual(Object.keys(invalid.errors).sort(), ['accountId', 'email', 'firstName', 'isPrimary', 'phone']);
  let row = { id: 7, accountId: 2, active: true, isPrimary: true, archivedAt: null };
  const client = { contact: { findUnique: async () => row, update: async ({ data }) => { row = { ...row, ...data }; } }, account: { findUnique: async () => ({ status: 'ACTIVE' }) } };
  await contacts.setContactState(client, 7, 'inactive'); assert.equal(row.isPrimary, false); assert.equal(row.active, false);
  await contacts.setContactState(client, 7, 'archived'); assert.ok(row.archivedAt); assert.equal(row.active, false);
  await contacts.setContactState(client, 7, 'active'); assert.equal(row.archivedAt, null); assert.equal(row.isPrimary, false);
});
test('setting a new primary clears the previous primary inside the save transaction', async () => {
  const calls = [];
  const client = { $transaction: async (fn) => fn({ account: { findUnique: async () => ({ status: 'ACTIVE' }) }, contact: {
    findUnique: async () => ({ id: 8, archivedAt: null }), updateMany: async (args) => calls.push(['clear', args]), update: async (args) => { calls.push(['save', args]); return { id: 8 }; },
  } }) };
  const input = { accountId: 2, firstName: 'Ada', lastName: 'Lovelace', title: null, email: null, phone: null, mobile: null, active: true, isPrimary: true };
  assert.equal(await contacts.saveContact(client, input, 8), 8);
  assert.equal(calls[0][0], 'clear'); assert.deepEqual(calls[0][1].where, { accountId: 2, isPrimary: true, id: { not: 8 } }); assert.equal(calls[1][0], 'save');
});
test('unassigned Contacts can be created, assigned later, and filtered', async () => {
  const base = [['firstName', 'Ada'], ['lastName', 'Lovelace']];
  const unassigned = contacts.parseContact(form(base));
  assert.deepEqual(unassigned.errors, {});
  assert.equal(unassigned.value.accountId, null);
  assert.match(contacts.parseContact(form([...base, ['isPrimary', 'on']])).errors.isPrimary, /account/);
  assert.deepEqual(contacts.contactWhere({ accountId: 'unassigned', q: 'Ada' }).accountId, null);
  assert.deepEqual(contacts.contactWhere({ accountId: '2' }).accountId, 2);
  let row;
  const calls = [];
  const client = { $transaction: async fn => fn({
    account: { findUnique: async ({ where }) => { calls.push(['account', where.id]); return { status: 'ACTIVE' }; } },
    contact: {
      findUnique: async () => row,
      create: async ({ data }) => (row = { id: 9, ...data, archivedAt: null }),
      update: async ({ data }) => (row = { ...row, ...data }),
      updateMany: async args => calls.push(['primary', args.where.accountId]),
    },
  }) };
  assert.equal(await contacts.saveContact(client, unassigned.value), 9);
  assert.equal(row.accountId, null);
  assert.deepEqual(calls, []);
  const assigned = contacts.parseContact(form([...base, ['accountId', '2'], ['isPrimary', 'on']]));
  assert.equal(await contacts.saveContact(client, assigned.value, 9), 9);
  assert.equal(row.accountId, 2);
  assert.deepEqual(calls, [['account', 2], ['primary', 2]]);
  const moved = contacts.parseContact(form([...base, ['accountId', '3']]));
  assert.equal(await contacts.saveContact(client, moved.value, 9), 9);
  assert.equal(row.accountId, 3);
  assert.equal(row.isPrimary, false);
});
test('opportunity parser retains multiple accounts and roles', () => {
  const parsed = opportunities.parseOpportunity(form([['name', 'New fleet'], ['stageId', '1'], ['currencyCode', 'USD'], ['accountId', '11'], ['participantRoles', 'END_USER,OEM'], ['accountId', '12'], ['participantRoles', 'DISTRIBUTOR,VAR_RESELLER'], ['productId', '3'], ['quantity', '2'], ['price', '19.95']]));
  assert.deepEqual(parsed.errors, {});
  assert.deepEqual(parsed.value.participants, [{ accountId: 11, roles: ['END_USER', 'OEM'] }, { accountId: 12, roles: ['DISTRIBUTOR', 'VAR_RESELLER'] }]);
  assert.deepEqual(parsed.value.lines, [{ id: undefined, productId: 3, quantity: 2, price: '19.95' }]);
});
test('participant addition and removal prevent duplicate accounts and preserve selected roles', () => {
  const base = { name: 'Working draft', description: '', ownerId: '', stageId: '1', expectedCloseDate: '', probability: '', forecastCategory: '', currencyCode: 'USD', projectIds: [], participants: [], lines: [] };
  const added = drafts.addParticipant(base, 11);
  assert.equal(drafts.addParticipant(added, 11), added);
  const withRoles = drafts.setParticipantRoles(added, 11, ['END_USER', 'OEM']);
  assert.deepEqual(withRoles.participants, [{ accountId: 11, roles: ['END_USER', 'OEM'] }]);
  assert.deepEqual(drafts.removeParticipant(withRoles, 11).participants, []);
  assert.deepEqual(base.participants, []);
});
test('opportunity participant roles start empty and stay independent of account business roles', () => {
  assert.equal(partyLabels.MEDIA_PARTNER, 'Media Partner');
  assert.equal(opportunityPartyLabels(defaultLabels).MEDIA_PARTNER, 'Media Partner');
  const account = { id: 11, businessRoles: ['MEDIA_PARTNER', 'OEM'] };
  const base = { participants: [] };
  const added = drafts.addParticipant(base, account.id);
  assert.deepEqual(added.participants, [{ accountId: 11, roles: [] }]);
  const assigned = drafts.setParticipantRoles(added, account.id, ['MEDIA_PARTNER', 'VAR_RESELLER']);
  assert.deepEqual(assigned.participants[0].roles, ['MEDIA_PARTNER', 'VAR_RESELLER']);
  assert.deepEqual(account.businessRoles, ['MEDIA_PARTNER', 'OEM']);
  const parsed = opportunities.parseOpportunity(form([['name', 'Media deal'], ['stageId', '1'], ['currencyCode', 'USD'], ['accountId', '11'], ['participantRoles', 'MEDIA_PARTNER']]));
  assert.deepEqual(parsed.value.participants, [{ accountId: 11, roles: ['MEDIA_PARTNER'] }]);
  assert.deepEqual(account.businessRoles, ['MEDIA_PARTNER', 'OEM']);
});
test('opportunity draft restores every editable field after remount without changing the fallback', () => {
  const fallback = { name: '', description: '', ownerId: '', stageId: '', expectedCloseDate: '', probability: '', forecastCategory: '', currencyCode: 'USD', projectIds: [], participants: [], lines: [] };
  const saved = { ...fallback, name: 'Fleet rollout', description: 'Call next week', ownerId: '4', stageId: '2', expectedCloseDate: '2026-10-01', probability: '70', forecastCategory: 'COMMIT', participants: [{ accountId: 11, roles: ['END_USER'] }], lines: [{ id: 0, productId: 3, quantity: '2', price: '19.95' }] };
  assert.deepEqual(drafts.readDraft(JSON.stringify(saved), fallback), saved);
  const legacy = { ...saved }; delete legacy.projectIds;
  assert.deepEqual(drafts.readDraft(JSON.stringify({ ...legacy, projectId: '9' }), fallback), { ...saved, projectIds: [9] });
  assert.equal(drafts.readDraft('{broken', fallback), fallback);
  assert.deepEqual(fallback.participants, []);
});
test('local opportunity draft survives blank remount defaults and waits for hydration before writes', () => {
  const storage = new Map();
  const localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
  const key = drafts.draftKey();
  assert.equal(key, 'opportunity-draft:new');
  assert.equal(drafts.draftKey(42), 'opportunity-draft:42');
  const blank = { name: '', description: '', ownerId: '', stageId: '', expectedCloseDate: '', probability: '', forecastCategory: '', currencyCode: 'USD', projectIds: [], participants: [], lines: [] };
  const saved = { ...blank, name: 'Fleet rollout', description: 'Call next week', ownerId: '4', stageId: '2', expectedCloseDate: '2026-10-01', probability: '70', forecastCategory: 'COMMIT', currencyCode: 'EUR', participants: [{ accountId: 11, roles: ['END_USER', 'OEM'] }], lines: [{ id: 0, productId: 3, quantity: '2', price: '19.95' }] };
  storage.set(key, JSON.stringify(saved));
  const storedBeforeHydration = storage.get(key);
  assert.equal(drafts.persistDraft(localStorage, key, blank, null), false);
  assert.equal(storage.get(key), storedBeforeHydration);
  const restored = drafts.restoreDraft(localStorage, key, blank);
  assert.deepEqual(restored, saved);
  assert.equal(drafts.persistDraft(localStorage, key, restored, key), true);
  assert.deepEqual(JSON.parse(storage.get(key)), saved);
  const remounted = drafts.restoreDraft(localStorage, key, blank);
  assert.deepEqual(remounted, saved);
  assert.equal(drafts.persistDraft(localStorage, key, blank, 'opportunity-draft:other'), false);
  assert.deepEqual(JSON.parse(storage.get(key)), saved);
  drafts.clearDraft(localStorage, key); // successful save
  assert.equal(storage.has(key), false);
  storage.set(key, JSON.stringify(saved));
  drafts.clearDraft(localStorage, key); // explicit Cancel
  assert.equal(storage.has(key), false);
});
test('opportunity draft rejects malformed scalar, participant, and line fields', () => {
  const fallback = { name: '', description: '', ownerId: '', stageId: '', expectedCloseDate: '', probability: '', forecastCategory: '', currencyCode: 'USD', projectIds: [], participants: [], lines: [] };
  const valid = { ...fallback, participants: [{ accountId: 11, roles: ['END_USER'] }], lines: [{ id: 0, productId: 3, quantity: '2', price: '19.95' }] };
  for (const field of ['name', 'description', 'ownerId', 'stageId', 'expectedCloseDate', 'probability', 'currencyCode']) {
    assert.equal(drafts.readDraft(JSON.stringify({ ...valid, [field]: null }), fallback), fallback, field);
  }
  assert.equal(drafts.readDraft(JSON.stringify({ ...valid, forecastCategory: 'INVALID' }), fallback), fallback);
  for (const participant of [{ accountId: '11', roles: [] }, { accountId: 11, roles: 'END_USER' }, { accountId: 11, roles: ['INVALID'] }]) {
    assert.equal(drafts.readDraft(JSON.stringify({ ...valid, participants: [participant] }), fallback), fallback);
  }
  for (const line of [{ id: '0', productId: 3, quantity: '2', price: '19.95' }, { id: 0, productId: null, quantity: '2', price: '19.95' }, { id: 0, productId: 3, quantity: 2, price: '19.95' }, { id: 0, productId: 3, quantity: '2', price: null }]) {
    assert.equal(drafts.readDraft(JSON.stringify({ ...valid, lines: [line] }), fallback), fallback);
  }
});
test('opportunity parser rejects duplicate participants', () => {
  const parsed = opportunities.parseOpportunity(form([['name', 'Duplicate'], ['stageId', '1'], ['currencyCode', 'USD'], ['accountId', '11'], ['participantRoles', 'END_USER'], ['accountId', '11'], ['participantRoles', 'OEM']]));
  assert.equal(parsed.errors.participants, 'Choose each account only once.');
});
test('user validation requires identity, role, and status without credentials', () => {
  const parsed = users.parseUser(form([['firstName', ' Ada '], ['lastName', 'Lovelace'], ['email', 'ADA@EXAMPLE.COM'], ['role', 'SALES'], ['active', 'true']]));
  assert.deepEqual(parsed.errors, {});
  assert.deepEqual(parsed.value, { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', role: 'SALES', active: true });
  assert.deepEqual(Object.keys(users.parseUser(form([['firstName', ''], ['lastName', ''], ['email', 'bad'], ['role', 'OWNER'], ['active', 'maybe']])).errors).sort(), ['active', 'email', 'firstName', 'lastName', 'role']);
});
test('opportunity value excludes archived lines and weights by probability', () => {
  const lines = [{ quantity: 2, estimatedUnitPrice: '19.95', archivedAt: null }, { quantity: 3, estimatedUnitPrice: '10.00', archivedAt: new Date() }];
  const total = opportunities.opportunityTotal(lines);
  assert.equal(total.toFixed(2), '39.90'); assert.equal(opportunities.weightedValue(total, 25).toFixed(2), '9.98'); assert.equal(opportunities.weightedValue(total, 80).toFixed(2), '31.92');
});
test('saving an opportunity persists each account and each selected role', async () => {
  const memberships = [], roles = [], productLines = [];
  const tx = {
    salesStage: { findUnique: async () => ({ active: true }) }, currency: { findUnique: async () => ({ active: true }) },
    account: { findMany: async () => [{ id: 11 }, { id: 12 }] }, product: { findMany: async () => [{ id: 3 }] }, project: { findMany: async () => [] },
    accountBusinessRole: { create: async () => { throw Error('Opportunity changed Account roles'); }, deleteMany: async () => { throw Error('Opportunity changed Account roles'); } },
    opportunity: { create: async () => ({ id: 5 }) },
    opportunityAccount: { findMany: async () => [], upsert: async ({ create }) => memberships.push(create) },
    opportunityAccountRole: { create: async ({ data }) => roles.push(data) },
    opportunityProduct: { findMany: async () => [], create: async ({ data }) => productLines.push(data) },
  };
  const client = { $transaction: async (fn) => fn(tx) };
  const input = { name: 'New fleet', description: null, ownerId: null, stageId: 1, expectedCloseDate: null, probability: null, forecastCategory: null, currencyCode: 'USD', projectIds: [], participants: [{ accountId: 11, roles: ['MEDIA_PARTNER', 'OEM'] }, { accountId: 12, roles: ['DISTRIBUTOR'] }], lines: [{ productId: 3, quantity: 2, price: '19.95' }] };
  assert.equal(await opportunities.saveOpportunity(client, input), 5);
  assert.deepEqual(memberships.map((m) => m.accountId), [11, 12]);
  assert.deepEqual(roles.map((r) => [r.accountId, r.role]), [[11, 'MEDIA_PARTNER'], [11, 'OEM'], [12, 'DISTRIBUTOR']]);
  assert.equal(productLines[0].estimatedUnitPrice, '19.95');
});
test('saving an edited opportunity removes a participant and its roles', async () => {
  const calls = [];
  const tx = {
    salesStage: { findUnique: async () => ({ active: true }) }, currency: { findUnique: async () => ({ active: true }) },
    account: { findMany: async () => [{ id: 11 }] }, product: { findMany: async () => [] }, project: { findMany: async () => [] },
    opportunity: { findUnique: async () => ({ id: 5, archivedAt: null }), update: async () => {} },
    opportunityAccount: { findMany: async () => [{ accountId: 11, roles: [{ role: 'END_USER' }] }, { accountId: 12, roles: [{ role: 'DISTRIBUTOR' }] }], delete: async (args) => calls.push(['membership', args]), upsert: async () => {} },
    opportunityAccountRole: { deleteMany: async (args) => calls.push(['roles', args]) },
    opportunityProduct: { findMany: async () => [] },
  };
  const client = { $transaction: async (fn) => fn(tx) };
  const input = { name: 'Edited', description: null, ownerId: null, stageId: 1, expectedCloseDate: null, probability: null, forecastCategory: null, currencyCode: 'USD', projectIds: [], participants: [{ accountId: 11, roles: ['END_USER'] }], lines: [] };
  assert.equal(await opportunities.saveOpportunity(client, input, 5), 5);
  assert.deepEqual(calls, [
    ['roles', { where: { opportunityId: 5, accountId: 12 } }],
    ['membership', { where: { opportunityId_accountId: { opportunityId: 5, accountId: 12 } } }],
  ]);
});

test('opportunity SKU is parsed and must belong to the selected product', async () => {
  const parsed = opportunities.parseOpportunity(form([['name', 'SKU deal'], ['stageId', '1'], ['currencyCode', 'USD'], ['accountId', '11'], ['participantRoles', 'END_USER'], ['productId', '3'], ['skuId', '9'], ['quantity', '2'], ['price', '19.95']]));
  assert.equal(parsed.value.lines[0].skuId, 9);
  const legacy = opportunities.parseOpportunity(form([['name', 'Legacy deal'], ['stageId', '1'], ['currencyCode', 'USD'], ['accountId', '11'], ['participantRoles', 'END_USER'], ['lineId', '7'], ['productId', '3'], ['skuId', ''], ['quantity', '2'], ['price', '18.50']]));
  assert.equal(legacy.value.lines[0].id, 7);
  assert.equal(legacy.value.lines[0].skuId, undefined);
  assert.equal(legacy.value.lines[0].price, '18.50');
  const tx = {
    salesStage: { findUnique: async () => ({ active: true }) }, currency: { findUnique: async () => ({ active: true }) },
    account: { findMany: async () => [{ id: 11 }] }, product: { findMany: async () => [{ id: 3 }] }, project: { findMany: async () => [] },
    productSku: { findMany: async () => [{ id: 9, productId: 4, active: true }] }, project: { findMany: async () => [] },
  };
  await assert.rejects(() => opportunities.saveOpportunity({ $transaction: async fn => fn(tx) }, parsed.value), /SKU belonging/);
});

test('saving and reopening SKU lines preserves IDs, quantity, tier prices and manual prices', async () => {
  const stored = [];
  const tx = {
    salesStage: { findUnique: async () => ({ active: true }) }, currency: { findUnique: async () => ({ active: true }) },
    account: { findMany: async () => [{ id: 11 }] }, product: { findMany: async () => [{ id: 3 }] }, project: { findMany: async () => [] },
    productSku: { findMany: async () => [{ id: 9, productId: 3, active: true }] },
    opportunity: { create: async () => ({ id: 5 }), findUnique: async () => ({ id: 5, projects: [], archivedAt: null }), update: async () => {} },
    opportunityAccount: { findMany: async () => [], upsert: async () => {} }, opportunityAccountRole: { create: async () => {} },
    opportunityProduct: {
      findMany: async () => stored.map(line => ({ ...line })),
      create: async ({ data }) => stored.push({ id: stored.length + 1, archivedAt: null, ...data }),
      update: async ({ where, data }) => Object.assign(stored.find(line => line.id === where.id), data),
    },
  };
  const client = { $transaction: async fn => fn(tx) };
  const input = { name: 'SKU pricing', description: null, ownerId: null, stageId: 1, expectedCloseDate: null, probability: null, forecastCategory: null, currencyCode: 'USD', projectIds: [], participants: [{ accountId: 11, roles: ['END_USER'] }], lines: [
    { productId: 3, skuId: 9, quantity: 1000, price: '990.22' },
    { productId: 3, skuId: 9, quantity: 2, price: '800.00' },
    { productId: 3, quantity: 3, price: '18.50' },
  ] };
  await opportunities.saveOpportunity(client, input);
  const reopen = () => stored.map(line => ({ id: line.id, productId: line.productId, skuId: line.skuId, quantity: line.quantity, price: line.estimatedUnitPrice }));
  assert.deepEqual(reopen(), input.lines.map((line, i) => ({ ...line, id: i + 1, skuId: line.skuId ?? null })));
  assert.equal(opportunities.opportunityTotal(stored).toFixed(2), '991875.50');
  const edited = reopen();
  edited[1] = { ...edited[1], quantity: 4, price: '777.00' };
  await opportunities.saveOpportunity(client, { ...input, lines: edited }, 5);
  assert.deepEqual(reopen(), edited);
  assert.equal(opportunities.opportunityTotal(stored).toFixed(2), '993383.50');
});
