import { PrismaClient } from '@prisma/client';
import { test, expect, type Page } from './fixtures';
import { databaseUrl, emails, names } from './constants.mjs';
import { signInAs } from './helpers';

// All fixtures live in the existing allowlisted local E2E database. Fixed names
// are idempotent; this suite never depends on another spec having run first.
const db = new PrismaClient({ datasourceUrl: databaseUrl });
let accountId: number, opportunityId: number, taskId: number, caseId: number;
test.beforeAll(async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: emails.admin } });
  const support = await db.user.findUniqueOrThrow({ where: { email: emails.support } });
  const stage = await db.salesStage.findUniqueOrThrow({ where: { name: 'E2E Qualification' } });
  const account = await db.account.findFirst({ where: { name: 'Release smoke customer' } }) ?? await db.account.create({ data: { name: 'Release smoke customer' } });
  accountId = account.id;
  await db.account.update({ where: { id: accountId }, data: { archivedAt: null, status: 'ACTIVE', phone: '555-0100', ownerId: admin.id } });
  const opportunity = await db.opportunity.findFirst({ where: { name: 'Release smoke opportunity' } }) ?? await db.opportunity.create({ data: { name: 'Release smoke opportunity', ownerId: admin.id, stageId: stage.id, currencyCode: 'USD', participants: { create: { accountId } } } });
  opportunityId = opportunity.id;
  const task = await db.task.findFirst({ where: { subject: 'Release smoke task' } }) ?? await db.task.create({ data: { subject: 'Release smoke task', accountId, assignedToId: admin.id } });
  taskId = task.id;
  const supportCase = await db.supportCase.findUnique({ where: { caseNumber: 'BXS-2099-999999' } }) ?? await db.supportCase.create({ data: { caseNumber: 'BXS-2099-999999', subject: 'Release smoke case', customerNameText: 'Release smoke customer', accountId, source: 'PHONE', description: 'Isolated release validation fixture', assignedToId: support.id, createdById: admin.id, updatedById: admin.id } });
  caseId = supportCase.id;
  // Verify the shared seed exists, rather than falling back to arbitrary user data.
  await db.account.findFirstOrThrow({ where: { name: names.account } });
});
test.afterAll(() => db.$disconnect());

async function opens(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(200);
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.locator('main h1').first()).toBeVisible();
  await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0);
}

test('sign-in, authenticated shell, Account detail and isolated edit/save', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await signInAs(page, 'admin');
  await expect(page.getByRole('main')).toBeVisible();
  await opens(page, `/accounts/${accountId}`);
  await opens(page, `/accounts/${accountId}/edit`);
  await page.getByLabel('Phone', { exact: true }).fill('555-0199');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page).toHaveURL(`/accounts/${accountId}`);
  await expect(page.getByRole('main')).toContainText('555-0199');
  expect((await db.account.findUniqueOrThrow({ where: { id: accountId } })).phone).toBe('555-0199');
});

test('Opportunity detail/edit, Task workflow, Reports, Admin and Help open', async ({ page }) => {
  test.setTimeout(180_000);
  await signInAs(page, 'admin');
  for (const path of [`/opportunities/${opportunityId}`, `/opportunities/${opportunityId}/edit`, `/tasks/${taskId}`, `/tasks/${taskId}/edit`, '/reports', '/administration/settings', '/help']) await opens(page, path);
});

test('Support can open its Case and edit form', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAs(page, 'support');
  await opens(page, `/support/cases/${caseId}`);
  await opens(page, `/support/cases/${caseId}/edit`);
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Release smoke case');
});
