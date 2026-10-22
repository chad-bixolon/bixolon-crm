import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';
import { databaseUrl } from './constants.mjs';
import { signInAs } from './helpers';
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const ids: number[] = [];
test.afterAll(async () => { await db.scheduledJobRun.deleteMany({ where: { id: { in: ids } } }); await db.$disconnect(); });
for (const width of [1440, 1024, 820, 768, 390]) test(`Deployment Status healthy and warning operational evidence at ${width}px`, async ({ page }) => {
  const run = await db.scheduledJobRun.create({ data: { jobType: 'CALENDAR_SYNC', status: 'SUCCEEDED', startedAt: new Date(Date.now() + 60000), completedAt: new Date(), resultSummary: '8 of 8 connections succeeded.' } }); ids.push(run.id);
  await page.setViewportSize({ width, height: 900 }); await signInAs(page, 'admin'); await page.goto('/administration/system-health');
  const region = page.getByRole('region', { name: 'Deployment Status' });
  await expect(region).toBeVisible(); await expect(region).toContainText('8 calendar connections processed');
  await expect(region).toContainText('Database updates'); await expect(region).toContainText('Application & database compatibility');
  await expect(region.getByText('Application & database compatibility', { exact: true }).locator('..').locator('dd')).toHaveText('Verified');
  // The test runner can inject identity only into the server environment, just
  // as App Platform does for a Docker-based service (no metadata rebuild).
  const runtimeSha = process.env.RELEASE_GIT_SHA;
  if (runtimeSha?.length === 40 && /^[a-f0-9]{40}$/i.test(runtimeSha)) {
    await expect(region.locator('div').filter({ has: page.locator('dt').filter({ hasText: /^Deployed version$/ }) }).last().locator('dd')).toHaveText(runtimeSha.slice(0, 10));
  }
  if (process.env.RELEASE_BRANCH === 'main') {
    await expect(region.locator('div').filter({ has: page.locator('dt').filter({ hasText: /^Source branch$/ }) }).last().locator('dd')).toHaveText('main');
  }
  await expect(region).toContainText('Gmail not configured');
  const technical = region.locator('details').filter({ has: page.getByText('Technical details', { exact: true }) });
  const summary = technical.locator('summary');
  await expect(technical).not.toHaveAttribute('open', '');
  await expect(technical.getByText('Migration counts', { exact: true })).toBeHidden();
  await summary.focus(); await page.keyboard.press('Enter');
  await expect(technical).toHaveAttribute('open', '');
  await expect(technical.getByText('Migration counts', { exact: true })).toBeVisible();
  await expect(technical).toContainText('Running Prisma client/runtime version');
  if (runtimeSha?.length === 40 && /^[a-f0-9]{40}$/i.test(runtimeSha)) await expect(technical).toContainText(runtimeSha);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Space'); await expect(technical).not.toHaveAttribute('open', '');
  const calendar = region.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Calendar Automation', exact: true }) });
  await expect(calendar).toContainText('Status: Healthy');
  await expect(calendar).toContainText('Last completed');
  await expect(calendar).not.toContainText('Latest attempt');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await db.scheduledJobRun.update({ where: { id: run.id }, data: { status: 'FAILED', errorSummary: 'PRIVATE_PROVIDER_PAYLOAD' } });
  await page.reload(); await expect(calendar).toContainText('Status: Attention needed'); await expect(calendar).toContainText('Latest failed attempt'); await expect(calendar).toContainText('Most recent successful completion'); await expect(region).not.toContainText('PRIVATE_PROVIDER_PAYLOAD');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await db.scheduledJobRun.update({ where: { id: run.id }, data: { status: 'SUCCEEDED', resultSummary: '0 of 0 connections succeeded.' } });
  await page.reload(); await expect(calendar).toContainText('no active connections');
  await db.scheduledJobRun.update({ where: { id: run.id }, data: { resultSummary: '1 of 1 connections succeeded.' } });
  await page.reload(); await expect(calendar).toContainText('1 calendar connection processed'); await expect(calendar).not.toContainText('1 calendar connections');
  await region.getByText('How deployment verification works', { exact: true }).click(); await expect(region).toContainText('These checks are read-only and do not make changes to the system.');
  await page.screenshot({ path: `reports/system-health-wording/health-${width}.png`, fullPage: true });
  await db.scheduledJobRun.delete({ where: { id: run.id } });
});
test('Deployment Status remains Admin-only', async ({ page }) => {
  for (const role of ['sales', 'salesManager', 'support', 'marketing', 'readOnly'] as const) { await signInAs(page, role); await page.goto('/administration/system-health'); await expect(page).toHaveURL(/access-denied/); }
});
