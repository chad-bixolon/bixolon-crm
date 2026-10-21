import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(import.meta.url);
Module._extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { saveTradeShowLeadUpdate, tradeShowLeadFailureState } = require(`${root}/lib/trade-show-leads.ts`);
const { correctPriceExceptionReference } = require(`${root}/lib/price-exception-maintenance.ts`);
const { RecordChangedError, recordChangedMessage } = require(`${root}/lib/stale-edit.ts`);
const actor = role => ({ id: 7, role, active: true, archivedAt: null });
const opened = new Date('2099-10-20T12:00:00.000Z');
function form(token = opened.toISOString(), fields = {}) {
  const data = new FormData();
  if (token !== null) data.set('editToken', token);
  for (const [key, value] of Object.entries({ status: 'NEW', salesNotes: 'My entered notes', ...fields })) data.set(key, value);
  return data;
}
function leadDb({ race = false, taskFailure = false } = {}) {
  let row = { id: 2, tradeShowId: 1, updatedAt: opened, routing: 'UNREVIEWED', assignedSalesRepUserId: 7, convertedOpportunityId: null, accountId: null, contactId: null, competitorId: null, tradeShow: { archivedAt: null } };
  let mutations = 0;
  const tx = {
    tradeShowLead: {
      findFirst: async () => ({ ...row }),
      update: async ({ where, data }) => {
        if (race) row = { ...row, updatedAt: new Date(opened.getTime() + 1), salesNotes: 'Newer notes', routing: 'MARKETING_FOLLOW_UP' };
        assert.equal(where.tradeShowId, 1);
        if (where.updatedAt?.getTime() !== row.updatedAt.getTime()) throw Object.assign(new Error('Missing record'), { code: 'P2025' });
        mutations++; row = { ...row, ...data }; return row;
      },
    },
    user: { findFirst: async () => ({ id: 7 }) },
    task: { findFirst: async () => { if (taskFailure) throw new Error('Task sync failed'); return null; } },
  };
  return {
    get row() { return row; }, get mutations() { return mutations; },
    $transaction: async callback => {
      const before = row;
      try { return await callback(tx); } catch (error) { if (!race) row = before; throw error; }
    },
  };
}

test('lead normal save advances exactly once even with a backwards clock, then rejects all old privileged forms', async () => {
  const db = leadDb();
  await saveTradeShowLeadUpdate(db, 1, 2, form(), actor('SALES'));
  assert.equal(db.row.updatedAt.getTime(), opened.getTime() + 1);
  assert.equal(db.row.salesNotes, 'My entered notes');
  for (const role of ['SALES', 'SALES_MANAGER', 'MARKETING_MANAGER', 'ADMIN']) await assert.rejects(saveTradeShowLeadUpdate(db, 1, 2, form(), actor(role)), RecordChangedError);
  assert.equal(db.mutations, 1);
});

test('lead conditional write rejects a change after eligibility reads and preserves submitted values', async () => {
  const db = leadDb({ race: true }), submitted = form();
  await assert.rejects(saveTradeShowLeadUpdate(db, 1, 2, submitted, actor('ADMIN')), { code: 'P2025' });
  assert.equal(db.row.salesNotes, 'Newer notes'); assert.equal(db.row.routing, 'MARKETING_FOLLOW_UP');
  assert.equal(db.mutations, 0);
  assert.deepEqual(tradeShowLeadFailureState(submitted, {}, recordChangedMessage).values, Object.fromEntries(submitted));
});

test('lead missing, invalid or repeated tokens cannot reach mutations, and permissions still apply', async () => {
  const db = leadDb();
  const repeated = form(); repeated.append('editToken', opened.toISOString());
  for (const submitted of [form(null), form('bad'), repeated]) await assert.rejects(saveTradeShowLeadUpdate(db, 1, 2, submitted, actor('ADMIN')), RecordChangedError);
  for (const role of ['READ_ONLY', 'SUPPORT']) await assert.rejects(saveTradeShowLeadUpdate(db, 1, 2, form(), actor(role)), /Access denied/);
  await assert.rejects(saveTradeShowLeadUpdate(db, 1, 2, form(opened.toISOString(), { assignedSalesRepUserId: '8' }), actor('SALES')), /Access denied/);
  assert.equal(db.mutations, 0);
});

test('lead follow-up Task failure rolls back the conditional parent mutation', async () => {
  const db = leadDb({ taskFailure: true });
  await assert.rejects(saveTradeShowLeadUpdate(db, 1, 2, form(opened.toISOString(), { routing: 'BIXOLON_SALES', assignedSalesRepUserId: '7' }), actor('ADMIN')), /Task sync failed/);
  assert.equal(db.row.updatedAt, opened); assert.equal(db.row.routing, 'UNREVIEWED');
});

function peDb({ race = false, failHistory = false, eligible = true } = {}) {
  let parent = { id: 1, peCode: 'PE-TEST', status: 'ACTIVE', archivedAt: null, updatedAt: opened, distributorAccountId: 2 };
  let line = { id: 3, priceExceptionId: 1, productSkuId: 4 }, history = [];
  const tx = {
    priceException: {
      findUnique: async () => ({ ...parent }),
      updateMany: async ({ where, data }) => {
        if (race) { parent = { ...parent, updatedAt: new Date(opened.getTime() + 1), distributorAccountId: 88 }; line = { ...line, productSkuId: 99 }; }
        assert.equal(where.archivedAt, null); assert.equal(where.status.not, 'ARCHIVED');
        if (where.updatedAt?.getTime() !== parent.updatedAt.getTime()) return { count: 0 };
        parent = { ...parent, ...data }; return { count: 1 };
      },
    },
    priceExceptionLine: { findFirst: async () => line, update: async ({ data }) => { line = { ...line, ...data }; } },
    account: { findUnique: async () => ({ status: eligible ? 'ACTIVE' : 'INACTIVE', archivedAt: null }) },
    productSku: { findUnique: async () => ({ active: eligible, product: { active: true, archivedAt: null } }) },
    adminMaintenanceEvent: { create: async ({ data }) => { if (failHistory) throw new Error('History failed'); history.push(data); } },
  };
  return {
    get parent() { return parent; }, get line() { return line; }, get history() { return history; },
    $transaction: async callback => {
      const before = { parent, line, history: [...history] };
      try { return await callback(tx); } catch (error) { if (!race) { parent = before.parent; line = before.line; history = before.history; } throw error; }
    },
  };
}
for (const field of ['distributorAccountId', 'productSkuId']) {
  test(`PE ${field}: first correction advances parent once and records history; second leaves it intact`, async () => {
    const db = peDb();
    await correctPriceExceptionReference(db, actor('ADMIN'), 1, field, 5, opened, 3);
    assert.equal(db.parent.updatedAt.getTime(), opened.getTime() + 1);
    assert.equal(field === 'productSkuId' ? db.line.productSkuId : db.parent.distributorAccountId, 5);
    assert.deepEqual(db.history, [{ actorId: 7, entityType: 'Price Exception', action: field === 'productSkuId' ? 'Corrected Price Exception SKU' : 'Updated Price Exception reference', recordIds: [1], recordCount: 1 }]);
    await assert.rejects(correctPriceExceptionReference(db, actor('ADMIN'), 1, field, 6, opened, 3), RecordChangedError);
    assert.equal(db.history.length, 1);
    assert.equal(field === 'productSkuId' ? db.line.productSkuId : db.parent.distributorAccountId, 5);
  });
  test(`PE ${field}: commit between read and write cannot change parent, line or history`, async () => {
    const db = peDb({ race: true });
    await assert.rejects(correctPriceExceptionReference(db, actor('ADMIN'), 1, field, 5, opened, 3), RecordChangedError);
    assert.equal(db.parent.distributorAccountId, 88); assert.equal(db.line.productSkuId, 99); assert.equal(db.history.length, 0);
  });
  test(`PE ${field}: history failure rolls back the parent and line`, async () => {
    const db = peDb({ failHistory: true });
    await assert.rejects(correctPriceExceptionReference(db, actor('ADMIN'), 1, field, 5, opened, 3), /History failed/);
    assert.equal(db.parent.updatedAt, opened); assert.equal(db.parent.distributorAccountId, 2); assert.equal(db.line.productSkuId, 4);
  });
}

test('PE direct correction keeps Admin-only permissions and validation', async () => {
  const db = peDb();
  for (const role of ['SALES', 'SALES_MANAGER', 'MARKETING_MANAGER', 'READ_ONLY', 'SUPPORT']) await assert.rejects(correctPriceExceptionReference(db, actor(role), 1, 'distributorAccountId', 5, opened), /Access denied|Administrator/);
  for (const [field, target, date, line] of [['unknown', 5, opened, 3], ['distributorAccountId', -1, opened, 3], ['productSkuId', 5, opened, 0], ['productSkuId', 5, new Date('bad'), 3]]) await assert.rejects(correctPriceExceptionReference(db, actor('ADMIN'), 1, field, target, date, line));
  assert.equal(db.parent.updatedAt, opened); assert.equal(db.history.length, 0);
});


test('PE correction rejects inactive Account and SKU destinations without advancing parent or history', async () => {
  const db = peDb({ eligible: false });
  await assert.rejects(correctPriceExceptionReference(db, actor('ADMIN'), 1, 'distributorAccountId', 5, opened), /active Account/);
  await assert.rejects(correctPriceExceptionReference(db, actor('ADMIN'), 1, 'productSkuId', 5, opened, 3), /active SKU/);
  assert.equal(db.parent.updatedAt, opened); assert.equal(db.history.length, 0);
});

function serverAction(file, db, currentActor = actor('ADMIN')) {
  const filename = path.join(root, file), mod = new Module(filename);
  mod.filename = filename; mod.paths = require.resolve.paths(filename);
  mod.require = name => {
    if (name === 'next/cache') return { revalidatePath() {} };
    if (name === '@/lib/prisma') return { prisma: db };
    if (name === '@/lib/current-user') return { currentUser: async () => currentActor, requireMutation: async permission => { require(`${root}/lib/authorization.ts`).assertPermission(currentActor, permission); return currentActor; } };
    return require(name.startsWith('@/') ? path.join(root, name.slice(2)) : name);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
  return mod.exports;
}

test('direct lead server action returns shared conflict with every submitted value and no refreshed token', async () => {
  const db = leadDb({ race: true });
  const { submitTradeShowLead } = serverAction('app/trade-shows/[id]/leads/[leadId]/actions.ts', db);
  const submitted = form();
  const result = await submitTradeShowLead(1, 2, { errors: {} }, submitted);
  assert.equal(result.recordChanged, true); assert.equal(result.message, recordChangedMessage);
  assert.deepEqual(result.values, Object.fromEntries(submitted)); assert.equal(db.mutations, 0);
  for (const token of [null, 'bad']) {
    const result = await submitTradeShowLead(1, 2, { errors: {} }, form(token));
    assert.equal(result.recordChanged, true); assert.equal(db.mutations, 0);
  }
});

test('direct PE server action rejects missing/noncanonical tokens and maps a lost conditional claim to conflict', async () => {
  const db = peDb({ race: true });
  const { correctReference } = serverAction('app/administration/price-exceptions/actions.ts', db);
  for (const token of [undefined, '', 'bad', '2099-10-20', '2099-10-20T12:00:00Z', opened.toISOString()]) {
    const result = await correctReference(1, 'productSkuId', 5, token, 3);
    assert.equal(result.ok, false); assert.equal(result.recordChanged, true); assert.equal(result.message, recordChangedMessage);
  }
  assert.equal(db.history.length, 0); assert.equal(db.line.productSkuId, 99);
  const impersonatedAction = serverAction('app/administration/price-exceptions/actions.ts', db, actor('SALES'));
  await assert.rejects(impersonatedAction.correctReference(1, 'distributorAccountId', 5, opened.toISOString()), /Access denied/);
});


test('Sales whose lead was reassigned after opening gets the shared conflict and cannot overwrite the new owner', async () => {
  const db = leadDb();
  await saveTradeShowLeadUpdate(db, 1, 2, form(opened.toISOString(), { assignedSalesRepUserId: '8' }), actor('ADMIN'));
  await assert.rejects(saveTradeShowLeadUpdate(db, 1, 2, form(), actor('SALES')), RecordChangedError);
  assert.equal(db.row.assignedSalesRepUserId, 8);
  await assert.rejects(saveTradeShowLeadUpdate(db, 1, 2, form(db.row.updatedAt.toISOString()), actor('SALES')), /Access denied/);
  assert.equal(db.mutations, 1);
});
