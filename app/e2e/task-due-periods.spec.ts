import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';
import { databaseUrl, emails } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';
import { addCalendarDays, businessToday } from '../lib/business-date';
import { taskWhere } from '../lib/work';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
test.use({ timezoneId: 'Asia/Tokyo' });
const prefix = uniqueName('E2E rolling tasks');
const viewPrefix = uniqueName('E2E rolling view');
let assignee: number;
test.beforeAll(async () => {
  assignee = (await db.user.findUniqueOrThrow({ where: { email: emails.sales } })).id;
  const other = (await db.user.findUniqueOrThrow({ where: { email: emails.admin } })).id;
  const today = businessToday();
  await db.task.createMany({ data: [
    ...[-8, -1, 0, 1, 6, 7, 8, 30].map(offset => ({ subject: `${prefix} day ${offset}`, assignedToId: assignee, dueDate: addCalendarDays(today, offset) })),
    { subject: `${prefix} undated`, assignedToId: assignee },
    ...[-1, 0, 7].map(offset => ({ subject: `${prefix} completed ${offset}`, assignedToId: assignee, dueDate: addCalendarDays(today, offset), status: 'COMPLETED' as const })),
    { subject: `${prefix} other owner`, assignedToId: other, dueDate: today },
  ] });
});
test.afterAll(async () => {
  await db.savedView.deleteMany({ where: { name: { startsWith: viewPrefix } } });
  await db.task.deleteMany({ where: { subject: { startsWith: prefix } } });
  await db.$disconnect();
});

test('each period filters rows with assignee, excludes undated/completed, and preserves explicit status and custom dates', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAs(page, 'admin');
  await page.goto(`/tasks?q=${encodeURIComponent(prefix)}&assignedToId=${assignee}`);
  const form = page.getByRole('form', { name: 'Filter tasks' });
  for (const period of ['overdue', 'today', 'next-7-days', 'this-week']) {
    await form.getByLabel('Due date', { exact: true }).selectOption(period);
    await form.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`duePeriod=${period}`));
    const expected = await db.task.findMany({ where: taskWhere({ q: prefix, assignedToId: String(assignee), duePeriod: period }), orderBy: [{ dueDate: 'asc' }, { id: 'desc' }] });
    await expect(page.locator('tbody tr td:nth-child(2) a')).toHaveText(expected.map(row => row.subject));
    await expect(page.getByText(`${expected.length} tasks · Page 1 of 1`, { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: `${prefix} undated`, exact: true })).toHaveCount(0);
    await expect(page.locator('tbody')).not.toContainText('completed');
  }
  await form.getByLabel('Due date', { exact: true }).selectOption('today');
  await form.locator('select[name="status"]').selectOption('COMPLETED');
  await form.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('link', { name: `${prefix} completed 0`, exact: true })).toBeVisible();
  await form.locator('select[name="status"]').selectOption('');
  await form.getByLabel('Due date', { exact: true }).selectOption('custom');
  const today = businessToday().toISOString().slice(0, 10);
  await form.getByLabel('Due Date From').fill(today);
  await form.getByLabel('Due Date Through').fill(today);
  await form.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('link', { name: `${prefix} day 0`, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: `${prefix} completed 0`, exact: true })).toBeVisible();
  await form.getByLabel('Due date', { exact: true }).selectOption('');
  await form.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('link', { name: `${prefix} undated`, exact: true })).toBeVisible();
});

test('Saved Views store the period, restore it after reload, and Clear overrides a relative default', async ({ page }) => {
  test.setTimeout(150_000);
  await signInAs(page, 'admin');
  for (const period of ['overdue', 'today', 'next-7-days', 'this-week']) {
    const name = `${viewPrefix} ${period}`;
    await page.goto(`/tasks?assignedToId=${assignee}&dueFrom=2020-01-01&dueTo=2020-02-01`);
    const form = page.getByRole('form', { name: 'Filter tasks' });
    await expect(form.getByLabel('Due date', { exact: true })).toHaveValue('custom');
    // Save an unapplied filter change too: the submitted meaning must win.
    await form.getByLabel('Due date', { exact: true }).selectOption(period);
    await page.locator('.saved-views-menu summary').click();
    await page.getByRole('button', { name: 'Save current view' }).click();
    await page.getByRole('dialog', { name: 'Save current view' }).getByLabel('View name').fill(name);
    await page.getByRole('button', { name: 'Save view', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Save current view' })).toHaveCount(0);
    expect((await db.savedView.findFirstOrThrow({ where: { name } })).queryState).toEqual({ assignedToId: String(assignee), duePeriod: period });
    await page.goto('/tasks?duePeriod=');
    await page.reload();
    await page.locator('.saved-views-menu summary').click();
    await page.getByRole('button', { name, exact: true }).click();
    await expect(form.getByLabel('Due date', { exact: true })).toHaveValue(period);
    await expect(page).toHaveURL(new RegExp(`duePeriod=${period}`));
    await page.reload();
    await expect(form.getByLabel('Due date', { exact: true })).toHaveValue(period);
    await expect(form.locator('select[name="assignedToId"]')).toHaveValue(String(assignee));
    await expect(form.getByLabel('Due Date From')).toHaveCount(0);
  }
  const refreshedSubject = `${prefix} same-view refresh`;
  await db.task.create({ data: { subject: refreshedSubject, assignedToId: assignee, dueDate: businessToday() } });
  await page.locator('.saved-views-menu summary').click();
  await page.getByRole('button', { name: `${viewPrefix} this-week`, exact: true }).click();
  await expect(page.getByRole('link', { name: refreshedSubject, exact: true })).toBeVisible();
  const view = await db.savedView.findFirstOrThrow({ where: { name: `${viewPrefix} overdue` } });
  const updateDefault = (isDefault: boolean) => page.request.patch('/api/saved-views', { headers: { origin: 'http://127.0.0.1:3100' }, data: { routeKey: 'tasks', id: view.id, action: 'default', isDefault } });
  try {
    expect((await updateDefault(true)).ok()).toBe(true);
    await page.goto('/tasks');
    await expect(page).toHaveURL(/duePeriod=overdue/);
    await page.getByRole('form', { name: 'Filter tasks' }).getByRole('link', { name: 'Clear', exact: true }).click();
    await expect(page).toHaveURL(/\/tasks\?duePeriod=$/);
    await expect(page.getByLabel('Due date', { exact: true })).toHaveValue('');
  } finally { expect((await updateDefault(false)).ok()).toBe(true); }
});

test('relative database criteria give matching counts, ordered rows and pagination', async ({ page }) => {
  await signInAs(page, 'sales');
  const subject = `${prefix} pagination`;
  await db.task.createMany({ data: Array.from({ length: 25 }, (_, i) => ({ subject: `${subject} ${i}`, dueDate: businessToday(), assignedToId: assignee })) });
  const expected = await db.task.findMany({ where: { subject: { startsWith: subject } }, orderBy: [{ dueDate: 'asc' }, { id: 'desc' }] });
  await page.goto(`/tasks?q=${encodeURIComponent(subject)}&assignedToId=${assignee}&duePeriod=today`);
  await expect(page.getByText('25 tasks · Page 1 of 2', { exact: true })).toBeVisible();
  await expect(page.locator('tbody tr td:nth-child(2) a')).toHaveText(expected.slice(0, 20).map(row => row.subject));
  await page.getByRole('link', { name: 'Next', exact: true }).click();
  await expect(page).toHaveURL(/duePeriod=today/);
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByText('25 tasks · Page 2 of 2', { exact: true })).toBeVisible();
  await expect(page.locator('tbody tr td:nth-child(2) a')).toHaveText(expected.slice(20).map(row => row.subject));
  await page.getByRole('link', { name: 'Previous', exact: true }).click();
  await expect(page.getByText('25 tasks · Page 1 of 2', { exact: true })).toBeVisible();
});

test('period controls and custom range fit phone, tablet and desktop across browser timezones', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await signInAs(page, 'admin');
  for (const [width, height] of [[390, 844], [768, 1024], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/tasks?duePeriod=next-7-days');
    await expect(page.locator('select[name="duePeriod"]')).toBeEnabled();
    if (width < 1024) await page.getByRole('button', { name: /Show filters, 1 active/ }).click();
    const form = page.getByRole('form', { name: 'Filter tasks' });
    await expect(form.getByLabel('Due date', { exact: true })).toBeVisible();
    await expect(form.getByLabel('Due Date From')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`rolling-tasks-${width}.png`), fullPage: true });
    await form.getByLabel('Due date', { exact: true }).selectOption('custom');
    await expect(form.getByLabel('Due Date From')).toBeVisible();
    await expect(form.getByLabel('Due Date Through')).toBeVisible();
    await form.getByLabel('Due Date From').fill('2026-10-01');
    await form.getByLabel('Due Date Through').fill('2026-10-31');
    if (width < 1024) await expect(page.getByRole('button', { name: /Hide filters, 1 active/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`custom-tasks-${width}.png`), fullPage: true });
  }
  // Permissions still control bulk actions independently of the period filter.
  await signInAs(page, 'readOnly');
  await page.goto(`/tasks?q=${encodeURIComponent(prefix)}&duePeriod=today`);
  await expect(page.getByRole('link', { name: 'New task', exact: true })).toHaveCount(0);
  await expect(page.locator('tbody input[type="checkbox"]')).toHaveCount(0);
  await expect(page.locator('tbody')).toContainText(prefix);
});
