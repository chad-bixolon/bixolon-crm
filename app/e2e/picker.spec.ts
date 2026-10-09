import { test, expect } from './fixtures';
import { signInAs } from './helpers';

test('Support Product popover stays in viewport, scrolls, and supports keyboard selection', async ({ page }) => {
  await signInAs(page, 'support');
  await page.goto('/support/cases/new');
  const picker = page.getByRole('combobox', { name: 'Product / SKU' });
  await picker.fill('E2E-PICK-');
  const menu = page.getByRole('listbox');
  await expect(menu.getByRole('option')).toHaveCount(25);
  const bounds = await menu.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  const scroll = await menu.evaluate(element => ({ height: element.clientHeight, total: element.scrollHeight }));
  expect(scroll.total).toBeGreaterThan(scroll.height);
  await picker.press('ArrowDown');
  await expect(menu.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
  await picker.press('Enter');
  await expect(page.getByText(/E2E-PICK-02 · E2E Receipt Printer/)).toBeVisible();
  await expect(menu).toBeHidden();
  await page.getByRole('button', { name: 'Change' }).last().click();
  await expect(menu).toBeVisible();
  await page.getByRole('combobox', { name: 'Product / SKU' }).press('Escape');
  await expect(menu).toBeHidden();
});
