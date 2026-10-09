import { test, expect } from './fixtures';
import { signInAs, watchApplicationErrors } from './helpers';

// Includes direct routes that do not appear in the primary sidebar.
import { routes } from './route-inventory';

test.describe('route inventory', () => {
  test.beforeEach(async ({ page }) => signInAs(page, 'admin'));
  for (const [area, paths] of Object.entries(routes)) {
    test(`${area} user-facing pages load`, async ({ page }) => {
      test.setTimeout(180_000);
      const errors = watchApplicationErrors(page);
      for (const path of paths) {
        const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
        expect(response?.status(), `${path}: HTTP status`).toBe(200);
        await expect(page.getByRole('main'), `${path}: main landmark`).toBeVisible();
        await expect(page.locator('main h1').first(), `${path}: page heading`).toBeVisible();
        expect((await page.locator('main').innerText()).trim().length, `${path}: blank content`).toBeGreaterThan(15);
        // The development indicator mounts nextjs-portal even without an error.
        await expect(page.locator('[data-nextjs-dialog]'), `${path}: Next.js error overlay`).toHaveCount(0);
        expect(errors, `${path}: application console/page errors`).toEqual([]);
      }
    });
  }
});
