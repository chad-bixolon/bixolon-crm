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
const { Prisma } = require('@prisma/client');
const { saveOpportunity } = require(path.join(root, 'lib/opportunities.ts'));
const { newYorkWeek, stageStartedAt, archiveCutoff, captureForecastWeek, previewHistoryArchive, archiveHistoryBatch, restoreHistoryBatch, opportunityHistory, closeDateMovement, snapshotComparisonState, snapshotChange } = require(path.join(root, 'lib/opportunity-history.ts'));
const { formatCalendarDate, formatEasternDateTime } = require(path.join(root, 'lib/display-format.ts'));
const { captureFeedback, existingCaptureFeedback, formatSnapshotWeekQuery } = require(path.join(root, 'lib/history-admin-display.ts'));
const actor = role => ({ id: 7, role, active: true, archivedAt: null });

test('New York Monday period and stage age have no invented prehistory', () => {
  assert.equal(newYorkWeek(new Date('2026-10-04T03:00:00Z')).toISOString().slice(0,10), '2026-09-28');
  assert.equal(stageStartedAt([]), null);
  const date = new Date('2026-09-02T12:00:00Z');
  assert.equal(stageStartedAt([{ eventType: 'STAGE', occurredAt: date }, { eventType: 'BASELINE', occurredAt: new Date('2026-01-01') }]), date);
  assert.equal(archiveCutoff(new Date('2026-10-02T18:00:00Z'), 3).toISOString(), '2023-10-02T00:00:00.000Z');
});

test('close date changes distinguish same quarter, quarter slips, year slips, and earlier moves', () => {
  const date = value => new Date(`${value}T12:00:00Z`);
  assert.equal(closeDateMovement(date('2027-04-01'), date('2027-05-01')), 'Moved later within the same quarter');
  assert.equal(closeDateMovement(date('2027-06-30'), date('2027-09-30')), 'Slipped to a later quarter');
  assert.equal(closeDateMovement(date('2027-12-31'), date('2028-01-01')), 'Moved to a future year');
  assert.equal(closeDateMovement(date('2027-09-30'), date('2027-06-30')), 'Moved earlier');
});

test('movement comparison needs two distinct captured weeks', () => {
  assert.equal(snapshotComparisonState([]), 'NONE');
  assert.equal(snapshotComparisonState(['2026-09-28']), 'ONE');
  assert.equal(snapshotComparisonState(['2026-10-05','2026-09-28']), 'READY');
  const report = fs.readFileSync(path.join(root, 'app/reports/forecast-movement/page.tsx'), 'utf8');
  assert.match(report, /No weekly forecast snapshots exist/);
  assert.match(report, /Capture a later week to compare movement/);
  assert.match(report, /currentWeek !== previousWeek/);
  assert.match(report, /includeArchived === '1'/);
  const admin = fs.readFileSync(path.join(root, 'app/administration/history/page.tsx'), 'utf8');
  for (const label of ['Week of','Rep','Forecast period','Currency','Captured','Status']) assert.ok(admin.includes(label));
});

test('History administration presents dates, statuses, and empty states clearly', () => {
  const admin = fs.readFileSync(path.join(root, 'app/administration/history/page.tsx'), 'utf8');
  assert.match(admin, /title="Opportunity & Forecast History"/);
  assert.match(admin, /Current snapshot week: \{currentWeek\}/);
  assert.match(admin, /formatCalendarDate\(newYorkWeek\(now\)\)/);
  assert.match(admin, /formatCalendarDate\(row\.snapshotWeek\)/);
  assert.match(admin, /formatEasternDateTime\(row\.capturedAt\)/);
  assert.match(admin, /'sourceId' in row \? 'Archived' : 'Active'/);
  assert.match(admin, /formatCalendarDate\(preview\.cutoff\)/);
  assert.match(admin, /Active history retention:/);
  assert.match(admin, /No weekly forecast snapshots have been captured yet\./);
  assert.match(admin, /No history is currently eligible for archive\./);
  assert.match(admin, /No archived history batches are available to restore\./);
  assert.match(admin, /_count: \{ _all: true \}/);
  assert.match(admin, /formatEasternDateTime\(batch\.archivedAt\)/);
  assert.doesNotMatch(admin, /Captured \(UTC\)|Storage|snapshot\(s\)| UTC · Batch/);
  assert.equal(formatCalendarDate(new Date('2026-09-28T00:00:00Z')), 'Sep 28, 2026');
  assert.equal(formatEasternDateTime(new Date('2026-10-03T14:06:00Z')), 'Oct 3, 2026 at 10:06 AM');
  assert.equal(formatSnapshotWeekQuery('2026-09-28'), 'Sep 28, 2026');
  assert.equal(formatSnapshotWeekQuery('2026-02-30'), null);
  assert.equal(captureFeedback(1, 'Sep 28, 2026'), 'Captured 1 rep snapshot for the week of Sep 28, 2026.');
  assert.equal(captureFeedback(2, 'Sep 28, 2026'), 'Captured 2 rep snapshots for the week of Sep 28, 2026.');
  assert.equal(existingCaptureFeedback('Sep 28, 2026'), 'Snapshots for the week of Sep 28, 2026 were already captured.');
});

test('two-week movement sums rep snapshots and reports precise change', () => {
  const make = (week, pipeline) => ({ snapshotWeek: new Date(`${week}T00:00:00Z`), pipeline: new Prisma.Decimal(pipeline), weightedPipeline: new Prisma.Decimal(0), bestCase: new Prisma.Decimal(0), commit: new Prisma.Decimal(0), target: null });
  const rows = [make('2026-09-28','100.00'), make('2026-09-28','200.00'), make('2026-10-05','150.00'), make('2026-10-05','250.00')];
  const change = snapshotChange(rows, '2026-09-28', '2026-10-05', 'pipeline');
  assert.deepEqual([change.previous.toFixed(2),change.current.toFixed(2),change.change.toFixed(2),change.percent.toFixed(1)], ['300.00','400.00','100.00','33.3']);
});

test('one save records changed forecast fields and one total value event; an unchanged save records none', async () => {
  const oldDate = new Date('2027-06-30T12:00:00Z'), newDate = new Date('2027-09-30T12:00:00Z');
  const oldLine = { id: 20, opportunityId: 5, productId: 3, skuId: null, quantity: 1, estimatedUnitPrice: new Prisma.Decimal('300'), priceSource: 'MANUAL', archivedAt: null };
  let row = { id: 5, name: 'Deal', projects: [], participants: [], stageId: 1, stage: { name: 'Qualification' }, forecastCategory: 'PIPELINE', expectedCloseDate: oldDate, ownerId: 7, owner: { firstName: 'Ryan', lastName: 'Persaud' }, probability: null, currencyCode: 'USD', archivedAt: null };
  let line = { ...oldLine }, events = [];
  const tx = {
    opportunity: { findUnique: async () => row, update: async ({ data }) => { row = { ...row, ...data, stage: { name: data.stageId === 2 ? 'Evaluation' : 'Qualification' } }; } },
    opportunityProduct: { findMany: async () => [line], update: async ({ data }) => { line = { ...line, ...data, estimatedUnitPrice: new Prisma.Decimal(data.estimatedUnitPrice) }; } },
    opportunityHistoryEvent: { createMany: async ({ data }) => { events.push(...data); return { count: data.length }; } },
    salesStage: { findUnique: async ({ where }) => ({ id: where.id, name: where.id === 2 ? 'Evaluation' : 'Qualification', active: true, isClosed: false, isWon: false }) },
    currency: { findUnique: async () => ({ active: true }) },
    user: { findUnique: async ({ where }) => where.id === 8 ? { id: 8, firstName: 'Alex', lastName: 'Lee', active: true, role: 'SALES' } : { id: 7, firstName: 'Ryan', lastName: 'Persaud', active: true, role: 'ADMIN' } },
    account: { findMany: async () => [{ id: 11, name: 'Customer' }] }, product: { findMany: async () => [{ id: 3 }] }, project: { findMany: async () => [] },
    opportunityAccount: { findMany: async () => [], upsert: async () => ({}) }, opportunityAccountRole: { create: async () => ({}) },
  };
  const client = { $transaction: fn => fn(tx) };
  const input = { name: 'Deal', description: null, ownerId: 8, projectIds: [], stageId: 2, expectedCloseDate: newDate, probability: 80, forecastCategory: 'BEST_CASE', currencyCode: 'USD', participants: [{ accountId: 11, roles: ['END_USER'] }], contacts: [], lines: [{ id: 20, productId: 3, quantity: 2, price: '300.00', priceSource: 'MANUAL' }] };
  await saveOpportunity(client, input, 5, actor('ADMIN'));
  assert.deepEqual(events.map(event => event.eventType), ['STAGE','FORECAST_CATEGORY','EXPECTED_CLOSE_DATE','OWNER','PROBABILITY','VALUE']);
  assert.equal(events[5].oldValue.toFixed(2), '300.00'); assert.equal(events[5].newValue.toFixed(2), '600.00');
  assert.equal(events[0].actorId, 7); assert.equal(events[0].actorName, 'Ryan Persaud');
  events = [];
  await saveOpportunity(client, input, 5, actor('ADMIN'));
  assert.deepEqual(events, []);
});

function valueFixture(initial = [], failHistory = false) {
  let stored = initial.map((row, index) => ({ id: index + 20, opportunityId: 5, productId: 3, skuId: row.skuId ?? null, quantity: row.quantity, estimatedUnitPrice: new Prisma.Decimal(row.price), priceSource: row.priceSource ?? 'MANUAL', archivedAt: null }));
  const events = [];
  const pe = { id: 102, productSkuId: 9, approvedUnitPrice: new Prisma.Decimal('250'), currencyCode: 'USD', sourceQuantity: new Prisma.Decimal('1'), sourceQuantityRaw: '1', priceException: { status: 'ACTIVE', archivedAt: null, expirationDate: null, endUserAccountId: 11, distributorAccountId: null, varAccountId: null, assignedSalesRepUserId: null, sourceType: 'LEGACY_WORKBOOK' } };
  const odm = { id: 201, skuId: 9, accountId: 11, customerPrice: new Prisma.Decimal('250'), tariffPercent: new Prisma.Decimal('4'), tariffAmount: new Prisma.Decimal('10'), finalUnitPrice: new Prisma.Decimal('260'), currencyCode: 'USD', effectiveDate: null, archivedAt: null, odmCustomer: { archivedAt: null, sku: { catalogSource: 'PRICE_LIST', odmSubtype: null } } };
  const client = { $transaction: async fn => {
    let working = stored.map(row => ({ ...row }));
    const pending = [];
    const tx = {
      opportunity: { findUnique: async () => ({ id: 5, name: 'Deal', projects: [], participants: [], stageId: 1, stage: { name: 'Open' }, forecastCategory: 'PIPELINE', expectedCloseDate: null, ownerId: null, owner: null, probability: null, currencyCode: 'USD', archivedAt: null }), update: async () => ({}) },
      opportunityProduct: {
        findMany: async ({ where }) => working.filter(row => row.archivedAt === null && row.opportunityId === where.opportunityId),
        update: async ({ where, data }) => { const index = working.findIndex(row => row.id === where.id); working[index] = { ...working[index], ...data, ...(data.estimatedUnitPrice === undefined ? {} : { estimatedUnitPrice: new Prisma.Decimal(data.estimatedUnitPrice) }) }; },
        create: async ({ data }) => { working.push({ ...data, id: 100 + working.length, archivedAt: null, estimatedUnitPrice: new Prisma.Decimal(data.estimatedUnitPrice) }); },
      },
      opportunityHistoryEvent: { createMany: async ({ data }) => { if (failHistory) throw new Error('history unavailable'); pending.push(...data); return { count: data.length }; } },
      salesStage: { findUnique: async () => ({ id: 1, name: 'Open', active: true, isClosed: false, isWon: false }) }, currency: { findUnique: async () => ({ active: true }) },
      user: { findUnique: async () => ({ id: 7, firstName: 'Ryan', lastName: 'Persaud', role: 'ADMIN', active: true }) },
      account: { findMany: async () => [{ id: 11, name: 'Customer' }] }, product: { findMany: async ({ where }) => where.id.in.length ? [{ id: 3 }] : [] }, project: { findMany: async () => [] },
      productSku: { findMany: async () => [{ id: 9, productId: 3, active: true, catalogSource: 'PRICE_LIST', odmSubtype: null }] },
      productPrice: { findMany: async () => [] }, priceExceptionLine: { findMany: async () => [pe] }, productSkuOdmCustomerPrice: { findMany: async () => [odm] },
      opportunityAccount: { findMany: async () => [{ opportunityId: 5, accountId: 11, roles: [{ role: 'END_USER' }] }], upsert: async () => ({}) },
    };
    const result = await fn(tx);
    stored = working; events.push(...pending); return result;
  } };
  const input = lines => ({ name: 'Deal', description: null, ownerId: null, projectIds: [], stageId: 1, expectedCloseDate: null, probability: null, forecastCategory: 'PIPELINE', currencyCode: 'USD', participants: [{ accountId: 11, roles: ['END_USER'] }], contacts: [], lines });
  return { client, events, input, get stored() { return stored; } };
}

test('add, remove, quantity, unit price, Price Exception, and Customer Pricing each record one total change', async () => {
  const manual = (id, quantity, price) => ({ ...(id ? { id } : {}), productId: 3, quantity, price, priceSource: 'MANUAL' });
  const cases = [
    { name: 'add', initial: [], lines: [manual(null,1,'100.00')], before: '0.00', after: '100.00' },
    { name: 'remove', initial: [{ quantity: 1, price: '100.00' }], lines: [], before: '100.00', after: '0.00' },
    { name: 'quantity', initial: [{ quantity: 1, price: '100.00' }], lines: [manual(20,2,'100.00')], before: '100.00', after: '200.00' },
    { name: 'unit price', initial: [{ quantity: 1, price: '100.00' }], lines: [manual(20,1,'150.00')], before: '100.00', after: '150.00' },
    { name: 'Price Exception', initial: [{ quantity: 1, price: '100.00' }], lines: [{ id: 20, productId: 3, skuId: 9, quantity: 1, price: '250.00', priceSource: 'PRICE_EXCEPTION', priceExceptionLineId: 102 }], before: '100.00', after: '250.00' },
    { name: 'Customer Pricing', initial: [{ quantity: 1, price: '100.00' }], lines: [{ id: 20, productId: 3, skuId: 9, quantity: 1, price: '260.00', priceSource: 'ODM_CUSTOMER', odmCustomerPriceId: 201, odmCustomerAccountId: 11 }], before: '100.00', after: '260.00' },
  ];
  for (const scenario of cases) {
    const db = valueFixture(scenario.initial);
    await saveOpportunity(db.client, db.input(scenario.lines), 5, actor('ADMIN'));
    const values = db.events.filter(event => event.eventType === 'VALUE');
    assert.equal(values.length, 1, scenario.name);
    assert.equal(values[0].oldValue.toFixed(2), scenario.before, scenario.name);
    assert.equal(values[0].newValue.toFixed(2), scenario.after, scenario.name);
  }
});

test('a history write failure rolls back the product value change', async () => {
  const db = valueFixture([{ quantity: 1, price: '100.00' }], true);
  await assert.rejects(saveOpportunity(db.client, db.input([{ id: 20, productId: 3, quantity: 2, price: '100.00', priceSource: 'MANUAL' }]), 5, actor('ADMIN')), /history unavailable/);
  assert.equal(db.stored[0].quantity, 1);
  assert.deepEqual(db.events, []);
});

test('weekly snapshot copies authoritative forecast result and prevents duplicates by key', async () => {
  const saved = new Set(), rows = [];
  const users = [{ id: 7, firstName: 'Ryan', lastName: 'Persaud' }, { id: 8, firstName: 'Alex', lastName: 'Lee' }];
  const client = {
    user: { findMany: async () => users },
    salesTarget: { findFirst: async () => ({ targetAmount: new Prisma.Decimal('1000') }) },
    opportunity: { findMany: async () => [] },
    forecastSnapshotArchive: { findMany: async () => [] },
    forecastSnapshot: { createMany: async ({ data }) => { let count = 0; for (const row of data) { const key = [row.snapshotWeek.toISOString(), row.year, row.quarter, row.currencyCode, row.repId].join('|'); if (saved.has(key)) continue; saved.add(key); rows.push(row); count++; } return { count }; } },
  };
  const input = { year: 2026, quarter: 'Q4', currencyCode: 'USD', at: new Date('2026-10-02T15:00:00Z') };
  assert.equal((await captureForecastWeek(client, actor('ADMIN'), input)).created, 2);
  assert.equal((await captureForecastWeek(client, actor('ADMIN'), input)).created, 0);
  assert.equal((await captureForecastWeek(client, actor('ADMIN'), { ...input, at: new Date('2026-10-06T15:00:00Z') })).created, 2);
  assert.equal(rows.filter(row => row.repId === 7).length, 2);
  assert.equal(rows.filter(row => row.repId === 8).length, 2);
  assert.deepEqual([rows[0].pipeline, rows[0].weightedPipeline, rows[0].bestCase, rows[0].commit, rows[0].target], ['0.00','0.00','0.00','0.00','1000.00']);
  const archivedClient = { ...client, forecastSnapshotArchive: { findMany: async () => [{ repId: 7 }] } };
  assert.equal((await captureForecastWeek(archivedClient, actor('ADMIN'), { ...input, at: new Date('2026-10-13T15:00:00Z') })).created, 1);
  assert.equal(rows.at(-1).repId, 8);
  await assert.rejects(captureForecastWeek(client, actor('SALES'), input), /Access denied/);
});

test('history lookup enforces Opportunity ownership and read permission', async () => {
  const client = { opportunity: { findFirst: async ({ where }) => where.ownerId === 7 ? { id: 2 } : null }, opportunityHistoryEvent: { findMany: async () => [], count: async () => 0 }, opportunityHistoryArchive: { findMany: async () => [], count: async () => 0 } };
  assert.equal((await opportunityHistory(client, actor('SALES'), 2)).total, 0);
  await assert.rejects(opportunityHistory(client, actor('MARKETING_MANAGER'), 2), /Access denied/);
  await assert.rejects(opportunityHistory({ ...client, opportunity: { findFirst: async () => null } }, actor('SALES'), 2), /not found/);
});

test('archived Opportunity events remain readable under the same Opportunity scope', async () => {
  const archived = { id: 40, sourceId: 4, opportunityId: 2, opportunityName: 'Old deal', actorName: 'Former rep', eventType: 'VALUE', occurredAt: new Date('2020-01-01'), oldValue: new Prisma.Decimal('100'), newValue: new Prisma.Decimal('200') };
  const client = { opportunity: { findFirst: async ({ where }) => where.ownerId === 7 ? { id: 2 } : null }, opportunityHistoryEvent: { findMany: async () => [], count: async () => 0 }, opportunityHistoryArchive: { findMany: async () => [archived], count: async () => 1 } };
  const result = await opportunityHistory(client, actor('SALES'), 2);
  assert.equal(result.total, 1); assert.equal(result.rows[0].actorName, 'Former rep'); assert.equal(result.rows[0].newValue.toFixed(2), '200.00');
});

test('archive copies before removal, preserves context, and rolls back on a failed copy', async () => {
  const old = new Date('2020-01-01'), event = { id: 3, opportunityId: 4, opportunityName: 'Archived deal', actorName: 'Former rep', eventType: 'VALUE', occurredAt: old, createdAt: old, oldValue: '100.00', newValue: '200.00' };
  const writes = [];
  const tx = { opportunityHistoryEvent: { findMany: async () => [event], deleteMany: async () => { writes.push('delete'); return { count: 1 }; } }, forecastSnapshot: { findMany: async () => [] }, opportunityHistoryArchive: { createMany: async ({ data }) => { writes.push(data[0]); return { count: 1 }; } } };
  const client = { systemSetting: { findMany: async () => [] }, $transaction: async fn => fn(tx) };
  const result = await archiveHistoryBatch(client, actor('ADMIN'), new Date('2020-02-01'));
  assert.equal(result.events, 1);
  assert.equal(writes[0].sourceId, 3); assert.equal(writes[0].actorName, 'Former rep'); assert.equal(writes[0].newValue, '200.00'); assert.equal(writes[1], 'delete');
  const failed = { ...tx, opportunityHistoryArchive: { createMany: async () => { throw new Error('copy failed'); } } };
  writes.length = 0;
  await assert.rejects(archiveHistoryBatch({ ...client, $transaction: fn => fn(failed) }, actor('ADMIN'), new Date('2020-02-01')), /copy failed/);
  assert.deepEqual(writes, []);
  await assert.rejects(archiveHistoryBatch(client, actor('SALES'), new Date('2020-02-01')), /Access denied/);
});

test('retention preview counts only older active rows and never deletes data', async () => {
  const seen = [], old = new Date('2020-01-01');
  const client = {
    systemSetting: { findMany: async () => [{ key: 'HISTORY_RETENTION_YEARS', value: 3 }] },
    opportunityHistoryEvent: { count: async ({ where }) => { seen.push(where); return 2; }, findFirst: async () => ({ occurredAt: old }) },
    forecastSnapshot: { count: async ({ where }) => { seen.push(where); return 1; }, findFirst: async () => ({ capturedAt: old }) },
  };
  const result = await previewHistoryArchive(client, actor('ADMIN'), new Date('2026-10-02T18:00:00Z'));
  assert.equal(result.cutoff.toISOString(), '2023-10-02T00:00:00.000Z');
  assert.deepEqual([result.events,result.snapshots], [2,1]);
  assert.ok(seen.every(where => (where.occurredAt?.lt ?? where.capturedAt?.lt).getTime() === result.cutoff.getTime()));
  assert.equal(Object.hasOwn(client.opportunityHistoryEvent, 'deleteMany'), false);
});

test('Admin restore moves original events and snapshots atomically, preserving values and IDs', async () => {
  const batchId = '123e4567-e89b-42d3-a456-426614174000', date = new Date('2020-01-01');
  const event = { id: 60, sourceId: 3, archiveBatchId: batchId, archivedAt: new Date(), opportunityId: 4, opportunityName: 'Old deal', actorName: 'Former rep', eventType: 'VALUE', occurredAt: date, createdAt: date, oldValue: new Prisma.Decimal('100'), newValue: new Prisma.Decimal('200') };
  const snapshot = { id: 70, sourceId: 5, archiveBatchId: batchId, archivedAt: new Date(), snapshotWeek: date, capturedAt: date, year: 2020, quarter: 'Q1', currencyCode: 'USD', repId: 7, repName: 'Former rep', pipeline: new Prisma.Decimal('200'), weightedPipeline: new Prisma.Decimal('100'), bestCase: new Prisma.Decimal('0'), commit: new Prisma.Decimal('0'), target: null, targetStatus: 'NO_TARGET', createdAt: date };
  const operations = [];
  const tx = {
    opportunityHistoryArchive: { findMany: async () => [event], deleteMany: async () => { operations.push('remove event archive'); return { count: 1 }; } },
    forecastSnapshotArchive: { findMany: async () => [snapshot], deleteMany: async () => { operations.push('remove snapshot archive'); return { count: 1 }; } },
    opportunityHistoryEvent: { count: async () => 0, createMany: async ({ data }) => { operations.push(data[0]); return { count: 1 }; } },
    forecastSnapshot: { count: async () => 0, createMany: async ({ data }) => { operations.push(data[0]); return { count: 1 }; } },
  };
  const client = { $transaction: fn => fn(tx) };
  const result = await restoreHistoryBatch(client, actor('ADMIN'), batchId);
  assert.deepEqual([result.events, result.snapshots], [1,1]);
  assert.equal(operations[0].id, 3); assert.equal(operations[0].opportunityName, 'Old deal'); assert.equal(operations[0].newValue.toFixed(2), '200.00');
  assert.equal(operations[2].id, 5); assert.equal(operations[2].pipeline.toFixed(2), '200.00');
  assert.deepEqual([operations[1], operations[3]], ['remove event archive', 'remove snapshot archive']);
  operations.length = 0;
  await assert.rejects(restoreHistoryBatch({ $transaction: fn => fn({ ...tx, forecastSnapshot: { ...tx.forecastSnapshot, count: async () => 1 } }) }, actor('ADMIN'), batchId), /Restore conflicts/);
  assert.deepEqual(operations, []);
  await assert.rejects(restoreHistoryBatch(client, actor('SALES'), batchId), /Access denied/);
});
