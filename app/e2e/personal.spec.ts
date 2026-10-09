import { test, expect } from './fixtures';
import { signInAs, watchApplicationErrors } from './helpers';

test('Support dashboard, notifications, My Day, and disconnected calendar pages', async ({ page }) => {
  await signInAs(page, 'support');
  const errors = watchApplicationErrors(page);
  await expect(page.getByRole('main')).toContainText('My Open Cases');
  await expect(page.getByRole('main')).toContainText('High / Critical Cases');
  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: 'Notification Center' })).toBeVisible();
  const categories = page.getByRole('navigation', { name: 'Notification category' });
  await categories.getByRole('link', { name: 'Support' }).click();
  await expect(page).toHaveURL(/category=support/);
  await expect(categories.getByRole('link', { name: 'Support' })).toHaveAttribute('aria-current', 'page');
  await page.goto('/my-day');
  await expect(page.getByRole('heading', { name: 'My Day' })).toBeVisible();
  await page.goto('/my-integrations');
  await expect(page.locator('main h1')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Admin dashboard and Calendar Matches load without Google connection', async ({ page }) => {
  await signInAs(page, 'admin');
  await expect(page.locator('main h1')).toBeVisible();
  await page.goto('/calendar-matches');
  await expect(page.locator('main h1')).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText('Application error');
});
