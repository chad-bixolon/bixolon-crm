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
const { Prisma } = require('@prisma/client');
const { runWeeklySnapshots, intendedSnapshotWeek } = require(path.join(root, 'lib/weekly-snapshots.ts'));
const { snapshotWeek, previewOpportunitySnapshot, assertSnapshotAdmin } = require(path.join(root, 'lib/opportunity-snapshots.ts'));
const { businessQuarter } = require(path.join(root, 'lib/business-quarter.ts'));
const { weeklySnapshotService, snapshotCreator, snapshotAttribution, assertSnapshotCaptureActor } = require(path.join(root, 'lib/snapshot-capture-identity.ts'));
function fake(at = new Date()) {
  const sources = [], forecasts = [], jobs = [], events = [];
  const flags = { opportunityFailure: false, forecastFailure: false, historyFailure: false };
  const duplicate = () => new Prisma.PrismaClientKnownRequestError('private database detail', { code: 'P2002', clientVersion: '6' });
  const db = {
    $queryRaw: async () => [{ at }],
    $transaction: async fn => fn(db),
    user: { findUniqueOrThrow: async () => { events.push('human-lookup'); return { firstName: 'Manual', lastName: 'Admin' }; } },
    opportunity: { findMany: async () => { events.push('opportunity-read'); if (flags.opportunityFailure) throw new Error('secret connection URL'); return []; } },
    opportunitySnapshotRun: {
      findUnique: async ({ where }) => sources.find(s => where.id ? s.id === where.id : +s.snapshotWeek === +where.snapshotWeek) ?? null,
      create: async ({ data }) => { if (sources.some(s => +s.snapshotWeek === +data.snapshotWeek)) throw duplicate(); const s = { id: sources.length + 1, status: 'COMPLETE', ...data }; sources.push(s); events.push('opportunity-commit'); return s; },
    },
    opportunitySnapshot: { findMany: async () => { events.push('forecast-read'); if (flags.forecastFailure) throw new Error('raw database error'); return []; }, createMany: async () => {} },
    forecastSnapshotRun: {
      findUnique: async ({ where: { sourceRunId_year_quarter: key } }) => forecasts.find(f => f.sourceRunId === key.sourceRunId && f.year === key.year && f.quarter === key.quarter) ?? null,
      create: async ({ data }) => { if (forecasts.some(f => f.sourceRunId === data.sourceRunId && f.year === data.year && f.quarter === data.quarter)) throw duplicate(); const f = { id: forecasts.length + 10, status: 'COMPLETE', rulesVersion: 'QUARTERLY_V1', ...data }; forecasts.push(f); events.push('forecast-commit'); return f; },
    },
    forecastSnapshotRollup: { createMany: async () => {} },
    scheduledJobRun: {
      create: async ({ data }) => { if (flags.historyFailure) throw new Error('history unavailable'); const j = { id: jobs.length + 1, startedAt: at, opportunitySnapshotRunId: null, forecastSnapshotRunId: null, ...data }; jobs.push(j); return j; },
      update: async ({ where, data }) => Object.assign(jobs.find(j => j.id === where.id), data),
    },
  };
  const manual = (extra = {}) => { const s = { id: 99, status: 'COMPLETE', scopeVersion: 'FORECAST_OPERATIONAL_V1', snapshotWeek: snapshotWeek(at), snapshotAt: at, opportunityCount: 0, source: 'MANUAL', createdById: 7, createdByName: 'Manual Admin', ...extra }; sources.push(s); return s; };
  return { db, sources, forecasts, jobs, events, flags, manual };
}
test('normal weekly capture uses both real shared services in order, exact source, and service attribution', async () => {
  const f = fake(); const result = await runWeeklySnapshots(f.db);
  assert.equal(result.status, 'SUCCEEDED'); assert.equal(result.createdCount, 2);
  assert.equal(result.opportunitySnapshotRunId, f.sources[0].id); assert.equal(result.forecastSnapshotRunId, f.forecasts[0].id);
  assert.equal(f.forecasts[0].sourceRunId, f.sources[0].id);
  assert.ok(f.events.indexOf('opportunity-commit') < f.events.indexOf('forecast-read'));
  for (const run of [f.sources[0], f.forecasts[0]]) { assert.equal(run.source, 'SCHEDULED'); assert.equal(run.createdById, null); assert.equal(snapshotAttribution(run), 'Automated weekly capture'); }
  assert.ok(!f.events.includes('human-lookup'));
});
test('Opportunity failure records a safe failure and never attempts Forecast', async () => {
  const f = fake(); f.flags.opportunityFailure = true;
  const result = await runWeeklySnapshots(f.db);
  assert.equal(result.status, 'FAILED'); assert.equal(result.failureCategory, 'OPPORTUNITY_CAPTURE_FAILED');
  assert.equal(f.sources.length, 0); assert.equal(f.forecasts.length, 0); assert.ok(!f.events.includes('forecast-read'));
  assert.ok(!JSON.stringify(result).includes('secret connection'));
});
test('automated Opportunity success survives Forecast failure and a retry creates only the missing forecast', async () => {
  const f = fake(); f.flags.forecastFailure = true;
  const failed = await runWeeklySnapshots(f.db);
  assert.equal(failed.status, 'FAILED'); assert.equal(failed.failureCategory, 'FORECAST_CAPTURE_FAILED');
  assert.equal(f.sources.length, 1); assert.equal(f.sources[0].source, 'SCHEDULED'); assert.equal(f.forecasts.length, 0);
  assert.equal(failed.opportunitySnapshotRunId, f.sources[0].id);
  assert.ok(!JSON.stringify(failed).includes('raw database'));
  f.flags.forecastFailure = false;
  const retry = await runWeeklySnapshots(f.db);
  assert.equal(retry.status, 'SUCCEEDED'); assert.equal(retry.createdCount, 1); assert.equal(f.sources.length, 1); assert.equal(f.forecasts.length, 1);
});
test('a process crossing Monday midnight refuses to capture the wrong intended week', async () => {
  const f = fake(new Date('2026-10-19T03:59:59Z'));
  let reads = 0;
  f.db.$queryRaw = async () => [{ at: new Date(reads++ === 0 ? '2026-10-19T03:59:59Z' : '2026-10-19T04:00:00Z') }];
  const result = await runWeeklySnapshots(f.db);
  assert.equal(result.status, 'FAILED'); assert.equal(f.sources.length, 0); assert.equal(f.forecasts.length, 0);
  assert.equal(result.snapshotWeek.toISOString().slice(0, 10), '2026-10-12');
});
test('Forecast failure preserves source; retry recovers even after a process restart and quarter rollover', async () => {
  const f = fake(new Date('2027-01-04T10:00:00Z'));
  const source = f.manual({ snapshotAt: new Date('2026-12-31T23:00:00Z'), snapshotWeek: new Date('2026-12-28') });
  f.flags.forecastFailure = true;
  const failed = await runWeeklySnapshots(f.db, '2026-12-28');
  assert.equal(failed.status, 'FAILED'); assert.equal(failed.failureCategory, 'FORECAST_CAPTURE_FAILED'); assert.equal(failed.opportunitySnapshotRunId, source.id);
  f.flags.forecastFailure = false;
  // A RUNNING record from an interrupted process must never block recovery.
  await f.db.scheduledJobRun.create({ data: { jobType: 'WEEKLY_SNAPSHOTS', status: 'RUNNING' } });
  const retry = await runWeeklySnapshots(f.db, '2026-12-28');
  assert.equal(retry.status, 'SUCCEEDED'); assert.equal(f.sources.length, 1); assert.equal(f.forecasts.length, 1);
  assert.equal(f.forecasts[0].year, 2026); assert.equal(f.forecasts[0].quarter, 'Q4');
  assert.equal(f.forecasts[0].sourceRunId, source.id); assert.equal(retry.createdCount, 1);
});
test('simultaneous duplicate scheduler invocations and later retries create one pair', async () => {
  const f = fake();
  const results = await Promise.all([runWeeklySnapshots(f.db), runWeeklySnapshots(f.db)]);
  assert.ok(results.every(r => r.status === 'SUCCEEDED')); assert.equal(f.sources.length, 1); assert.equal(f.forecasts.length, 1);
  const retry = await runWeeklySnapshots(f.db); assert.equal(retry.createdCount, 0); assert.equal(f.jobs.length, 3);
});
test('a complete manual source and manual forecast satisfy the weekly requirement without changing attribution', async () => {
  const f = fake(); const source = f.manual();
  const forecast = await f.db.forecastSnapshotRun.create({ data: { sourceRunId: source.id, snapshotAt: source.snapshotAt, ...businessQuarter(source.snapshotAt), createdById: 7, createdByName: 'Manual Admin', source: 'MANUAL' } });
  const result = await runWeeklySnapshots(f.db);
  assert.equal(result.status, 'SUCCEEDED'); assert.equal(result.createdCount, 0); assert.equal(result.forecastSnapshotRunId, forecast.id);
  assert.equal(source.source, 'MANUAL'); assert.equal(snapshotAttribution(forecast), 'Manual capture by Manual Admin');
});
test('open-only weekly source fails visibly without replacement, and missing past weeks cannot be invented', async () => {
  const f = fake(); const source = f.manual({ scopeVersion: 'OPEN_OPERATIONAL_V1' });
  assert.equal((await runWeeklySnapshots(f.db)).failureCategory, 'INCOMPATIBLE_SOURCE');
  assert.equal(f.sources.length, 1); assert.equal(f.sources[0], source); assert.equal(f.forecasts.length, 0);
  assert.equal((await runWeeklySnapshots(f.db, '2000-01-03')).failureCategory, 'MISSING_HISTORICAL_SOURCE');
});
test('existing forecasts must match exact source, period, timestamp and complete rules', async () => {
  const f = fake(); const source = f.manual();
  const forecast = await f.db.forecastSnapshotRun.create({ data: { sourceRunId: source.id, snapshotAt: new Date('2000-01-01'), ...businessQuarter(source.snapshotAt) } });
  assert.equal((await runWeeklySnapshots(f.db)).failureCategory, 'FORECAST_CAPTURE_FAILED');
  forecast.snapshotAt = source.snapshotAt; forecast.status = 'RUNNING';
  assert.equal((await runWeeklySnapshots(f.db)).status, 'FAILED');
});
test('durable history is required before any capture', async () => {
  const f = fake(); f.flags.historyFailure = true;
  await assert.rejects(runWeeklySnapshots(f.db)); assert.equal(f.events.length, 0);
});
test('service capability cannot be forged and human permissions stay unchanged', async () => {
  const f = fake();
  assert.throws(() => assertSnapshotAdmin(weeklySnapshotService));
  assert.throws(() => assertSnapshotCaptureActor({ service: 'weekly-snapshots' }), /Access denied/);
  for (const actor of [{ id: 1, role: 'SALES', active: true }, { id: 1, role: 'ADMIN', active: false }, { id: 1, role: 'ADMIN', active: true, archivedAt: new Date() }]) await assert.rejects(previewOpportunitySnapshot(f.db, actor), /Access denied/);
  const manual = await snapshotCreator(f.db, { id: 7, role: 'ADMIN', active: true });
  assert.deepEqual(manual, { createdById: 7, createdByName: 'Manual Admin', source: 'MANUAL' });
});
test('New York Monday weeks and quarters survive UTC midnight, local midnight and DST changes', () => {
  for (const [at, week, quarter, year] of [
    ['2026-10-19T00:00:00Z', '2026-10-12', 'Q4', 2026],
    ['2026-10-19T03:59:59Z', '2026-10-12', 'Q4', 2026],
    ['2026-10-19T04:00:00Z', '2026-10-19', 'Q4', 2026],
    ['2026-03-08T06:59:59Z', '2026-03-02', 'Q1', 2026],
    ['2026-03-08T07:00:00Z', '2026-03-02', 'Q1', 2026],
    ['2026-03-09T09:00:00Z', '2026-03-09', 'Q1', 2026],
    ['2026-11-01T05:59:59Z', '2026-10-26', 'Q4', 2026],
    ['2026-11-01T06:00:00Z', '2026-10-26', 'Q4', 2026],
    ['2026-11-02T10:00:00Z', '2026-11-02', 'Q4', 2026],
    ['2026-10-01T03:59:59Z', '2026-09-28', 'Q3', 2026],
    ['2026-10-01T04:00:00Z', '2026-09-28', 'Q4', 2026],
    ['2027-01-01T04:59:59Z', '2026-12-28', 'Q4', 2026],
    ['2027-01-01T05:00:00Z', '2026-12-28', 'Q1', 2027],
  ]) {
    assert.equal(snapshotWeek(new Date(at)).toISOString().slice(0, 10), week, at);
    assert.deepEqual(businessQuarter(new Date(at)), { year, quarter }, at);
  }
  for (const value of ['2026-02-30', '2026-10-18', '2099-01-05', 'invalid']) assert.throws(() => intendedSnapshotWeek(value, new Date('2026-10-19')));
});
