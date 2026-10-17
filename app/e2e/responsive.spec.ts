import { resolve } from 'node:path';
import { test, expect } from './fixtures';
import { names } from './constants.mjs';
import { signInAs, uniqueName, watchApplicationErrors } from './helpers';
import { routes } from './route-inventory';

const smokeRoutes = [
  '/', '/accounts', '/contacts', '/opportunities', '/tasks', '/projects',
  '/support/cases', '/support/cases/new', '/price-exceptions', '/demos',
  '/reports', '/notifications', '/my-day', '/administration',
];

test('shared controls retain phone and desktop sizing', async ({ page }, info) => {
  test.skip(page.viewportSize()!.width >= 640 && page.viewportSize()!.width < 1280);
  await signInAs(page, 'admin');
  await page.goto('/projects');
  const toggle = page.getByRole('button', { name: /^Show filters/ });
  if (await toggle.isVisible()) await toggle.click();
  const expected = page.viewportSize()!.width < 640 ? 44 : 40;
  for (const selector of ['input[name="q"]', 'select[name="status"]', '.saved-views-menu summary', '.filter-actions button']) {
    const box = await page.locator(`main ${selector}`).first().boundingBox();
    expect(box!.height, selector).toBe(expected);
  }
  await page.screenshot({ path: info.outputPath('project-controls.png'), caret: 'initial' });
});

async function expectNoPageOverflow(page: import('@playwright/test').Page, route: string) {
  const result = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll('body *')].filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && (rect.right > document.documentElement.clientWidth + 1 || rect.left < -1) &&
        getComputedStyle(element).position !== 'fixed';
    }).slice(0, 5).map(element => `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 90)}`),
  }));
  expect(result.scrollWidth, `${route}: ${JSON.stringify(result)}`).toBeLessThanOrEqual(result.width + 1);
}

test('representative routes retain headings, actions, and a bounded page', async ({ page }) => {
  test.setTimeout(300_000);
  await signInAs(page, 'admin');
  const errors = watchApplicationErrors(page);
  for (const route of smokeRoutes) {
    const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
    expect(response?.status(), route).toBe(200);
    await expect(page.locator('main h1').first(), route).toBeVisible();
    await expectNoPageOverflow(page, route);
    const headerAction = page.locator('main > div:first-child .btn-primary, main > div:first-child .btn-secondary').first();
    if (await headerAction.count()) {
      const box = await headerAction.boundingBox();
      expect(box!.x, `${route}: action left edge`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${route}: action right edge`).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    }
  }
  expect(errors).toEqual([]);
});

for (const [area, paths] of Object.entries(routes)) {
  test(`${area} route inventory has no page overflow`, async ({ page }) => {
    test.setTimeout(240_000);
    await signInAs(page, 'admin');
    const errors = watchApplicationErrors(page);
    for (const route of paths) {
      const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
      expect(response?.status(), route).toBe(200);
      await expect(page.locator('main h1').first(), route).toBeVisible();
      await expectNoPageOverflow(page, route);
    }
    expect(errors).toEqual([]);
  });
}

test('record detail pages remain bounded', async ({ page }) => {
  test.setTimeout(180_000);
  await signInAs(page, 'admin');
  for (const [list, pattern] of [
    ['/accounts', /^\/accounts\/\d+$/],
    ['/contacts', /^\/contacts\/\d+$/],
    ['/opportunities', /^\/opportunities\/\d+$/],
    ['/projects', /^\/projects\/\d+$/],
    ['/support/cases', /^\/support\/cases\/\d+$/],
    ['/price-exceptions', /^\/price-exceptions\/\d+$/],
    ['/tasks', /^\/tasks\/\d+\/edit$/],
    ['/demos', /^\/demos\/\d+$/],
  ] as const) {
    await page.goto(list);
    const hrefs = await page.locator('main a[href]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href') || ''));
    const detail = hrefs.find(href => pattern.test(href));
    if (!detail) continue;
    await page.goto(detail);
    await expect(page.locator('main h1').first()).toBeVisible();
    await expectNoPageOverflow(page, detail);
    if (['/accounts', '/contacts', '/opportunities', '/projects', '/support/cases'].includes(list)) {
      await page.goto(`${detail}/edit`);
      await expect(page.locator('main h1').first()).toBeVisible();
      await expectNoPageOverflow(page, `${detail}/edit`);
    }
    if (list === '/tasks') {
      const taskDetail = detail.replace(/\/edit$/, '');
      await page.goto(taskDetail);
      await expect(page.locator('main h1').first()).toBeVisible();
      await expectNoPageOverflow(page, taskDetail);
    }
  }
});

test('navigation uses a drawer below the desktop breakpoint', async ({ page }) => {
  await signInAs(page, 'admin');
  if (page.viewportSize()!.width >= 1024) {
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
    return;
  }
  const open = page.getByRole('button', { name: 'Open menu' });
  await expect(open).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeHidden();
  await open.click();
  await expect(open).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Close menu' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(open).toBeFocused();
  await open.click();
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Accounts', exact: true }).click();
  await expect(page).toHaveURL('/accounts');
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeHidden();
  await expect(open).toHaveAttribute('aria-expanded', 'false');
});

test('notification popover stays inside the viewport', async ({ page }) => {
  await signInAs(page, 'admin');
  await page.getByRole('button', { name: /^Notifications/ }).click();
  const popover = page.getByRole('link', { name: 'View all notifications' }).locator('..');
  const box = await popover.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  await expectNoPageOverflow(page, 'notification popover');
});

test('search pickers stay within the viewport and select by touch', async ({ page, isMobile }) => {
  test.skip(!isMobile);
  await signInAs(page, 'salesManager');
  await page.goto('/tasks/new');
  for (const [label, query] of [['Account', 'E2E Picker Account'], ['Opportunity', 'E2E Picker Opportunity'], ['Project', 'E2E Picker Project']] as const) {
    const picker = page.getByRole('combobox', { name: label, exact: true });
    await picker.fill(query);
    const menu = page.getByRole('listbox');
    await expect(menu.getByRole('option').first()).toBeVisible();
    const bounds = await menu.boundingBox();
    const size = page.viewportSize()!;
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(size.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(size.height);
    await menu.getByRole('option').first().tap();
    await expectNoPageOverflow(page, `/tasks/new ${label}`);
    const selected = page.locator(`input[name="${label.toLowerCase()}Id"]`).locator('..');
    await selected.getByRole('button', { name: 'Change' }).tap();
    await expect(page.getByRole('combobox', { name: label, exact: true })).toBeVisible();
  }
  await page.goto('/contacts/new');
  const account = page.getByRole('combobox', { name: 'Account' });
  await account.fill('E2E Picker Account');
  await expect(page.getByRole('listbox').getByRole('option').first()).toBeVisible();
  await page.getByRole('listbox').getByRole('option').first().tap();
  await expectNoPageOverflow(page, '/contacts/new picker');
});

test('Support intake, history, and attachment work on a phone', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'responsive-phone');
  test.setTimeout(180_000);
  await signInAs(page, 'support');
  await page.goto('/support/cases');
  await expect(page.getByRole('heading', { name: 'Support Cases' })).toBeVisible();
  await page.getByRole('link', { name: 'New case' }).click();
  const subject = uniqueName('Responsive case');
  await page.getByLabel('Customer / End User').fill('Responsive customer');
  await page.getByRole('combobox', { name: 'Linked CRM Account (optional)' }).fill(names.account);
  await page.getByRole('listbox').getByRole('option', { name: names.account }).click();
  await page.getByRole('combobox', { name: 'Contact' }).fill('E2E Jane');
  await page.getByRole('listbox').getByRole('option', { name: /E2E Jane Smith/ }).click();
  await page.getByLabel('Subject').fill(subject);
  await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('PHONE');
  await page.getByLabel('Priority').selectOption('HIGH');
  await page.getByLabel('Category').selectOption({ label: names.category });
  await page.getByLabel('Assigned Support Rep').selectOption({ label: 'E2E support' });
  const sku = page.getByRole('combobox', { name: 'Product / SKU' });
  await sku.fill(names.sku);
  await expect(page.getByRole('listbox').getByRole('option').first()).toBeVisible();
  await page.getByRole('listbox').getByRole('option').first().click();
  await page.getByLabel('Status').selectOption('RESOLVED');
  await page.getByRole('textbox', { name: /^Purchased From/ }).fill('Mobile reseller');
  await page.getByLabel('Description').fill('Mobile diagnostic intake.');
  await page.getByRole('button', { name: 'Create case' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Resolution Summary is required' })).toBeVisible();
  await expect(page.getByLabel('Customer / End User')).toHaveValue('Responsive customer');
  await expect(page.getByLabel('Subject')).toHaveValue(subject);
  await expect(page.getByRole('combobox', { name: 'Source', exact: true })).toHaveValue('PHONE');
  await expect(page.getByLabel('Priority')).toHaveValue('HIGH');
  await expect(page.getByRole('textbox', { name: /^Purchased From/ })).toHaveValue('Mobile reseller');
  await expectNoPageOverflow(page, '/support/cases/new validation');
  await page.getByLabel(/Resolution Summary/).fill('Resolved during initial intake.');
  await page.getByRole('button', { name: 'Create case' }).click();
  await expect(page).toHaveURL(/\/support\/cases\/\d+$/);
  const timeline = page.getByRole('region', { name: 'Case Timeline' });
  await timeline.getByRole('button', { name: 'Show timeline' }).click();
  const audit = page.getByRole('region', { name: 'Audit History' });
  await audit.getByRole('button', { name: 'Show audit history' }).click();
  await expectNoPageOverflow(page, '/support/cases/detail history');
  const attachments = page.getByRole('region', { name: 'Attachments' });
  await attachments.getByRole('button', { name: 'Add Attachment' }).click();
  await attachments.getByLabel('File').setInputFiles(resolve(process.cwd(), 'e2e/fixtures/sample.txt'));
  const [uploadResponse] = await Promise.all([
    page.waitForResponse(response => /\/api\/support\/cases\/\d+\/attachments$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST'),
    attachments.getByRole('button', { name: 'Upload', exact: true }).click(),
  ]);
  expect(uploadResponse.ok()).toBe(true);
  await uploadResponse.finished();
  await expect(attachments).toContainText('sample.txt');
  await expect(attachments.getByRole('link', { name: 'Download' })).toBeVisible();
  await expectNoPageOverflow(page, '/support/cases/detail attachment');
  page.once('dialog', dialog => dialog.accept());
  await attachments.getByRole('button', { name: 'Remove' }).click();
  await expect(attachments).toContainText('No attachments have been added');
});

test('list and report filters stay compact without losing state', async ({ page }) => {
  test.setTimeout(180_000);
  await signInAs(page, 'admin');
  const narrow = page.viewportSize()!.width < 1024;
  for (const route of ['/contacts', '/opportunities', '/support/cases', '/price-exceptions', '/reports/support-cases']) {
    await page.goto(route);
    const form = page.locator('main form.responsive-filter-form').first();
    const toggle = form.getByRole('button', { name: /^Show filters/ });
    const search = form.locator('input[name="q"]');
    await expect(search, route).toBeVisible();
    const secondary = form.locator('select').first();
    if (!narrow) {
      await expect(toggle, route).toBeHidden();
      await expect(secondary, route).toBeVisible();
      continue;
    }
    await expect(toggle, route).toHaveAttribute('aria-expanded', 'false');
    await expect(secondary, route).toBeHidden();
    await expect(form.getByRole('button', { name: 'Search', exact: true }), route).toBeVisible();
    const initialUrl = page.url();
    await toggle.click();
    await expect(form.getByRole('button', { name: /^Hide filters/ })).toHaveAttribute('aria-expanded', 'true');
    await expect(secondary, route).toBeVisible();
    expect(page.url(), route).toBe(initialUrl);
    const option = secondary.locator('option').last();
    const value = await option.getAttribute('value');
    if (value) {
      await secondary.selectOption(value);
      await expect(form.getByRole('button', { name: /1 active/ })).toBeVisible();
      await form.getByRole('button', { name: /^Hide filters/ }).click();
      await expect(secondary).toBeHidden();
      await form.getByRole('button', { name: /^Show filters/ }).click();
      await expect(secondary).toHaveValue(value);
    }
    await expectNoPageOverflow(page, route);
  }
});

test('Contacts and Support Cases expose results promptly and clear applied filters', async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 1024);
  await signInAs(page, 'admin');
  for (const [route, field] of [['/contacts', 'active'], ['/support/cases', 'status']] as const) {
    await page.goto(route);
    const form = page.locator('main form.responsive-filter-form').first();
    const results = page.locator(route === '/contacts' ? 'main .panel.overflow-x-auto' : 'main .grid.lg\\:hidden').first();
    const box = await results.boundingBox();
    expect(box, `${route} results`).not.toBeNull();
    expect(box!.y, `${route} results start`).toBeLessThan(page.viewportSize()!.height);
    await form.getByRole('button', { name: /^Show filters/ }).click();
    const select = form.locator(`select[name="${field}"]`);
    const nonDefault = await select.locator('option').nth(1).getAttribute('value');
    expect(nonDefault).toBeTruthy();
    await select.selectOption(nonDefault!);
    await form.getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(new RegExp(`${field}=`));
    await expect(form.getByRole('button', { name: /1 active/ })).toBeVisible();
    await form.getByRole('link', { name: 'Clear', exact: true }).first().click();
    await expect(page).toHaveURL(route);
    await expect(form.getByRole('button', { name: /^Show filters/ })).toBeVisible();
  }
});

test('expanded Opportunity filter picker remains inside the viewport', async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 1024);
  await signInAs(page, 'admin');
  await page.goto('/opportunities');
  const form = page.locator('main form.responsive-filter-form').first();
  await form.getByRole('button', { name: /^Show filters/ }).click();
  const picker = form.getByRole('combobox', { name: 'Participating Account' });
  await picker.fill(names.account);
  const menu = page.getByRole('listbox');
  await expect(menu.getByRole('option').first()).toBeVisible();
  const bounds = await menu.boundingBox();
  const viewport = page.viewportSize()!;
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
  await menu.getByRole('option').first().click();
  await expect(form.locator('input[name="accountId"]')).not.toHaveValue('');
  await form.getByRole('button', { name: /^Hide filters/ }).click();
  await form.getByRole('button', { name: /^Show filters/ }).click();
  await expect(form.locator('input[name="accountId"]')).not.toHaveValue('');
  await expectNoPageOverflow(page, '/opportunities expanded filter picker');
});

test('Search text and displayed Contact results survive disclosure toggles', async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 1024);
  await signInAs(page, 'admin');
  await page.goto('/contacts');
  const form = page.locator('main form.responsive-filter-form').first();
  const search = form.locator('input[name="q"]');
  const firstResult = page.locator('main .panel.overflow-x-auto tbody tr').first();
  const before = await firstResult.textContent();
  await search.fill('Ada');
  await expect(form.getByRole('button', { name: 'Show filters, 1 active' })).toBeVisible();
  const url = page.url();
  await form.getByRole('button', { name: /^Show filters/ }).click();
  await form.getByRole('button', { name: /^Hide filters/ }).click();
  await expect(search).toHaveValue('Ada');
  expect(await firstResult.textContent()).toBe(before);
  expect(page.url()).toBe(url);
});

test('filter groups without Search collapse as a whole', async ({ page }) => {
  await signInAs(page, 'admin');
  for (const route of ['/pipeline', '/trade-shows/my-leads']) {
    await page.goto(route);
    const form = page.locator('main form.responsive-filter-form').first();
    const secondary = form.locator('select').first();
    const toggle = form.getByRole('button', { name: /^Show filters/ });
    if (page.viewportSize()!.width >= 1024) {
      await expect(toggle).toBeHidden();
      await expect(secondary).toBeVisible();
      continue;
    }
    await expect(toggle).toBeVisible();
    await expect(secondary).toBeHidden();
    await toggle.click();
    await expect(secondary).toBeVisible();
    await expectNoPageOverflow(page, route);
  }
});

test('Recent Items stays within the viewport and supports touch dismissal', async ({ page, isMobile }, testInfo) => {
  await signInAs(page, 'admin');
  // Compile the local development endpoint before interaction timing assertions.
  expect((await page.request.get('/api/recent-items')).ok()).toBe(true);
  const trigger = page.getByRole('button', { name: 'Recent Items', exact: true });
  if (isMobile) await trigger.tap(); else await trigger.click();
  const popover = page.getByRole('region', { name: 'Recent Items' });
  await expect(popover).toBeVisible();
  await expect(popover.getByRole('status')).toHaveCount(0);
  const box = await popover.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  await expectNoPageOverflow(page, 'Recent Items');
  await page.screenshot({ path: testInfo.outputPath('recent-items.png') });
  if (isMobile) await page.touchscreen.tap(8, viewport.height - 8); else await page.mouse.click(8, viewport.height - 8);
  await expect(popover).toHaveCount(0);
  if (isMobile) await trigger.tap(); else await trigger.click();
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('User account menu fits the responsive header and supports touch dismissal', async ({ page, isMobile }) => {
  await signInAs(page, 'admin');
  const header = page.locator('header');
  const trigger = header.getByRole('button', { name: /^User account:/ });
  const menu = page.getByRole('navigation', { name: 'User account', exact: true });
  await expect(trigger).toBeVisible();
  await expectNoPageOverflow(page, 'User account header');
  await (isMobile ? trigger.tap() : trigger.click());
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await (isMobile ? page.getByRole('main').tap({ position: { x: 20, y: 20 } }) : page.getByRole('main').click({ position: { x: 20, y: 20 } }));
  await expect(menu).toHaveCount(0);
  await (isMobile ? trigger.tap() : trigger.click());
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await (isMobile ? trigger.tap() : trigger.click());
  const integrations = menu.getByRole('link', { name: 'My integrations' });
  await (isMobile ? integrations.tap() : integrations.click());
  await expect(page).toHaveURL('/my-integrations');
  await expect(menu).toHaveCount(0);
});
