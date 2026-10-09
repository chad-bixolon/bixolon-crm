import { test, expect } from './fixtures';
import { signInAs, uniqueName } from './helpers';

test('Campaign failed date validation preserves form, then create and edit', async ({ page }) => {
  await signInAs(page, 'marketing');
  await page.goto('/marketing/campaigns/new');
  const name = uniqueName('E2E campaign');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Year').fill('2026');
  await page.getByLabel('Start date').fill('2026-12-10');
  await page.getByLabel('End date').fill('2026-12-01');
  await page.getByRole('button', { name: 'Create Campaign' }).click();
  await expect(page).toHaveURL('/marketing/campaigns/new');
  await expect(page.getByLabel('Name')).toHaveValue(name);
  await expect(page.getByLabel('Start date')).toHaveValue('2026-12-10');
  await expect(page.getByRole('alert').or(page.getByRole('status')).first()).toBeVisible();
  await expect(page.locator('form[aria-busy="true"]')).toHaveCount(0);
  await page.getByLabel('End date').fill('2026-12-20');
  await page.getByRole('button', { name: 'Create Campaign' }).click();
  await expect(page).toHaveURL(/\/marketing\/campaigns\/\d+$/);
  await page.getByRole('link', { name: 'Edit Campaign' }).click();
  await page.getByLabel('Description').fill('E2E edited campaign');
  await page.getByRole('button', { name: 'Save Campaign' }).click();
  await expect(page.getByRole('main')).toContainText('E2E edited campaign');
});

test('Trade Shows and Audiences render for Marketing', async ({ page }) => {
  await signInAs(page, 'marketing');
  for (const path of ['/trade-shows', '/marketing/audiences', '/reports/marketing-attribution']) {
    await page.goto(path);
    await expect(page.locator('main h1')).toBeVisible();
  }
});
