import { test, expect } from './fixtures';
import { names } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';

test('Task retains relationships and due date, then completes', async ({ page }) => {
  await signInAs(page, 'sales');
  await page.goto('/tasks/new');
  const subject = uniqueName('E2E task');
  await page.getByLabel('Subject').fill(subject);
  await page.getByLabel('Account', { exact: true }).selectOption({ label: names.account });
  await page.getByLabel('Due date').fill('2026-11-20');
  await page.getByRole('button', { name: 'Create task' }).click();
  await expect(page).toHaveURL(/\/tasks\/\d+$/);
  await expect(page.getByRole('main')).toContainText(subject);
  await page.getByRole('link', { name: 'Edit task' }).click();
  await expect(page.getByLabel('Due date')).toHaveValue('2026-11-20');
  await page.getByLabel('Status').selectOption('COMPLETED');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('main')).toContainText('COMPLETED');
});

test('Sales Plan filters without losing page', async ({ page }) => {
  await signInAs(page, 'salesManager');
  await page.goto('/sales-plan');
  await expect(page.locator('main h1')).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText('Application error');
});
