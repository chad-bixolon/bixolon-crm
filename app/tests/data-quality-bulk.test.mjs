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
const { bulkQualityOwners } = require(path.join(root, 'lib/data-quality-bulk.ts'));
const { eligibleUserWhere } = require(path.join(root, 'lib/assignment-eligibility.ts'));
const admin = { id: 1, role: 'ADMIN', active: true };
const row = id => ({ id, updatedAt: '2026-10-19T12:00:00.000Z' });
const scope = { issue: 'account-owner', q: '', page: 1 };
const request = { records: [row(1)], action: 'assign', value: '2', confirmed: true };
const untouchedDb = new Proxy({}, { get() { throw Error('Unexpected database access'); } });

test('bulk quality owner assignment denies every non-Admin effective actor before database access', async () => {
  for (const actor of ['SALES', 'SALES_MANAGER', 'SUPPORT', 'READ_ONLY', 'MARKETING_MANAGER'].map(role => ({ ...admin, role })).concat([{ ...admin, active: false }, { ...admin, archivedAt: new Date() }])) {
    for (const issue of ['account-owner', 'account-owner-inactive', 'opportunity-owner']) await assert.rejects(bulkQualityOwners(untouchedDb, actor, { ...scope, issue }, request), /Access denied/);
  }
});

function reassignmentDb({ currentActor = admin, owner = { id: 2, firstName: 'Jane', lastName: 'Smith' }, rows = [{ id: 1, updatedAt: new Date(row(1).updatedAt) }], visible = rows } = {}) {
  const writes = [], events = [], queries = [];
  const tx = {
    $queryRaw: async query => { queries.push(query); return []; },
    user: {
      findUnique: async () => currentActor,
      findFirst: async ({ where }) => { assert.deepEqual(where, { id: 2, ...eligibleUserWhere('account-owner') }); return owner; },
    },
    account: {
      findMany: async args => args.take ? visible.map(record => ({ ...record, name: 'Acme', owner: null })) : rows,
      count: async () => visible.length,
      update: async args => { writes.push(args); },
    },
    adminMaintenanceEvent: { create: async ({ data }) => { events.push(data); } },
  };
  return { db: { $transaction: async (fn, options) => { assert.equal(options.isolationLevel, 'Serializable'); return fn(tx); } }, writes, events, queries };
}

test('unavailable-owner correction uses Account versions, ordinary owner eligibility and reassignment history', async () => {
  const f = reassignmentDb();
  assert.equal(await bulkQualityOwners(f.db, admin, { ...scope, issue: 'account-owner-inactive' }, request), 1);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0].where, { id: 1, updatedAt: new Date(row(1).updatedAt) });
  assert.equal(f.writes[0].data.ownerId, 2);
  assert.equal(f.writes[0].data.updatedById, admin.id);
  assert.ok(f.writes[0].data.updatedAt > new Date(row(1).updatedAt));
  assert.deepEqual(Object.keys(f.writes[0].data).sort(), ['ownerId', 'updatedAt', 'updatedById']);
  assert.deepEqual(f.events, [{ actorId: admin.id, entityType: 'Account', action: 'Reassign', recordIds: [1], recordCount: 1, newOwnerId: 2, newOwnerName: 'Jane Smith' }]);
  assert.match(f.queries[0].strings.join(' '), /FOR SHARE/);
  assert.match(f.queries[1].strings.join(' '), /Account.*FOR UPDATE/);
});

test('unavailable-owner submission rejects changed versions, missing issue matches, page changes and lost permissions before writes', async () => {
  for (const [options, error] of [
    [{ owner: null }, /no longer available/],
    [{ currentActor: { ...admin, role: 'SALES_MANAGER' } }, /Access denied/],
    [{ currentActor: { ...admin, active: false } }, /Access denied/],
    [{ rows: [] }, /changed|unavailable/],
    [{ rows: [{ id: 1, updatedAt: new Date('2026-10-19T12:00:00.001Z') }] }, /changed|unavailable/],
    [{ visible: [] }, /current page changed/],
  ]) {
    const f = reassignmentDb(options);
    await assert.rejects(bulkQualityOwners(f.db, admin, { ...scope, issue: 'account-owner-inactive' }, request), error);
    assert.equal(f.writes.length, 0);
    assert.equal(f.events.length, 0);
  }
});

test('bulk quality assignment rejects unconfirmed, oversized, unsupported and malformed requests before a transaction', async () => {
  for (const [context, input, error] of [
    [scope, { ...request, confirmed: false }, /confirmation/],
    [scope, { ...request, records: Array.from({ length: 21 }, (_, i) => row(i + 1)) }, /between 1 and 20/],
    [{ ...scope, issue: 'contact-account' }, request, /individual review/],
    [scope, { ...request, action: 'archive' }, /individual review/],
    [{ ...scope, page: -1 }, request, /Refresh/],
    [{ ...scope, q: [] }, request, /Refresh/],
    [scope, { ...request, value: 'NaN' }, /eligible owner/],
  ]) await assert.rejects(bulkQualityOwners(untouchedDb, admin, context, input), error);
});
