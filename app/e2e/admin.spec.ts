import { test, expect } from './fixtures';
import { signInAs, uniqueName } from './helpers';
import { PrismaClient, type SalesQuarter } from '@prisma/client';
import { databaseUrl } from './constants.mjs';

test('Competitor add preserves duplicate error and resets on success', async ({ page }) => {
  await signInAs(page, 'admin');
  await page.goto('/administration/competitors');
  const form = page.getByRole('heading', { name: 'Add competitor' }).locator('..').locator('form');
  const name = uniqueName('E2E competitor');
  await form.getByLabel('Name').fill(name);
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('main')).toContainText(name);
  await expect(form.getByLabel('Name')).toHaveValue('');
  await form.getByLabel('Name').fill(name);
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(form.getByLabel('Name')).toHaveValue(name);
  await expect(form.getByRole('status')).toBeVisible();
});

test('Admin Users, Support categories, and History management render', async ({ page }) => {
  await signInAs(page, 'admin');
  for (const path of ['/administration/users', '/administration/support-case-categories', '/administration/history']) {
    await page.goto(path);
    await expect(page.locator('main h1')).toBeVisible();
  }
});

test('snapshot capture shows one outcome and refreshes the current-week status', async ({ page }) => {
  await signInAs(page, 'admin');
  await page.goto('/administration/history');
  const status = page.getByRole('region', { name: 'Forecast Movement captures' });
  const form = status.locator('form');
  const weekText = await status.locator('dt', { hasText: 'Current week' }).locator('..').locator('dd').innerText();
  const snapshotWeek = new Date(`${new Date(weekText).toISOString().slice(0, 10)}T00:00:00.000Z`);
  const year = Number(await form.getByLabel('Year').inputValue());
  const quarter = await form.getByLabel('Quarter').inputValue() as SalesQuarter;
  const currencyCode = await form.getByLabel('Currency').inputValue();
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await db.forecastSnapshot.deleteMany({ where: { snapshotWeek, year, quarter, currencyCode } });
  } finally {
    await db.$disconnect();
  }
  await page.reload();
  await expect(status.locator('dt', { hasText: 'Sales reps captured' }).locator('..').locator('dd')).toHaveText('0');
  await form.getByRole('button', { name: 'Capture Forecast' }).click();
  const success = form.getByRole('status').filter({ hasText: /^Captured \d+ rep snapshots? for the week of / });
  await expect(success).toBeVisible();
  const count = Number((await success.innerText()).match(/^Captured (\d+)/)?.[1]);
  expect(count).toBeGreaterThan(0);
  await expect(form.getByRole('alert')).toHaveCount(0);
  await expect(status.locator('dt', { hasText: 'Sales reps captured' }).locator('..').locator('dd')).toHaveText(String(count));
  const lastCaptured = status.locator('dt', { hasText: 'Last captured' }).locator('..').locator('dd');
  await expect(lastCaptured).not.toHaveText('Not captured yet');
  const firstCaptureTime = await lastCaptured.innerText();

  await form.getByLabel('Year').evaluate(input => (input as HTMLInputElement).min = '1900');
  await form.getByLabel('Year').fill('1999');
  await form.getByRole('button', { name: 'Capture Forecast' }).click();
  await expect(form.getByRole('alert')).toHaveText('Choose a valid year and quarter.');
  await expect(page.getByText(/^Captured \d+ rep snapshots? for the week of /)).toHaveCount(0);
  await expect(form.getByLabel('Year')).toHaveValue('1999');
  await expect(status.locator('dt', { hasText: 'Sales reps captured' }).locator('..').locator('dd')).toHaveText(String(count));

  await form.getByLabel('Year').fill(String(year));
  await form.getByRole('button', { name: 'Capture Forecast' }).click();
  await expect(form.getByRole('status').filter({ hasText: 'were already captured.' })).toBeVisible();
  await expect(form.getByRole('alert')).toHaveCount(0);
  await expect(status.locator('dt', { hasText: 'Sales reps captured' }).locator('..').locator('dd')).toHaveText(String(count));
  await expect(lastCaptured).toHaveText(firstCaptureTime);
});
