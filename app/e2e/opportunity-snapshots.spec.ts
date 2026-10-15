import { test, expect } from './fixtures';
import { signInAs, uniqueName } from './helpers';
import { Prisma, PrismaClient, type OpportunitySnapshot } from '@prisma/client';
import { databaseUrl, emails } from './constants.mjs';
import { captureOpportunitySnapshot, compareSnapshotRuns, previewOpportunitySnapshot, snapshotWeek, snapshotWhere } from '../lib/opportunity-snapshots';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const tag = uniqueName('Snapshot fixture');
let admin: { id: number; role: 'ADMIN'; active: boolean };
let managerId: number, repId: number, accountId: number, stageId: number, nextStageId: number;
let movingId: number, removedId: number, enteredId: number, closedId: number, archivedId: number, inactiveAccountId: number, inactiveProjectId: number;
let beforeId: number, afterId: number;
let oldSnapshot: Omit<OpportunitySnapshot, 'id' | 'runId' | 'snapshotAt'>;

test.beforeAll(async () => {
  const user = await db.user.findUniqueOrThrow({ where: { email: emails.admin } });
  admin = { id: user.id, role: 'ADMIN', active: true };
  repId = (await db.user.findUniqueOrThrow({ where: { email: emails.sales } })).id;
  managerId = (await db.user.findUniqueOrThrow({ where: { email: emails.salesManager } })).id;
  accountId = (await db.account.create({ data: { name: `${tag} Account` } })).id;
  stageId = (await db.salesStage.create({ data: { name: `${tag} Qualification`, probability: 20, sortOrder: 900 } })).id;
  nextStageId = (await db.salesStage.create({ data: { name: `${tag} Evaluation`, probability: 60, sortOrder: 901 } })).id;
  const closedStage = await db.salesStage.create({ data: { name: `${tag} Won`, probability: 100, sortOrder: 902, isClosed: true, isWon: true } });
  const product = await db.product.create({ data: { name: tag, sku: tag } });
  const create = (name: string, extra: Partial<Prisma.OpportunityUncheckedCreateInput> = {}) => db.opportunity.create({ data: {
    name: `${tag} ${name}`, ownerId: repId, currencyCode: 'USD', stageId, ...extra,
    participants: { create: { accountId } },
  } });
  // Each fixture has a product sum of 59.85; archived lines must not contribute.
  const moving = await create('Moving', { name: `${tag} Moving`, stageId, expectedCloseDate: new Date('2026-11-01T12:00:00Z'), products: { create: [
    { productId: product.id, quantity: 3, estimatedUnitPrice: '19.95' },
    { productId: product.id, quantity: 1, estimatedUnitPrice: '900', archivedAt: new Date() },
  ] } });
  movingId = moving.id;
  removedId = (await create('Removed')).id;
  enteredId = (await create('Entered', { name: `${tag} Entered`, stageId, ownerId: managerId })).id;
  closedId = (await create('Closed', { name: `${tag} Closed`, stageId: closedStage.id })).id;
  archivedId = (await create('Archived', { name: `${tag} Archived`, stageId, archivedAt: new Date() })).id;
  const inactive = await db.account.create({ data: { name: `${tag} Inactive Account`, status: 'INACTIVE' } });
  const inactiveOpportunity = await create('Inactive Account'); inactiveAccountId = inactiveOpportunity.id;
  await db.opportunityAccount.update({ where: { opportunityId_accountId: { opportunityId: inactiveAccountId, accountId } }, data: { accountId: inactive.id } });
  const project = await db.project.create({ data: { name: `${tag} Archived Project`, primaryAccountRole: 'END_CUSTOMER', createdById: admin.id, archivedAt: new Date() } });
  inactiveProjectId = (await create('Archived Project', { name: `${tag} Archived Project`, stageId, projects: { create: { projectId: project.id } } })).id;

  oldSnapshot = { opportunityId: movingId, opportunityName: `${tag} Moving`, accountIds: [accountId], accounts: [{ id: accountId, name: `${tag} Account` }], ownerId: repId, ownerName: 'Original Rep', stageId, stageName: 'Qualification', amount: new Prisma.Decimal('59.85'), currencyCode: 'USD', expectedCloseDate: new Date('2026-11-01T12:00:00Z'), probability: 20, probabilityOverride: null, stageProbability: 20, forecastCategory: 'PIPELINE', status: 'OPEN', productCount: 1 };
  const count = await db.opportunitySnapshotRun.count();
  const earlier = new Date(Date.UTC(2000, 0, 3 + count * 14)), later = new Date(earlier.getTime() + 7 * 86400000);
  async function historicalRun(at: Date, rows: typeof oldSnapshot[]) {
    return db.$transaction(async tx => {
      const run = await tx.opportunitySnapshotRun.create({ data: { snapshotAt: at, snapshotWeek: snapshotWeek(at), createdById: admin.id, createdByName: 'E2E Admin', opportunityCount: rows.length } });
      await tx.opportunitySnapshot.createMany({ data: rows.map(row => ({ ...row, accounts: row.accounts as Prisma.InputJsonValue, runId: run.id, snapshotAt: at })) });
      return run.id;
    });
  }
  beforeId = await historicalRun(earlier, [oldSnapshot, { ...oldSnapshot, opportunityId: removedId, opportunityName: `${tag} Removed` }]);
  afterId = await historicalRun(later, [
    { ...oldSnapshot, stageId: nextStageId, stageName: 'Evaluation', ownerId: managerId, ownerName: 'New Owner', amount: new Prisma.Decimal('75'), expectedCloseDate: new Date('2026-12-01'), forecastCategory: 'COMMIT', probability: 60 },
    { ...oldSnapshot, opportunityId: enteredId, opportunityName: `${tag} Entered`, ownerId: managerId },
  ]);
});
test.afterAll(async () => {
  // Historical rows intentionally remain immutable in the isolated database.
  await db.opportunity.updateMany({ where: { name: { startsWith: tag } }, data: { archivedAt: new Date() } });
  await db.$disconnect();
});

test('manual capture confirms a complete set, excludes out-of-scope records, and prevents duplicates', async ({ page }) => {
  await signInAs(page, 'admin');
  await page.goto('/administration/opportunity-snapshots');
  const capture = page.getByRole('region', { name: 'Manual snapshot capture', exact: true });
  await page.getByRole('button', { name: 'Preview snapshot', exact: true }).click();
  const existing = await db.opportunitySnapshotRun.findUnique({ where: { snapshotWeek: snapshotWeek(new Date()) } });
  if (existing) {
    await expect(capture.getByRole('alert')).toContainText('already has an immutable snapshot run');
    return;
  }
  const expectedCount = await db.opportunity.count({ where: snapshotWhere });
  await expect(page.getByText('Opportunities to capture', { exact: true }).locator('..')).toContainText(String(expectedCount));
  await expect(page.getByRole('button', { name: 'Confirm snapshot', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: /I confirm creation/ }).check();
  await page.getByRole('button', { name: 'Confirm snapshot', exact: true }).click();
  await expect(capture.getByRole('status')).toContainText(`Captured ${expectedCount} Opportunities`);
  const run = await db.opportunitySnapshotRun.findUniqueOrThrow({ where: { snapshotWeek: snapshotWeek(new Date()) } });
  expect(await db.opportunitySnapshot.count({ where: { runId: run.id } })).toBe(expectedCount);
  expect(await db.opportunitySnapshot.count({ where: { runId: run.id, opportunityId: { in: [closedId, archivedId, inactiveAccountId, inactiveProjectId] } } })).toBe(0);
  const row = await db.opportunitySnapshot.findUniqueOrThrow({ where: { runId_opportunityId: { runId: run.id, opportunityId: movingId } } });
  expect(row.amount.toFixed(2)).toBe('59.85'); expect(row.productCount).toBe(1); expect(row.probability).toBe(20);
  expect(row.accountIds).toEqual([accountId]); expect(row.stageName).toContain('Qualification');
  await page.getByRole('button', { name: 'Preview snapshot', exact: true }).click();
  await expect(capture.getByRole('alert')).toContainText('already has an immutable snapshot run');
});

test('database rejects mutation, extension and incomplete sets; live edits do not rewrite history', async () => {
  const historical = await db.opportunitySnapshot.findFirstOrThrow({ where: { runId: beforeId, opportunityId: movingId } });
  await expect(db.opportunitySnapshot.update({ where: { id: historical.id }, data: { opportunityName: 'Changed' } })).rejects.toThrow(/immutable/);
  await expect(db.opportunitySnapshot.delete({ where: { id: historical.id } })).rejects.toThrow(/immutable/);
  await expect(db.opportunitySnapshotRun.update({ where: { id: beforeId }, data: { opportunityCount: 99 } })).rejects.toThrow(/immutable/);
  await expect(db.opportunitySnapshot.create({ data: { ...oldSnapshot, accounts: oldSnapshot.accounts as Prisma.InputJsonValue, opportunityId: enteredId, snapshotAt: historical.snapshotAt, runId: beforeId } })).rejects.toThrow(/atomically/);
  const at = new Date('1900-01-01');
  await expect(db.opportunitySnapshotRun.create({ data: { snapshotAt: at, snapshotWeek: at, createdById: admin.id, createdByName: 'Admin', opportunityCount: 5 } })).rejects.toThrow(/count mismatch/);
  await db.opportunity.update({ where: { id: movingId }, data: { stageId: nextStageId, ownerId: managerId, name: `${tag} Moving edited`, archivedAt: new Date() } });
  await db.account.update({ where: { id: accountId }, data: { name: `${tag} Renamed Account` } });
  await db.salesStage.update({ where: { id: stageId }, data: { name: `${tag} Renamed Stage`, probability: 90 } });
  expect(await db.opportunitySnapshot.findUnique({ where: { id: historical.id } })).toEqual(historical);
});

test('server comparisons retain both endpoints through owner/stage/Account filters and scope exits', async () => {
  const result = await compareSnapshotRuns(db, admin, beforeId, afterId, { ownerId: repId, stageId, accountId });
  const movement = result.rows.find(row => row.opportunityId === movingId)!;
  expect(movement.changes).toEqual(['Stage changed', 'Amount increased', 'Close date slipped', 'Owner changed', 'Forecast category changed', 'Probability changed']);
  expect(movement.after?.ownerId).toBe(managerId);
  expect(result.rows.find(row => row.opportunityId === removedId)?.changes).toEqual(['Left snapshot scope — closure/removal reason not captured']);
  const all = await compareSnapshotRuns(db, admin, beforeId, afterId);
  expect(all.rows.find(row => row.opportunityId === enteredId)?.changes).toEqual(['Entered snapshot set']);
  expect((await compareSnapshotRuns(db, admin, beforeId, afterId, { accountId: 2147483647 })).rows).toHaveLength(0);
  expect(all.totals.find(row => row.runId === beforeId)?.amount.toFixed(2)).toBe('119.70');
  for (const role of ['SALES_MANAGER', 'SALES', 'READ_ONLY', 'SUPPORT', 'MARKETING_MANAGER'] as const) {
    await expect(previewOpportunitySnapshot(db, { ...admin, role })).rejects.toThrow('Access denied');
    await expect(captureOpportunitySnapshot(db, { ...admin, role }, { count: 0, preparedAt: '', fingerprint: '', week: '' }, true)).rejects.toThrow('Access denied');
  }
});

test('report and detail retain historical values, respect filters and deny unauthorized roles', async ({ page }) => {
  await signInAs(page, 'salesManager');
  await page.goto(`/reports/opportunity-snapshots?before=${beforeId}&after=${afterId}&ownerId=${repId}&stageId=${stageId}&accountId=${accountId}&from=2000-01-01&through=2020-01-01`);
  await expect(page.getByRole('heading', { name: 'Opportunity Snapshot History', exact: true })).toBeVisible();
  const moving = page.getByRole('region', { name: 'Snapshot comparison' }).getByRole('row').filter({ hasText: `${tag} Moving` });
  await expect(moving).toContainText('Amount increased'); await expect(moving).toContainText('Owner changed');
  await expect(moving).toContainText('Original Rep'); await expect(moving).toContainText('New Owner');
  await expect(page.getByLabel('Run date from (UTC)')).toHaveValue('2000-01-01');
  await page.getByRole('button', { name: 'Compare snapshots', exact: true }).click();
  await expect(moving).toContainText('Close date slipped');
  await page.goto(`/opportunities/${movingId}`);
  const history = page.getByRole('region', { name: 'Snapshot History', exact: true });
  await expect(history).toContainText('Qualification'); await expect(history).toContainText('59.85');
  await signInAs(page, 'sales');
  await page.goto(`/reports/opportunity-snapshots?before=${beforeId}&after=${afterId}`);
  await expect(page).toHaveURL(/access-denied/);
  await page.goto('/administration/opportunity-snapshots'); await expect(page).toHaveURL(/access-denied/);
});

test('snapshot capture, comparison and detail render on desktop, tablet and phone', async ({ page }) => {
  await signInAs(page, 'admin');
  for (const [width, height] of [[1440, 900], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const path of ['/administration/opportunity-snapshots', `/reports/opportunity-snapshots?before=${beforeId}&after=${afterId}`, `/opportunities/${movingId}`]) {
      await page.goto(path);
      await expect(page.locator('main h1')).toBeVisible();
      if (path.includes('/reports/')) await expect(page.getByRole('region', { name: 'Snapshot comparison' })).toBeVisible();
      if (path.includes('/opportunities/')) await expect(page.getByRole('region', { name: 'Snapshot History', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${width}px ${path}`).toBe(true);
    }
    await page.screenshot({ path: `reports/opportunity-snapshots/detail-${width}.png`, fullPage: true, caret: 'initial' });
    await page.goto(`/reports/opportunity-snapshots?before=${beforeId}&after=${afterId}`);
    await page.screenshot({ path: `reports/opportunity-snapshots/report-${width}.png`, fullPage: true, caret: 'initial' });
  }
});
