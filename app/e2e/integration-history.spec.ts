import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';
import { databaseUrl, emails, baseURL } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';
import { adminIntegrationHistory, durableIntegrationHealth } from '../lib/admin-integration-history';
import { attemptContext, gmailContext, trackIntegrationAttempt } from '../lib/integration-attempts';
import { SupportGmailHttpError } from '../lib/support-gmail-errors';
import { runWeeklySnapshots } from '../lib/weekly-snapshots';
import { snapshotWeek, FORECAST_SNAPSHOT_SCOPE } from '../lib/opportunity-snapshots';
import { resolveUserContext } from '../lib/dev-impersonation';
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let actorId: number, caseId: number, recoveredId: number, recoveryId: number, unresolvedId: number;
const base = '/administration/maintenance-history?view=integrations';
const filters = () => ({ actor: String(actorId), from: '2003-02-01', to: '2003-02-01', integration: 'SUPPORT_GMAIL' });
const admin = () => db.user.findUniqueOrThrow({ where: { email: emails.admin } });
test.beforeAll(async () => {
  const owner = await admin();
  const actor = await db.user.create({ data: { email: `${uniqueName('integrationactor').replaceAll(' ', '')}@example.test`, firstName: 'Integration', lastName: 'Operator', role: 'SUPPORT' } }); actorId = actor.id;
  const c = await db.supportCase.create({ data: { caseNumber: uniqueName('INT'), subject: 'Integration history linked case', customerNameText: 'Synthetic customer', description: 'Synthetic test', source: 'EMAIL', createdById: owner.id, updatedById: owner.id } }); caseId = c.id;
  const context = gmailContext('LINK_EMAIL', 'synthetic-mailbox', 'message-a', actorId, caseId);
  const failed = await db.scheduledJobRun.create({ data: { ...context, isTest: false, status: 'FAILED', startedAt: new Date('2003-02-01T10:00:00Z'), completedAt: new Date('2003-02-01T10:01:00Z'), failureCategory: 'AUTHENTICATION' } }); recoveredId = failed.id;
  const successful = await db.scheduledJobRun.create({ data: { ...context, isTest: false, status: 'SUCCEEDED', startedAt: new Date('2003-02-01T10:02:00Z'), completedAt: new Date('2003-02-01T10:03:00Z') } }); recoveryId = successful.id;
  const unresolvedContext = { ...context, contextKey: attemptContext('different-message') };
  const unresolved = await db.scheduledJobRun.create({ data: { ...unresolvedContext, isTest: false, status: 'FAILED', startedAt: new Date('2003-02-01T11:00:00Z'), completedAt: new Date('2003-02-01T11:02:00Z'), failureCategory: 'PERMISSION' } }); unresolvedId = unresolved.id;
  await db.scheduledJobRun.createMany({ data: [
    // Earlier concurrent success, a different operation, and a fixture success
    // must all leave the second failure unresolved.
    { ...unresolvedContext, isTest: false, status: 'SUCCEEDED', startedAt: new Date('2003-02-01T11:01:00Z'), completedAt: new Date('2003-02-01T11:03:00Z') },
    { ...unresolvedContext, operation: 'INBOX_FETCH', isTest: false, status: 'SUCCEEDED', startedAt: new Date('2003-02-01T11:04:00Z'), completedAt: new Date('2003-02-01T11:05:00Z') },
    { ...unresolvedContext, isTest: true, status: 'SUCCEEDED', startedAt: new Date('2003-02-01T11:04:00Z'), completedAt: new Date('2003-02-01T11:05:00Z') },
  ] });
  await db.scheduledJobRun.createMany({ data: Array.from({ length: 27 }, (_, i) => ({ ...context, operation: 'INBOX_FETCH', contextKey: attemptContext('paged', i), isTest: false, status: 'SUCCEEDED', startedAt: new Date(Date.UTC(2003, 1, 1, 12, i)), completedAt: new Date(Date.UTC(2003, 1, 1, 12, i, 1)) })) });
});
test.afterAll(() => db.$disconnect());

test('stored recovery matches exact operation and target, excludes overlapping and fixture successes', async () => {
  const a = await admin();
  const recovered = await adminIntegrationHistory(db, a, { ...filters(), status: 'Recovered' });
  expect(recovered.count).toBe(1); expect(recovered.rows[0]).toMatchObject({ id: recoveredId, recoveryId, state: 'Recovered' });
  const failed = await adminIntegrationHistory(db, a, { ...filters(), status: 'Failed' });
  expect(failed.count).toBe(1); expect(failed.rows[0]).toMatchObject({ id: unresolvedId, recoveryId: null, state: 'Failed' });
  const second = await adminIntegrationHistory(db, a, { ...filters(), page: '2' });
  expect(second.count).toBe(33); expect(second.rows).toHaveLength(8);
  expect((await adminIntegrationHistory(db, a, { ...filters(), from: '2003-02-02' })).count).toBe(0);
});

test('real Gmail writer records safe success/failure and System Health reads durable unresolved evidence', async () => {
  const context = { ...gmailContext('INBOX_FETCH', 'synthetic-mailbox', uniqueName('writer'), actorId), isTest: false };
  await trackIntegrationAttempt(db, context, async () => ({ access_token: 'NEVER_SAVE_TOKEN', body: 'NEVER_SAVE_EMAIL_BODY' }));
  await expect(trackIntegrationAttempt(db, context, async () => { throw new SupportGmailHttpError('NEVER_SAVE_PROVIDER_RESPONSE', 'quota'); })).rejects.toThrow('NEVER_SAVE_PROVIDER_RESPONSE');
  const rows = await db.scheduledJobRun.findMany({ where: { contextKey: context.contextKey }, orderBy: { id: 'asc' } });
  expect(rows.map(r => r.status)).toEqual(['SUCCEEDED', 'FAILED']); expect(rows[1].failureCategory).toBe('QUOTA'); expect(JSON.stringify(rows)).not.toMatch(/NEVER_SAVE/);
  const health = await durableIntegrationHealth(db, await admin());
  const gmail = health.find(h => h.jobType === 'SUPPORT_GMAIL')!;
  expect(gmail.failed?.id).toBe(rows[1].id); expect(gmail.successful?.id).toBe(rows[0].id);
  // Reconnect and other operations do not prove this fetch has recovered.
  await trackIntegrationAttempt(db, { ...context, operation: 'CONNECT' }, async () => {});
  expect((await durableIntegrationHealth(db, await admin())).find(h => h.jobType === 'SUPPORT_GMAIL')!.failed?.id).toBe(rows[1].id);
});

test('weekly snapshots surface their existing attempts and exact links without additional history rows', async ({ page }) => {
  let at = new Date('2003-01-06T17:00:00Z');
  while (await db.opportunitySnapshotRun.findUnique({ where: { snapshotWeek: snapshotWeek(at) } })) at = new Date(+at + 7 * 86400000);
  const source = await db.opportunitySnapshotRun.create({ data: { snapshotAt: at, snapshotWeek: snapshotWeek(at), source: 'SCHEDULED', createdById: null, createdByName: 'Automated weekly capture', opportunityCount: 0, scopeVersion: FORECAST_SNAPSHOT_SCOPE } });
  const before = await db.scheduledJobRun.count();
  const run = await runWeeklySnapshots(db, source.snapshotWeek.toISOString().slice(0, 10));
  expect(run.status).toBe('SUCCEEDED'); expect(await db.scheduledJobRun.count()).toBe(before + 1);
  const result = await adminIntegrationHistory(db, await admin(), { integration: 'WEEKLY_SNAPSHOTS' });
  expect(result.rows.filter(r => r.id === run.id)).toHaveLength(1);
  await signInAs(page, 'admin'); await page.goto(`${base}&integration=WEEKLY_SNAPSHOTS`);
  const article = page.locator(`#attempt-${run.id}`);
  await expect(article).toContainText('Weekly snapshot service');
  await expect(article.getByRole('link', { name: `Opportunity Snapshot #${source.id}`, exact: true })).toBeVisible();
  const link = article.getByRole('link', { name: `Forecast Snapshot #${run.forecastSnapshotRunId}`, exact: true }); await expect(link).toBeVisible(); await link.click(); await expect(page).not.toHaveURL(/access-denied|not-found/);
});

test('Admin history filters, pagination, failed/recovered states and linked case work in the browser', async ({ page }) => {
  await signInAs(page, 'admin'); await page.goto(`${base}&${new URLSearchParams(filters())}`);
  const region = page.getByRole('region', { name: 'Integration attempts' });
  await expect(region.locator('article')).toHaveCount(25); await page.getByRole('link', { name: 'Next', exact: true }).click(); await expect(region.locator('article')).toHaveCount(8);
  await page.getByLabel('Status', { exact: true }).selectOption('Recovered'); await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(region.locator('article')).toHaveCount(1); await expect(region).toContainText('Authentication required'); await expect(region).toContainText(`Recovered by attempt #${recoveryId}`);
  await region.getByRole('link', { name: `Support Case #${caseId}` }).click(); await expect(page.locator('main')).toContainText('Integration history linked case');
  await page.goto(`${base}&${new URLSearchParams({ ...filters(), status: 'Failed' })}`); await expect(region.locator('article')).toHaveCount(1); await expect(region).toContainText('Permission issue');
  await page.getByLabel('Integration or job', { exact: true }).selectOption('CALENDAR_CONNECTION_SYNC'); await page.getByRole('button', { name: 'Apply filters' }).click(); await expect(region).toContainText('No connection actions or jobs match');
});

for (const width of [1440, 768, 390]) test(`history and durable System Health fit ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await signInAs(page, 'admin');
  await page.goto(`${base}&${new URLSearchParams({ ...filters(), status: 'Recovered' })}`); await expect(page.getByRole('heading', { name: 'Integration & Job History' })).toBeVisible();
  await expect(page.locator(`#attempt-${recoveredId}`)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `reports/integration-history/history-${width}.png`, fullPage: true, caret: 'initial' });
  await page.goto('/administration/system-health'); const region = page.getByRole('region', { name: 'Recorded integration status' }); await expect(region).toContainText('Last successful action'); await expect(region).toContainText('Most recent unresolved failure'); await expect(region).not.toContainText('NEVER_SAVE');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `reports/integration-history/health-${width}.png`, fullPage: true, caret: 'initial' });
});

test('Admin-only visibility uses effective impersonated user; personal integration ownership is unchanged', async ({ page, context }) => {
  test.setTimeout(120_000);
  const a = await admin(), sales = await db.user.findUniqueOrThrow({ where: { email: emails.sales } });
  const effective = await resolveUserContext({ ...a, name: 'Admin' }, String(sales.id), db, { NODE_ENV: 'development', ENABLE_DEV_IMPERSONATION: 'true' });
  await expect(adminIntegrationHistory(db, effective.effective!, {})).rejects.toThrow(/Access denied/);
  await expect(durableIntegrationHealth(db, effective.effective!)).rejects.toThrow(/Access denied/);
  for (const role of ['sales', 'salesManager', 'support', 'marketing', 'readOnly'] as const) { await signInAs(page, role); await page.goto(base); await expect(page).toHaveURL(/access-denied/); }
  if (process.env.ENABLE_DEV_IMPERSONATION === 'true') {
    await signInAs(page, 'admin'); await context.addCookies([{ name: 'saleshub-dev-impersonate-user', value: String(sales.id), url: baseURL }]); await page.goto(base); await expect(page).toHaveURL(/access-denied/);
  }
});
