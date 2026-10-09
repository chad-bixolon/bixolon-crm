import { test, expect, type Page } from '@playwright/test';
import { names } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';

async function choosePicker(page: Page, label: string, query: string, result: RegExp) {
  if (label === 'Product / SKU') {
    const response = await page.request.get(`/support/cases/search?kind=sku&q=${encodeURIComponent(query)}`);
    expect(response.ok()).toBeTruthy();
    expect(JSON.stringify(await response.json())).toMatch(result);
  }
  await page.getByRole('combobox', { name: label }).fill(query);
  await page.getByRole('option', { name: result }).click();
}

test('resolved intake preserves a complete form on server error, then creates one BXS case', async ({ page }) => {
  await signInAs(page, 'support');
  await page.goto('/support/cases/new');
  const subject = uniqueName('E2E resolved intake');
  await page.getByLabel('Customer / End User').fill('E2E end user');
  await choosePicker(page, 'Linked CRM Account (optional)', names.account, new RegExp(names.account));
  await choosePicker(page, 'Contact', 'E2E Jane', /E2E Jane Smith/);
  await page.getByLabel('Subject').fill(subject);
  await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('PHONE');
  await page.getByLabel('Status').selectOption('RESOLVED');
  await page.getByLabel('Priority').selectOption('HIGH');
  await page.getByLabel('Category').selectOption({ label: names.category });
  await page.getByLabel('Assigned Support Rep').selectOption({ label: 'E2E support' });
  await choosePicker(page, 'Product / SKU', names.sku, new RegExp(names.sku));
  await page.getByLabel('Serial Number').fill('E2E-SN-123');
  await page.getByLabel('Next Follow-up').fill('2026-10-20T10:30');
  await page.getByRole('textbox', { name: /^Purchased From/ }).fill('Phone intake: reseller');
  await choosePicker(page, 'Link to CRM Account (optional)', names.purchasedFrom, new RegExp(names.purchasedFrom));
  await page.getByLabel('Description').fill('Customer called and the cable was replaced.');
  await page.getByRole('button', { name: 'Create case' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Resolution Summary is required when resolving or closing a Support Case.' })).toBeVisible();
  await expect(page.getByLabel('Customer / End User')).toHaveValue('E2E end user');
  await expect(page.getByLabel('Subject')).toHaveValue(subject);
  await expect(page.getByRole('combobox', { name: 'Source', exact: true })).toHaveValue('PHONE');
  await expect(page.getByLabel('Status')).toHaveValue('RESOLVED');
  await expect(page.getByLabel('Priority')).toHaveValue('HIGH');
  await expect(page.getByLabel('Next Follow-up')).toHaveValue('2026-10-20T10:30');
  await expect(page.getByText(names.account, { exact: true })).toBeVisible();
  await expect(page.getByText(names.contact, { exact: true })).toBeVisible();
  await expect(page.getByText(new RegExp(names.sku))).toBeVisible();
  await expect(page.getByText(names.purchasedFrom, { exact: true })).toBeVisible();
  await page.getByLabel(/Resolution Summary/).fill('Replaced the cable during initial intake.');
  await page.getByRole('button', { name: 'Create case' }).click();
  await expect(page).toHaveURL(/\/support\/cases\/\d+$/);
  await expect(page.getByText(/BXS-\d{4}-\d{6}/).first()).toBeVisible();
  await expect(page.getByText('Replaced the cable during initial intake.', { exact: true })).toBeVisible();
});

test('customer text alone can create an active Support Case', async ({ page }) => {
  await signInAs(page, 'support');
  await page.goto('/support/cases/new');
  const customer = uniqueName('E2E unlinked customer');
  await page.getByLabel('Customer / End User').fill(customer);
  await page.getByLabel('Subject').fill(uniqueName('E2E new case'));
  await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('EMAIL');
  await page.getByLabel('Description').fill('Customer emailed Support.');
  await page.getByRole('button', { name: 'Create case' }).click();
  await expect(page).toHaveURL(/\/support\/cases\/\d+$/);
  await expect(page.getByText(customer, { exact: true })).toBeVisible();
});

test('typed Product text is rejected until a suggestion is selected', async ({ page }) => {
  await signInAs(page, 'support');
  await page.goto('/support/cases/new');
  await page.getByLabel('Customer / End User').fill('E2E product customer');
  await page.getByLabel('Subject').fill(uniqueName('E2E product validation'));
  await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('PHONE');
  await page.getByLabel('Description').fill('The printer needs attention.');
  const product = page.getByRole('combobox', { name: 'Product / SKU' });
  await product.fill(names.sku);
  await page.getByRole('button', { name: 'Create case' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Select a product from the suggestions.' })).toBeVisible();
  await expect(product).toHaveValue(names.sku);
  await expect(page.locator('input[name="productSkuId"]')).toHaveValue('');
  await page.getByLabel('Subject').focus();
  await product.focus();
  await page.getByRole('option', { name: new RegExp(names.sku) }).click();
  await page.getByRole('button', { name: 'Create case' }).click();
  await expect(page).toHaveURL(/\/support\/cases\/\d+$/);
});
