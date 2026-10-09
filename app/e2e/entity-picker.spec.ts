import { test, expect } from './fixtures';
import { signInAs } from './helpers';

for (const viewport of [{ width: 1440, height: 900 }, { width: 900, height: 700 }]) {
  test(`Account search is bounded, ranked, and contained at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signInAs(page, 'salesManager');
    await page.goto('/contacts/new');
    const picker = page.getByRole('combobox', { name: 'Account (optional)' });
    let calls = 0;
    page.on('request', request => { if (request.url().includes('/api/entity-search?')) calls++; });
    await picker.fill('E');
    await expect(page.getByText('Type at least 2 characters to search.')).toBeVisible();
    await page.waitForTimeout(350);
    expect(calls).toBe(0);
    await picker.fill('E2E Picker Account');
    const menu = page.getByRole('listbox');
    await expect(menu.getByRole('option')).toHaveCount(25, { timeout: 30000 });
    await expect(menu.getByRole('option').first()).toContainText('E2E Picker Account');
    const first = await menu.getByRole('option').first().innerText();
    expect(first.split('\n')[0]).toBe('E2E Picker Account');
    await expect(menu.getByRole('option').nth(1)).toContainText('E2E Picker Account 01');
    await expect(menu.getByRole('option').nth(2)).toContainText('E2E Picker Account 02');
    const bounds = await menu.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.height).toBeLessThanOrEqual(320);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    expect(await menu.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    await picker.press('ArrowDown');
    await expect(menu.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
    await picker.press('Escape');
    await expect(menu).toBeHidden();
    await picker.press('ArrowDown');
    await expect(menu).toBeVisible();
    await menu.getByRole('option').first().click();
    await expect(page.getByText('E2E Picker Account', { exact: true })).toBeVisible();
    await page.getByRole('form', { name: 'Create contact' }).getByRole('button', { name: 'Create contact' }).click();
    await expect(page.getByText('E2E Picker Account', { exact: true })).toBeVisible();
  });
}

test('Contact name, email, and Account context search', async ({ page }) => {
  await signInAs(page, 'salesManager');
  await page.goto('/opportunities/new');
  const picker = page.getByRole('combobox', { name: 'Search existing Contacts' });
  await picker.fill('e2e-picker-00@example.test');
  const menu = page.getByRole('listbox');
  await expect(menu.getByRole('option').first()).toContainText('E2E Picker Account');
  await picker.fill('Picker Contact');
  await expect(menu.getByRole('option')).toHaveCount(25);
  await menu.getByRole('option').first().click();
  await page.getByRole('button', { name: 'Add Contact' }).click();
  await expect(page.getByRole('form', { name: 'Create opportunity' })).toContainText('E2E Picker Contact');
});

test('Opportunity and Project searches show Account context and reject stale results', async ({ page }) => {
  await signInAs(page, 'salesManager');
  await page.goto('/tasks/new');
  const opportunity = page.getByRole('combobox', { name: 'Opportunity' });
  await opportunity.fill('E2E Picker Opportunity');
  const menu = page.getByRole('listbox');
  await expect(menu.getByRole('option')).toHaveCount(25);
  await expect(menu.getByRole('option').first()).toContainText('E2E Picker Account');
  await opportunity.fill('zzzz-no-match');
  await expect(menu).toContainText('No matching Opportunities.');
  await opportunity.fill('E2E Picker Opportunity');
  await expect(menu.getByRole('option')).toHaveCount(25);
  await menu.getByRole('option').first().click();
  await expect(page.getByText('E2E Picker Opportunity', { exact: true })).toBeVisible();
  const project = page.getByRole('combobox', { name: 'Project' });
  await project.fill('E2E Picker Project');
  await expect(menu.getByRole('option')).toHaveCount(25);
  await expect(menu.getByRole('option').first()).toContainText('E2E Picker Account');
});

test('Activity dependent searches keep only records linked to the selected Account', async ({ page }) => {
  await signInAs(page, 'salesManager');
  await page.goto('/activities/new');
  const account = page.getByRole('combobox', { name: /^Account/ });
  await account.fill('E2E Picker Account');
  await page.getByRole('option', { name: /E2E Picker Account/ }).first().click();
  const opportunity = page.getByRole('combobox', { name: 'Opportunity' });
  await opportunity.fill('E2E Picker Opportunity');
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('listbox').getByRole('option').first()).toContainText('E2E Picker Opportunity');
  await page.getByRole('listbox').getByRole('option').first().click();
  const contact = page.getByRole('combobox', { name: 'Contacts involved in this activity' });
  await contact.fill('Picker Contact');
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(1);
});

test('older Account responses cannot replace a newer query', async ({ page }) => {
  await signInAs(page, 'salesManager');
  await page.goto('/contacts/new');
  await page.route('**/api/entity-search?**', async route => {
    if (new URL(route.request().url()).searchParams.get('q') === 'E2E Picker Account') await new Promise(resolve => setTimeout(resolve, 900));
    try { await route.continue(); } catch { /* The old request was aborted after typing continued. */ }
  });
  const picker = page.getByRole('combobox', { name: 'Account (optional)' });
  await picker.fill('E2E Picker Account');
  await page.waitForRequest(request => request.url().includes('/api/entity-search?') && new URL(request.url()).searchParams.get('q') === 'E2E Picker Account');
  await picker.fill('E2E Picker Account 04');
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('listbox').getByRole('option').first()).toContainText('E2E Picker Account 04');
  await page.waitForTimeout(1100);
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(1);
});
