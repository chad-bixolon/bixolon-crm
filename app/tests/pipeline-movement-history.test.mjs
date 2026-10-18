import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import ts from 'typescript';
const require = Module.createRequire(import.meta.url);
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const h = require('../lib/pipeline-movement-history.ts');
const { analyzePipelineMovement } = require('../lib/pipeline-movement.ts');
const { salesHubMovementPolicy: policy } = require('../lib/pipeline-movement-report.ts');
const { loadMovementHistory } = require('../lib/pipeline-movement-history-report.ts');
const period = { start: new Date('2026-10-01'), endExclusive: new Date('2027-01-01') };
const filters = { period, currencyCode: 'USD' };
const options = { categoryKeys: { bestCase: 'BEST_CASE', commit: 'COMMIT' }, hasClosureEvidence: c => c.scopeVersion !== 'OPEN_OPERATIONAL_V1' };
const state = (extra = {}) => ({ opportunityId: 1, opportunityName: 'Deal', amount: '100.01', currencyCode: 'USD', expectedCloseDate: new Date('2026-12-01'), ownerId: 7, ownerName: 'Frozen owner', ownerForecastEligible: true, stageId: 1, stageName: 'Open', stageProbability: 20, status: 'OPEN', forecastCategory: 'COMMIT', accounts: [{ id: 10, name: 'Frozen account' }], ...extra });
const capture = (i, rows = [state()], extra = {}) => ({ id: i + 1, snapshotAt: new Date(Date.UTC(2026, 9, 4 + i * 7, 15)), snapshotWeek: new Date(Date.UTC(2026, 9, 4 + i * 7)), source: i % 2 ? 'SCHEDULED' : 'MANUAL', scopeVersion: 'FORECAST_OPERATIONAL_V1', rows, ...extra });
const current = (extra = {}) => ({ id: 1, status: 'WON', expectedCloseDate: new Date('2026-12-01'), actualCloseDate: new Date('2026-12-20'), outcomeReasonName: 'Original label', events: [], ...extra });
const analyze = captures => h.analyzeHistory(captures, filters, policy, options);

test('4/8/12-week windows are date bounded, inclusive, and quarter clipped', () => {
  const captures = Array.from({ length: 13 }, (_, i) => capture(i));
  const end = captures.at(-1).snapshotAt;
  for (const weeks of [4, 8, 12]) {
    const w = h.historyWindow(end, period, String(weeks));
    assert.equal(captures.filter(c => c.snapshotAt >= w.start && c.snapshotAt <= w.end).length, weeks + 1);
    assert.equal(w.end, end);
  }
  assert.equal(h.historyWindow(end, period, 'quarter').start, period.start);
  assert.equal(h.historyWindow(captures[1].snapshotAt, period, '12').start.getTime(), period.start.getTime());
  assert.throws(() => h.historyWindow(end, period, '52'), /Choose/);
});
test('quarter progression preserves v1 allocation, cents and category totals', () => {
  const before = [state({ amount: '200' }), state({ opportunityId: 2, amount: '100' })];
  const after = [state({ amount: '150', expectedCloseDate: new Date('2027-02-01'), forecastCategory: 'BEST_CASE' }), state({ opportunityId: 2, amount: '100.01' }), state({ opportunityId: 3, amount: '50' })];
  const result = analyze([capture(0, before), capture(1, after)]);
  assert.equal(result.points[0].pipeline, '300.00'); assert.equal(result.points[1].pipeline, '150.01');
  assert.equal(result.points[1].commit, '150.01'); assert.equal(result.points[1].slipped, '200.00'); assert.equal(result.points[1].entered, '50.00');
  assert.equal(result.reconciliation.totals.decreases, '0.00');
  assert.deepEqual(result.reconciliation, analyzePipelineMovement(before, after, filters, policy));
});
test('missing weeks are gaps, manual/automated captures use identical logic, legacy won is unknown', () => {
  const r = analyze([capture(0), capture(2, [state({ status: 'WON' })]), capture(3, [], { scopeVersion: 'OPEN_OPERATIONAL_V1' })]);
  assert.equal(r.points.length, 3); assert.equal(r.points[1].gap, true); assert.equal(r.points[1].closedWon, '100.01'); assert.equal(r.points[2].closedWon, null);
  assert.equal(r.points[0].intervalEntered, null); assert.equal(r.points[0].source, 'MANUAL'); assert.equal(r.points[2].source, 'SCHEDULED');
});
test('Commit and Best Case cohorts classify every current outcome once using historical amounts', () => {
  const states = Array.from({ length: 8 }, (_, i) => state({ opportunityId: i + 1, forecastCategory: i === 7 ? 'BEST_CASE' : 'COMMIT' }));
  const outcomes = [current(), current({ id: 2, actualCloseDate: new Date('2027-02-01') }), current({ id: 3, actualCloseDate: new Date('2026-09-01') }), current({ id: 4, status: 'LOST' }), current({ id: 5, status: 'OPEN', expectedCloseDate: new Date('2027-02-01') }), current({ id: 6, status: 'OPEN' }), current({ id: 7, actualCloseDate: null }), current({ id: 8 })];
  const rows = h.cohortOutcomes(states, outcomes, filters, policy, 'COMMIT');
  assert.deepEqual(rows.map(r => r.outcome), ['Closed Won in-period', 'Closed Won later', 'Closed Won earlier', 'Closed Lost', 'Slipped to another quarter', 'Still open', 'Closed Won · actual close unknown']);
  assert.equal(h.cohortOutcomes(states, outcomes, filters, policy, 'BEST_CASE').length, 1);
  assert.equal(h.outcomeGroups(rows, 'outcome').reduce((n, g) => n + g.count, 0), 7);
});
test('Expected vs Actual Close uses calendar periods and never infers legacy actual dates', () => {
  const expected = new Date('2026-12-01');
  for (const [outcome, label] of [[current(), 'Closed in expected period'], [current({ actualCloseDate: new Date('2027-01-01') }), 'Closed later than expected'], [current({ actualCloseDate: new Date('2026-09-30') }), 'Closed earlier than expected'], [current({ actualCloseDate: null, events: [{ eventType: 'CLOSED', occurredAt: new Date() }] }), 'Actual close unknown'], [current({ status: 'OPEN' }), 'Still open'], [current({ status: 'OPEN', expectedCloseDate: new Date('2027-02-01') }), 'Slipped to another quarter']]) assert.equal(h.timingOutcome(expected, outcome), label);
  assert.equal(h.timingOutcome(null, current()), 'Expected close unknown'); assert.equal(h.timingOutcome(expected, undefined), 'Outcome unavailable');
});
test('reopened deals use latest state and preserve prior events without double counting; ambiguous history is flagged', () => {
  const events = ['CLOSED', 'OUTCOME_REOPENED', 'CLOSED', 'OUTCOME_REOPENED'].map((eventType, i) => ({ id: i + 1, eventType, occurredAt: new Date(2026, 10, i + 1), oldOutcome: null, newOutcome: { status: eventType === 'CLOSED' ? 'Closed Won' : 'Open' } }));
  const rows = h.cohortOutcomes([state()], [current({ status: 'OPEN', actualCloseDate: null, events })], filters, policy);
  assert.equal(rows[0].outcome, 'Still open'); assert.equal(rows[0].closures, 2); assert.equal(rows[0].reopens, 2); assert.equal(rows[0].ambiguous, false);
  assert.equal(h.outcomeGroups(rows, 'outcome')[0].count, 1); assert.equal(h.outcomeGroups(rows, 'outcome')[0].won, 0);
  assert.equal(h.cohortOutcomes([state()], [current({ events })], filters, policy)[0].ambiguous, true);
});
test('repeated slips accumulate v1 movements but detail uses first slip once; cleared dates remain unknown', () => {
  const outside = state({ expectedCloseDate: new Date('2027-02-01'), amount: '50' });
  const r = analyze([capture(0), capture(1, [outside]), capture(2), capture(3, [outside])]);
  assert.equal(r.slips.length, 1); assert.equal(r.points.at(-1).slipped, '200.02'); assert.equal(r.points.at(-1).entered, '100.01');
  assert.equal(r.slips[0].weeks, 9);
  assert.equal(analyze([capture(0), capture(1, [state({ expectedCloseDate: null })])]).slips[0].weeks, null);
});
test('currency and captured owner/Account/category filters preserve both endpoints for exits', () => {
  const captures = [capture(0, [state(), state({ opportunityId: 2, currencyCode: 'CAD', amount: '9999' })]), capture(1, [state({ ownerId: 8, accounts: [{ id: 11, name: 'Other' }] })])];
  assert.equal(h.analyzeHistory(captures, { ...filters, ownerId: 7 }, policy, options).points[1].pipeline, '0.00');
  const scoped = h.analyzeHistory(captures, filters, h.historicalPolicy(policy, 10), options);
  assert.equal(scoped.points[0].pipeline, '100.01'); assert.equal(scoped.points[1].pipeline, '0.00'); assert.equal(scoped.reconciliation.totals.removed, '-100.01');
  assert.equal(h.analyzeHistory(captures, filters, h.historicalPolicy(policy, undefined, 'BEST_CASE'), options).points[0].pipeline, '0.00');
});
test('reason labels preserve renamed/inactive strings, Account groups overlap explicitly and owner names are captured', () => {
  const rows = h.cohortOutcomes([state({ accounts: [{ id: 10, name: 'Old name' }, { id: 11, name: 'Second' }] })], [current({ status: 'LOST', outcomeReasonName: 'Inactive old label' })], filters, policy);
  assert.equal(h.outcomeGroups(rows, 'reason')[0].label, 'LOST · Inactive old label');
  assert.equal(h.outcomeGroups(rows, 'account').length, 2); assert.equal(h.outcomeGroups(rows, 'owner')[0].label, 'Frozen owner (#7)');
});
test('quarter comparison requires two compatible matching weeks and omits missing and legacy periods', () => {
  const a = analyze([capture(0), capture(1), capture(3)]);
  const previous = { start: new Date('2026-07-01'), endExclusive: new Date('2026-10-01') };
  const b = h.analyzeHistory([0, 1, 2].map(i => capture(i, [state({ expectedCloseDate: new Date('2026-08-01') })], { snapshotAt: new Date(Date.UTC(2026, 6, 4 + i * 7)), snapshotWeek: new Date(Date.UTC(2026, 6, 4 + i * 7)) })), { ...filters, period: previous }, policy, options);
  assert.deepEqual(h.compareQuarterHistory(a, b, period, previous).map(p => p.week), [1, 2]);
  assert.deepEqual(h.compareQuarterHistory({ points: a.points.slice(0, 1) }, b, period, previous), []);
  assert.deepEqual(h.compareQuarterHistory({ points: a.points.map(p => ({ ...p, scopeVersion: 'OPEN_OPERATIONAL_V1', closedWon: null })) }, b, period, previous), []);
});
test('generic history works without forecasting, company labels or category ordering', () => {
  const r = h.analyzeHistory([capture(0, [state({ forecastCategory: null })]), capture(1, [state({ forecastCategory: null, amount: '200' })])], filters);
  assert.equal(r.points[1].pipeline, '200.00'); assert.equal(r.points[1].commit, null); assert.equal(r.reconciliation.change, '99.99');
});

function fakeClient() {
  const runs = Array.from({ length: 13 }, (_, i) => ({ ...capture(i), opportunityCount: 1, status: 'COMPLETE' }));
  const calls = [];
  const client = { currency: { findMany: async () => [{code:"USD",name:"US Dollar",active:true,isDefault:true}] }, user: { findMany: async () => [{ id: 7 }, { id: 8 }] }, opportunitySnapshotRun: { findMany: async q => { calls.push(q); return runs; } }, opportunitySnapshot: { findMany: async q => { calls.push(q); return runs.filter(r => q.where.runId.in.includes(r.id)).map(r => ({ ...state(), runId: r.id })); } }, opportunity: { findMany: async () => [{ ...current(), stage: { isClosed: true, isWon: true } }] }, opportunityHistoryEvent: { findMany: async () => [] }, opportunityHistoryArchive: { findMany: async () => [] }, forecastSnapshotRun: { findMany: async () => [] } };
  client.$transaction = async fn => fn(client);
  return { client, calls };
}
const manager = { id: 7, active: true, role: 'SALES_MANAGER' };
test('adapter loads only window rows plus explicit cohort and defaults Sales to self', async () => {
  for (const [window, count] of [['4', 5], ['8', 9], ['12', 13], ['quarter', 13]]) {
    const { client, calls } = fakeClient();
    const r = await loadMovementHistory(client, { ...manager, role: 'SALES' }, { year: '2026', quarter: 'Q4', window, cohortRun: '13' });
    assert.equal(r.history.points.length, count); assert.equal(r.ownerId, 7);
    assert.equal(calls.find(c => c.where.runId).where.runId.in.length, count);
  }
});
test('adapter rejects invalid filters, denied actors, over-size and incomplete captures', async () => {
  for (const query of [{ window: '99' }, { ownerId: 'team' }, { category: 'bogus' }, { accountId: 'x' }, { cohortCategory: 'bogus' }, { compareQuarter: 'Q4', compareYear: '2026' }]) await assert.rejects(loadMovementHistory(fakeClient().client, { ...manager, role: 'SALES' }, { year: '2026', quarter: 'Q4', ...query }));
  await assert.rejects(loadMovementHistory({}, { ...manager, role: 'READ_ONLY' }, {}), /denied/);
  const f = fakeClient(); f.client.opportunitySnapshot.findMany = async () => [];
  await assert.rejects(loadMovementHistory(f.client, manager, { year: '2026', quarter: 'Q4' }), /incomplete/);
});

test('movement groups attribute captured transfers and Account changes without using live membership', () => {
  const r = analyze([capture(0), capture(1, [state({ ownerId: 8, ownerName: 'New captured owner', accounts: [{ id: 11, name: 'New captured account' }], amount: '200' })])]);
  const owners = h.movementGroups(r.reconciliation, 'owner');
  assert.equal(owners.find(g => g.label.includes('#7')).change, '-100.01'); assert.equal(owners.find(g => g.label.includes('#8')).change, '200.00');
  const accounts = h.movementGroups(r.reconciliation, 'account'); assert.equal(accounts.find(g => g.label.includes('#10')).ending, '0.00'); assert.equal(accounts.find(g => g.label.includes('#11')).starting, '0.00');
});
test('quarter slippage comparison flags differing interval spans across a missing week', () => {
  const a = analyze([capture(0), capture(2), capture(3)]), b = analyze([capture(0), capture(1), capture(2), capture(3)]);
  const pairs = h.compareQuarterHistory(a, b, period, period);
  assert.equal(pairs[1].sameInterval, false); assert.equal(pairs[2].sameInterval, true);
});
test('adapter retains first quarter week and uses captured week boundaries across DST', async () => {
  const f = fakeClient();
  const runs = Array.from({ length: 5 }, (_, i) => ({ ...capture(i), snapshotAt: new Date(Date.UTC(2026, 9, 5 + i * 7, i === 4 ? 16 : 15)), snapshotWeek: new Date(Date.UTC(2026, 9, 5 + i * 7)), opportunityCount: 1 }));
  f.client.opportunitySnapshotRun.findMany = async () => runs;
  f.client.opportunitySnapshot.findMany = async () => runs.map(r => ({ ...state(), runId: r.id }));
  const r = await loadMovementHistory(f.client, manager, { year: '2026', quarter: 'Q4', window: '4', cohortRun: '1' });
  assert.equal(r.history.points.length, 5);
});
test('archived and live copies of an outcome event are deduplicated by source ID', async () => {
  const f = fakeClient();
  const event = { id: 10, opportunityId: 1, occurredAt: new Date('2026-11-01'), eventType: 'CLOSED', oldOutcome: null, newOutcome: { status: 'Closed Won', actualCloseDate: '2026-12-20', outcomeReason: 'Original label' } };
  f.client.opportunityHistoryEvent.findMany = async () => [event]; f.client.opportunityHistoryArchive.findMany = async () => [{ ...event, id: 99, sourceId: 10 }];
  const r = await loadMovementHistory(f.client, manager, { year: '2026', quarter: 'Q4', cohortRun: '1' });
  assert.equal(r.cohort[0].closures, 1); assert.equal(r.cohort[0].events.length, 1); assert.equal(r.cohort[0].ambiguous, false);
});

test('Lost reason views require captured Commit or an observed slip before a known actual close', async () => {
  const setup = actual => {
    const f = fakeClient();
    f.client.opportunity.findMany = async () => [{ ...current({ status: 'LOST', actualCloseDate: actual }), stage: { isClosed: true, isWon: false } }];
    f.client.opportunitySnapshot.findMany = async q => Array.from({ length: 13 }, (_, i) => ({ ...state({ expectedCloseDate: new Date(i === 12 ? '2027-02-01' : '2026-12-01') }), runId: i + 1 })).filter(r => q.where.runId.in.includes(r.runId));
    return f.client;
  };
  const query = { year: '2026', quarter: 'Q4', window: 'quarter', cohortRun: '1' };
  const committed = await loadMovementHistory(setup(new Date('2027-01-01')), manager, { ...query, reasonView: 'lost-commit' }); assert.equal(committed.reasons.length, 1);
  for (const [actual, count] of [[new Date('2027-01-01'), 1], [new Date('2026-10-01'), 0], [null, 0]]) {
    const r = await loadMovementHistory(setup(actual), manager, { ...query, reasonView: 'lost-slipped' }); assert.equal(r.reasons.length, count);
  }
});
