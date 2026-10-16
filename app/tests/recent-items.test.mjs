import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(import.meta.url);
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
// Keep unrelated mutation integrations out of this isolated read/history unit test.
const originalLoad = Module._load;
Module._load = function(request, parent, main) {
  if (request === './projects') return { projectReadWhere: () => ({}) };
  if (request === './support-cases') return { supportCaseReadWhere: actor => ({ archivedAt: null, ...(actor.role === 'READ_ONLY' ? { accountId: { not: null } } : {}) }) };
  return originalLoad.call(this, request, parent, main);
};
const { listRecentItems, recordRecentView, resolveRecentTargets, recentEntityRoutes, isRecentEntityType } = require(path.join(root, 'lib/recent-items.ts'));
const actor = { id: 7, role: 'ADMIN', active: true };

test('recent input rejects unsupported types, unsafe IDs and inactive actors before any write', async () => {
  const db = { $transaction: () => assert.fail('must not write') };
  for (const type of ['USER', '/accounts', '__proto__', null]) { assert.equal(isRecentEntityType(type), false); await recordRecentView(db, actor, type, 1); }
  for (const id of [-1, 0, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) await recordRecentView(db, actor, 'ACCOUNT', id);
  await recordRecentView(db, { ...actor, active: false }, 'ACCOUNT', 1);
  await recordRecentView(db, { ...actor, archivedAt: new Date() }, 'ACCOUNT', 1);
});

test('write locks only the actor, checks eligibility, and upserts a compound identity', async () => {
  const calls = [];
  const latest = new Date(Date.now() + 1000);
  const tx = { $queryRaw: async (_, id) => calls.push(['lock', id]), account: { findMany: async query => { calls.push(['resolve', query]); return [{ id: 21, name: 'Acme' }]; } }, recentItem: { findFirst: async () => ({ lastViewedAt: latest }), upsert: async query => calls.push(['upsert', query]) }, $executeRaw: async (_, ...values) => calls.push(['prune', values]) };
  await recordRecentView({ $transaction: callback => callback(tx) }, actor, 'ACCOUNT', 21);
  assert.deepEqual(calls[0], ['lock', 7]);
  assert.equal(calls[1][1].take, 50);
  assert.deepEqual(calls[2][1].where, { userId_entityType_recordId: { userId: 7, entityType: 'ACCOUNT', recordId: 21 } });
  assert.ok(calls[2][1].update.lastViewedAt instanceof Date);
  assert.equal(calls[2][1].update.lastViewedAt.getTime(), latest.getTime() + 1);
  assert.deepEqual(calls[3], ['prune', [7, 7, 50]]);
  tx.account.findMany = async () => [];
  calls.length = 0;
  await recordRecentView({ $transaction: callback => callback(tx) }, actor, 'ACCOUNT', 21);
  assert.deepEqual(calls, [['lock', 7]]);
});

test('listing is private, bounded, batched and keeps history ordering after missing targets are filtered', async () => {
  let batches = 0;
  const history = [21, 99, 20].map((recordId, i) => ({ entityType: 'ACCOUNT', recordId, lastViewedAt: new Date(10000 - i * 1000) }));
  const db = { recentItem: { findMany: async query => { assert.deepEqual(query.where, { userId: 7 }); assert.equal(query.take, 50); assert.deepEqual(query.orderBy, [{ lastViewedAt: 'desc' }, { id: 'desc' }]); return history; } }, account: { findMany: async query => { batches++; assert.deepEqual(query.where.AND[0], { id: { in: [21, 99, 20] } }); assert.deepEqual(query.select, { id: true, name: true }); return [{ id: 20, name: 'Older' }, { id: 21, name: 'Latest' }]; } } };
  const items = await listRecentItems(db, actor);
  assert.equal(batches, 1);
  assert.deepEqual(items.map(row => row.label), ['Latest', 'Older']);
  assert.deepEqual(items.map(row => row.href), ['/accounts/21', '/accounts/20']);
  assert.equal((await listRecentItems(db, { ...actor, active: false })).length, 0);
});

test('permission gates skip forbidden entity queries and use operational read scopes', async () => {
  assert.deepEqual(await resolveRecentTargets({}, { ...actor, role: 'SUPPORT' }, 'OPPORTUNITY', [21]), []);
  assert.deepEqual(await resolveRecentTargets({}, { ...actor, role: 'SUPPORT' }, 'ACTIVITY', [21]), []);
  const db = { opportunity: { findMany: async query => { assert.equal(query.where.AND[1].archivedAt, null); assert.deepEqual(query.where.AND[2], {}); return []; } }, contact: { findMany: async query => { assert.equal(query.where.AND[1].active, true); assert.equal(query.where.AND[1].archivedAt, null); return []; } } };
  await resolveRecentTargets(db, { ...actor, role: 'SALES' }, 'OPPORTUNITY', [21]);
  await resolveRecentTargets(db, actor, 'CONTACT', [21]);
});

test('eight destinations include an activity read page', () => {
  assert.deepEqual(Object.values(recentEntityRoutes).map(row => row[1]), ['/accounts', '/contacts', '/opportunities', '/projects', '/support/cases', '/price-exceptions', '/tasks', '/activities']);
});
