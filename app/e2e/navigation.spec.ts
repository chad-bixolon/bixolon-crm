import { test, expect } from './fixtures';
import { signInAs, watchApplicationErrors } from './helpers';

test('primary navigation tracks route and browser history', async ({ page }) => {
  await signInAs(page, 'admin');
  const errors = watchApplicationErrors(page);
  const nav = page.getByRole('navigation', { name: 'Primary navigation' });
  for (const [label, path] of [
    ['Accounts', '/accounts'], ['Opportunities', '/opportunities'], ['Projects', '/projects'],
    ['Support Cases', '/support/cases'], ['Reports', '/reports'], ['Administration', '/administration'],
  ]) {
    await nav.getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(path);
    await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
  }
  await page.goBack();
  await expect(page).toHaveURL('/reports');
  await page.goForward();
  await expect(page).toHaveURL('/administration');
  expect(errors).toEqual([]);
});

const access = [
  { role: 'support', visible: ['Support Cases', 'Accounts', 'Contacts', 'Products'], absent: ['Pipeline', 'Administration', 'Reports'], allowed: '/support/cases', denied: '/administration' },
  { role: 'sales', visible: ['Pipeline', 'Sales Plan', 'Tasks'], absent: ['Administration', 'Demos'], allowed: '/opportunities', denied: '/administration' },
  { role: 'salesManager', visible: ['Pipeline', 'Sales Plan', 'Reports'], absent: ['Administration', 'Demos'], allowed: '/reports', denied: '/administration' },
  { role: 'marketing', visible: ['Campaigns', 'Marketing Audiences', 'Trade Shows'], absent: ['Pipeline', 'Administration'], allowed: '/marketing/audiences', denied: '/pipeline' },
  { role: 'readOnly', visible: ['Accounts', 'Products', 'Reports'], absent: ['Administration', 'Marketing Audiences'], allowed: '/reports', denied: '/accounts/new' },
] as const;

for (const { role, visible, absent, allowed, denied } of access) {
  test(`${role} sees permitted navigation and is denied a restricted route`, async ({ page }) => {
    await signInAs(page, role);
    const nav = page.getByRole('navigation', { name: 'Primary navigation' });
    await expect(page.getByRole('main')).toBeVisible();
    for (const label of visible) await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    for (const label of absent) await expect(nav.getByRole('link', { name: label, exact: true })).toHaveCount(0);
    await page.goto(allowed);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page).not.toHaveURL(/access-denied|sign-in/);
    await page.goto(denied);
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
  });
}
