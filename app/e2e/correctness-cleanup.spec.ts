import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';
import { baseURL, databaseUrl, emails } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const tag = uniqueName('Correctness cleanup');
let salesId: number, managerId: number, adminId: number;
let accountId: number, projectId: number, opportunityId: number, stageId: number, taskId: number, noteId: number;

test.beforeAll(async () => {
  salesId = (await db.user.findUniqueOrThrow({ where: { email: emails.sales } })).id;
  managerId = (await db.user.findUniqueOrThrow({ where: { email: emails.salesManager } })).id;
  adminId = (await db.user.findUniqueOrThrow({ where: { email: emails.admin } })).id;
  accountId = (await db.account.create({ data: { name: tag, ownerId: salesId } })).id;
  stageId = (await db.salesStage.create({ data: { name: `${tag} Stage`, probability: 20, sortOrder: 990 } })).id;
  projectId = (await db.project.create({ data: { name: tag, ownerId: salesId, primaryAccountId: accountId, primaryAccountRole: 'PROGRAM_OWNER', createdById: adminId } })).id;
  const productId = (await db.product.create({ data: { name: tag, sku: tag } })).id;
  for (const [ownerId, amount, forecastCategory] of [
    [salesId, '100', 'PIPELINE'], [salesId, '25', 'OMITTED'],
    [managerId, '200', 'COMMIT'], [adminId, '400', 'BEST_CASE'],
  ] as const) {
    const row = await db.opportunity.create({ data: {
      name: `${tag} ${amount}`, ownerId, stageId, forecastCategory, currencyCode: 'USD',
      expectedCloseDate: new Date('2026-12-01T12:00:00Z'),
      participants: { create: { accountId } },
      products: { create: { productId, quantity: 1, estimatedUnitPrice: amount } },
    } });
    if (amount === '100') opportunityId = row.id;
  }
  await db.opportunity.create({ data: {
    name: `${tag} archived`, ownerId: salesId, stageId, archivedAt: new Date(),
    participants: { create: { accountId } },
    products: { create: { productId, quantity: 1, estimatedUnitPrice: '9000' } },
  } });
  taskId = (await db.task.create({ data: { subject: `${tag} Task`, accountId, opportunityId, projectId, assignedToId: salesId } })).id;
  noteId = (await db.note.create({ data: { body: `${tag} Note body`, accountId, opportunityId, projectId, createdById: adminId } })).id;
});

test.afterAll(async () => {
  await db.opportunity.updateMany({ where: { name: { startsWith: tag } }, data: { archivedAt: new Date() } });
  await db.$disconnect();
});

function stageSummary(page: import('@playwright/test').Page) {
  return page.getByRole('heading', { name: 'Stage', exact: true }).locator('..');
}

for (const role of ['sales', 'salesManager', 'admin'] as const) test(`${role} direct Pipeline URL uses permitted totals and keeps Omitted deals`, async ({ page }) => {
  await signInAs(page, role);
  await page.goto(`/pipeline?stageId=${stageId}`);
  const summary = stageSummary(page);
  await expect(summary.getByRole('cell', { name: role === 'sales' ? '2' : '4', exact: true })).toBeVisible();
  await expect(summary.getByRole('cell', { name: role === 'sales' ? '$125.00' : '$725.00', exact: true })).toBeVisible();
  await expect(summary.getByRole('cell', { name: role === 'sales' ? '$25.00' : '$145.00', exact: true })).toBeVisible();
  // A query string is an additional filter, never an ownership override.
  await page.goto(`/pipeline?stageId=${stageId}&ownerId=${managerId}`);
  if (role === 'sales') await expect(page.getByText('No open opportunities match these filters.')).toBeVisible();
  else await expect(stageSummary(page).getByRole('cell', { name: '$200.00', exact: true })).toBeVisible();
});

test('Pipeline Test as user uses Sales scope and returns to Admin scope', async ({ page, context }) => {
  test.skip(process.env.ENABLE_DEV_IMPERSONATION !== 'true', 'Development impersonation is disabled');
  await signInAs(page, 'admin');
  await context.addCookies([{ name: 'saleshub-dev-impersonate-user', value: String(salesId), url: baseURL }]);
  await page.goto(`/pipeline?stageId=${stageId}`);
  await expect(stageSummary(page).getByRole('cell', { name: '$125.00', exact: true })).toBeVisible();
  await page.goto(`/pipeline?stageId=${stageId}&ownerId=${managerId}`);
  await expect(page.getByText('No open opportunities match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Return to Admin' }).click();
  await expect(page.getByRole('button', { name: 'Return to Admin' })).toHaveCount(0);
  await page.goto(`/pipeline?stageId=${stageId}`);
  await expect(stageSummary(page).getByRole('cell', { name: '$725.00', exact: true })).toBeVisible();
});

test('Read Only follows related Tasks and reads Notes without edit-only View links', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAs(page, 'readOnly');
  for (const path of [`/tasks?q=${encodeURIComponent(tag)}`, `/accounts/${accountId}?tab=tasks`, `/projects/${projectId}?tab=tasks`, `/opportunities/${opportunityId}`]) {
    await page.goto(path);
    const link = page.getByRole('link', { name: `${tag} Task`, exact: true });
    await expect(link).toHaveAttribute('href', `/tasks/${taskId}`);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`));
    await expect(page.getByRole('heading', { name: `${tag} Task`, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit task', exact: true })).toHaveCount(0);
  }
  for (const path of [`/accounts/${accountId}?tab=notes`, `/projects/${projectId}?tab=notes`, `/opportunities/${opportunityId}`]) {
    await page.goto(path);
    await expect(page.getByText(`${tag} Note body`, { exact: true })).toBeVisible();
    await expect(page.locator(`a[href="/notes/${noteId}/edit"]`)).toHaveCount(0);
  }
  await page.goto(`/tasks/${taskId}/edit`);
  await expect(page).toHaveURL(/\/access-denied/);
  await page.goto(`/notes/${noteId}/edit`);
  await expect(page).toHaveURL(/\/access-denied/);
  await signInAs(page, 'admin');
  await page.goto(`/accounts/${accountId}?tab=notes`);
  await expect(page.locator(`a[href="/notes/${noteId}/edit"]`)).toHaveText('Edit note');
});

for (const width of [1440, 768, 390]) test(`Pipeline and forecast-history guidance at ${width}px`, async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width, height: 900 });
  await signInAs(page, 'admin');
  for (const path of [`/pipeline?stageId=${stageId}`, '/administration', '/administration/history', '/administration/forecast-snapshots', '/reports/forecast-movement', '/reports/forecast-snapshots', '/help/forecasting', '/help/forecast-snapshots', `/accounts/${accountId}?tab=tasks`, `/accounts/${accountId}?tab=notes`]) {
    await page.goto(path);
    await expect(page.locator('main h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${width}-${path.replace(/[^a-zA-Z0-9-]/g, '-')}.png`), fullPage: true, caret: 'initial' });
    if (path === '/administration/history') {
      await expect(page.getByRole('heading', { name: 'Forecast Movement captures', exact: true })).toBeVisible();
      await page.getByRole('link', { name: 'Forecast Snapshot History', exact: true }).click();
      await expect(page).toHaveURL(/\/reports\/forecast-snapshots$/);
    }
    if (path.startsWith('/help/')) await expect(page.getByRole('main')).toContainText('Forecast Movement');
  }
});
