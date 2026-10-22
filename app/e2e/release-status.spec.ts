import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';
import { databaseUrl } from './constants.mjs';
import { signInAs } from './helpers';
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const ids: number[] = [];
test.afterAll(async () => { await db.scheduledJobRun.deleteMany({ where: { id: { in: ids } } }); await db.$disconnect(); });
for (const width of [1440, 768, 390]) test(`Release Status healthy and warning operational evidence at ${width}px`, async ({ page }) => {
  const run = await db.scheduledJobRun.create({ data: { jobType: 'CALENDAR_SYNC', status: 'SUCCEEDED', startedAt: new Date(Date.now() + 60000), completedAt: new Date(), resultSummary: '8 of 8 connections succeeded.' } }); ids.push(run.id);
  await page.setViewportSize({ width, height: 900 }); await signInAs(page, 'admin'); await page.goto('/administration/system-health');
  const region = page.getByRole('region', { name: 'Release Status' });
  await expect(region).toBeVisible(); await expect(region).toContainText('8 connections processed');
  await expect(region).toContainText('Migration status'); await expect(region).toContainText('Runtime/schema status');
  // The test runner can inject identity only into the server environment, just
  // as App Platform does for a Docker-based service (no metadata rebuild).
  const runtimeSha = process.env.RELEASE_GIT_SHA;
  if (runtimeSha?.length === 40 && /^[a-f0-9]{40}$/i.test(runtimeSha)) {
    await expect(region.locator('div').filter({ has: page.locator('dt').filter({ hasText: /^Commit$/ }) }).last().locator('dd')).toHaveText(runtimeSha);
  }
  if (process.env.RELEASE_BRANCH === 'main') {
    await expect(region.locator('div').filter({ has: page.locator('dt').filter({ hasText: /^Branch$/ }) }).last().locator('dd')).toHaveText('main');
  }
  await expect(region).toContainText('Not configured');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await db.scheduledJobRun.update({ where: { id: run.id }, data: { status: 'FAILED', errorSummary: 'PRIVATE_PROVIDER_PAYLOAD' } });
  await page.reload(); await expect(region).toContainText('Last run had failures'); await expect(region).not.toContainText('PRIVATE_PROVIDER_PAYLOAD');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await db.scheduledJobRun.update({ where: { id: run.id }, data: { status: 'SUCCEEDED', resultSummary: '0 of 0 connections succeeded.' } });
  await page.reload(); await expect(region).toContainText('Last run completed — no active connections');
  await region.getByText('Pre-deploy and post-deploy verification', { exact: true }).click(); await expect(region).toContainText('npm run release:check');
  await db.scheduledJobRun.delete({ where: { id: run.id } });
});
test('Release Status remains Admin-only', async ({ page }) => {
  for (const role of ['sales', 'salesManager', 'support', 'marketing', 'readOnly'] as const) { await signInAs(page, role); await page.goto('/administration/system-health'); await expect(page).toHaveURL(/access-denied/); }
});
