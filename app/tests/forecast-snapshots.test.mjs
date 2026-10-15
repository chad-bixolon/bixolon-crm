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
const service = require(path.join(root, 'lib/forecast-snapshots.ts'));
const rules = require(path.join(root, 'lib/forecast-snapshot-rules.ts'));
const signing = require(path.join(root, 'lib/forecast-snapshot-preview.ts'));
const sources = require(path.join(root, 'lib/opportunity-snapshots.ts'));
const auth = require(path.join(root, 'lib/authorization.ts'));
const actor = { id: 1, role: 'ADMIN', active: true, archivedAt: null };
const period = { sourceRunId: 5, year: 2026, quarter: 'Q4' };
const row = (extra = {}) => ({ opportunityId: 1, ownerId: 2, ownerName: 'Original Rep', ownerForecastEligible: true, status: 'OPEN', currencyCode: 'USD', forecastCategory: 'PIPELINE', amount: new Prisma.Decimal('100.10'), expectedCloseDate: new Date('2026-10-01T12:00:00Z'), stageId: 1, stageName: 'Qualified', probability: 25, ...extra });
function fake(rows = [row()]) {
  const runs = [], saved = [], source = { id: 5, snapshotAt: new Date('2026-10-15'), opportunityCount: rows.length, scopeVersion: sources.FORECAST_SNAPSHOT_SCOPE, status: 'COMPLETE' };
  const tx = {
    opportunitySnapshotRun: { findUnique: async () => source },
    opportunitySnapshot: { findMany: async () => rows },
    forecastSnapshotRun: { findUnique: async () => runs[0] ?? null, create: async ({ data }) => { const run = { id: 11, ...data }; runs.push(run); return run; } },
    forecastSnapshotRollup: { createMany: async ({ data }) => { saved.push(...data); return { count: data.length }; } },
    user: { findUniqueOrThrow: async () => ({ firstName: 'Admin', lastName: 'Creator' }) },
  };
  return { source, runs, saved, rows, tx, client: { $transaction: async work => work(tx) } };
}
test('source-derived creation freezes categories, decimal totals, counts, owner names and timestamp', async () => {
  const f = fake([row(), row({ opportunityId: 2, forecastCategory: 'BEST_CASE', amount: new Prisma.Decimal('20.20') }), row({ opportunityId: 3, forecastCategory: 'COMMIT', amount: new Prisma.Decimal('30.30') }), row({ opportunityId: 4, status: 'WON', forecastCategory: 'CLOSED', amount: new Prisma.Decimal('40.40') })]);
  const result = await service.previewForecastSnapshot(f.client, actor, period);
  assert.equal(result.opportunityCount, 4); assert.equal(result.salespersonCount, 1);
  const run = await service.captureForecastSnapshot(f.client, actor, result.preview, true);
  assert.equal(run.sourceRunId, 5); assert.equal(run.snapshotAt, f.source.snapshotAt); assert.equal(run.createdByName, 'Admin Creator');
  assert.equal(run.rowCount, 4); assert.equal(f.saved.length, 4);
  const totals = service.summarizeForecastRows(f.saved);
  assert.equal(totals.pipeline.toFixed(2), '150.60'); assert.equal(totals.bestCase.toFixed(2), '20.20'); assert.equal(totals.commit.toFixed(2), '30.30'); assert.equal(totals.closedWon.toFixed(2), '40.40'); assert.equal(totals.opportunityCount.toNumber(), 4);
  f.rows[0].amount = new Prisma.Decimal(999); f.rows[0].ownerName = 'Renamed';
  assert.equal(f.saved.find(x => x.forecastCategory === 'PIPELINE').amount.toFixed(2), '100.10'); assert.equal(f.saved[0].ownerName, 'Original Rep');
});
test('quarter bounds use Expected Close Date; omitted, lost, undated and ineligible owners are excluded', async () => {
  const f = fake([row(), row({ opportunityId: 2, expectedCloseDate: new Date('2027-01-01') }), row({ opportunityId: 3, expectedCloseDate: new Date('2026-09-30T12:00:00Z') }), row({ opportunityId: 4, expectedCloseDate: null }), row({ opportunityId: 5, forecastCategory: 'OMITTED' }), row({ opportunityId: 6, status: 'LOST' }), row({ opportunityId: 7, ownerForecastEligible: false }), row({ opportunityId: 8, ownerId: null })]);
  const result = await service.previewForecastSnapshot(f.client, actor, period);
  assert.equal(result.opportunityCount, 1);
  assert.equal(rules.inSnapshotForecast(row({ expectedCloseDate: new Date('2026-12-31T12:00:00Z') }), period), true);
  await assert.rejects(service.previewForecastSnapshot(f.client, actor, { ...period, quarter: 'Q5' }), /valid year/);
});
test('grouping keeps salespeople and currencies separate, including eligible managers without targets', async () => {
  const f = fake([row(), row({ opportunityId: 2, amount: new Prisma.Decimal('0.20') }), row({ opportunityId: 3, ownerId: 3, ownerName: 'Manager' }), row({ opportunityId: 4, currencyCode: 'EUR', amount: new Prisma.Decimal('500') })]);
  const result = await service.previewForecastSnapshot(f.client, actor, period);
  assert.equal(result.rows.length, 3); assert.equal(result.salespersonCount, 2);
  assert.equal(result.rows.find(x => x.ownerId === 2 && x.currencyCode === 'USD').amount.toFixed(2), '100.30');
  assert.equal(result.rows.find(x => x.currencyCode === 'EUR').amount.toFixed(2), '500.00');
});
test('won status is authoritative; a historical category inconsistency does not turn a won deal into Pipeline', async () => {
  const f = fake([row({ status: 'WON', forecastCategory: 'PIPELINE' })]);
  const result = await service.previewForecastSnapshot(f.client, actor, period);
  assert.equal(result.rows[0].forecastCategory, 'CLOSED'); assert.equal(result.rows[0].categoryName, 'Closed Won');
  assert.equal(service.summarizeForecastRows(result.rows).pipeline.toFixed(2), '0.00');
});
test('duplicate protection, required confirmation, expired previews and legacy source rejection', async () => {
  const f = fake(), p = (await service.previewForecastSnapshot(f.client, actor, period)).preview;
  await assert.rejects(service.captureForecastSnapshot(f.client, actor, p, false), /Explicit confirmation/);
  await assert.rejects(service.captureForecastSnapshot(f.client, actor, { ...p, preparedAt: '2000-01-01' }, true), /expired/);
  f.source.scopeVersion = sources.SNAPSHOT_SCOPE;
  await assert.rejects(service.captureForecastSnapshot(f.client, actor, p, true), /forecast-ready/);
  f.source.scopeVersion = sources.FORECAST_SNAPSHOT_SCOPE;
  await service.captureForecastSnapshot(f.client, actor, p, true);
  await assert.rejects(service.captureForecastSnapshot(f.client, actor, p, true), /already have/);
  await assert.rejects(service.previewForecastSnapshot(f.client, actor, period), /already have/);
});
test('incomplete sources are rejected; empty sources produce valid zero runs', async () => {
  const f = fake(); f.source.opportunityCount = 2;
  await assert.rejects(service.previewForecastSnapshot(f.client, actor, period), /incomplete/);
  f.source.opportunityCount = 1; f.rows[0].ownerForecastEligible = null;
  await assert.rejects(service.previewForecastSnapshot(f.client, actor, period), /incomplete/);
  const empty = fake([]), p = await service.previewForecastSnapshot(empty.client, actor, period);
  const run = await service.captureForecastSnapshot(empty.client, actor, p.preview, true);
  assert.equal(run.opportunityCount, 0); assert.equal(run.rowCount, 0); assert.equal(empty.saved.length, 0);
});
test('comparison uses decimal math and suppresses percentage for every zero baseline', () => {
  assert.deepEqual(rules.forecastChange('0', '100'), { previous: '0.00', current: '100.00', change: '100.00', percent: null });
  assert.equal(rules.forecastChange('0', '0').percent, null);
  assert.equal(rules.forecastChange('100.10', '150.15').percent, '50.00');
  assert.equal(rules.forecastChange('100', '0').percent, '-100.00');
  assert.equal(rules.forecastChange('-100', '-50').percent, '50.00');
});
test('comparisons preserve owner movement and never combine currencies', async () => {
  const f = fake();
  f.tx.forecastSnapshotRun.findMany = async () => [{ id: 1, year: 2026, quarter: 'Q4', snapshotAt: new Date('2026-10-01') }, { id: 2, year: 2026, quarter: 'Q4', snapshotAt: new Date('2026-10-08') }];
  f.tx.forecastSnapshotRollup.findMany = async () => [
    { ...row(), runId: 1, opportunityCount: 1 }, { ...row({ ownerId: 3, ownerName: 'New Owner', forecastCategory: 'COMMIT', amount: new Prisma.Decimal('200.20') }), runId: 2, opportunityCount: 1 }, { ...row({ currencyCode: 'EUR' }), runId: 2, opportunityCount: 1 },
  ];
  const result = await service.compareForecastSnapshotRuns(f.client, actor, 1, 2);
  assert.equal(result.groups.filter(g => !g.ownerId).length, 2);
  const usd = result.groups.find(g => !g.ownerId && g.currencyCode === 'USD');
  assert.equal(usd.metrics.find(m => m.key === 'pipeline').change, '100.10');
  const rep = result.groups.find(g => g.ownerId === 2 && g.currencyCode === 'USD');
  assert.equal(rep.metrics.find(m => m.key === 'pipeline').change, '-100.10');
  await assert.rejects(service.compareForecastSnapshotRuns(f.client, actor, 2, 1), /earlier and later/);
  await assert.rejects(service.compareForecastSnapshotRuns(f.client, actor, 1, 1), /different/);
  f.tx.forecastSnapshotRun.findMany = async () => [{ id: 1, year: 2026, quarter: 'Q3', snapshotAt: new Date('2026-10-01') }, { id: 2, year: 2026, quarter: 'Q4', snapshotAt: new Date('2026-10-08') }];
  await assert.rejects(service.compareForecastSnapshotRuns(f.client, actor, 1, 2), /same forecast period/);
});
test('forecast slice membership distinguishes category, period, currency and owner exits', () => {
  const before = row(), after = row({ forecastCategory: 'COMMIT', expectedCloseDate: new Date('2027-02-01') });
  assert.equal(rules.inSnapshotForecast(before, period, { category: 'ALL_OPEN' }), true);
  assert.equal(rules.inSnapshotForecast(after, period), false);
  assert.equal(rules.inSnapshotForecast(row({ forecastCategory: 'COMMIT' }), period, { category: 'COMMIT' }), true);
  assert.equal(rules.inSnapshotForecast(before, period, { category: 'COMMIT' }), false);
  assert.equal(rules.inSnapshotForecast(before, period, { currencyCode: 'EUR' }), false);
  assert.equal(rules.inSnapshotForecast(before, period, { ownerId: 3 }), false);
  assert.equal(rules.inSnapshotForecast(null, period), false);
  assert.deepEqual(sources.compareOpportunitySnapshots(before, after), ['Close date slipped', 'Forecast category changed']);
});
test('creation and reporting deny unauthorized or inactive users at the service and route', async () => {
  for (const role of ['SALES_MANAGER', 'SALES', 'READ_ONLY', 'MARKETING_MANAGER', 'SUPPORT']) {
    await assert.rejects(service.previewForecastSnapshot({}, { ...actor, role }, period), /Access denied/);
    await assert.rejects(service.captureForecastSnapshot({}, { ...actor, role }, {}, true), /Access denied/);
  }
  for (const who of [{ ...actor, active: false }, { ...actor, archivedAt: new Date() }, ...['SALES', 'READ_ONLY', 'MARKETING_MANAGER', 'SUPPORT'].map(role => ({ ...actor, role }))]) {
    await assert.rejects(service.compareForecastSnapshotRuns({}, who, 1, 2), /Access denied/);
    assert.equal(auth.routeAccess('/reports/forecast-snapshots', who), 'denied');
  }
  assert.equal(auth.routeAccess('/reports/forecast-snapshots', { ...actor, role: 'SALES_MANAGER' }), 'allowed');
});
test('signed previews reject cross-user, tampered and wrong-domain inputs', () => {
  const p = { ...period, preparedAt: new Date().toISOString() }, token = signing.signForecastPreview(p, 1, 'test');
  assert.deepEqual(signing.verifyForecastPreview(token, 1, 'test'), p);
  assert.throws(() => signing.verifyForecastPreview(token, 2, 'test'), /Invalid/);
  assert.throws(() => signing.verifyForecastPreview(token + 'x', 1, 'test'), /Invalid/);
  assert.throws(() => signing.verifyForecastPreview(token, 1, 'other'), /Invalid/);
});
