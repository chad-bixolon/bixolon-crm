import { test, expect, type Page } from './fixtures';
import { names } from './constants.mjs';
import { signInAs } from './helpers';
import { routes } from './route-inventory';

// Include every shared filter consumer, plus the newer inbox/history/help routes.
const auditAreas = {
  ...routes,
  History: ['/reports/forecast-snapshots', '/reports/opportunity-snapshots', '/administration/forecast-snapshots', '/administration/opportunity-snapshots', '/administration/audit-history', '/administration/maintenance-history'],
  Operations: ['/support/inbox', '/administration/ownership', '/administration/data-quality', '/administration/outcome-reasons', '/help'],
};

async function expectBoundedControls(page: Page, route: string) {
  const measurements = await page.locator('main').evaluate(main => {
    const visible = (element: Element) => element.getBoundingClientRect().width > 0;
    const bounds = main.getBoundingClientRect();
    const fields = [...main.querySelectorAll('input.field:not([type="hidden"]):not([type="file"]), select.field:not([multiple]):not([size])')].filter(visible);
    return {
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      fields: fields.map(element => {
        const box = element.getBoundingClientRect();
        const localTable = element.closest('.overflow-x-auto');
        return { name: element.getAttribute('name') ?? element.id, height: box.height, bounded: !!localTable || (box.left >= bounds.left - 1 && box.right <= bounds.right + 1) };
      }),
      actions: [...main.querySelectorAll('.page-header-actions > *, .saved-views-menu, .filter-actions')].filter(visible).map(element => {
        const box = element.getBoundingClientRect();
        return { name: element.textContent?.trim(), bounded: box.left >= bounds.left - 1 && box.right <= bounds.right + 1 };
      }),
      searches: [...main.querySelectorAll('.filter-mobile-search-submit')].filter(visible).map(button => {
        const input = button.closest('form')!.querySelector('.filter-primary-search .field')!;
        const fieldBox = input.getBoundingClientRect(), buttonBox = button.getBoundingClientRect();
        return { height: buttonBox.height, topDifference: Math.abs(fieldBox.top - buttonBox.top), gap: buttonBox.left - fieldBox.right };
      }),
    };
  });
  expect(measurements.pageOverflow, route).toBe(false);
  for (const field of measurements.fields) {
    expect(field.height, `${route}: ${field.name} height`).toBeCloseTo(44, 0);
    expect(field.bounded, `${route}: ${field.name} bounds`).toBe(true);
  }
  for (const action of measurements.actions) expect(action.bounded, `${route}: ${action.name}`).toBe(true);
  for (const search of measurements.searches) {
    expect(search.height, `${route}: Search height`).toBe(44);
    expect(search.topDifference, `${route}: search/button alignment`).toBeLessThanOrEqual(1);
    expect(search.gap, `${route}: search/button gap`).toBe(8);
  }
}

for (const [area, paths] of Object.entries(auditAreas)) {
  test(`${area}: rendered tablet controls and expanded filters`, async ({ page }, info) => {
    test.setTimeout(240_000);
    await signInAs(page, 'admin');
    for (const route of paths) {
      const response = await page.goto(route, { waitUntil: 'networkidle' });
      expect(response?.status(), route).toBe(200);
      await expect(page.locator('main h1').first(), route).toBeVisible();
      await expectBoundedControls(page, route);
      const slug = route.replaceAll('/', '-') || 'dashboard';
      // Keep the caret intact: hiding it during streamed hydration mutates inputs.
      await page.screenshot({ path: info.outputPath(`${slug}.png`), caret: 'initial' });
      const toggle = page.getByRole('button', { name: /^Show filters/ }).first();
      if (await toggle.isVisible()) {
        await toggle.click();
        await expect(page.getByRole('button', { name: /^Hide filters/ }).first()).toHaveAttribute('aria-expanded', 'true');
        await expectBoundedControls(page, `${route} expanded`);
        await page.locator('form.responsive-filter-form').first().screenshot({ path: info.outputPath(`${slug}-filters.png`), caret: 'initial' });
      }
      const more = page.locator('form.responsive-filter-form details > summary').filter({ hasText: 'More filters' });
      if (await more.isVisible()) {
        await more.click();
        await expectBoundedControls(page, `${route} more filters`);
        await page.locator('form.responsive-filter-form').first().screenshot({ path: info.outputPath(`${slug}-more-filters.png`), caret: 'initial' });
      }
    }
  });
}

test('mixed label, select, date, and picker fields align in their grid rows', async ({ page }) => {
  await signInAs(page, 'admin');
  for (const route of ['/projects', '/opportunities?closePeriod=custom', '/pipeline', '/tasks', '/reports/forecast']) {
    await page.goto(route);
    const toggle = page.getByRole('button', { name: /^Show filters/ }).first();
    if (await toggle.isVisible()) await toggle.click();
    const rows = await page.locator('form.filter-grid').evaluateAll(grids => grids.flatMap(grid => {
      const rows = new Map<number, number[]>();
      for (const child of grid.children) {
        const field = child.querySelector('.field');
        if (!field || !field.getBoundingClientRect().width || !child.matches('div, label')) continue;
        const top = Math.round(child.getBoundingClientRect().top);
        rows.set(top, [...(rows.get(top) ?? []), field.getBoundingClientRect().top]);
      }
      return [...rows.values()].filter(row => row.length > 1);
    }));
    expect(rows.length, `${route}: compared grid rows`).toBeGreaterThan(0);
    for (const row of rows) expect(Math.max(...row) - Math.min(...row), `${route}: field top edges`).toBeLessThanOrEqual(1);
    await expectBoundedControls(page, route);
  }
});

test('selected pickers, unassigned Contacts, and date submission retain alignment', async ({ page }, info) => {
  await signInAs(page, 'admin');
  await page.goto('/contacts', { waitUntil: 'networkidle' });
  const form = page.locator('form.responsive-filter-form');
  // At the landscape breakpoint the disclosure is hidden, so no click waits for
  // hydration. Its effect sets this id once the picker's handlers are attached.
  await expect(form).toHaveAttribute('id', /-controls$/);
  const toggle = form.getByRole('button', { name: /^Show filters/ });
  if (await toggle.isVisible()) await toggle.click();
  const account = form.getByRole('combobox', { name: 'Account', exact: true });
  // Let the focus-driven picker render settle before WebKit's synthetic fill.
  await account.tap();
  await expect(account).toHaveAttribute('aria-expanded', 'true');
  await account.fill(names.account);
  await expect(account).toHaveValue(names.account);
  await page.getByRole('listbox').getByRole('option', { name: names.account, exact: true }).tap();
  const selection = form.locator('.entity-picker-selection');
  await expect(selection).toContainText(names.account);
  expect((await selection.boundingBox())!.height).toBe(44);
  await selection.getByRole('button', { name: 'Change' }).tap();
  await account.press('Escape');
  await form.getByRole('button', { name: 'Show unassigned Contacts' }).tap();
  await expect(selection).toContainText('Unassigned');
  expect((await selection.boundingBox())!.height).toBe(44);
  await form.screenshot({ path: info.outputPath('contacts-unassigned.png'), caret: 'initial' });
  await selection.getByRole('button', { name: 'Clear', exact: true }).tap();
  await expect(account).toBeVisible();

  await page.goto('/opportunities?closePeriod=custom', { waitUntil: 'networkidle' });
  const opportunities = page.getByRole('form', { name: 'Filter opportunities' });
  await expect(opportunities).toHaveAttribute('id', /-controls$/);
  const show = opportunities.getByRole('button', { name: /^Show filters/ });
  if (await show.isVisible()) await show.tap();
  await opportunities.getByLabel('Expected Close Date From', { exact: true }).fill('2026-10-01');
  await opportunities.getByLabel('Expected Close Date Through', { exact: true }).fill('2026-12-31');
  await expect(opportunities.getByLabel('Expected Close Date From', { exact: true })).toHaveValue('2026-10-01');
  await expect(opportunities.getByLabel('Expected Close Date Through', { exact: true })).toHaveValue('2026-12-31');
  await opportunities.screenshot({ path: info.outputPath('opportunities-custom-dates.png'), caret: 'initial' });
  await opportunities.getByRole('button', { name: 'Apply', exact: true }).tap();
  await expect(page).toHaveURL(/closeFrom=2026-10-01/);
  await expect(page).toHaveURL(/closeTo=2026-12-31/);
});

test('long Saved View names stay bounded and keyboard accessible', async ({ page }, info) => {
  await signInAs(page, 'admin');
  await page.goto('/projects?q=tablet-audit');
  const summary = page.locator('.saved-views-menu summary');
  await summary.click();
  await page.getByRole('button', { name: 'Save current view', exact: true }).click();
  const name = `Tablet audit ${info.project.name} a long saved view name for alignment`.slice(0, 80);
  await page.getByRole('textbox', { name: 'View name', exact: true }).fill(name);
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  try {
    await expect(summary).toContainText(name);
    await expectBoundedControls(page, 'long Saved View name');
    const label = summary.locator('.saved-views-label');
    expect(await label.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    await summary.focus();
    await page.keyboard.press('Enter');
    const options = page.locator('.saved-views-options');
    await expect(options).toBeVisible();
    const box = (await options.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.screenshot({ path: info.outputPath('saved-view-long-name.png'), caret: 'initial' });
    await page.keyboard.press('Enter');
    await expect(options).toBeHidden();
  } finally {
    const response = await page.request.get('/api/saved-views?route=projects');
    const result = await response.json();
    const view = result.views.find((view: { name: string }) => view.name === name);
    if (view) {
      const removed = await page.request.delete('/api/saved-views', { headers: { origin: new URL(page.url()).origin }, data: { routeKey: 'projects', id: view.id } });
      expect(removed.ok()).toBe(true);
    }
  }
});

test('Support Inbox linking controls and selected SKU retain tablet sizing', async ({ page }, info) => {
  test.setTimeout(90_000);
  await signInAs(page, 'admin');
  await page.goto('/support/inbox', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^Link to Case/ }).first().tap();
  const linking = page.locator('main form').filter({ has: page.getByRole('button', { name: 'Confirm link', exact: true }) }).first();
  await expect(linking).toBeVisible();
  const boxes = await Promise.all([
    linking.locator('select[name="caseId"]').boundingBox(),
    linking.locator('input[name="caseNumber"]').boundingBox(),
    linking.getByRole('button', { name: 'Confirm link', exact: true }).boundingBox(),
  ]);
  for (const box of boxes) expect(box!.height).toBe(44);
  expect(Math.max(...boxes.map(box => box!.y)) - Math.min(...boxes.map(box => box!.y))).toBeLessThanOrEqual(1);
  await expectBoundedControls(page, 'Support Inbox linking');
  await linking.screenshot({ path: info.outputPath('support-inbox-link-controls.png'), caret: 'initial' });

  await page.goto('/support/cases/new', { waitUntil: 'networkidle' });
  const sku = page.getByRole('combobox', { name: 'Product / SKU', exact: true });
  await sku.fill(names.sku);
  await page.getByRole('listbox').getByRole('option').first().tap();
  const selection = page.locator('.entity-picker-selection').filter({ hasText: names.sku });
  await expect(selection).toBeVisible();
  expect((await selection.boundingBox())!.height).toBe(44);
  await expectBoundedControls(page, 'Support selected SKU');
  await selection.locator('..').screenshot({ path: info.outputPath('support-selected-sku.png'), caret: 'initial' });
  await selection.getByRole('button', { name: 'Change', exact: true }).tap();
  await expect(sku).toBeFocused();
  await sku.press('Escape');
});

test('compact report and Campaign filters retain content appropriate widths', async ({ page }, info) => {
  await signInAs(page, 'admin');
  for (const route of ['/reports/sales-plan', '/marketing/campaigns']) {
    await page.goto(route, { waitUntil: 'networkidle' });
    const form = page.locator('form.responsive-filter-form');
    const toggle = form.getByRole('button', { name: /^Show filters/ });
    if (await toggle.isVisible()) await toggle.tap();
    await expectBoundedControls(page, route);
    if (page.viewportSize()!.width >= 1024) {
      const year = (await form.locator('input[name="year"]').boundingBox())!;
      const primary = (await form.locator(route.startsWith('/reports') ? 'select[name="userId"]' : 'input[name="q"]').boundingBox())!;
      expect(primary.width, `${route}: owner/search has more room than Year`).toBeGreaterThan(year.width);
      expect(Math.abs(primary.y - year.y), `${route}: compact row alignment`).toBeLessThanOrEqual(1);
    }
    await form.screenshot({ path: info.outputPath(`${route.replaceAll('/', '-')}-compact-filters.png`), caret: 'initial' });
  }
});
