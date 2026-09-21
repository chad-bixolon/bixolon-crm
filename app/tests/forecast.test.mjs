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
const { Prisma, ForecastCategory: C } = require('@prisma/client');
const { categoryForStage } = require(path.join(root, 'lib/opportunities.ts'));
const { quarterBounds, forecastForRep, coverage } = require(path.join(root, 'lib/forecast.ts'));
const { parseSalesTarget, saveSalesTarget, archiveSalesTarget } = require(path.join(root, 'lib/sales-targets.ts'));
const actor = (role, id = 7) => ({ id, role, active: true, archivedAt: null });
const form = fields => { const value = new FormData(); for (const [key, item] of Object.entries(fields)) value.set(key, String(item)); return value; };
const targetForm = (extra = {}) => form({ userId: 7, year: 2026, quarter: 'Q4', currencyCode: 'USD', targetAmount: '1000000', notes: 'Plan', ...extra });

test('stage and category remain separate; reopening never invents Commit', () => {
  const open = { isClosed: false, isWon: false }, won = { isClosed: true, isWon: true }, lost = { isClosed: true, isWon: false };
  assert.equal(categoryForStage(open, null), C.PIPELINE);
  for (const selected of [C.PIPELINE, C.BEST_CASE, C.COMMIT, C.OMITTED]) assert.equal(categoryForStage(open, selected), selected);
  assert.equal(categoryForStage(won, C.COMMIT), C.CLOSED);
  assert.equal(categoryForStage(lost, C.COMMIT), C.OMITTED);
  assert.equal(categoryForStage(open, C.CLOSED, { stageId: 2, forecastCategory: C.CLOSED }, 1), C.PIPELINE);
  assert.throws(() => categoryForStage(open, C.CLOSED), /cannot have/);
});

test('calendar quarter boundaries include date-only close dates at New York DST changes', () => {
  assert.deepEqual(Object.values(quarterBounds(2026, 'Q4')).map(date => date.toISOString().slice(0, 10)), ['2026-10-01', '2027-01-01']);
  assert.deepEqual(Object.values(quarterBounds(2026, 'Q1')).map(date => date.toISOString().slice(0, 10)), ['2026-01-01', '2026-04-01']);
  const { start, endExclusive } = quarterBounds(2026, 'Q4');
  assert.ok(new Date('2026-10-01T12:00:00Z') >= start);
  assert.ok(new Date('2026-12-31T12:00:00Z') < endExclusive);
  assert.ok(new Date('2027-01-01T12:00:00Z') >= endExclusive);
});

test('forecast totals use explicit categories, active products, override and stage probability, currency and close date filters', async () => {
  let where;
  const deal = (category, amount, probability = null, stageProbability = 50) => ({ forecastCategory: category, probability, stage: { probability: stageProbability }, products: [{ quantity: 1, estimatedUnitPrice: new Prisma.Decimal(amount) }, { quantity: 1, estimatedUnitPrice: new Prisma.Decimal('999'), archivedAt: new Date() }] });
  const client = { salesTarget: { findFirst: async () => ({ targetAmount: new Prisma.Decimal('1000000') }) }, opportunity: { findMany: async args => { where = args.where; return [deal(C.PIPELINE, '1000000', 20), deal(C.BEST_CASE, '500000'), deal(C.COMMIT, '850000', 100)]; } } };
  const result = await forecastForRep(client, actor('SALES'), { userId: 7, year: 2026, quarter: 'Q4', currencyCode: 'USD' });
  assert.equal(result.pipeline, '2350000.00'); assert.equal(result.weightedPipeline, '1300000.00'); assert.equal(result.commit, '850000.00'); assert.equal(result.bestCase, '500000.00');
  assert.deepEqual([result.pipelineCoverage, result.weightedCoverage, result.commitCoverage], ['2.35','1.30','0.85']);
  assert.ok(where.AND.some(part => part.ownerId === 7 && part.currencyCode === 'USD' && part.expectedCloseDate.gte.toISOString().startsWith('2026-10-01') && part.expectedCloseDate.lt.toISOString().startsWith('2027-01-01')));
  assert.ok(where.AND.some(part => part.ownerId === 7));
  assert.ok(where.AND.some(part => part.forecastCategory?.in?.join(',') === 'PIPELINE,BEST_CASE,COMMIT'));
  await assert.rejects(forecastForRep(client, actor('SALES', 8), { userId: 7, year: 2026, quarter: 'Q4', currencyCode: 'USD' }), /Access denied/);
  await assert.rejects(forecastForRep(client, actor('MARKETING_MANAGER'), { userId: 7, year: 2026, quarter: 'Q4', currencyCode: 'USD' }), /Access denied/);
  await forecastForRep(client, actor('SALES_MANAGER'), { userId: 7, year: 2026, quarter: 'Q4', currencyCode: 'USD' });
  await forecastForRep(client, actor('ADMIN'), { userId: 7, year: 2026, quarter: 'Q4', currencyCode: 'USD' });
});

test('missing and zero targets leave coverage unavailable; precision stays decimal', () => {
  assert.equal(coverage(new Prisma.Decimal('3000000'), new Prisma.Decimal('1000000')), '3.00');
  assert.equal(coverage(new Prisma.Decimal('1350000'), new Prisma.Decimal('1000000')), '1.35');
  assert.equal(coverage(new Prisma.Decimal('1'), null), null);
  assert.equal(coverage(new Prisma.Decimal('1'), new Prisma.Decimal(0)), null);
});

test('target create, duplicate identity, currency specificity, archive, and role checks', async () => {
  const rows = [];
  const client = { user: { findUnique: async () => ({ active: true, archivedAt: null, role: 'SALES' }) }, currency: { findUnique: async () => ({ active: true }) }, salesTarget: {
    findUnique: async ({ where }) => rows.find(row => row.id === where.id),
    create: async ({ data }) => { if (rows.some(row => !row.archivedAt && row.userId === data.userId && row.year === data.year && row.quarter === data.quarter && row.currencyCode === data.currencyCode)) throw new Error('Unique constraint'); const row = { id: rows.length + 1, ...data, archivedAt: null }; rows.push(row); return row; },
    update: async ({ where, data }) => { const row = rows.find(item => item.id === where.id && !item.archivedAt); if (!row) throw new Error('Not found'); Object.assign(row, data); return row; },
  } };
  assert.equal(parseSalesTarget(targetForm()).targetAmount.toFixed(2), '1000000.00');
  await saveSalesTarget(client, actor('ADMIN'), targetForm());
  await assert.rejects(saveSalesTarget(client, actor('ADMIN'), targetForm()), /Unique constraint/);
  await saveSalesTarget(client, actor('ADMIN'), targetForm({ currencyCode: 'EUR' }));
  assert.equal(rows.length, 2);
  await archiveSalesTarget(client, actor('ADMIN'), 1);
  await saveSalesTarget(client, actor('ADMIN'), targetForm());
  assert.equal(rows.length, 3);
  for (const role of ['SALES','SALES_MANAGER','READ_ONLY','MARKETING_MANAGER']) await assert.rejects(saveSalesTarget(client, actor(role), targetForm()), /Access denied/);
  await assert.rejects(archiveSalesTarget(client, actor('READ_ONLY'), 2), /Access denied/);
});
