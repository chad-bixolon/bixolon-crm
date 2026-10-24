import { test, expect } from './fixtures';
import { signInAs } from './helpers';
import { baseURL } from './constants.mjs';
const trigger = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /^User account:/ });
const menu = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'User account', exact: true });

test('account menu toggles, dismisses outside and on Escape, and supports keyboard focus', async ({ page }) => {
  await signInAs(page, 'admin');
  await expect(trigger(page)).toContainText('Administrator');
  await expect(page.locator('header').getByRole('link', { name: 'My Settings' })).toHaveCount(0);
  await expect(page.locator('header').getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  await trigger(page).click();
  await expect(menu(page)).toBeVisible();
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true');
  await trigger(page).click();
  await expect(menu(page)).toHaveCount(0);
  await trigger(page).click();
  await page.getByRole('main').click({ position: { x: 20, y: 20 } });
  await expect(menu(page)).toHaveCount(0);
  await trigger(page).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  const help = menu(page).getByRole('link', { name: 'Help & Guide' });
  const integrations = menu(page).getByRole('link', { name: 'My Settings' });
  const signOut = menu(page).getByRole('button', { name: 'Sign out' });
  await expect(help).toBeFocused();
  expect(await help.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await page.keyboard.press('ArrowDown');
  await expect(integrations).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(signOut).toBeFocused();
  await page.keyboard.press('Home');
  await expect(help).toBeFocused();
  await page.keyboard.press('End');
  await expect(signOut).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(signOut).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu(page)).toHaveCount(0);
});

for (const role of ['admin', 'support', 'sales', 'salesManager', 'marketing', 'readOnly'] as const) {
  test(`${role} retains integrations and appropriate test-user visibility`, async ({ page }) => {
    await signInAs(page, role);
    await expect(page.locator('header').getByRole('link', { name: 'Test as user' })).toHaveCount(role === 'admin' && process.env.ENABLE_DEV_IMPERSONATION === 'true' ? 1 : 0);
    await trigger(page).click();
    await expect(menu(page).getByRole('link')).toHaveCount(2);
    await expect(menu(page).getByRole('link', { name: 'Help & Guide' })).toHaveAttribute('href', '/help');
    await expect(menu(page).getByRole('button')).toHaveCount(1);
    await menu(page).getByRole('link', { name: 'My Settings' }).click();
    await expect(page).toHaveURL('/my-integrations');
    await expect(page.getByRole('heading', { name: 'My Settings', exact: true })).toBeVisible();
    await expect(menu(page)).toHaveCount(0);
    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
  });
}

test('account sign out clears the session and test-user cookie', async ({ page, context }) => {
  await signInAs(page, 'admin');
  if (process.env.ENABLE_DEV_IMPERSONATION === 'true') {
    await page.goto('/dev/impersonation');
    await page.locator('main li').filter({ hasText: 'sales@e2e.saleshub.local' }).getByRole('button', { name: 'Test as user' }).click();
    await expect(page.getByRole('status')).toContainText('Testing as E2E sales');
  } else {
    await context.addCookies([{ name: 'saleshub-dev-impersonate-user', value: '999999', url: baseURL }]);
  }
  await trigger(page).click();
  await menu(page).getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/sign-in');
  expect((await context.cookies()).some(cookie => cookie.name === 'saleshub-dev-impersonate-user')).toBe(false);
  await page.goto('/accounts');
  await expect(page).toHaveURL(/\/sign-in/);
});

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`account menu and header controls fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signInAs(page, 'admin');
    const header = page.locator('header');
    const controls = [header.getByRole('button', { name: 'Search SalesHub' }), header.getByRole('button', { name: 'Recent Items' }), header.locator('summary'), header.getByRole('button', { name: /^Notifications/ }), trigger(page)];
    let previousRight = 0;
    for (const control of controls) {
      await expect(control).toBeVisible();
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(previousRight);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      previousRight = box.x + box.width;
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await trigger(page).click();
    const box = (await menu(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/account-menu-${width}.png` });
    await page.keyboard.press('Escape');
    if (width < 1024) {
      await header.getByRole('button', { name: 'Open menu' }).click();
      await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
      await page.getByRole('button', { name: 'Close menu', exact: true }).click();
    }
  });
}

test('Administrator can still test a user and return through the existing banner', async ({ page }) => {
  test.skip(process.env.ENABLE_DEV_IMPERSONATION !== 'true', 'Development impersonation is disabled');
  await signInAs(page, 'admin');
  await page.locator('header').getByRole('link', { name: 'Test as user' }).click();
  await expect(page).toHaveURL('/dev/impersonation');
  await page.locator('main li').filter({ hasText: 'sales@e2e.saleshub.local' }).getByRole('button', { name: 'Test as user' }).click();
  await expect(page.getByRole('status')).toContainText('Testing as E2E sales');
  await expect(trigger(page)).toContainText('E2E sales');
  await expect(page.locator('header').getByRole('link', { name: 'Test as user' })).toHaveCount(0);
  await trigger(page).click();
  await menu(page).getByRole('link', { name: 'Help & Guide' }).click();
  await expect(page).toHaveURL('/help');
  await expect(page.getByRole('main').getByRole('heading', { name: 'Administration', exact: true })).toHaveCount(0);
  await expect(page.getByRole('main').locator('a[href="/help/support-inbox"]')).toHaveCount(0);
  await trigger(page).click();
  await menu(page).getByRole('link', { name: 'My Settings' }).click();
  await expect(page.getByText('Manage preferences and connections for your signed-in SalesHub account (admin@e2e.saleshub.local).')).toBeVisible();
  await page.getByRole('button', { name: 'Return to Admin' }).click();
  await expect(trigger(page)).toContainText('E2E admin');
  await expect(page.locator('header').getByRole('link', { name: 'Test as user' })).toBeVisible();
});
