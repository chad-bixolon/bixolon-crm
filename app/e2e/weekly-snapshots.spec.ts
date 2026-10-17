import { test, expect } from './fixtures';
import { signInAs } from './helpers';
import { PrismaClient } from '@prisma/client';
import { databaseUrl, emails } from './constants.mjs';
import { snapshotWeek, FORECAST_SNAPSHOT_SCOPE } from '../lib/opportunity-snapshots';
import { runWeeklySnapshots } from '../lib/weekly-snapshots';
import { businessQuarter } from '../lib/business-quarter';
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const authorization = 'Bearer saleshub-weekly-snapshot-e2e-only-secret';
let sourceId: number, week: string, forecastId: number;
test.beforeAll(async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: emails.admin } });
  let at = new Date('2001-01-08T17:00:00Z');
  while (await db.opportunitySnapshotRun.findUnique({ where: { snapshotWeek: snapshotWeek(at) } })) at = new Date(at.getTime() + 7 * 86400000);
  const source = await db.opportunitySnapshotRun.create({ data: { snapshotAt: at, snapshotWeek: snapshotWeek(at), createdById: admin.id, createdByName: 'Automation fixture Admin', opportunityCount: 0, scopeVersion: FORECAST_SNAPSHOT_SCOPE } });
  sourceId = source.id; week = source.snapshotWeek.toISOString().slice(0, 10);
});
test.afterAll(async () => { await db.$disconnect(); });

test('protected job recovers an exact manual source; duplicate requests reuse the immutable forecast', async ({ request }) => {
  const count = await db.scheduledJobRun.count({ where: { jobType: 'WEEKLY_SNAPSHOTS' } });
  expect((await request.post('/api/internal/snapshots/weekly', { data: { week } })).status()).toBe(404);
  expect((await request.get('/api/internal/snapshots/weekly')).status()).toBe(405);
  expect(await db.scheduledJobRun.count({ where: { jobType: 'WEEKLY_SNAPSHOTS' } })).toBe(count);
  const responses = await Promise.all([1, 2].map(() => request.post('/api/internal/snapshots/weekly', { headers: { authorization }, data: { week } })));
  for (const response of responses) { expect(response.status()).toBe(200); expect((await response.json()).opportunitySnapshotRunId).toBe(sourceId); }
  const forecasts = await db.forecastSnapshotRun.findMany({ where: { sourceRunId: sourceId } });
  expect(forecasts).toHaveLength(1); const forecast = forecasts[0]; forecastId = forecast.id;
  expect(forecast).toMatchObject({ source: 'SCHEDULED', createdById: null, createdByName: 'Automated weekly capture' });
  const source = await db.opportunitySnapshotRun.findUniqueOrThrow({ where: { id: sourceId } });
  expect(forecast).toMatchObject(businessQuarter(source.snapshotAt)); expect(forecast.snapshotAt).toEqual(source.snapshotAt); expect(source.source).toBe('MANUAL'); expect(source.createdById).not.toBeNull();
  await expect(db.forecastSnapshotRun.update({ where: { id: forecast.id }, data: { source: 'MANUAL' } })).rejects.toThrow(/immutable/);
});
test('open-only historical sources fail safely with durable links and safe messages', async () => {
  const at = new Date(`${week}T17:00:00Z`); at.setUTCDate(at.getUTCDate() - 7);
  while (await db.opportunitySnapshotRun.findUnique({ where: { snapshotWeek: snapshotWeek(at) } })) at.setUTCDate(at.getUTCDate() - 7);
  const source = await db.opportunitySnapshotRun.create({ data: { snapshotAt: at, snapshotWeek: snapshotWeek(at), source: 'SCHEDULED', createdById: null, createdByName: 'Automated weekly capture', opportunityCount: 0 } });
  const result = await runWeeklySnapshots(db, source.snapshotWeek.toISOString().slice(0, 10));
  expect(result).toMatchObject({ status: 'FAILED', opportunitySnapshotRunId: source.id, forecastSnapshotRunId: null, failureCategory: 'INCOMPATIBLE_SOURCE' });
  expect(result.errorSummary).toContain('Admin review');
  expect(await db.forecastSnapshotRun.count({ where: { sourceRunId: source.id } })).toBe(0);
  // Return the latest evidence to success for the visibility check below.
  expect((await runWeeklySnapshots(db, week)).status).toBe('SUCCEEDED');
});
test('Admin status and manual/automated attribution render on desktop, tablet and phone', async ({ page }) => {
  await signInAs(page, 'admin');
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const path of ['/administration/opportunity-snapshots', '/administration/forecast-snapshots', '/administration/maintenance-history']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const region = page.getByRole('region', { name: 'Weekly snapshot automation', exact: true });
      await expect(region).toContainText('Mondays at 5:00 a.m. America/New_York');
      await expect(region).toContainText('Last automated capture attempt');
      await expect(region).toContainText('SUCCEEDED');
      await expect(region.getByRole('link', { name: `Opportunity Snapshot #${sourceId}`, exact: true }).first()).toBeVisible();
      await expect(region.getByRole('link', { name: `Forecast Snapshot #${forecastId}`, exact: true }).first()).toBeVisible();
      if (path.endsWith('/maintenance-history')) {
        const summary = region.locator('summary');
        await summary.click();
        await expect(region.getByText(/INCOMPATIBLE_SOURCE:/).first()).toBeVisible();
        await summary.click();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `reports/weekly-snapshots/${path.split('/').at(-1)}-${viewport.width}.png`, fullPage: true, caret: 'initial' });
    }
  }
});
test('normal user permissions cannot invoke or see automation', async ({ page }) => {
  test.setTimeout(90_000);
  for (const role of ['sales', 'salesManager', 'readOnly', 'support', 'marketing'] as const) {
    await signInAs(page, role); await page.goto('/administration/opportunity-snapshots'); await expect(page).toHaveURL(/access-denied/);
    const response = await page.request.post('/api/internal/snapshots/weekly', { data: { week } }); expect(response.status()).toBe(404);
  }
});
