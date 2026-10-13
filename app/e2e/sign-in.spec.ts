import { test, expect } from './fixtures';

test('sign-in card is centered, compact, and keyboard accessible on desktop and phone', async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/sign-in');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.getByAltText('BIXOLON')).toBeVisible();
    await expect(page.getByText('AMERICA | SALESHUB')).toBeVisible();
    await expect(page.getByText('Sign in to BIXOLON America SalesHub using your corporate account.')).toBeVisible();
    await expect(page.getByText('Authorized BIXOLON America users only.')).toBeVisible();
    const button = page.getByRole('button', { name: 'Continue with Google' });
    await expect(button).toBeVisible();
    const card = page.locator('main > div');
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(384);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(Math.abs(box!.x + box!.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    expect(await button.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
  }
});
