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
const { analyzePipelineMovement: analyze, compareMovement: compare } = require(path.join(root, 'lib/pipeline-movement.ts'));
const { salesHubMovementPolicy: policy, movementOwner, loadPipelineMovement, canReadPipelineMovement } = require(path.join(root, 'lib/pipeline-movement-report.ts'));
const { routeAccess } = require(path.join(root, 'lib/authorization.ts'));
const filters = { period: { start: new Date('2026-10-01'), endExclusive: new Date('2027-01-01') }, currencyCode: 'USD' };
const state = (extra = {}) => ({ opportunityId: 1, opportunityName: 'Expansion', ownerId: 7, ownerName: 'Captured rep', ownerForecastEligible: true, amount: '100000.00', currencyCode: 'USD', expectedCloseDate: new Date('2026-11-01'), stageId: 1, stageName: 'Discovery', stageProbability: 20, forecastCategory: 'BEST_CASE', status: 'OPEN', ...extra });
const result = (before = state(), after = state(), context = filters) => analyze(before ? [before] : [], after ? [after] : [], context, policy);
const sum = values => values.reduce((total, value) => total.add(value), new Prisma.Decimal(0));
function reconciles(report) {
  assert.equal(sum([report.starting, ...Object.values(report.totals)]).toFixed(2), report.ending);
  assert.equal(sum(report.rows.map(row => row.impact)).toFixed(2), report.change);
  for (const row of report.rows) assert.equal(new Prisma.Decimal(row.current).sub(row.previous).toFixed(2), row.impact);
  for (const category of report.forecast) assert.equal(new Prisma.Decimal(category.previous).add(category.into).sub(category.out).add(category.retained).toFixed(2), category.current);
}

test('unchanged and newly included Opportunities retain endpoint evidence', () => {
  const same = result(); assert.equal(same.rows[0].primary, 'UNCHANGED'); assert.equal(same.change, '0.00'); reconciles(same);
  const added = result(null); assert.equal(added.rows[0].primary, 'NEW'); assert.equal(added.totals.additions, '100000.00');
  assert.match(added.rows[0].changes[0].detail, /not distinguishable/); reconciles(added);
});
test('entered quarter uses later amount and slipped quarter uses earlier amount', () => {
  const outside = state({ expectedCloseDate: new Date('2027-01-01') });
  const entry = result(outside, state({ amount: '150000' })); assert.equal(entry.totals.entered, '150000.00'); assert.equal(entry.totals.increases, '0.00'); reconciles(entry);
  const slip = result(state({ amount: '200000' }), { ...outside, amount: '150000' });
  assert.equal(slip.rows[0].primary, 'SLIPPED'); assert.equal(slip.totals.slipped, '-200000.00'); assert.equal(slip.totals.decreases, '0.00'); assert.equal(slip.ending, '0.00'); reconciles(slip);
  assert.equal(result(state(), state({ expectedCloseDate: null })).totals.slipped, '-100000.00');
});
test('value increases/decreases and fractional amounts use exact decimal arithmetic', () => {
  for (const [amount, primary, bucket, delta] of [['100000.01', 'INCREASE', 'increases', '0.01'], ['99999.99', 'DECREASE', 'decreases', '-0.01']]) {
    const r = result(state(), state({ amount })); assert.equal(r.rows[0].primary, primary); assert.equal(r.totals[bucket], delta); reconciles(r);
  }
  const r = result(state({ amount: '9999999999999999.98' }), state({ amount: '9999999999999999.99' })); assert.equal(r.change, '0.01'); reconciles(r);
});
test('aggregate totals retain cents beyond the default decimal precision', () => {
  const before = Array.from({ length: 10000 }, (_, i) => state({ opportunityId: i + 1, amount: '9999999999999999.98' }));
  const after = before.map(row => ({ ...row, amount: '9999999999999999.99' }));
  const r = analyze(before, after, filters, policy);
  assert.equal(r.starting, '99999999999999999800.00');
  assert.equal(r.ending, '99999999999999999900.00');
  assert.equal(r.change, '100.00'); assert.equal(r.totals.increases, '100.00');
  const category = r.forecast.find(c => c.category === 'BEST_CASE');
  assert.equal(category.previous, r.starting); assert.equal(category.current, r.ending); assert.equal(category.retained, '100.00');
});
test('stage direction uses frozen probability, equal probabilities preserve unknown direction', () => {
  for (const [stageProbability, primary] of [[60, 'STAGE_UP'], [10, 'STAGE_DOWN'], [20, 'STAGE_CHANGED']]) {
    const r = result(state(), state({ stageId: 2, stageName: 'Evaluation', stageProbability })); assert.equal(r.rows[0].primary, primary); assert.equal(r.change, '0.00'); reconciles(r);
  }
  const r = compare(state(), state({ stageId: 2 }), filters, { stageOrder: new Map([[1, 20], [2, 5]]) }); assert.equal(r.primary, 'STAGE_DOWN');
});
test('forecast upgrade/downgrade changes composition independently of pipeline', () => {
  const upgrade = result(state(), state({ forecastCategory: 'COMMIT' }));
  assert.equal(upgrade.rows[0].primary, 'FORECAST_UP'); assert.equal(upgrade.change, '0.00');
  assert.equal(upgrade.forecast.find(c => c.category === 'COMMIT').into, '100000.00');
  assert.equal(upgrade.forecast.find(c => c.category === 'BEST_CASE').out, '100000.00'); reconciles(upgrade);
  const down = result(state({ forecastCategory: 'COMMIT' }), state()); assert.equal(down.rows[0].primary, 'FORECAST_DOWN'); reconciles(down);
});
test('category entry with amount change reconciles using full before/after values', () => {
  const r = result(state(), state({ amount: '150000', forecastCategory: 'COMMIT' }));
  assert.equal(r.totals.increases, '50000.00'); assert.equal(r.forecast.find(c => c.category === 'BEST_CASE').out, '100000.00');
  assert.equal(r.forecast.find(c => c.category === 'COMMIT').into, '150000.00'); reconciles(r);
  const retained = result(state(), state({ amount: '99999' })); assert.equal(retained.forecast.find(c => c.category === 'BEST_CASE').retained, '-1.00'); reconciles(retained);
});
test('Won and Lost closure take precedence over simultaneous slip, category and value changes', () => {
  for (const [status, primary, bucket] of [['WON', 'WON', 'won'], ['LOST', 'LOST', 'lost']]) {
    const r = result(state({ amount: '200000', forecastCategory: 'COMMIT' }), state({ status, amount: '150000', forecastCategory: 'BEST_CASE', expectedCloseDate: new Date('2027-02-01'), stageId: 2, stageProbability: 100 }));
    assert.equal(r.rows[0].primary, primary); assert.equal(r.totals[bucket], '-200000.00');
    assert.equal(r.totals.decreases, '0.00'); assert.equal(r.totals.slipped, '0.00');
    for (const type of ['SLIPPED', 'DECREASE', 'FORECAST_DOWN', 'STAGE_UP']) assert.ok(r.rows[0].changes.some(c => c.type === type)); reconciles(r);
  }
});
test('newly captured closures remain visible without inventing an open starting value', () => {
  for (const status of ['WON', 'LOST']) {
    const r = result(null, state({ status, forecastCategory: 'CLOSED' }));
    assert.equal(r.rows[0].primary, status); assert.equal(r.rows[0].impact, '0.00');
    assert.equal(r.starting, '0.00'); assert.equal(r.ending, '0.00'); assert.equal(r.rows[0].bucket, null);
    assert.equal(r.groups[status === 'WON' ? 'won' : 'lost'].length, 1); reconciles(r);
  }
  const unchangedWon = result(state({ status: 'WON' }), state({ status: 'WON' })); assert.equal(unchangedWon.rows.length, 0);
  const otherOwner = result(null, state({ status: 'WON', ownerId: 8 }), { ...filters, ownerId: 7 }); assert.equal(otherOwner.rows.length, 0);
});
test('multi-change slip deducts exactly once and preserves every additional change', () => {
  const r = result(state({ amount: '200000', forecastCategory: 'COMMIT' }), state({ amount: '150000', forecastCategory: 'BEST_CASE', expectedCloseDate: new Date('2027-01-20'), stageId: 2, stageProbability: 10 }));
  assert.equal(r.rows[0].primary, 'SLIPPED'); assert.equal(r.change, '-200000.00'); assert.equal(r.totals.decreases, '0.00');
  for (const type of ['SLIPPED', 'DECREASE', 'FORECAST_DOWN', 'STAGE_DOWN', 'DETAILS']) assert.ok(r.rows[0].changes.some(c => c.type === type)); reconciles(r);
});
test('missing endpoint is removal with unknown reason, never an invented closure', () => {
  const r = result(state(), null); assert.equal(r.rows[0].primary, 'REMOVED'); assert.equal(r.totals.removed, '-100000.00');
  assert.equal(r.totals.lost, '0.00'); assert.equal(r.totals.won, '0.00'); reconciles(r);
});
test('owner filtering evaluates each endpoint; viewing preserves attribution', () => {
  const old = state(), current = state({ ownerId: 8, ownerName: 'Other rep', amount: '150000' });
  const own = result(old, current, { ...filters, ownerId: 7 }); assert.equal(own.totals.removed, '-100000.00'); assert.equal(own.rows[0].after.ownerId, 8); reconciles(own);
  const other = result(old, current, { ...filters, ownerId: 8 }); assert.equal(other.totals.scopeEntries, '150000.00'); reconciles(other);
  const all = result(old, current); assert.equal(all.totals.increases, '50000.00'); reconciles(all);
  assert.equal(old.ownerId, 7); assert.equal(current.ownerId, 8);
});
test('currency changes are scope exits/entries, never FX value increases', () => {
  const old = state(), current = state({ currencyCode: 'CAD', amount: '150000' });
  const usd = result(old, current); assert.equal(usd.change, '-100000.00'); assert.equal(usd.totals.decreases, '0.00'); assert.ok(usd.rows[0].changes.some(c => c.type === 'CURRENCY')); reconciles(usd);
  const cad = result(old, current, { ...filters, currencyCode: 'CAD' }); assert.equal(cad.change, '150000.00'); reconciles(cad);
  assert.throws(() => result(old, current, { ...filters, currencyCode: 'ALL' .toLowerCase() }), /currency/);
});
test('scope exclusion, captured eligibility changes and reopening reconcile', () => {
  for (const change of [{ forecastCategory: 'OMITTED' }, { ownerForecastEligible: false }, { ownerId: null }]) {
    const r = result(state(), state(change)); assert.equal(r.totals.removed, '-100000.00'); reconciles(r);
    const back = result(state(change), state()); assert.equal(back.totals.scopeEntries, '100000.00'); reconciles(back);
  }
  const reopen = result(state({ status: 'WON' }), state()); assert.equal(reopen.rows[0].primary, 'REOPENED'); assert.equal(reopen.totals.scopeEntries, '100000.00'); reconciles(reopen);
});
test('generic engine supports absent forecast categories and arbitrary reporting periods', () => {
  const r = analyze([state({ forecastCategory: null })], [state({ forecastCategory: null, amount: '110000' })], { ...filters, period: { start: new Date('2026-10-15'), endExclusive: new Date('2026-11-15') } });
  assert.equal(r.change, '10000.00'); assert.deepEqual(r.forecast, []); reconciles(r);
});
test('legacy eligibility remains unknown and does not consult mutable current owners', () => {
  const r = result(state({ ownerForecastEligible: null }), state({ ownerForecastEligible: true })); assert.equal(r.change, '0.00'); assert.equal(r.starting, '100000.00'); reconciles(r);
});
test('exhaustive endpoint combinations prove financial and category reconciliation', () => {
  const variants = [null];
  for (const status of ['OPEN', 'WON', 'LOST']) for (const amount of ['0.00', '100.01', '150.99']) for (const ownerId of [7, 8]) for (const currencyCode of ['USD', 'CAD']) for (const forecastCategory of ['BEST_CASE', 'COMMIT', 'OMITTED']) for (const expectedCloseDate of [new Date('2026-11-01'), new Date('2027-01-01'), null]) {
    variants.push(state({ status, amount, ownerId, currencyCode, forecastCategory, expectedCloseDate }));
  }
  // Every state against a representative set of endpoints covers interactions
  // across closure, period, amount, owner, currency and category simultaneously.
  const endpoints = [null, state(), state({ ownerId: 8, amount: '150.99', forecastCategory: 'COMMIT' }), state({ status: 'WON', currencyCode: 'CAD' }), state({ expectedCloseDate: null })];
  for (const before of variants) for (const after of endpoints) {
    if (!before && !after) continue;
    for (const ownerId of [undefined, 7, 8]) reconciles(result(before, after, { ...filters, ownerId }));
  }
});
test('Sales defaults own rep, intentional cross-Sales selection and effective-role authorization', () => {
  const actor = { id: 7, role: 'SALES', active: true }, reps = [{ id: 7 }, { id: 8 }];
  assert.equal(movementOwner(actor, undefined, reps), 7); assert.equal(movementOwner(actor, '8', reps), 8);
  assert.throws(() => movementOwner(actor, 'team', reps), /eligible/); assert.throws(() => movementOwner(actor, '9', reps), /eligible/);
  assert.equal(movementOwner({ ...actor, role: 'SALES_MANAGER' }, undefined, reps), undefined);
  for (const role of ['ADMIN', 'SALES_MANAGER', 'SALES']) assert.equal(routeAccess('/reports/pipeline-movement', { ...actor, role }), 'allowed');
  for (const role of ['READ_ONLY', 'SUPPORT', 'MARKETING_MANAGER']) { assert.equal(canReadPipelineMovement({ ...actor, role }), false); assert.equal(routeAccess('/reports/pipeline-movement', { ...actor, role }), 'denied'); }
  assert.equal(canReadPipelineMovement({ ...actor, active: false }), false);
});
function fakeReport({ prior = true, scope = 'FORECAST_OPERATIONAL_V1', source = 'SCHEDULED' } = {}) {
  const after = { id: 2, snapshotAt: new Date('2026-11-09T10:00:00Z'), snapshotWeek: new Date('2026-11-09'), scopeVersion: scope, source, status: 'COMPLETE', opportunityCount: 1 };
  const before = { ...after, id: 1, snapshotAt: new Date('2026-11-02T10:00:00Z') };
  const calls = [];
  const client = { currency: { findMany: async () => [{code:"USD",name:"US Dollar",active:true,isDefault:true}] },
    user: { findMany: async () => [{ id: 7 }, { id: 8 }] },
    opportunitySnapshotRun: { findMany: async query => { calls.push(query); return prior ? [after, before] : [after]; }, findFirst: async () => prior ? before : null },
    opportunitySnapshot: { findMany: async query => { calls.push(query); return query.distinct ? [{ currencyCode: 'USD' }] : [{ ...state(), runId: 1 }, { ...state({ amount: '150000' }), runId: 2 }]; } },
    $queryRaw: async query => { calls.push(query); return [{ opportunityId: 1 }]; },
  };
  return { client, calls };
}
const manager = { id: 7, role: 'SALES_MANAGER', active: true };
test('latest vs immediately prior defaults to later snapshot quarter; reads only two run endpoints', async () => {
  const f = fakeReport(); const r = await loadPipelineMovement(f.client, manager, {});
  assert.equal(r.before.id, 1); assert.equal(r.after.id, 2); assert.equal(r.year, 2026); assert.equal(r.quarter, 'Q4'); assert.equal(r.result.change, '50000.00');
  const endpoint = f.calls.find(query => query.where?.opportunityId); assert.deepEqual(endpoint.where.runId.in, [1, 2]); assert.equal(endpoint.take, 20001);
  const keyQuery = f.calls.find(query => query.sql); assert.ok(keyQuery.values.includes('USD')); assert.ok(keyQuery.values.some(value => value instanceof Date)); reconciles(r.result);
});
test('missing previous snapshot returns unavailable, never zero movement', async () => {
  const f = fakeReport({ prior: false }); const r = await loadPipelineMovement(f.client, manager, {});
  assert.equal(r.result, null); assert.equal(r.before, null); assert.equal(f.calls.filter(query => query.sql).length, 0);
});
test('a lone old snapshot explains missing prior before applying period bounds', async () => {
  const f = fakeReport({ prior: false });
  f.client.opportunitySnapshotRun.findMany = async () => [{ id: 1, snapshotAt: new Date('1999-12-27'), scopeVersion: 'OPEN_OPERATIONAL_V1', status: 'COMPLETE', opportunityCount: 0 }];
  const r = await loadPipelineMovement(f.client, manager, {}); assert.equal(r.result, null); assert.equal(r.year, 1999);
});
test('legacy/manual and automated snapshots use the same query-time engine', async () => {
  for (const [scope, source] of [['OPEN_OPERATIONAL_V1', 'MANUAL'], ['FORECAST_OPERATIONAL_V1', 'SCHEDULED']]) {
    const f = fakeReport({ scope, source }); const r = await loadPipelineMovement(f.client, manager, {}); assert.equal(r.result.change, '50000.00'); reconciles(r.result);
  }
});
test('invalid run ordering, owner, period, currency and permissions fail before endpoint analysis', async () => {
  for (const [query, message] of [[{ before: '2', after: '1' }, /earlier/], [{ before: '2', after: '2' }, /earlier/], [{ after: 'x' }, /IDs/], [{ year: '2026.5' }, /year/], [{ quarter: 'Q5' }, /quarter/], [{ ownerId: '999' }, /eligible/], [{ currencyCode: 'CAD' }, /currency/]]) await assert.rejects(loadPipelineMovement(fakeReport().client, manager, query), message);
  await assert.rejects(loadPipelineMovement({}, { ...manager, role: 'READ_ONLY' }, {}), /Access denied/);
});
