import { test, expect } from './fixtures';
import { signInAs, uniqueName } from './helpers';

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
