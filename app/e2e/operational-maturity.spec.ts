import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';
import { databaseUrl, emails, names } from './constants.mjs';
import { signInAs } from './helpers';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const key = `E2E-OPS-${Date.now()}`;
let caseId: number;
let noticeId: number;
let supportId: number;
let supportTimeZone: string;

test.beforeAll(async () => {
  const support = await db.user.findUniqueOrThrow({ where: { email: emails.support } });
  supportId = support.id;
  supportTimeZone = support.timeZone;
  const row = await db.supportCase.create({ data: { caseNumber: `BXS-2026-${String(Date.now() % 1000000).padStart(6, '0')}`, customerNameText: names.account, subject: `${key} search case`, description: 'E2E search fixture', source: 'PHONE', createdById: supportId, updatedById: supportId } });
  caseId = row.id;
  const notice = await db.notification.create({ data: { userId: supportId, type: 'SUPPORT_ASSIGNMENT', severity: 'WARNING', title: `${key} attention`, message: 'Operational test notice', entityType: 'SUPPORT_CASE', entityId: caseId, actionUrl: `/support/cases/${caseId}`, sourceKey: key } });
  noticeId = notice.id;
});
test.afterAll(async () => {
  await db.notification.deleteMany({ where: { sourceKey: { startsWith: key } } });
  await db.supportCase.deleteMany({ where: { id: caseId } });
  await db.notificationPreference.deleteMany({ where: { userId: supportId, category: 'SUPPORT_CASE' } });
  await db.scheduledJobRun.deleteMany({ where: { resultSummary: key } });
  await db.user.update({ where: { id: supportId }, data: { timeZone: supportTimeZone } });
  await db.$disconnect();
});

test('global palette opens, searches core entities, selects with keyboard, and closes', async ({ page }) => {
  await signInAs(page, 'admin');
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search SalesHub' });
  await expect(dialog).toBeVisible();
  const search = dialog.getByRole('combobox');
  await search.fill('E2E Picker Account');
  await expect(dialog.getByRole('group', { name: 'Accounts' }).getByRole('option').first()).toBeVisible();
  await search.press('ArrowDown');
  await expect(dialog.getByRole('option', { selected: true })).toHaveCount(1);
  await search.press('Enter');
  await expect(page).toHaveURL(/\/accounts\/\d+$/);
  await page.keyboard.press('Control+k');
  await search.fill('E2E Jane');
  await expect(dialog.getByRole('group', { name: 'Contacts' }).getByRole('option').first()).toContainText('E2E Jane Smith');
  await search.fill('E2E Picker Opportunity');
  await expect(dialog.getByRole('group', { name: 'Opportunities' }).getByRole('option').first()).toBeVisible();
  await search.fill(key);
  await expect(dialog.getByRole('group', { name: 'Support Cases' }).getByRole('option').first()).toBeVisible();
  await search.fill(names.sku);
  await expect(dialog.getByRole('group', { name: 'Products' }).getByRole('option').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Search SalesHub' })).toBeFocused();
});

test('global search permits cross-owner Sales viewing and works at phone width', async ({ page }) => {
  await signInAs(page, 'sales');
  const response = await page.request.get('/api/global-search?q=E2E%20Picker%20Opportunity');
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).results.some((row: { group: string }) => row.group === 'Opportunities')).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Search SalesHub' }).click();
  await page.getByRole('dialog', { name: 'Search SalesHub' }).getByRole('combobox').fill(names.account);
  await expect(page.getByRole('group', { name: 'Accounts' }).getByRole('option').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test('Admin health displays conservative recorded states without secrets; non-Admin is denied', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAs(page, 'admin');
  await page.goto('/administration/system-health', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'System Health' })).toBeVisible();
  const evaluator = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Notification Evaluator', exact: true }) }).first();
  await expect(evaluator.getByText('Stale', { exact: true })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/DATABASE_URL|saleshub_e2e_local_only|AUTH_SECRET|SPACES_SECRET/);
  const run = await db.scheduledJobRun.create({ data: { jobType: 'NOTIFICATION_EVALUATOR', status: 'FAILED', startedAt: new Date(), completedAt: new Date(), resultSummary: key, errorSummary: 'Evaluator failed.' } });
  await page.reload();
  await expect(evaluator.getByText('Failed', { exact: true })).toBeVisible();
  await db.scheduledJobRun.update({ where: { id: run.id }, data: { status: 'SUCCEEDED', completedAt: new Date(), errorSummary: null } });
  await page.reload();
  await expect(evaluator.getByText('Healthy', { exact: true })).toBeVisible();
  await db.scheduledJobRun.update({ where: { id: run.id }, data: { completedAt: new Date(Date.now() - 49 * 3600000) } });
  await page.reload();
  await expect(evaluator.getByText('Stale', { exact: true })).toBeVisible();
  await signInAs(page, 'sales');
  await page.goto('/administration/system-health');
  await expect(page).not.toHaveURL(/\/administration\/system-health$/);
});

test('preferences suppress without dismissing; snooze and explicit states survive off/on', async ({ page }) => {
  await db.user.update({ where: { id: supportId }, data: { timeZone: 'America/Los_Angeles' } });
  const critical = await db.notification.create({ data: { userId: supportId, type: 'SUPPORT_CRITICAL', severity: 'CRITICAL', title: `${key} critical`, message: 'Critical test notice', entityType: 'SUPPORT_CASE', entityId: caseId, actionUrl: `/support/cases/${caseId}`, sourceKey: `${key}:critical` } });
  const dismissed = await db.notification.create({ data: { userId: supportId, type: 'SUPPORT_ASSIGNED', severity: 'INFO', title: `${key} dismissed`, message: 'Dismissed test notice', entityType: 'SUPPORT_CASE', entityId: caseId, actionUrl: `/support/cases/${caseId}`, sourceKey: `${key}:dismissed`, dismissedAt: new Date() } });
  const resolved = await db.notification.create({ data: { userId: supportId, type: 'SUPPORT_FOLLOW_UP_OVERDUE', severity: 'WARNING', title: `${key} resolved`, message: 'Resolved test notice', entityType: 'SUPPORT_CASE', entityId: caseId, actionUrl: `/support/cases/${caseId}`, sourceKey: `${key}:resolved`, resolvedAt: new Date() } });
  await signInAs(page, 'support');
  await page.goto('/notifications');
  const notice = page.locator('article').filter({ hasText: `${key} attention` });
  await expect(notice).toBeVisible();
  await page.goto('/notifications/preferences');
  const supportCheckbox = page.getByRole('checkbox', { name: 'Support' });
  await expect(page.getByRole('button', { name: 'Save preferences' })).toHaveCount(1);
  await expect(supportCheckbox).toBeChecked();
  await supportCheckbox.uncheck();
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByRole('status')).toHaveText('Preferences updated.');
  await expect.poll(async () => (await db.notificationPreference.findUnique({ where: { userId_category: { userId: supportId, category: 'SUPPORT_CASE' } } }))?.enabled).toBe(false);
  expect((await db.notification.findUniqueOrThrow({ where: { id: noticeId } })).dismissedAt).toBeNull();
  await page.goto('/notifications');
  await expect(notice).toBeHidden();
  await expect(page.locator('article').filter({ hasText: `${key} critical` })).toBeVisible();
  await page.getByRole('link', { name: /History/ }).click();
  await expect(notice).toBeVisible();
  await page.goto('/notifications/preferences');
  await page.reload();
  await expect(supportCheckbox).not.toBeChecked();
  await supportCheckbox.check();
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByRole('status')).toHaveText('Preferences updated.');
  await expect.poll(async () => (await db.notificationPreference.findUnique({ where: { userId_category: { userId: supportId, category: 'SUPPORT_CASE' } } }))?.enabled).toBe(true);
  await page.goto('/notifications');
  await expect(notice).toBeVisible();
  await expect(page.locator('article').filter({ hasText: `${key} dismissed` })).toBeHidden();
  await expect(page.locator('article').filter({ hasText: `${key} resolved` })).toBeHidden();
  expect((await db.notification.findUniqueOrThrow({ where: { id: dismissed.id } })).dismissedAt).not.toBeNull();
  expect((await db.notification.findUniqueOrThrow({ where: { id: resolved.id } })).resolvedAt).not.toBeNull();
  expect((await db.notification.findUniqueOrThrow({ where: { id: critical.id } })).dismissedAt).toBeNull();
  await notice.getByRole('button', { name: 'Snooze' }).click();
  await expect(notice).toBeHidden();
  await page.getByRole('link', { name: /History/ }).click();
  const until = (await db.notification.findUniqueOrThrow({ where: { id: noticeId } })).snoozedUntil!;
  await expect(page.locator('article').filter({ hasText: `${key} attention` })).toContainText(`Snoozed until ${until.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' })}`);
  await db.notificationPreference.update({ where: { userId_category: { userId: supportId, category: 'SUPPORT_CASE' } }, data: { enabled: false } });
  await db.notificationPreference.update({ where: { userId_category: { userId: supportId, category: 'SUPPORT_CASE' } }, data: { enabled: true } });
  expect((await db.notification.findUniqueOrThrow({ where: { id: noticeId } })).snoozedUntil?.getTime()).toBe(until.getTime());
  await page.goto('/notifications');
  await expect(notice).toBeHidden();
  await db.notification.update({ where: { id: noticeId }, data: { snoozedUntil: new Date(Date.now() - 1000) } });
  await page.goto('/notifications');
  await expect(page.locator('article').filter({ hasText: `${key} attention` })).toBeVisible();
});

test('preferences save multiple category changes together', async ({ page }) => {
  const categories = ['TASK', 'OPPORTUNITY'] as const;
  const original = await db.notificationPreference.findMany({ where: { userId: supportId, category: { in: [...categories] } } });
  try {
    await signInAs(page, 'support');
    await page.goto('/notifications/preferences');
    const tasks = page.getByRole('checkbox', { name: 'Tasks' });
    const opportunities = page.getByRole('checkbox', { name: 'Opportunities' });
    const nextTasks = !(await tasks.isChecked());
    const nextOpportunities = !(await opportunities.isChecked());
    await tasks.setChecked(nextTasks);
    await opportunities.setChecked(nextOpportunities);
    await expect(page.getByRole('button', { name: 'Save preferences' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect(page.getByRole('status')).toHaveText('Preferences updated.');
    await page.reload();
    await expect(tasks).toBeChecked({ checked: nextTasks });
    await expect(opportunities).toBeChecked({ checked: nextOpportunities });
    const saved = await db.notificationPreference.findMany({ where: { userId: supportId, category: { in: [...categories] } } });
    expect(saved.find(row => row.category === 'TASK')?.enabled).toBe(nextTasks);
    expect(saved.find(row => row.category === 'OPPORTUNITY')?.enabled).toBe(nextOpportunities);
  } finally {
    await db.notificationPreference.deleteMany({ where: { userId: supportId, category: { in: [...categories] } } });
    for (const row of original) await db.notificationPreference.create({ data: { userId: row.userId, category: row.category, enabled: row.enabled } });
  }
});

test('new pages and palette have no document overflow at phone, tablet, or desktop widths', async ({ page }) => {
  await signInAs(page, 'admin');
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : width === 768 ? 1024 : 900 });
    for (const route of ['/administration/system-health', '/notifications/preferences', '/notifications']) {
      await page.goto(route);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${width} ${route}`).toBe(true);
    }
    await page.getByRole('button', { name: 'Search SalesHub' }).click();
    const dialog = page.getByRole('dialog', { name: 'Search SalesHub' });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    await page.keyboard.press('Escape');
  }
});
