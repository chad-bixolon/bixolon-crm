import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';
import { databaseUrl, names } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let accountId: number;
let otherAccountId: number;
let contactId: number;
let opportunityId: number;
let projectId: number;

test.beforeAll(async () => {
  accountId = (await db.account.findFirstOrThrow({ where: { name: names.account } })).id;
  otherAccountId = (await db.account.findFirstOrThrow({ where: { name: names.otherAccount } })).id;
  contactId = (await db.contact.findFirstOrThrow({ where: { accountId, firstName: 'E2E Jane' } })).id;
  opportunityId = (await db.opportunity.findFirstOrThrow({ where: { name: 'E2E Picker Opportunity' } })).id;
  projectId = (await db.project.findFirstOrThrow({ where: { name: 'E2E Picker Project' } })).id;
});
test.afterAll(async () => { await db.$disconnect(); });

test('Account Quick Action creates Task and preserves context after failed save', async ({ page }) => {
  await signInAs(page, 'salesManager');
  await page.goto(`/accounts/${accountId}`);
  await page.getByRole('region', { name: 'Quick Actions' }).getByRole('link', { name: 'Create Task' }).click();
  await expect(page.getByText(names.account, { exact: true }).first()).toBeVisible();
  const subject = uniqueName('Quick Action task');
  await page.getByLabel('Subject').fill(subject);
  await page.getByLabel('Status').selectOption('');
  await page.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByText('Choose a status.')).toBeVisible();
  await expect(page.getByLabel('Subject')).toHaveValue(subject);
  await expect(page.getByText(names.account, { exact: true }).first()).toBeVisible();
  await page.getByLabel('Status').selectOption('OPEN');
  await page.getByRole('button', { name: 'Create task' }).click();
  await expect(page).toHaveURL(/\/tasks\/\d+$/);
  await expect(page.getByRole('main')).toContainText(subject);
});

test('Account New Opportunity shows prefilled Account and retains it after validation', async ({ page }) => {
  await signInAs(page, 'salesManager');
  await page.goto(`/accounts/${accountId}`);
  await page.getByRole('region', { name: 'Quick Actions' }).getByRole('link', { name: 'New Opportunity' }).click();
  const form = page.getByRole('form', { name: 'Create opportunity' });
  await expect(form.getByText(names.account, { exact: true })).toBeVisible();
  const name = uniqueName('Quick Action opportunity');
  await form.getByLabel('Opportunity name *').fill(name);
  await form.getByLabel('Sales stage *').selectOption({ label: 'E2E Qualification · 20%' });
  await form.getByRole('button', { name: 'Create opportunity' }).click();
  await expect(form.getByText('Add at least one participating account with a role.')).toBeVisible();
  await expect(form.getByLabel('Opportunity name *')).toHaveValue(name);
  await expect(form.getByText(names.account, { exact: true })).toBeVisible();
  await form.getByRole('checkbox', { name: /End User/ }).check();
  await form.getByRole('button', { name: 'Create opportunity' }).click();
  await expect(form.getByRole('heading', { name: 'Review before creating this Opportunity' })).toBeVisible();
  await form.getByRole('button', { name: 'Save anyway' }).first().click();
  await expect(page).toHaveURL(/\/opportunities\/\d+/);
});

test('Account Add Contact uses the existing Account-prefilled form', async ({ page }) => {
  await signInAs(page, 'salesManager');
  await page.goto(`/accounts/${accountId}`);
  await page.getByRole('region', { name: 'Quick Actions' }).getByRole('link', { name: 'Add Contact' }).click();
  const form = page.getByRole('form', { name: 'Create contact' });
  await expect(form.getByText(names.account, { exact: true })).toBeVisible();
  await expect(form.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', `/accounts/${accountId}?tab=contacts`);
});

test('Contact Log Activity prefills Contact and Account', async ({ page }) => {
  await signInAs(page, 'salesManager');
  await page.goto(`/contacts/${contactId}`);
  await page.getByRole('region', { name: 'Quick Actions' }).getByRole('link', { name: 'Log Activity' }).click();
  await expect(page.getByText(names.account, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(names.contact, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', `/contacts/${contactId}`);
});

test('Contact Create Task prefills editable Contact and Account', async ({ page }) => {
  await signInAs(page, 'salesManager');
  await page.goto(`/contacts/${contactId}`);
  await page.getByRole('region', { name: 'Quick Actions' }).getByRole('link', { name: 'Create Task' }).click();
  await expect(page.getByText(names.contact, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(names.account, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change' })).toHaveCount(2);
});

test('Opportunity Create Task prefills Opportunity and Account', async ({ page }) => {
  await signInAs(page, 'salesManager');
  await page.goto(`/opportunities/${opportunityId}`);
  await page.getByRole('region', { name: 'Quick Actions' }).getByRole('link', { name: 'Create Task' }).click();
  await expect(page.getByText('E2E Picker Opportunity', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('E2E Picker Account', { exact: true }).first()).toBeVisible();
});

test('Opportunity Add Product reaches the existing product section', async ({ page }) => {
  await signInAs(page, 'salesManager');
  await page.goto(`/opportunities/${opportunityId}`);
  await page.getByRole('region', { name: 'Quick Actions' }).getByRole('link', { name: 'Add Product' }).click();
  await expect(page).toHaveURL(new RegExp(`/opportunities/${opportunityId}/edit#opportunity-products$`));
  await expect(page.getByRole('heading', { name: 'Opportunity products' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add product' })).toBeVisible();
});

test('Project Log Activity prefills Project and primary Account', async ({ page }) => {
  await signInAs(page, 'salesManager');
  await page.goto(`/projects/${projectId}`);
  await page.getByRole('region', { name: 'Quick Actions' }).getByRole('link', { name: 'Log Activity' }).click();
  await expect(page.getByText('E2E Picker Project', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('E2E Picker Account', { exact: true }).first()).toBeVisible();
});

test('global Quick Create opens and Read Only sees no write shortcuts', async ({ page }) => {
  await signInAs(page, 'salesManager');
  await page.getByText('+ New').click();
  await page.getByRole('navigation', { name: 'Quick Create' }).getByRole('link', { name: 'New Task' }).click();
  await expect(page).toHaveURL('/tasks/new');
  await signInAs(page, 'readOnly');
  await page.goto(`/accounts/${accountId}`);
  await expect(page.getByRole('region', { name: 'Quick Actions' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Quick Create' })).toHaveCount(0);
  await page.goto('/tasks');
  await expect(page.getByRole('link', { name: 'New task' })).toHaveCount(0);
});

test('Quick Create closes on outside click and Escape while its trigger still toggles it', async ({ page }) => {
  await signInAs(page, 'salesManager');
  const trigger = page.locator('header details summary');
  const menu = page.getByRole('navigation', { name: 'Quick Create' });
  await trigger.click();
  await expect(menu).toBeVisible();
  await page.getByRole('main').click({ position: { x: 20, y: 20 } });
  await expect(menu).toBeHidden();
  await trigger.click();
  await expect(menu).toBeVisible();
  await trigger.click();
  await expect(menu).toBeHidden();
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test('Notifications closes on outside click and Escape while its trigger still toggles it', async ({ page }) => {
  await signInAs(page, 'salesManager');
  const trigger = page.getByRole('button', { name: /^Notifications/ });
  const popover = page.getByRole('link', { name: 'View all notifications' });
  await trigger.click();
  await expect(popover).toBeVisible();
  await page.getByRole('main').click({ position: { x: 20, y: 20 } });
  await expect(popover).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await expect(popover).toBeVisible();
  await trigger.click();
  await expect(popover).toBeHidden();
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
});

test('Account Quick Actions fit on a phone', async ({ page }) => {
  await signInAs(page, 'salesManager');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/accounts/${accountId}`);
  const actions = page.getByRole('region', { name: 'Quick Actions' });
  await expect(actions.getByRole('link', { name: 'Create Task' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.locator('header details summary').click();
  const menu = page.getByRole('navigation', { name: 'Quick Create' });
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
  await page.locator('header details summary').click();
  await actions.getByRole('link', { name: 'Create Task' }).click();
  await expect(page.getByText(names.account, { exact: true }).first()).toBeVisible();
});

test('work prefill rejects invalid and unrelated query IDs', async ({ page }) => {
  await signInAs(page, 'salesManager');
  expect((await page.request.get('/tasks/new?accountId=not-a-number')).status()).toBe(404);
  expect((await page.request.get(`/activities/new?accountId=${otherAccountId}&contactId=${contactId}`)).status()).toBe(404);
});
