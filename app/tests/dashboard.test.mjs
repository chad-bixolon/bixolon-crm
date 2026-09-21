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
const { Prisma, ForecastCategory } = require('@prisma/client');
const dashboard = require(path.join(root, 'lib/dashboard.ts'));
const { forecastForRep, forecastForTeam, getRepTargetStatus } = require(path.join(root, 'lib/forecast.ts'));
const { pipelineConfigFromParams } = require(path.join(root, 'lib/report-builder.ts'));
const { executePipelineReport } = require(path.join(root, 'lib/reporting.ts'));
const { routeAccess } = require(path.join(root, 'lib/authorization.ts'));
const actor = (role, id = 7) => ({ id, role, active: true, archivedAt: null });

test('role dashboard presentation is filtered by authorization', () => {
  const sections = role => dashboard.getDashboardViewForRole(actor(role)).sections;
  assert.deepEqual(sections('SALES'), ['forecast','closing','stale','tasks','activities','stage']);
  assert.deepEqual(sections('SALES_MANAGER'), ['forecast','reps','closing','stale','tasks','activities','stage','category']);
  assert.ok(sections('ADMIN').includes('admin'));
  assert.deepEqual(sections('READ_ONLY'), ['forecast','reps','closing','stage','category']);
  assert.deepEqual(sections('MARKETING_MANAGER'), ['marketing']);
  assert.equal(dashboard.canShowDashboardSection(actor('MARKETING_MANAGER'), 'forecast'), false);
  assert.equal(dashboard.canShowDashboardSection(actor('READ_ONLY'), 'admin'), false);
});

test('dashboard Account, Task, and Activity queries preserve personal scope', () => {
  assert.equal(dashboard.dashboardAccountWhere(actor('SALES')).ownerId, 7);
  assert.equal(dashboard.dashboardAccountWhere(actor('SALES_MANAGER')).ownerId, undefined);
  assert.throws(() => dashboard.dashboardAccountWhere(actor('READ_ONLY')), /Access denied/);
  const today = new Date('2026-09-21T00:00:00Z');
  const own = dashboard.dashboardTaskWhere(actor('SALES'), today, [7, 8]);
  assert.equal(own.assignedToId, 7);
  assert.deepEqual(own.status.in, ['OPEN','IN_PROGRESS']);
  assert.deepEqual(dashboard.dashboardTaskWhere(actor('SALES_MANAGER'), today, [7,8]).assignedToId, { in: [7,8] });
  assert.equal(dashboard.dashboardActivityWhere(actor('SALES'), [7,8]).userId, 7);
  assert.deepEqual(dashboard.dashboardActivityWhere(actor('SALES_MANAGER'), [7,8]).userId, { in: [7,8] });
});

test('team forecast sums rep values and target before calculating coverage, by currency', async () => {
  const observed = [];
  const rows = {
    7: { USD: [{ forecastCategory: ForecastCategory.PIPELINE, amount: '3000000', probability: 50 }], EUR: [{ forecastCategory: ForecastCategory.COMMIT, amount: '100', probability: 100 }] },
    8: { USD: [{ forecastCategory: ForecastCategory.COMMIT, amount: '500000', probability: 100 }], EUR: [] },
  };
  const targets = { 7: { USD: '1000000', EUR: '200' }, 8: { USD: '500000', EUR: '300' } };
  const client = {
    salesTarget: { findMany: async ({ where }) => where.userId.in.map(userId => ({ userId, targetAmount: new Prisma.Decimal(targets[userId][where.currencyCode]) })) },
    opportunity: { findMany: async ({ where }) => { const f = where.AND[1]; observed.push(f); return rows[f.ownerId][f.currencyCode].map(item => ({ forecastCategory: item.forecastCategory, probability: item.probability, stage: { probability: 50 }, products: [{ quantity: 1, estimatedUnitPrice: new Prisma.Decimal(item.amount) }] })); } },
  };
  const input = { users: [{ id: 7, role: 'SALES' }, { id: 8, role: 'SALES' }], year: 2026, quarter: 'Q3' };
  const usd = await forecastForTeam(client, actor('SALES_MANAGER'), { ...input, currencyCode: 'USD' });
  assert.deepEqual([usd.pipeline,usd.weightedPipeline,usd.commit,usd.target], ['3500000.00','2000000.00','500000.00','1500000.00']);
  assert.deepEqual([usd.pipelineCoverage,usd.weightedCoverage,usd.commitCoverage], ['2.33','1.33','0.33']);
  const eur = await forecastForTeam(client, actor('SALES_MANAGER'), { ...input, currencyCode: 'EUR' });
  assert.deepEqual([eur.pipeline,eur.commit,eur.target,eur.pipelineCoverage], ['100.00','100.00','500.00','0.20']);
  assert.ok(observed.every(f => f.expectedCloseDate.gte.toISOString().startsWith('2026-07-01') && f.expectedCloseDate.lt.toISOString().startsWith('2026-10-01')));
  assert.ok(observed.every(f => f.forecastCategory.in.join(',') === 'PIPELINE,BEST_CASE,COMMIT'));
  await assert.rejects(forecastForTeam(client, actor('SALES'), { ...input, currencyCode: 'USD' }), /Access denied/);
});

test('missing team target keeps partial amount but does not produce misleading coverage', async () => {
  const client = { salesTarget: { findMany: async () => [{ userId: 7, targetAmount: new Prisma.Decimal('100') }] }, opportunity: { findMany: async () => [] } };
  const result = await forecastForTeam(client, actor('ADMIN'), { users: [{ id: 7, role: 'SALES' }, { id: 8, role: 'SALES' }], year: 2026, quarter: 'Q3', currencyCode: 'USD' });
  assert.equal(result.target, '100.00');
  assert.equal(result.targetStatus, 'PARTIAL_TARGET');
  assert.equal(result.pipelineCoverage, null);
  assert.equal(result.reps.find(rep => rep.userId === 8).targetStatus, 'MISSING_TARGET');
});

test('target participation separates Sales requirements from manager visibility', async () => {
  const users = [
    { id: 7, role: 'SALES' }, { id: 8, role: 'SALES' },
    { id: 9, role: 'SALES_MANAGER' }, { id: 10, role: 'SALES_MANAGER' },
  ];
  const amounts = new Map([[7, '1000000'], [8, '500000'], [9, '750000']]);
  const pipelines = new Map([[7, '3000000'], [8, '500000'], [9, '1000000'], [10, '4000000']]);
  const targetQueries = [];
  const client = {
    salesTarget: {
      findMany: async ({ where }) => {
        targetQueries.push(where);
        return where.userId.in.filter(id => amounts.has(id)).map(userId => ({ userId, targetAmount: new Prisma.Decimal(amounts.get(userId)) }));
      },
      findFirst: async ({ where }) => amounts.has(where.userId) ? { targetAmount: new Prisma.Decimal(amounts.get(where.userId)) } : null,
    },
    opportunity: { findMany: async ({ where }) => {
      const ownerId = where.AND[1].ownerId;
      return [{ forecastCategory: ForecastCategory.PIPELINE, probability: 50, stage: { probability: 50 }, products: [{ quantity: 1, estimatedUnitPrice: new Prisma.Decimal(pipelines.get(ownerId)) }] }];
    } },
  };
  const input = { users, year: 2026, quarter: 'Q3', currencyCode: 'USD' };
  const result = await forecastForTeam(client, actor('SALES_MANAGER', 10), input);
  assert.deepEqual(result.reps.map(rep => [rep.userId, rep.targetStatus]), [[7, 'SET'], [8, 'SET'], [9, 'SET']]);
  assert.equal(result.target, '2250000.00');
  assert.equal(result.pipeline, '4500000.00');
  assert.equal(result.weightedPipeline, '2250000.00');
  assert.equal(result.pipelineCoverage, '2.00');
  assert.equal(result.weightedCoverage, '1.00');
  assert.equal(result.targetStatus, 'SET');
  assert.deepEqual(targetQueries[0].userId.in, [7,8,9,10]);
  assert.deepEqual([targetQueries[0].year, targetQueries[0].quarter, targetQueries[0].currencyCode, targetQueries[0].archivedAt], [2026, 'Q3', 'USD', null]);
  assert.equal(getRepTargetStatus('SALES_MANAGER', null), 'NON_QUOTA');
  assert.equal(getRepTargetStatus('SALES', null), 'MISSING_TARGET');
  assert.equal(routeAccess('/reports/forecast', actor('SALES_MANAGER', 10)), 'allowed');
  assert.equal(routeAccess('/', actor('SALES_MANAGER', 10)), 'allowed');
  const gary = await forecastForRep(client, actor('SALES_MANAGER', 10), { userId: 10, year: 2026, quarter: 'Q3', currencyCode: 'USD' });
  assert.equal(gary.targetStatus, 'NO_TARGET');
  assert.equal(gary.pipeline, '4000000.00');

  amounts.delete(8);
  const missing = await forecastForTeam(client, actor('ADMIN'), input);
  assert.equal(missing.target, '1750000.00');
  assert.equal(missing.pipeline, '4500000.00');
  assert.equal(missing.targetStatus, 'PARTIAL_TARGET');
  assert.deepEqual([missing.pipelineCoverage, missing.weightedCoverage, missing.commitCoverage], [null, null, null]);
  const blaise = missing.reps.find(rep => rep.userId === 8);
  assert.equal(blaise.targetStatus, 'MISSING_TARGET');
  assert.equal(blaise.pipeline, '500000.00');
  assert.equal(blaise.target, null);
  assert.equal(blaise.pipelineCoverage, null);
  assert.ok(!missing.reps.some(rep => rep.userId === 10));
});

test('dashboard report links retain quarter, currency, grouping and explicit Commit filter', async () => {
  const href = dashboard.pipelineReportHref({ currency: 'EUR', groupBy: 'owner', commit: true, team: true });
  const params = Object.fromEntries(new URL(href, 'http://localhost').searchParams);
  const config = pipelineConfigFromParams(params);
  assert.deepEqual(config.filters.find(f => f.field === 'forecastCategory'), { field: 'forecastCategory', operator: 'eq', value: 'COMMIT' });
  assert.equal(config.filters.find(f => f.field === 'currency').value, 'EUR');
  assert.equal(config.filters.find(f => f.field === 'closeDate').value, 'THIS_QUARTER');
  assert.equal(config.groupBy, 'owner');
  assert.deepEqual(config.filters.find(f => f.field === 'activeSalesRep'), { field: 'activeSalesRep', operator: 'eq', value: true });
  let where;
  await executePipelineReport({ opportunity: { findMany: async args => { where = args.where; return []; } } }, actor('READ_ONLY'), config);
  assert.ok(where.AND.some(x => x.forecastCategory === 'COMMIT'));
  assert.ok(where.AND.some(x => x.owner?.role?.in?.includes('SALES')));
  assert.equal(routeAccess('/reports/pipeline-view', actor('READ_ONLY')), 'allowed');
  assert.equal(routeAccess('/reports/pipeline-view', actor('MARKETING_MANAGER')), 'denied');
  assert.equal(routeAccess('/reports/new', actor('READ_ONLY')), 'denied');
});

test('dashboard Pipeline drill-down excludes omitted Opportunities and retains Sales ownership', async () => {
  const href = dashboard.pipelineReportHref({ currency: 'USD' });
  const params = Object.fromEntries(new URL(href, 'http://localhost').searchParams);
  const config = pipelineConfigFromParams(params);
  let where;
  await executePipelineReport({ opportunity: { findMany: async args => { where = args.where; return []; } } }, actor('SALES', 7), config);
  assert.ok(where.AND.some(x => x.ownerId === 7));
  assert.ok(where.AND.some(x => x.forecastCategory?.in?.join(',') === 'PIPELINE,BEST_CASE,COMMIT'));
});

test('current quarter follows New York calendar', () => {
  assert.deepEqual(dashboard.dashboardPeriod(new Date('2026-10-01T03:30:00Z')), { year: 2026, quarter: 'Q3' });
  assert.deepEqual(dashboard.dashboardPeriod(new Date('2026-10-01T04:30:00Z')), { year: 2026, quarter: 'Q4' });
});
