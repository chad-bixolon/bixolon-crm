import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

Module._extensions['.ts'] = Module._extensions['.tsx'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
}).outputText, filename);
const require = Module.createRequire(import.meta.url);
const { opportunityWhere, listOpportunities } = require('../lib/opportunities.ts');
const { opportunityOutcomeWhere, parseActualCloseDate } = require('../lib/opportunity-outcomes.ts');
const { normalizeSavedQuery, savedQueryHref, canUseSavedViews } = require('../lib/saved-views.ts');
const { countOpportunityFilters } = require('../lib/filter-count.ts');
const { businessToday } = require('../lib/business-date.ts');
const { resolveUserContext } = require('../lib/dev-impersonation.ts');
const { OpportunityOutcomeFilters } = require('../components/opportunity-outcome-filters.tsx');
const actor = role => ({ id: 7, role, active: true, archivedAt: null });

test('Open, Won and Lost use stage business flags; All and legacy requests have no outcome restriction', () => {
  for (const [outcomeStatus, stage] of [['open', { isClosed: false }], ['won', { isClosed: true, isWon: true }], ['lost', { isClosed: true, isWon: false }]]) {
    assert.deepEqual(opportunityWhere({ outcomeStatus }).stage, stage);
  }
  for (const input of [{}, { outcomeStatus: '' }, { outcomeStatus: 'all' }]) assert.equal(opportunityWhere(input).stage, undefined);
  const where = opportunityWhere({ outcomeStatus: 'lost', stageId: '3', competitorId: '9' });
  assert.equal(where.stageId, 3); assert.equal(where.competitorId, 9); assert.equal(where.stage.isWon, false);
});

test('actual from, through and inclusive ranges remain date-only across UTC, New York midnight and DST', () => {
  for (const day of ['2026-03-08', '2026-11-01', '2026-10-15']) {
    const date = parseActualCloseDate(day);
    assert.equal(date.toISOString(), `${day}T00:00:00.000Z`);
    assert.deepEqual(opportunityOutcomeWhere({ actualCloseFrom: day }).actualCloseDate, { gte: date });
    assert.deepEqual(opportunityOutcomeWhere({ actualCloseTo: day }).actualCloseDate, { lte: date });
    assert.deepEqual(opportunityOutcomeWhere({ actualCloseFrom: day, actualCloseTo: day }).actualCloseDate, { gte: date, lte: date });
  }
  for (const [instant, day] of [['2026-03-08T04:59:59Z', '2026-03-07'], ['2026-03-08T05:00:00Z', '2026-03-08'], ['2026-11-01T03:59:59Z', '2026-10-31'], ['2026-11-01T04:00:00Z', '2026-11-01']]) {
    const date = businessToday(new Date(instant)).toISOString().slice(0, 10);
    assert.equal(date, day);
    assert.equal(opportunityOutcomeWhere({ actualCloseFrom: date }).actualCloseDate.gte.toISOString().slice(0, 10), day);
  }
  assert.throws(() => opportunityOutcomeWhere({ actualCloseFrom: '2026-02-30' }), /valid Actual Close Date/);
  assert.throws(() => opportunityOutcomeWhere({ actualCloseFrom: '2026-10-31', actualCloseTo: '2026-10-01' }), /range/);
});

test('legacy unknown actual dates stay unconstrained without a date filter; expected and actual criteria are independent', () => {
  assert.equal(opportunityWhere({ outcomeStatus: 'won' }).actualCloseDate, undefined);
  const where = opportunityWhere({ outcomeStatus: 'lost', actualCloseFrom: '2026-10-01', actualCloseTo: '2026-12-31', closePeriod: '2027-Q1' });
  assert.equal(where.actualCloseDate.gte.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(where.expectedCloseDate.gte.toISOString(), '2027-01-01T00:00:00.000Z');
});

test('reason filtering uses the stable configured ID without requiring an active or current label', () => {
  assert.equal(opportunityWhere({ outcomeReasonId: '13' }).outcomeReasonId, 13);
  assert.equal(opportunityWhere({ outcomeReasonId: '13' }).outcomeReason, undefined);
  for (const value of ['-1', 'garbage', '9007199254740992']) assert.throws(() => opportunityOutcomeWhere({ outcomeReasonId: value }), /valid Outcome Reason/);
});

test('count, rows, pagination and existing sort share outcome/search/owner/quarter criteria for every reader', async () => {
  const filters = { q: 'printer', ownerId: '19', outcomeStatus: 'won', actualCloseFrom: '2026-10-01', actualCloseTo: '2026-12-31', outcomeReasonId: '13', closePeriod: '2027-Q1', page: '2' };
  for (const role of ['ADMIN', 'SALES_MANAGER', 'SALES', 'READ_ONLY']) {
    const calls = [];
    const db = { opportunity: {
      count: async args => { calls.push(args); return 25; },
      findMany: async args => { calls.push(args); return [{ id: 21, outcomeReasonName: 'Historical name', actualCloseDate: null }]; },
    } };
    const result = await listOpportunities(db, filters, actor(role));
    assert.deepEqual([result.count, result.page, result.pages], [25, 2, 2]);
    assert.deepEqual(calls[0].where, calls[1].where);
    assert.deepEqual(calls[1].where.AND[1], {}); // Sales cross-owner reads remain allowed.
    const where = calls[1].where.AND[0];
    assert.equal(where.ownerId, 19); assert.equal(where.outcomeReasonId, 13); assert.equal(where.OR[0].name.contains, 'printer');
    assert.deepEqual(where.stage, { isClosed: true, isWon: true });
    assert.equal(calls[1].skip, 20); assert.equal(calls[1].take, 20);
    assert.deepEqual(calls[1].orderBy, [{ expectedCloseDate: 'asc' }, { id: 'desc' }]);
    assert.equal(result.opportunities[0].outcomeReasonName, 'Historical name');
  }
});

test('Saved Views round-trip outcome keys without altering old views or expected-period meaning', () => {
  const old = { q: 'printer', ownerId: '19', closePeriod: 'current-quarter', forecastCategory: 'COMMIT' };
  assert.deepEqual(normalizeSavedQuery('opportunities', old), old);
  for (const outcomeStatus of ['open', 'won', 'lost']) {
    const query = { ...old, outcomeStatus, actualCloseFrom: '2026-03-08', actualCloseTo: '2026-11-01', outcomeReasonId: '13' };
    const stored = normalizeSavedQuery('opportunities', { ...query, page: '3' });
    assert.deepEqual(stored, query);
    assert.deepEqual(Object.fromEntries(new URL(savedQueryHref('opportunities', stored), 'http://localhost').searchParams), query);
  }
  assert.deepEqual(normalizeSavedQuery('opportunities', { outcomeStatus: 'all' }), {});
  assert.deepEqual(normalizeSavedQuery('opportunities', { outcomeStatus: 'other', outcomeReasonId: '-1', actualCloseFrom: '03/08/2026' }), {});
});

test('active counts group each date range once and Clear removes all outcome state', () => {
  assert.equal(countOpportunityFilters({ outcomeStatus: 'open' }), 1);
  assert.equal(countOpportunityFilters({ outcomeStatus: 'all' }), 0);
  assert.equal(countOpportunityFilters({ actualCloseFrom: '2026-03-08', actualCloseTo: '2026-11-01' }), 1);
  assert.equal(countOpportunityFilters({ q: 'printer', ownerId: '19', outcomeStatus: 'lost', actualCloseFrom: '2026-10-01', actualCloseTo: '2026-12-31', outcomeReasonId: '13', closePeriod: 'custom', closeFrom: '2027-01-01', closeTo: '2027-03-31', page: '2' }), 6);
  const page = fs.readFileSync(new URL('../app/opportunities/page.tsx', import.meta.url), 'utf8');
  const clear = page.match(/clearHref="([^"]+)"/)[1];
  assert.equal(clear, '/opportunities?closePeriod=');
  const cleared = Object.fromEntries(new URL(clear, 'http://localhost').searchParams);
  assert.equal(countOpportunityFilters(cleared), 0);
  assert.deepEqual(opportunityOutcomeWhere(cleared), {});
});

test('reason controls include inactive history, narrow by status, and retain explicitly selected filters', () => {
  const reasons = [{ id: 1, name: 'Expansion', isWon: true, active: true }, { id: 2, name: 'Old price label', isWon: false, active: false }];
  const markup = initial => renderToStaticMarkup(React.createElement(OpportunityOutcomeFilters, { initial, reasons }));
  assert.match(markup({}), /Lost · Old price label \(Inactive\)/);
  assert.doesNotMatch(markup({ outcomeStatus: 'won' }), /Old price label/);
  assert.doesNotMatch(markup({ outcomeStatus: 'open' }), /Expansion|Old price label/);
  assert.match(markup({ outcomeStatus: 'lost', outcomeReasonId: '2' }), /value="2" selected/);
  assert.match(markup({ outcomeStatus: 'won', outcomeReasonId: '2' }), /value="2" selected/);
});

test('impersonation uses effective reader permissions without granting mutation or inactive-user access', async () => {
  const context = await resolveUserContext({ ...actor('ADMIN'), name: 'Admin' }, '8', { user: { findUnique: async () => ({ ...actor('READ_ONLY'), id: 8, firstName: 'Reader', lastName: 'User', email: 'reader@test' }) } }, { NODE_ENV: 'development', ENABLE_DEV_IMPERSONATION: 'true' });
  assert.equal(context.effective.role, 'READ_ONLY');
  assert.equal(canUseSavedViews(context.effective, 'opportunities'), true);
  const db = { opportunity: { count: async () => 0, findMany: async () => [] } };
  assert.equal((await listOpportunities(db, { outcomeStatus: 'lost' }, context.effective)).count, 0);
  await assert.rejects(listOpportunities({}, {}, actor('SUPPORT')), /Access denied/);
  await assert.rejects(listOpportunities({}, {}, { ...actor('SALES'), active: false }), /Access denied/);
});
