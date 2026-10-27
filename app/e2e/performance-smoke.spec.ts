import { test, expect } from './fixtures';
import { signInAs } from './helpers';

test('representative server-rendered pages record navigation timing on the isolated E2E database', async ({ page }, testInfo) => {
  await signInAs(page, 'admin');
  const timings: { route: string; responseMs: number; loadMs: number }[] = [];
  for (const route of ['/', '/administration/ownership', '/reports/forecast', '/reports']) {
    const response = await page.goto(route, { waitUntil: 'load' });
    expect(response?.ok(), route).toBe(true);
    await expect(page.locator('main h1')).toBeVisible();
    const timing = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      return { responseMs: navigation.responseStart, loadMs: navigation.loadEventEnd };
    });
    timings.push({ route, responseMs: Math.round(timing.responseMs), loadMs: Math.round(timing.loadMs) });
  }
  await testInfo.attach('navigation-timing.json', { body: JSON.stringify(timings, null, 2), contentType: 'application/json' });
  console.log(`Performance smoke navigation timings: ${JSON.stringify(timings)}`);
});
