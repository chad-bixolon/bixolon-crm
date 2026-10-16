import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(import.meta.url);
const { Prisma } = require('@prisma/client');
const snapshots = require(path.join(root, 'lib/opportunity-snapshots.ts'));
const signed = require(path.join(root, 'lib/opportunity-snapshot-preview.ts'));
const authorization = require(path.join(root, 'lib/authorization.ts'));
const actor = (role = 'ADMIN', overrides = {}) => ({ id: 7, role, active: true, archivedAt: null, ...overrides });
const source = () => ({ id: 1, name: 'Expansion', ownerId: 7, owner: { firstName: 'Original', lastName: 'Rep' }, stageId: 2, stage: { name: 'Qualification', probability: 25, isClosed: false, isWon: false }, currencyCode: 'USD', probability: null, forecastCategory: 'PIPELINE', expectedCloseDate: new Date('2026-12-01'), participants: [{ accountId: 5, account: { name: 'Original Account' } }, { accountId: 6, account: { name: 'Reseller' } }], products: [{ quantity: 3, estimatedUnitPrice: new Prisma.Decimal('19.95') }] });
function fake() {
  const live = source(), runs = [], rows = [], options = [], queries = [];
  const tx = {
    $queryRaw: async () => [{ at: new Date() }],
    opportunity: { findMany: async query => { queries.push(query); return [live]; } },
    user: { findUniqueOrThrow: async () => ({ firstName: 'Admin', lastName: 'Creator' }) },
    opportunitySnapshotRun: {
      findUnique: async () => runs[0] ?? null,
      create: async ({ data }) => { if (runs.length) throw new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '6.19.3' }); const run = { id: 1, ...data }; runs.push(run); return run; },
    },
    opportunitySnapshot: { createMany: async ({ data }) => { rows.push(...structuredClone(data)); return { count: data.length }; } },
  };
  const client = { $transaction: async (run, settings) => { options.push(settings); return run(tx); } };
  return { client, live, rows, runs, options, queries };
}
const snapshot = (overrides = {}) => ({ opportunityId: 1, stageId: 2, stageName: 'Qualification', amount: new Prisma.Decimal('100'), currencyCode: 'USD', expectedCloseDate: new Date('2026-11-01'), ownerId: 7, forecastCategory: 'PIPELINE', probability: 25, ...overrides });

test('capture freezes display values, all Accounts, value, product count and probability source', async () => {
  const f = fake();
  const preview = await snapshots.previewOpportunitySnapshot(f.client, actor());
  const run = await snapshots.captureOpportunitySnapshot(f.client, actor(), preview, true);
  assert.equal(run.opportunityCount, 1);
  const row = f.rows[0];
  assert.equal(row.amount, '59.85'); assert.equal(row.productCount, 1);
  assert.deepEqual(row.accountIds, [5, 6]); assert.equal(row.accounts[0].name, 'Original Account');
  assert.equal(row.ownerName, 'Original Rep'); assert.equal(row.stageName, 'Qualification');
  assert.equal(row.probability, 25); assert.equal(row.probabilityOverride, null); assert.equal(row.stageProbability, 25);
  assert.equal(row.forecastCategory, 'PIPELINE'); assert.equal(row.status, 'OPEN');
  assert.equal(row.opportunityName, 'Expansion'); assert.equal(row.currencyCode, 'USD');
  assert.equal(row.expectedCloseDate.toISOString(), '2026-12-01T00:00:00.000Z');
  f.live.name = 'Renamed'; f.live.participants[0].account.name = 'Renamed Account'; f.live.stage.name = 'Renamed Stage'; f.live.owner.lastName = 'Replacement'; f.live.products[0].estimatedUnitPrice = new Prisma.Decimal('900');
  assert.equal(row.opportunityName, 'Expansion'); assert.equal(row.accounts[0].name, 'Original Account'); assert.equal(row.amount, '59.85'); assert.equal(row.ownerName, 'Original Rep');
  assert.ok(f.options.every(value => value.isolationLevel === 'RepeatableRead'));
  assert.deepEqual(f.queries[0].where, snapshots.snapshotWhere);
  assert.deepEqual(f.queries[0].select.products.where, { archivedAt: null });
});
test('effective probability preserves an explicit zero override', async () => {
  const f = fake(); f.live.probability = 0;
  await snapshots.captureOpportunitySnapshot(f.client, actor(), await snapshots.previewOpportunitySnapshot(f.client, actor()), true);
  assert.equal(f.rows[0].probability, 0); assert.equal(f.rows[0].probabilityOverride, 0);
});
test('duplicate weeks, stale previews, expired previews and missing confirmation are rejected', async () => {
  const f = fake(); const preview = await snapshots.previewOpportunitySnapshot(f.client, actor());
  await assert.rejects(snapshots.captureOpportunitySnapshot(f.client, actor(), preview, false), /Explicit confirmation/);
  f.live.name = 'Changed';
  await assert.rejects(snapshots.captureOpportunitySnapshot(f.client, actor(), preview, true), /Opportunity data changed/);
  assert.equal(f.runs.length, 0);
  await assert.rejects(snapshots.captureOpportunitySnapshot(f.client, actor(), { ...preview, preparedAt: '2000-01-01' }, true), /expired/);
  const fresh = await snapshots.previewOpportunitySnapshot(f.client, actor());
  await snapshots.captureOpportunitySnapshot(f.client, actor(), fresh, true);
  await assert.rejects(snapshots.captureOpportunitySnapshot(f.client, actor(), fresh, true), /already has/);
  await assert.rejects(snapshots.previewOpportunitySnapshot(f.client, actor()), /already has/);
});
test('signed previews reject changed payloads, cross-user use and missing secrets', () => {
  const preview = { preparedAt: new Date().toISOString(), week: '2026-10-12', count: 2, fingerprint: 'original' };
  const token = signed.signSnapshotPreview(preview, 7, 'test-secret');
  assert.deepEqual(signed.verifySnapshotPreview(token, 7, 'test-secret'), preview);
  assert.throws(() => signed.verifySnapshotPreview(token, 8, 'test-secret'), /Invalid/);
  assert.throws(() => signed.verifySnapshotPreview(`${token}x`, 7, 'test-secret'), /Invalid/);
  assert.throws(() => signed.signSnapshotPreview(preview, 7, ''), /not configured/);
});
test('creation and report permissions reject unauthorized, archived and inactive actors', async () => {
  for (const who of [actor('SALES_MANAGER'), actor('SALES'), actor('READ_ONLY'), actor('MARKETING_MANAGER'), actor('SUPPORT'), actor('ADMIN', { active: false }), actor('ADMIN', { archivedAt: new Date() })]) {
    await assert.rejects(snapshots.previewOpportunitySnapshot({}, who), /Access denied/);
    await assert.rejects(snapshots.captureOpportunitySnapshot({}, who, {}, true), /Access denied/);
  }
  for (const role of ['SALES', 'READ_ONLY', 'MARKETING_MANAGER', 'SUPPORT']) {
    assert.equal(snapshots.canReadOpportunitySnapshots(actor(role)), false);
    await assert.rejects(snapshots.compareSnapshotRuns({}, actor(role), 1, 2), /Access denied/);
    assert.equal(authorization.routeAccess('/reports/opportunity-snapshots', actor(role)), 'denied');
  }
  assert.equal(snapshots.canReadOpportunitySnapshots(actor('SALES_MANAGER')), true);
  assert.equal(authorization.routeAccess('/reports/opportunity-snapshots', actor()), 'allowed');
});
test('stage, amount, owner, category and probability movements compare independent endpoints', () => {
  assert.deepEqual(snapshots.compareOpportunitySnapshots(snapshot(), snapshot({ stageId: 3, stageName: 'Evaluation', amount: new Prisma.Decimal('150'), ownerId: 8, forecastCategory: 'COMMIT', probability: 50 })), ['Stage changed', 'Amount increased', 'Owner changed', 'Forecast category changed', 'Probability changed']);
  assert.deepEqual(snapshots.compareOpportunitySnapshots(snapshot(), snapshot({ amount: new Prisma.Decimal('50') })), ['Amount decreased']);
  assert.deepEqual(snapshots.compareOpportunitySnapshots(snapshot(), snapshot({ currencyCode: 'CAD', amount: new Prisma.Decimal('150') })), ['Currency changed — values not comparable']);
  assert.deepEqual(snapshots.compareOpportunitySnapshots(snapshot(), snapshot({ stageName: 'Renamed' })), ['Stage renamed']);
});
test('close dates slip/pull in only when both dates exist and differ by calendar day', () => {
  for (const [date, label] of [['2026-12-01', 'Close date slipped'], ['2026-10-01', 'Close date pulled in']]) assert.deepEqual(snapshots.compareOpportunitySnapshots(snapshot(), snapshot({ expectedCloseDate: new Date(date) })), [label]);
  assert.deepEqual(snapshots.compareOpportunitySnapshots(snapshot(), snapshot({ expectedCloseDate: null })), ['Close date cleared']);
  assert.deepEqual(snapshots.compareOpportunitySnapshots(snapshot({ expectedCloseDate: null }), snapshot()), ['Close date added']);
  assert.deepEqual(snapshots.compareOpportunitySnapshots(snapshot(), snapshot({ expectedCloseDate: new Date('2026-11-01T12:00:00Z') })), ['No tracked movement']);
});
test('entered and absent records never invent a loss or a slip', () => {
  assert.deepEqual(snapshots.compareOpportunitySnapshots(null, snapshot()), ['Newly included in this snapshot']);
  const removed = snapshots.compareOpportunitySnapshots(snapshot(), null).join(' ');
  assert.match(removed, /reason not recorded/); assert.doesNotMatch(removed, /lost|slipped|won/i);
});
test('SALES detail history requires current ownership AND historical ownership, bounded to eight', async () => {
  let query;
  const client = { opportunity: { findFirst: async ({ where }) => where.ownerId === 7 ? { id: 1 } : null }, opportunitySnapshot: { findMany: async value => { query = value; return []; } } };
  await snapshots.opportunitySnapshotHistory(client, actor('SALES'), 1);
  assert.equal(query.where.ownerId, 7); assert.equal(query.take, 8);
  query = null; await snapshots.opportunitySnapshotHistory(client, actor('SALES', { id: 8 }), 1); assert.equal(query, null);
  await snapshots.opportunitySnapshotHistory({}, actor('READ_ONLY'), 1);
});
test('weekly keys follow New York Mondays across daylight saving and UTC week boundaries', () => {
  assert.equal(snapshots.snapshotWeek(new Date('2026-10-19T01:00:00Z')).toISOString().slice(0, 10), '2026-10-12');
  assert.equal(snapshots.snapshotWeek(new Date('2026-11-02T06:00:00Z')).toISOString().slice(0, 10), '2026-11-02');
});
test('live detail survives a pending snapshot rollout while unexpected storage errors remain visible', async () => {
  assert.deepEqual(await snapshots.opportunitySnapshotHistory({}, actor(), 1), []);
  const client = { opportunity: { findFirst: async () => ({ id: 1 }) }, opportunitySnapshot: { findMany: async () => { throw new Prisma.PrismaClientKnownRequestError('missing table', { code: 'P2021', clientVersion: '6.19.3', meta: { table: 'public.OpportunitySnapshot' } }); } } };
  assert.deepEqual(await snapshots.opportunitySnapshotHistory(client, actor(), 1), []);
  client.opportunitySnapshot.findMany = async () => { throw new Error('unexpected database error'); };
  await assert.rejects(snapshots.opportunitySnapshotHistory(client, actor(), 1), /unexpected database error/);
});


test('forecast-ready source capture freezes owner eligibility and includes won-stage status', async () => {
  const f = fake(); Object.assign(f.live.owner, { role: 'SALES_MANAGER', active: true, archivedAt: null });
  f.live.stage.isClosed = true; f.live.stage.isWon = true; f.live.forecastCategory = 'CLOSED';
  const preview = await snapshots.previewOpportunitySnapshot(f.client, actor(), true);
  const run = await snapshots.captureOpportunitySnapshot(f.client, actor(), preview, true);
  assert.equal(run.scopeVersion, snapshots.FORECAST_SNAPSHOT_SCOPE);
  assert.equal(f.rows[0].status, 'WON'); assert.equal(f.rows[0].ownerForecastEligible, true);
  assert.deepEqual(f.queries[0].where, snapshots.forecastSnapshotWhere);
  f.live.owner.active = false;
  assert.equal(f.rows[0].ownerForecastEligible, true);
});
test('owner eligibility changes after preview require another source preview', async () => {
  const f = fake(); Object.assign(f.live.owner, { role: 'SALES', active: true, archivedAt: null });
  const preview = await snapshots.previewOpportunitySnapshot(f.client, actor(), true);
  f.live.owner.active = false;
  await assert.rejects(snapshots.captureOpportunitySnapshot(f.client, actor(), preview, true), /data changed/);
});
