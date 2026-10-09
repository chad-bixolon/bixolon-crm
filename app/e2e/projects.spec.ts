import { test, expect } from './fixtures';
import { names } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';

test('Project preserves Account and participant on validation, then saves and edits', async ({ page }) => {
  await signInAs(page, 'salesManager');
  await page.goto('/projects/new');
  const form = page.getByRole('form', { name: 'Create project' });
  const name = uniqueName('E2E project');
  await form.getByLabel('Project name').fill(name);
  await form.getByLabel('Primary Account (optional)').selectOption({ label: names.account });
  await form.getByLabel('Target end date').fill('2026-12-15');
  await form.getByLabel('Account', { exact: true }).selectOption({ label: names.otherAccount });
  await form.getByRole('button', { name: 'Add Account' }).click();
  await form.getByRole('button', { name: 'Create Project' }).click();
  await expect(form.getByText('Each additional Account needs at least one valid Project role.')).toBeVisible();
  await expect(form.getByLabel('Project name')).toHaveValue(name);
  await expect(form.getByLabel('Target end date')).toHaveValue('2026-12-15');
  await expect(form.getByLabel('Primary Account (optional)')).not.toHaveValue('');
  await form.getByText(names.otherAccount).locator('..').locator('..').getByRole('checkbox').first().check();
  await form.getByRole('button', { name: 'Create Project' }).click();
  await expect(page).toHaveURL(/\/projects\/\d+$/);
  await expect(page.getByRole('main')).toContainText(name);
  await page.getByRole('link', { name: 'Edit Project' }).click();
  await page.getByRole('form', { name: 'Edit project' }).getByLabel('Description').fill('Edited during E2E regression');
  await page.getByRole('button', { name: 'Save Project' }).click();
  await expect(page).toHaveURL(/\/projects\/\d+$/);
  await expect(page.getByRole('main')).toContainText('Edited during E2E regression');
});
