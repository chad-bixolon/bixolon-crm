import { test, expect } from './fixtures';
import { signInAs, watchApplicationErrors } from './helpers';

test('Support report filters and Excel export', async ({ page }) => {
  await signInAs(page, 'support');
  const errors = watchApplicationErrors(page);
  await page.goto('/reports/support-cases');
  await expect(page.getByRole('heading', { name: 'Support Cases Report' })).toBeVisible();
  const form = page.getByRole('form', { name: 'Filter Support Cases report' });
  await form.locator('select[name="status"]').selectOption('RESOLVED');
  await form.locator('select[name="priority"]').selectOption('HIGH');
  await form.getByRole('button', { name: 'View report' }).click();
  await expect(page).toHaveURL(/status=RESOLVED/);
  await expect(form.locator('select[name="priority"]')).toHaveValue('HIGH');
  await expect(page.getByRole('table')).toBeVisible();
  const exportResponse = await page.request.get('/reports/support-cases/export?status=RESOLVED&priority=HIGH');
  expect(exportResponse.status()).toBe(200);
  expect(exportResponse.headers()['content-type']).toMatch(/spreadsheet|excel|octet-stream/);
  expect(errors).toEqual([]);
});

test('report builder and forecast filter render', async ({ page }) => {
  await signInAs(page, 'admin');
  await page.goto('/reports/new');
  await expect(page.locator('main h1')).toBeVisible();
  await page.goto('/reports/forecast');
  await expect(page.locator('main h1')).toBeVisible();
  await expect(page.getByRole('main')).toContainText('Forecast');
});
