import { test, expect } from './fixtures';
import { signInAs, uniqueName } from './helpers';
import { Prisma, PrismaClient, type OpportunitySnapshot } from '@prisma/client';
import { databaseUrl, emails } from './constants.mjs';
import { captureForecastSnapshot, previewForecastSnapshot, compareForecastSnapshotRuns } from '../lib/forecast-snapshots';
import { compareSnapshotRuns, FORECAST_SNAPSHOT_SCOPE, snapshotWeek } from '../lib/opportunity-snapshots';
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const tag = uniqueName('Forecast fixture');
const period = { year: 2026, quarter: 'Q4' as const };
let admin: { id: number; role: 'ADMIN'; active: boolean }, repId: number, managerId: number;
let beforeSourceId: number, afterSourceId: number, beforeId: number, afterId: number, extraSourceId: number;
let movingId: number, outId: number, removedId: number, wonId: number, entryId: number;
let sourceRows: Omit<OpportunitySnapshot, 'id' | 'runId' | 'snapshotAt'>[];
async function source(at: Date, rows: typeof sourceRows) {
  return db.$transaction(async tx => {
    const run = await tx.opportunitySnapshotRun.create({ data: { snapshotAt: at, snapshotWeek: snapshotWeek(at), createdById: admin.id, createdByName: 'Historical Admin', opportunityCount: rows.length, scopeVersion: FORECAST_SNAPSHOT_SCOPE } });
    if (rows.length) await tx.opportunitySnapshot.createMany({ data: rows.map(row => ({ ...row, accounts: row.accounts as Prisma.InputJsonValue, runId: run.id, snapshotAt: at })) });
    return run.id;
  });
}
async function capture(sourceRunId: number) {
  return captureForecastSnapshot(db, admin, (await previewForecastSnapshot(db, admin, { ...period, sourceRunId })).preview, true);
}
test.beforeAll(async () => {
  const user = await db.user.findUniqueOrThrow({ where: { email: emails.admin } }); admin = { id: user.id, role: 'ADMIN', active: true };
  repId = (await db.user.findUniqueOrThrow({ where: { email: emails.sales } })).id;
  managerId = (await db.user.findUniqueOrThrow({ where: { email: emails.salesManager } })).id;
  const stage = await db.salesStage.findFirstOrThrow({ where: { isClosed: false } });
  const opportunity = await db.opportunity.create({ data: { name: tag, stageId: stage.id, ownerId: repId } });
  movingId = opportunity.id; outId = movingId + 100000; removedId = movingId + 100001; wonId = movingId + 100002; entryId = movingId + 100003;
  const row: typeof sourceRows[number] = { opportunityId: movingId, opportunityName: `${tag} Pipeline to Commit`, accountIds: [], accounts: [], ownerId: repId, ownerName: 'Historical Chad', ownerForecastEligible: true, stageId: stage.id, stageName: stage.name, amount: new Prisma.Decimal('100'), currencyCode: 'USD', expectedCloseDate: new Date('2026-11-01T12:00:00Z'), probability: 25, probabilityOverride: null, stageProbability: 25, forecastCategory: 'PIPELINE', status: 'OPEN', productCount: 1 };
  sourceRows = [row, { ...row, opportunityId: outId, opportunityName: `${tag} Close moved out`, forecastCategory: 'BEST_CASE', amount: new Prisma.Decimal('200') }, { ...row, opportunityId: removedId, opportunityName: `${tag} Scope exit`, forecastCategory: 'COMMIT', amount: new Prisma.Decimal('300') }, { ...row, opportunityId: wonId, opportunityName: `${tag} Later won`, forecastCategory: 'COMMIT', amount: new Prisma.Decimal('400') }, { ...row, opportunityId: movingId + 100004, opportunityName: `${tag} EUR`, currencyCode: 'EUR', amount: new Prisma.Decimal('900') }, { ...row, opportunityId: movingId + 100005, opportunityName: `${tag} Ineligible`, ownerForecastEligible: false, amount: new Prisma.Decimal('9999') }, { ...row, opportunityId: movingId + 100006, forecastCategory: 'OMITTED', amount: new Prisma.Decimal('9999') }];
  const count = await db.opportunitySnapshotRun.count(), earlier = new Date(Date.UTC(2010, 0, 4 + count * 28));
  beforeSourceId = await source(earlier, sourceRows);
  afterSourceId = await source(new Date(earlier.getTime() + 7 * 86400000), [
    { ...row, forecastCategory: 'COMMIT', amount: new Prisma.Decimal('150'), ownerId: managerId, ownerName: 'Historical Manager' },
    { ...sourceRows[1], expectedCloseDate: new Date('2027-02-01') },
    { ...sourceRows[3], forecastCategory: 'CLOSED', status: 'WON' }, sourceRows[4], sourceRows[5], sourceRows[6],
    { ...row, opportunityId: entryId, opportunityName: `${tag} Entered`, forecastCategory: 'BEST_CASE', amount: new Prisma.Decimal('50') },
  ]);
  beforeId = (await capture(beforeSourceId)).id; afterId = (await capture(afterSourceId)).id;
  extraSourceId = await source(new Date(earlier.getTime() + 14 * 86400000), sourceRows);
});
test.afterAll(async () => { await db.opportunity.update({ where: { id: movingId }, data: { archivedAt: new Date() } }); await db.$disconnect(); });

test('manual preview names source, period, currencies, counts and requires confirmation; duplicates are rejected', async ({ page }) => {
  await signInAs(page, 'admin'); await page.goto('/administration/forecast-snapshots');
  await page.getByLabel('Source Opportunity Snapshot Run').selectOption(String(extraSourceId));
  await page.getByLabel('Forecast year', { exact: true }).fill('2026'); await page.getByLabel('Forecast quarter', { exact: true }).selectOption('Q4');
  await page.getByRole('button', { name: 'Preview Forecast Snapshot', exact: true }).click();
  const region = page.getByRole('region', { name: 'Manual Forecast Snapshot', exact: true });
  await expect(region).toContainText('5 included Opportunities · 1 salespeople'); await expect(region).toContainText('USD'); await expect(region).toContainText('EUR');
  await expect(region.getByRole('button', { name: 'Confirm Forecast Snapshot', exact: true })).toBeDisabled();
  await region.getByRole('checkbox', { name: /I confirm this immutable/ }).check(); await region.getByRole('button', { name: 'Confirm Forecast Snapshot', exact: true }).click();
  await expect(region.getByRole('status')).toContainText(`from Opportunity Snapshot Run #${extraSourceId}`);
  const run = await db.forecastSnapshotRun.findUniqueOrThrow({ where: { sourceRunId_year_quarter: { sourceRunId: extraSourceId, ...period } } });
  expect(run.opportunityCount).toBe(5); expect(run.sourceRunId).toBe(extraSourceId);
  await page.getByRole('button', { name: 'Preview Forecast Snapshot', exact: true }).click(); await expect(region.getByRole('alert')).toContainText('already have an immutable');
});
test('correct rollups, period/currency filters, comparison math, won handling and owner movement', async () => {
  const result = await compareForecastSnapshotRuns(db, admin, beforeId, afterId);
  const usd = result.groups.find(g => g.ownerId === undefined && g.currencyCode === 'USD')!;
  const metric = (key: string) => usd.metrics.find(m => m.key === key)!;
  expect(metric('pipeline')).toMatchObject({ previous: '1000.00', current: '200.00', change: '-800.00', percent: '-80.00' });
  expect(metric('commit')).toMatchObject({ previous: '700.00', current: '150.00', change: '-550.00' });
  expect(metric('bestCase')).toMatchObject({ previous: '200.00', current: '50.00' });
  expect(metric('closedWon')).toMatchObject({ previous: '0.00', current: '400.00', percent: null });
  expect(metric('opportunityCount')).toMatchObject({ previous: '4.00', current: '3.00', change: '-1.00' });
  const eur = result.groups.find(g => g.ownerId === undefined && g.currencyCode === 'EUR')!;
  expect(eur.metrics.find(m => m.key === 'pipeline')?.change).toBe('0.00');
  const manager = await compareForecastSnapshotRuns(db, { ...admin, role: 'SALES_MANAGER' }, beforeId, afterId, { ownerId: managerId, currencyCode: 'USD' });
  expect(manager.groups).toHaveLength(2); expect(manager.groups[0].metrics.find(m => m.key === 'commit')?.change).toBe('150.00');
  const q3 = await previewForecastSnapshot(db, admin, { sourceRunId: beforeSourceId, year: 2026, quarter: 'Q3' }); expect(q3.opportunityCount).toBe(0);
  const empty = await captureForecastSnapshot(db, admin, q3.preview, true); expect(empty.rowCount).toBe(0);
});
test('shared Opportunity comparison explains categories, amount, close-period exits, entries, owner moves and unknown scope exits', async () => {
  const result = await compareSnapshotRuns(db, admin, beforeSourceId, afterSourceId, { forecastPeriod: period, currencyCode: 'USD' });
  const moving = result.rows.find(row => row.opportunityId === movingId)!;
  expect(moving.changes).toContain('Amount increased'); expect(moving.changes).toContain('Owner changed'); expect(moving.changes).toContain('Category: PIPELINE → COMMIT');
  expect(result.rows.find(row => row.opportunityId === outId)?.changes).toContain('Left selected forecast slice — compare captured values');
  expect(result.rows.find(row => row.opportunityId === removedId)?.changes).toContain('Left selected forecast slice — scope exit reason unknown');
  expect(result.rows.find(row => row.opportunityId === entryId)?.changes).toContain('Entered selected forecast slice');
  expect(result.rows.find(row => row.opportunityId === wonId)?.changes).toContain('Status changed: OPEN → WON');
  const commit = await compareSnapshotRuns(db, admin, beforeSourceId, afterSourceId, { forecastPeriod: period, currencyCode: 'USD', ownerId: managerId, category: 'COMMIT' });
  expect(commit.rows).toHaveLength(1); expect(commit.rows[0].before?.ownerId).toBe(repId); expect(commit.rows[0].changes).toContain('Entered selected forecast slice');
});
test('database freezes rollups and runs, validates source amounts and rejects late rows and concurrent duplicates', async () => {
  const stored = await db.forecastSnapshotRollup.findFirstOrThrow({ where: { runId: beforeId } });
  await expect(db.forecastSnapshotRollup.update({ where: { id: stored.id }, data: { ownerName: 'Renamed' } })).rejects.toThrow(/immutable/);
  await expect(db.forecastSnapshotRollup.delete({ where: { id: stored.id } })).rejects.toThrow(/immutable/);
  await expect(db.forecastSnapshotRun.update({ where: { id: beforeId }, data: { year: 2027 } })).rejects.toThrow(/immutable/);
  await expect(db.forecastSnapshotRun.delete({ where: { id: beforeId } })).rejects.toThrow(/immutable/);
  const { id: storedId, ...data } = stored; expect(storedId).toBeGreaterThan(0);
  await expect(db.forecastSnapshotRollup.create({ data: { ...data, ownerId: 999999 } })).rejects.toThrow(/atomically/);
  const sourceRun = await db.opportunitySnapshotRun.findUniqueOrThrow({ where: { id: beforeSourceId } });
  await expect(db.$transaction(async tx => {
    const run = await tx.forecastSnapshotRun.create({ data: { sourceRunId: beforeSourceId, snapshotAt: sourceRun.snapshotAt, createdById: admin.id, createdByName: 'Admin', year: 2026, quarter: 'Q2', opportunityCount: 1, salespersonCount: 1, rowCount: 1 } });
    await tx.forecastSnapshotRollup.create({ data: { ...data, runId: run.id, opportunityCount: 1, amount: '999' } });
  })).rejects.toThrow(/do not match/);
  await db.opportunity.update({ where: { id: movingId }, data: { name: `${tag} Renamed live`, ownerId: managerId } });
  expect(await db.forecastSnapshotRollup.findUnique({ where: { id: stored.id } })).toEqual(stored);
  const p = (await previewForecastSnapshot(db, admin, { sourceRunId: afterSourceId, year: 2026, quarter: 'Q1' })).preview;
  const concurrent = await Promise.allSettled([captureForecastSnapshot(db, admin, p, true), captureForecastSnapshot(db, admin, p, true)]);
  expect(concurrent.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(concurrent.filter(r => r.status === 'rejected')).toHaveLength(1);
});
test('management report filters, salesperson history and drill-through preserve source endpoints', async ({ page }) => {
  await signInAs(page, 'salesManager'); await page.goto(`/reports/forecast-snapshots?before=${beforeId}&after=${afterId}&year=2026&quarter=Q4&currencyCode=USD&ownerId=${repId}`);
  await expect(page.getByRole('heading', { name: 'Forecast Snapshot History', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Forecast comparison' })).toContainText('zero baseline');
  await expect(page.getByRole('heading', { name: 'Forecast History — Historical Chad', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Compare forecasts', exact: true }).click();
  await expect(page.getByLabel('Currency', { exact: true })).toHaveValue('USD');
  const row = page.getByRole('region', { name: 'Forecast comparison' }).getByRole('row').filter({ hasText: 'Team · USD' }).filter({ hasText: 'Pipeline (all open forecast categories)' });
  await row.getByRole('link', { name: 'Explain movement', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`before=${beforeSourceId}&after=${afterSourceId}`));
  await expect(page.getByText(/Forecast drill-through:/)).toContainText('2026 Q4');
  const comparison = page.getByRole('region', { name: 'Snapshot comparison', exact: true });
  await expect(comparison).toContainText(`${tag} Pipeline to Commit`); await expect(comparison).toContainText('Owner changed');
  await expect(comparison).toContainText('scope exit reason unknown');
  await page.getByRole('button', { name: 'Compare snapshots', exact: true }).click(); await expect(page).toHaveURL(/category=ALL_OPEN/);
});
test('snapshot creation and team history deny Sales and other unauthorized roles', async ({ page }) => {
  for (const role of ['sales', 'readOnly', 'marketing', 'support'] as const) {
    await signInAs(page, role); await page.goto('/reports/forecast-snapshots'); await expect(page).toHaveURL(/access-denied/);
    await page.goto('/administration/forecast-snapshots'); await expect(page).toHaveURL(/access-denied/);
  }
  await signInAs(page, 'salesManager'); await page.goto('/administration/forecast-snapshots'); await expect(page).toHaveURL(/access-denied/);
});
test('forecast capture, comparison, salesperson history and drill-through render on desktop, tablet and mobile', async ({ page }) => {
  await signInAs(page, 'admin');
  for (const [width, height] of [[1440, 900], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height });
    const paths = ['/administration/forecast-snapshots', `/reports/forecast-snapshots?before=${beforeId}&after=${afterId}&year=2026&quarter=Q4&ownerId=${repId}`, `/reports/opportunity-snapshots?before=${beforeSourceId}&after=${afterSourceId}&year=2026&quarter=Q4&currencyCode=USD&category=ALL_OPEN`];
    for (let i = 0; i < paths.length; i++) {
      await page.goto(paths[i]); await expect(page.locator('main h1')).toBeVisible();
      if (i === 1) await expect(page.getByRole('region', { name: 'Forecast comparison', exact: true })).toBeVisible();
      if (i === 2) await expect(page.getByRole('region', { name: 'Snapshot comparison', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${width}px ${paths[i]}`).toBe(true);
      await page.screenshot({ path: `reports/forecast-snapshots/view-${i}-${width}.png`, fullPage: true, caret: 'initial' });
    }
  }
});
