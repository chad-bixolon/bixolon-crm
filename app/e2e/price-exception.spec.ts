import { test, expect } from '@playwright/test';
import { names } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';

async function openCorrection(page: import('@playwright/test').Page) {
  await signInAs(page, 'admin');
  await page.goto('/administration/price-exceptions');
  const row = page.getByRole('row', { name: new RegExp(names.pe) });
  await row.getByRole('button', { name: 'Review / correct' }).click();
}

test('PE Account search clears a stale selected ID before correction', async ({ page }) => {
  await openCorrection(page);
  const account = page.getByRole('combobox', { name: 'active Account' });
  await account.selectOption({ label: names.account });
  await expect(page.getByText(`Selected: ${names.account}`)).toBeVisible();
  await page.getByRole('textbox', { name: 'Search active Account' }).fill(names.otherAccount);
  await expect(account).toHaveValue('');
  await expect(page.getByRole('alert').filter({ hasText: 'Select an active Account from the results.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save correction' })).toBeDisabled();
  await account.selectOption({ label: names.otherAccount });
  await expect(page.getByRole('alert').filter({ hasText: 'Select an active Account from the results.' })).toBeHidden();
  await page.getByRole('button', { name: 'Save correction' }).click();
  await expect(page.getByText(`Selected: ${names.otherAccount}`)).toBeHidden();
  await expect(page.getByText(names.otherAccount).first()).toBeVisible();
});

test('PE correction Account modal keeps its fields on duplicate error and closes after retry', async ({ page }) => {
  const duplicateKeyWarnings: string[] = [];
  page.on('console', message => { if (message.text().includes('Encountered two children with the same key')) duplicateKeyWarnings.push(message.text()); });
  await openCorrection(page);
  await page.getByRole('button', { name: 'Create Account…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create Account' });
  const name = dialog.getByLabel('Account Name');
  await name.fill(names.account);
  await dialog.getByRole('button', { name: 'Review Account creation' }).click();
  await expect(dialog).toBeVisible();
  await expect(name).toHaveValue(names.account);
  await expect(dialog.getByText('An Account with this name already exists. Use the existing Account.')).toBeVisible();
  const freshName = uniqueName('E2E PE account');
  await name.fill(freshName);
  await dialog.getByRole('button', { name: 'Review Account creation' }).click();
  await expect(dialog.getByText('No likely duplicate Accounts found')).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm Create Account' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(new RegExp(`Account ${freshName} created`))).toBeVisible();
  expect(duplicateKeyWarnings).toEqual([]);
});
