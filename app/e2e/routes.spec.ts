import { test, expect } from './fixtures';
import { signInAs, watchApplicationErrors } from './helpers';

// Includes direct routes that do not appear in the primary sidebar.
const routes: Record<string, string[]> = {
  Dashboard: ['/'],
  CRM: ['/accounts', '/accounts/new', '/contacts', '/contacts/new'],
  Sales: ['/opportunities', '/opportunities/new', '/pipeline', '/sales-plan', '/tasks', '/tasks/new', '/calendar-matches', '/demos'],
  Programs: ['/projects', '/projects/new'],
  Marketing: ['/trade-shows', '/trade-shows/new', '/trade-shows/import-mappings', '/marketing/campaigns', '/marketing/campaigns/new', '/marketing/audiences', '/marketing/audiences/new', '/marketing/lead-sources'],
  Catalog: ['/products', '/products/new', '/price-exceptions', '/price-exceptions/lookup'],
  Reports: ['/reports', '/reports/new', '/reports/forecast', '/reports/forecast-movement', '/reports/pipeline-view', '/reports/engagement', '/reports/trade-shows', '/reports/lead-sources', '/reports/marketing-attribution', '/reports/demo-inventory', '/reports/sales-plan', '/reports/sales-plan-sku', '/reports/price-exceptions-expiring', '/reports/support-cases'],
  Support: ['/support/cases', '/support/cases/new'],
  Administration: ['/administration', '/administration/users', '/administration/users/new', '/administration/competitors', '/administration/sales-stages', '/administration/support-case-categories', '/administration/settings', '/administration/labels', '/administration/history', '/administration/dashboard-views', '/administration/sales-targets', '/administration/price-exceptions', '/administration/imports', '/administration/lookups/industries'],
  Personal: ['/my-integrations', '/notifications', '/my-day'],
};

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
