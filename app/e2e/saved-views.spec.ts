import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';
import { databaseUrl, emails } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
test.afterAll(async () => { await db.savedView.deleteMany({ where: { name: { startsWith: 'E2E saved' } } }); await db.$disconnect(); });

test('Opportunity view restores search, resets page, and marks edits Modified', async ({ page }) => {
  await signInAs(page, 'admin');
  const viewName = uniqueName('E2E saved opportunity');
  await page.goto('/opportunities?q=E2E&page=3');
  await page.locator('.saved-views-menu summary').click();
  await page.getByRole('button', { name: 'Save current view' }).click();
  await page.getByRole('dialog', { name: 'Save current view' }).getByRole('textbox', { name: 'View name' }).fill(viewName);
  await page.getByRole('button', { name: 'Save view' }).click();
  await expect(page.locator('.saved-views-menu summary')).toContainText(viewName);
  await page.goto('/accounts');
  await page.goto('/opportunities');
  await page.locator('.saved-views-menu summary').click();
  await page.getByRole('button', { name: viewName }).click();
  await expect(page).toHaveURL(/\/opportunities\?q=E2E$/);
  await expect(page.locator('form[aria-label="Filter opportunities"] input[name="q"]')).toHaveValue('E2E');
  await page.locator('form[aria-label="Filter opportunities"] input[name="q"]').fill('changed');
  await expect(page.locator('.saved-views-menu summary')).toContainText('Modified');
  expect((await db.savedView.findFirstOrThrow({ where: { name: viewName } })).queryState).toEqual({ q: 'E2E' });
});

test('Opportunity Close Period views preserve relative, explicit, and custom choices', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAs(page, 'admin');
  const cases = [
    { query: 'closePeriod=current-quarter&forecastCategory=COMMIT', period: 'current-quarter', category: 'COMMIT', name: uniqueName('E2E saved current quarter') },
    { query: 'closePeriod=next-quarter&forecastCategory=PIPELINE', period: 'next-quarter', category: 'PIPELINE', name: uniqueName('E2E saved next quarter') },
    { query: 'closePeriod=2027-Q1', period: '2027-Q1', name: uniqueName('E2E saved explicit quarter') },
    { query: 'closePeriod=custom&closeFrom=2027-01-10&closeTo=2027-02-20', period: 'custom', from: '2027-01-10', through: '2027-02-20', name: uniqueName('E2E saved custom quarter') },
  ];
  for (const item of cases) {
    await page.goto(`/opportunities?${item.query}`);
    await page.locator('.saved-views-menu summary').click();
    await page.getByRole('button', { name: 'Save current view' }).click();
    await page.getByRole('dialog', { name: 'Save current view' }).getByRole('textbox', { name: 'View name' }).fill(item.name);
    await page.getByRole('button', { name: 'Save view' }).click();
    await expect(page.getByRole('dialog', { name: 'Save current view' })).toHaveCount(0);
    const stored = await db.savedView.findFirstOrThrow({ where: { name: item.name } });
    expect(stored.queryState).toEqual({ closePeriod: item.period, ...(item.category ? { forecastCategory: item.category } : {}), ...(item.from ? { closeFrom: item.from, closeTo: item.through } : {}) });
    await page.goto('/opportunities');
    await page.locator('.saved-views-menu summary').click();
    await page.getByRole('button', { name: item.name }).click();
    const form = page.getByRole('form', { name: 'Filter opportunities' });
    await expect(form.getByRole('combobox', { name: 'Close Period' })).toHaveValue(item.period);
    if (item.from) {
      await expect(form.getByLabel('Close Date From')).toHaveValue(item.from);
      await expect(form.getByLabel('Close Date Through')).toHaveValue(item.through!);
    } else await expect(form.getByLabel('Close Date From')).toHaveCount(0);
    await form.getByRole('combobox', { name: 'Close Period' }).selectOption('');
    await expect(page.locator('.saved-views-menu summary')).toContainText('Modified');
  }
  const currentView = await db.savedView.findFirstOrThrow({ where: { name: cases[0].name } });
  const defaultRequest = (isDefault: boolean) => page.request.patch('/api/saved-views', { headers: { origin: 'http://127.0.0.1:3100' }, data: { routeKey: 'opportunities', id: currentView.id, action: 'default', isDefault } });
  try {
    expect((await defaultRequest(true)).ok()).toBe(true);
    await page.goto('/opportunities?closePeriod=current-quarter');
    await page.getByRole('form', { name: 'Filter opportunities' }).getByRole('link', { name: 'Clear' }).click();
    await expect(page).toHaveURL(/\/opportunities\?closePeriod=$/);
    await expect(page.getByRole('combobox', { name: 'Close Period' })).toHaveValue('');
  } finally { expect((await defaultRequest(false)).ok()).toBe(true); }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/opportunities?closeFrom=2026-10-01&closeTo=2026-12-31');
  await expect(page.getByRole('button', { name: /Show filters, 1 active/ })).toBeVisible();
  await page.getByRole('button', { name: /Show filters, 1 active/ }).click();
  await expect(page.getByRole('combobox', { name: 'Close Period' })).toHaveValue('custom');
});

test('Opportunity Close Period stays compact and custom dates appear only when selected', async ({ page }) => {
  test.setTimeout(90_000);
  await signInAs(page, 'admin');
  for (const [width, height] of [[390, 844], [768, 1024], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/opportunities?closePeriod=current-quarter');
    const form = page.getByRole('form', { name: 'Filter opportunities' });
    if (width < 1024) await page.getByRole('button', { name: /Show filters, 1 active/ }).click();
    await expect(form.getByRole('combobox', { name: 'Close Period' })).toBeVisible();
    await expect(form.getByLabel('Close Date From')).toHaveCount(0);
    await form.getByRole('combobox', { name: 'Close Period' }).selectOption('custom');
    await expect(form.getByLabel('Close Date From')).toBeVisible();
    await expect(form.getByLabel('Close Date Through')).toBeVisible();
    await form.getByLabel('Close Date From').fill('2026-11-15');
    await form.getByLabel('Close Date Through').fill('2026-12-15');
    if (width < 1024) await expect(page.getByRole('button', { name: /filters, 1 active/i })).toBeVisible();
    await form.getByRole('combobox', { name: 'Close Period' }).selectOption('2026-Q4');
    await expect(form.getByLabel('Close Date From')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await form.getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/closePeriod=2026-Q4/);
    if (width < 1024) await page.locator('.filter-disclosure-clear').click();
    else await form.locator('.btn-filter-secondary').click();
    await expect(page).toHaveURL(/\/opportunities\?closePeriod=$/);
    if (width < 1024) await page.getByRole('button', { name: 'Show filters' }).click();
    await expect(form.getByRole('combobox', { name: 'Close Period' })).toHaveValue('');
  }
});

test('Opportunity Project filter keeps Project and No Project exclusive and restores No Project views', async ({ page }) => {
  await signInAs(page, 'admin');
  const project = await db.project.findFirstOrThrow({ where: { name: 'E2E Picker Project' }, select: { id: true, name: true } });
  const opportunity = await db.opportunity.findFirstOrThrow({ where: { name: 'E2E Picker Opportunity' }, select: { id: true, name: true } });
  const existingLink = await db.opportunityProject.findUnique({ where: { opportunityId_projectId: { opportunityId: opportunity.id, projectId: project.id } } });
  if (!existingLink) await db.opportunityProject.create({ data: { opportunityId: opportunity.id, projectId: project.id } });
  const form = page.getByRole('form', { name: 'Filter opportunities' });
  const projectValue = form.locator('input[name="projectId"]');
  const noProject = form.getByRole('checkbox', { name: 'Show opportunities with no project' });
  const viewName = uniqueName('E2E saved no project');
  try {
    await page.goto('/opportunities');
    await form.getByRole('combobox', { name: 'Project' }).fill(project.name);
    await page.getByRole('option', { name: /E2E Picker Project\s+E2E Picker Account$/ }).click();
    await expect(projectValue).toHaveValue(String(project.id));
    await expect(noProject).not.toBeChecked();
    await form.getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(new RegExp(`projectId=${project.id}`));
    await expect(page.getByRole('link', { name: opportunity.name, exact: true })).toBeVisible();

    await noProject.check();
    await expect(projectValue).toHaveValue('none');
    await expect(form.getByRole('combobox', { name: 'Project' })).toBeVisible();
    await form.getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/projectId=none/);
    await expect(noProject).toBeChecked();
    await expect(page.getByRole('link', { name: opportunity.name, exact: true })).toHaveCount(0);

    await page.locator('.saved-views-menu summary').click();
    await page.getByRole('button', { name: 'Save current view' }).click();
    await page.getByRole('dialog', { name: 'Save current view' }).getByRole('textbox', { name: 'View name' }).fill(viewName);
    await page.getByRole('button', { name: 'Save view' }).click();
    await expect(page.locator('.saved-views-menu summary')).toContainText(viewName);
    expect((await db.savedView.findFirstOrThrow({ where: { name: viewName } })).queryState).toEqual({ projectId: 'none' });

    await form.locator('.btn-filter-secondary').click();
    await expect(page).toHaveURL(/\/opportunities\?closePeriod=$/);
    await expect(projectValue).toHaveValue('');
    await expect(noProject).not.toBeChecked();
    await page.locator('.saved-views-menu summary').click();
    await page.getByRole('button', { name: viewName }).click();
    await expect(page).toHaveURL(/projectId=none/);
    await expect(noProject).toBeChecked();
    await expect(projectValue).toHaveValue('none');

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: /Show filters, 1 active/ })).toBeVisible();
    await page.getByRole('button', { name: /Show filters, 1 active/ }).click();
    await expect(noProject).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await form.getByRole('combobox', { name: 'Project' }).fill(project.name);
    await page.getByRole('option', { name: /E2E Picker Project\s+E2E Picker Account$/ }).click();
    await expect(noProject).not.toBeChecked();
    await expect(projectValue).toHaveValue(String(project.id));
    await form.locator('.btn-filter-secondary').click();
    await expect(projectValue).toHaveValue('');
    await expect(noProject).not.toBeChecked();
  } finally {
    if (!existingLink) await db.opportunityProject.delete({ where: { opportunityId_projectId: { opportunityId: opportunity.id, projectId: project.id } } });
  }
});

test('Task default applies once, explicit query wins, and defaults are unique', async ({ page }) => {
  await signInAs(page, 'admin');
  const admin = await db.user.findUniqueOrThrow({ where: { email: emails.admin } });
  const dueTo = new Date().toISOString().slice(0, 10);
  const first = uniqueName('E2E saved My overdue tasks'), second = uniqueName('E2E saved task second');
  await page.goto(`/tasks?assignedToId=${admin.id}&dueTo=${dueTo}`);
  await page.locator('.saved-views-menu summary').click(); await page.getByRole('button', { name: 'Save current view' }).click();
  await page.getByRole('dialog', { name: 'Save current view' }).getByRole('textbox', { name: 'View name' }).fill(first);
  await page.getByRole('checkbox', { name: 'Make this my default view' }).check();
  await page.getByRole('button', { name: 'Save view' }).click();
  await page.goto('/tasks'); await expect(page).toHaveURL(new RegExp(`/tasks\\?assignedToId=${admin.id}&dueTo=${dueTo}$`));
  await page.goto('/tasks?priority=HIGH'); await expect(page).toHaveURL(/\/tasks\?priority=HIGH$/);
  await page.locator('.saved-views-menu summary').click(); await page.getByRole('button', { name: 'Save current view' }).click();
  await page.getByRole('dialog', { name: 'Save current view' }).getByRole('textbox', { name: 'View name' }).fill(second);
  await page.getByRole('checkbox', { name: 'Make this my default view' }).check(); await page.getByRole('button', { name: 'Save view' }).click();
  expect(await db.savedView.count({ where: { userId: admin.id, routeKey: 'tasks', isDefault: true } })).toBe(1);
  await page.goto('/tasks'); await expect(page).toHaveURL(/\/tasks\?priority=HIGH$/);
  await page.goto('/accounts'); await page.goto('/tasks'); await expect(page).toHaveURL(/\/tasks\?priority=HIGH$/);
  await page.goBack(); await expect(page).toHaveURL(/\/accounts$/);
  await signInAs(page, 'sales'); await page.goto('/tasks'); await expect(page).toHaveURL(/\/tasks$/);
  const salesName = uniqueName('E2E saved sales task default');
  const created = await page.request.post('/api/saved-views', { headers: { origin: 'http://127.0.0.1:3100' }, data: { routeKey: 'tasks', name: salesName, query: { priority: 'LOW' }, isDefault: true } });
  expect(created.ok()).toBe(true);
  await page.goto('/tasks'); await expect(page).toHaveURL(/\/tasks\?priority=LOW$/);
  await signInAs(page, 'admin'); await page.goto('/tasks'); await expect(page).toHaveURL(/\/tasks\?priority=HIGH$/);
});

test('Account entity filter restores, foreign views are hidden, and mobile Filters stay closed', async ({ page }) => {
  await signInAs(page, 'admin');
  const name = uniqueName('E2E saved contact');
  const account = await db.account.findFirstOrThrow({ where: { archivedAt: null }, select: { id: true } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/contacts?accountId=${account.id}`);
  await expect(page.getByRole('button', { name: /Show filters/ })).toHaveAttribute('aria-expanded', 'false');
  await page.locator('.saved-views-menu summary').click(); await page.getByRole('button', { name: 'Save current view' }).click();
  await page.getByRole('dialog', { name: 'Save current view' }).getByRole('textbox', { name: 'View name' }).fill(name); await page.getByRole('button', { name: 'Save view' }).click();
  await page.goto('/contacts'); await page.locator('.saved-views-menu summary').click(); await page.getByRole('button', { name }).click();
  await expect(page).toHaveURL(new RegExp(`accountId=${account.id}`));
  await expect(page.getByRole('button', { name: /Show filters/ })).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  const view = await db.savedView.findFirstOrThrow({ where: { name } });
  const previous = await db.account.findUniqueOrThrow({ where: { id: account.id }, select: { archivedAt: true, status: true } });
  try {
    await db.account.update({ where: { id: account.id }, data: { archivedAt: new Date(), status: 'ARCHIVED' } });
    const stale = await page.request.get('/api/saved-views?route=contacts');
    const staleView = (await stale.json()).views.find((row: { id: number }) => row.id === view.id);
    expect(staleView.query).toEqual({});
    expect(staleView.omitted).toContain('Account');
  } finally { await db.account.update({ where: { id: account.id }, data: { archivedAt: previous.archivedAt, status: previous.status } }); }
  await signInAs(page, 'sales');
  const response = await page.request.get('/api/saved-views?route=contacts');
  expect((await response.json()).views.some((row: { id: number }) => row.id === view.id)).toBe(false);
  const denied = await page.request.delete('/api/saved-views', { headers: { origin: 'http://127.0.0.1:3100' }, data: { routeKey: 'contacts', id: view.id } });
  expect(denied.status()).toBe(404);
  const deniedEdit = await page.request.patch('/api/saved-views', { headers: { origin: 'http://127.0.0.1:3100' }, data: { routeKey: 'contacts', id: view.id, action: 'rename', name: 'stolen' } });
  expect(deniedEdit.status()).toBe(404);
});

test('Saved Views control and dialog fit phone, tablet, and desktop', async ({ page }) => {
  await signInAs(page, 'admin');
  for (const [width, height] of [[390, 844], [768, 1024], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/tasks?priority=HIGH');
    const summary = page.locator('.saved-views-menu summary');
    await expect(summary).toBeVisible();
    if (width < 1024) {
      await expect(page.getByRole('button', { name: /Show filters, 1 active/ })).toHaveAttribute('aria-expanded', 'false');
    }
    await summary.click(); await page.getByRole('button', { name: 'Manage views' }).click();
    const bounds = await page.getByRole('dialog', { name: 'Manage saved views' }).boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await page.getByRole('dialog', { name: 'Manage saved views' }).getByRole('button', { name: 'Close' }).click();
  }
});

test('Manage views can rename, set and clear default, then delete', async ({ page }) => {
  await signInAs(page, 'admin');
  const original = uniqueName('E2E saved demo'), renamed = uniqueName('E2E saved renamed demo');
  await page.goto('/demos?q=sample');
  await page.locator('.saved-views-menu summary').click(); await page.getByRole('button', { name: 'Save current view' }).click();
  await page.getByRole('dialog', { name: 'Save current view' }).getByRole('textbox', { name: 'View name' }).fill(original);
  await page.getByRole('button', { name: 'Save view' }).click();
  await page.locator('.saved-views-menu summary').click(); await page.getByRole('button', { name: 'Manage views' }).click();
  const manage = page.getByRole('dialog', { name: 'Manage saved views' });
  page.once('dialog', dialog => dialog.accept(renamed)); await manage.getByRole('button', { name: 'Rename' }).click();
  await expect(manage).toContainText(renamed);
  await manage.getByRole('button', { name: 'Make default' }).click(); await expect(manage).toContainText('Default');
  await manage.getByRole('button', { name: 'Clear default' }).click(); await expect(manage).not.toContainText('· Default');
  page.once('dialog', dialog => dialog.accept()); await manage.getByRole('button', { name: 'Delete' }).click();
  await expect(manage).toContainText('No saved views yet');
});
