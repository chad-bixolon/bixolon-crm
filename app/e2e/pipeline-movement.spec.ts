import { test, expect, type Page } from './fixtures';
import { signInAs, uniqueName } from './helpers';
import { Prisma, PrismaClient, type OpportunitySnapshot } from '@prisma/client';
import { databaseUrl, emails, baseURL } from './constants.mjs';
import { snapshotWeek, FORECAST_SNAPSHOT_SCOPE } from '../lib/opportunity-snapshots';
import { businessQuarter, quarterBounds } from '../lib/business-quarter';
import { loadPipelineMovement } from '../lib/pipeline-movement-report';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const tag = uniqueName('Movement');
let beforeId: number, afterId: number, repId: number, managerId: number, earliestId: number;
let reportYear: number, reportQuarter: string, nextYear: number, nextQuarter: string;
const dealIds: Record<string, number> = {};
const url = (extra = '') => `/reports/pipeline-movement?before=${beforeId}&after=${afterId}&year=${reportYear}&quarter=${reportQuarter}&currencyCode=USD${extra}`;
const metric = (page: Page, label: string) => page.locator(`[data-measure="${label}"]`);
async function assertReconciliation(page: Page, starting: string, ending: string) {
  await expect(metric(page, 'Starting Pipeline')).toHaveAttribute('data-value', starting);
  await expect(metric(page, 'Ending Pipeline')).toHaveAttribute('data-value', ending);
  const values = await page.getByRole('region', { name: 'Pipeline reconciliation', exact: true }).locator('[data-value]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-value')!));
  const cents = (value: string) => BigInt(value.replace('.', ''));
  expect(values.slice(0, -1).reduce((sum, value) => sum + cents(value), BigInt(0))).toBe(cents(values.at(-1)!));
}
test.beforeAll(async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: emails.admin } });
  repId = (await db.user.findUniqueOrThrow({ where: { email: emails.sales } })).id;
  managerId = (await db.user.findUniqueOrThrow({ where: { email: emails.salesManager } })).id;
  await db.currency.upsert({ where: { code: 'CAD' }, update: {}, create: { code: 'CAD', name: 'Canadian Dollar' } });
  const stage = await db.salesStage.create({ data: { name: `${tag} Discovery`, probability: 20, sortOrder: 950 } });
  const account = await db.account.create({ data: { name: `${tag} Customer` } });
  const names = ['Unchanged', 'Multi-change slip', 'Upgrade', 'Increase', 'Entered', 'New', 'Won', 'Removed', 'Owner transfer', 'Decrease', 'Downgrade', 'Stage advance', 'CAD only', 'Lost', 'New Won'];
  for (const name of names) dealIds[name] = (await db.opportunity.create({ data: { name: `${tag} ${name}`, ownerId: repId, stageId: stage.id, currencyCode: name === 'CAD only' ? 'CAD' : 'USD', participants: { create: { accountId: account.id } } } })).id;
  let at = new Date('2090-11-06T15:00:00Z');
  while (await db.opportunitySnapshotRun.findFirst({ where: { snapshotWeek: { in: [snapshotWeek(at), snapshotWeek(new Date(at.getTime() + 7 * 86400000))] } } })) at = new Date(at.getTime() + 14 * 86400000);
  const selectedPeriod = businessQuarter(new Date(at.getTime() + 7 * 86400000));
  reportYear = selectedPeriod.year; reportQuarter = selectedPeriod.quarter;
  const bounds = quarterBounds(selectedPeriod.year, selectedPeriod.quarter);
  const closeDate = new Date(bounds.start.getTime() + 45 * 86400000);
  const outside = new Date(bounds.endExclusive.getTime() + 45 * 86400000);
  const nextPeriod = businessQuarter(outside); nextYear = nextPeriod.year; nextQuarter = nextPeriod.quarter;
  const row = (name: string, amount: string, extra: Partial<OpportunitySnapshot> = {}): Omit<OpportunitySnapshot, 'id' | 'runId' | 'snapshotAt'> => ({
    opportunityId: dealIds[name], opportunityName: `${tag} ${name}`, accounts: [{ id: account.id, name: account.name }], accountIds: [account.id],
    ownerId: repId, ownerName: 'Captured Sales', ownerForecastEligible: true, stageId: stage.id, stageName: 'Captured Discovery',
    amount: new Prisma.Decimal(amount), currencyCode: 'USD', expectedCloseDate: closeDate,
    probability: 20, probabilityOverride: null, stageProbability: 20, forecastCategory: 'BEST_CASE', status: 'OPEN', productCount: 1, ...extra,
  });
  const before = [row('Unchanged', '100'), row('Multi-change slip', '200', { forecastCategory: 'COMMIT' }), row('Upgrade', '100'), row('Increase', '100'), row('Entered', '300', { expectedCloseDate: outside }), row('Won', '80'), row('Removed', '60'), row('Owner transfer', '70'), row('Decrease', '90'), row('Downgrade', '40', { forecastCategory: 'COMMIT' }), row('Stage advance', '10'), row('CAD only', '1000', { currencyCode: 'CAD' }), row('Lost', '25')];
  const after = [row('Unchanged', '100'), row('Multi-change slip', '150', { expectedCloseDate: outside }), row('Upgrade', '100', { forecastCategory: 'COMMIT' }), row('Increase', '125'), row('Entered', '250'), row('New', '50'), row('Won', '90', { status: 'WON', forecastCategory: 'CLOSED' }), row('Owner transfer', '75', { ownerId: managerId, ownerName: 'Captured Manager' }), row('Decrease', '85'), row('Downgrade', '40'), row('Stage advance', '10', { stageId: stage.id + 10000, stageName: 'Captured Evaluation', stageProbability: 60 }), row('CAD only', '1200', { currencyCode: 'CAD' }), row('Lost', '20', { status: 'LOST' }), row('New Won', '30', { status: 'WON', forecastCategory: 'CLOSED' })];
  // Lost endpoints are representable in the existing snapshot format even though
  // the current capture scope excludes them. No live state is used by the report.
  async function capture(date: Date, rows: typeof before, source: 'MANUAL' | 'SCHEDULED') {
    return db.$transaction(async tx => {
      const run = await tx.opportunitySnapshotRun.create({ data: { snapshotAt: date, snapshotWeek: snapshotWeek(date), createdById: source === 'MANUAL' ? admin.id : null, createdByName: source === 'MANUAL' ? 'Fixture Admin' : 'Automated weekly capture', source, scopeVersion: FORECAST_SNAPSHOT_SCOPE, opportunityCount: rows.length } });
      await tx.opportunitySnapshot.createMany({ data: rows.map(row => ({ ...row, accounts: row.accounts as Prisma.InputJsonValue, snapshotAt: date, runId: run.id })) });
      return run.id;
    });
  }
  beforeId = await capture(at, before, 'MANUAL'); afterId = await capture(new Date(at.getTime() + 7 * 86400000), after, 'SCHEDULED');
  earliestId = (await db.opportunitySnapshotRun.findFirstOrThrow({ orderBy: { snapshotAt: 'asc' } })).id;
});
test.afterAll(async () => { await db.opportunity.updateMany({ where: { id: { in: Object.values(dealIds) } }, data: { archivedAt: new Date() } }); await db.$disconnect(); });

test('latest vs prior default uses the later quarter and reconciles rendered financial movements', async ({ page }) => {
  await signInAs(page, 'salesManager'); await page.goto('/reports/pipeline-movement');
  await expect(page.getByRole('combobox', { name: 'Later snapshot', exact: true })).toHaveValue(String(afterId));
  await expect(page.getByRole('combobox', { name: 'Earlier snapshot', exact: true })).toHaveValue(String(beforeId));
  await expect(page.getByRole('combobox', { name: 'Quarter', exact: true })).toHaveValue(reportQuarter); await expect(page.getByLabel('Year', { exact: true })).toHaveValue(String(reportYear));
  await assertReconciliation(page, '875.00', '835.00');
  await expect(metric(page, 'Slipped Out')).toHaveAttribute('data-value', '-200.00');
  await expect(metric(page, 'Value Decreases')).toHaveAttribute('data-value', '-5.00');
  await expect(metric(page, 'Closed Lost')).toHaveAttribute('data-value', '-25.00');
  const slip = page.locator(`[data-opportunity-id="${dealIds['Multi-change slip']}"]`);
  await expect(slip.locator('[data-pipeline-impact]')).toHaveAttribute('data-pipeline-impact', '-200.00');
  await slip.locator('summary').click(); await expect(slip.getByText('200.00 → 150.00 USD', { exact: false })).toBeVisible();
  await expect(slip.getByText('Commit → Best Case', { exact: true })).toBeVisible();
  const newlyWon = page.locator(`[data-opportunity-id="${dealIds['New Won']}"]`);
  await expect(newlyWon.locator('[data-pipeline-impact]')).toHaveAttribute('data-pipeline-impact', '0.00');
  await expect(newlyWon).toContainText('Closed Won');
  const upgrade = page.locator(`[data-opportunity-id="${dealIds.Upgrade}"]`);
  await expect(upgrade.locator('[data-pipeline-impact]')).toHaveAttribute('data-pipeline-impact', '0.00');
  await expect(upgrade).toContainText('Commit:'); await expect(upgrade).toContainText('Best Case:');
  const management = page.getByRole('region', { name: 'Management movements', exact: true });
  for (const name of ['Largest positive movements', 'Largest negative movements', 'Deals that slipped', 'Forecast upgrades', 'Forecast downgrades', 'Closed Won', 'Closed Lost']) await expect(management.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(management.locator('section').filter({ has: page.getByRole('heading', { name: 'Closed Won', exact: true }) }).getByRole('link', { name: `${tag} Won`, exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Pipeline Movement Help', exact: true }).click();
  await expect(page).toHaveURL(/help\/pipeline-movement/); await expect(page.getByRole('heading', { name: 'Pipeline Movement', exact: true })).toBeVisible();
});
test('snapshot, salesperson, quarter and currency filters change endpoint totals', async ({ page }) => {
  await signInAs(page, 'salesManager'); await page.goto(url());
  await page.getByRole('combobox', { name: 'Salesperson', exact: true }).selectOption(String(managerId)); await page.getByRole('button', { name: 'Compare snapshots' }).click();
  await assertReconciliation(page, '0.00', '75.00'); await expect(page.getByRole('region', { name: 'Deal movement', exact: true }).locator('tbody tr')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Salesperson', exact: true }).selectOption('team'); await page.getByRole('combobox', { name: 'Quarter', exact: true }).selectOption(nextQuarter); await page.getByLabel('Year', { exact: true }).fill(String(nextYear)); await page.getByRole('button', { name: 'Compare snapshots' }).click();
  await assertReconciliation(page, '300.00', '150.00');
  await page.goto(url()); await page.getByRole('combobox', { name: 'Currency', exact: true }).selectOption('CAD'); await page.getByRole('button', { name: 'Compare snapshots' }).click(); await assertReconciliation(page, '1000.00', '1200.00');
  await page.goto(url()); await page.getByRole('combobox', { name: 'Later snapshot', exact: true }).selectOption(String(beforeId)); await page.getByRole('combobox', { name: 'Earlier snapshot', exact: true }).selectOption(''); await page.getByRole('button', { name: 'Compare snapshots' }).click();
  await expect(page.getByRole('combobox', { name: 'Later snapshot', exact: true })).toHaveValue(String(beforeId)); await expect(page.getByRole('combobox', { name: 'Earlier snapshot', exact: true })).not.toHaveValue(String(beforeId));
  await page.goto(`/reports/pipeline-movement?after=${earliestId}`); await expect(page.getByRole('status')).toContainText('No prior weekly snapshot available yet'); await expect(page.getByRole('region', { name: 'Pipeline reconciliation' })).toHaveCount(0);
});
test('Sales defaults own and deliberately selects another rep without changing ownership', async ({ page }) => {
  const beforeOwner = await db.opportunity.findUniqueOrThrow({ where: { id: dealIds['Owner transfer'] }, select: { ownerId: true } });
  await signInAs(page, 'sales'); await page.goto(url());
  await expect(page.getByRole('combobox', { name: 'Salesperson', exact: true })).toHaveValue(String(repId)); await assertReconciliation(page, '875.00', '760.00');
  await expect(page.getByRole('combobox', { name: 'Salesperson', exact: true }).locator('option[value="team"]')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Salesperson', exact: true }).selectOption(String(managerId)); await page.getByRole('button', { name: 'Compare snapshots' }).click();
  await assertReconciliation(page, '0.00', '75.00');
  expect(await db.opportunity.findUniqueOrThrow({ where: { id: dealIds['Owner transfer'] }, select: { ownerId: true } })).toEqual(beforeOwner);
  await page.goto(url('&ownerId=team')); await expect(page.getByRole('alert')).toContainText('eligible salesperson');
});
test('service handles legacy/manual source and immutable records independently of live values', async () => {
  const manager = await db.user.findUniqueOrThrow({ where: { email: emails.salesManager } });
  const old = await db.opportunitySnapshotRun.findFirst({ where: { scopeVersion: 'OPEN_OPERATIONAL_V1' }, orderBy: { snapshotAt: 'asc' } });
  if (old) { const r = await loadPipelineMovement(db, manager, { before: String(old.id), after: String(afterId), year: String(reportYear), quarter: reportQuarter }); expect(r.result?.ending).toBe('835.00'); }
  await db.opportunity.update({ where: { id: dealIds.Upgrade }, data: { name: `${tag} Live renamed`, forecastCategory: 'OMITTED' } });
  const r = await loadPipelineMovement(db, manager, { before: String(beforeId), after: String(afterId), year: String(reportYear), quarter: reportQuarter });
  expect(r.result?.rows.find(row => row.opportunityId === dealIds.Upgrade)?.after?.forecastCategory).toBe('COMMIT');
  expect(r.result?.ending).toBe('835.00');
});
test('effective impersonated Sales actor defaults own; other roles are denied', async ({ page, context }) => {
  test.setTimeout(90_000);
  for (const role of ['readOnly', 'marketing', 'support'] as const) { await signInAs(page, role); await page.goto('/reports/pipeline-movement'); await expect(page).toHaveURL(/access-denied/); }
  if (process.env.ENABLE_DEV_IMPERSONATION === 'true') {
    await signInAs(page, 'admin'); await context.addCookies([{ name: 'saleshub-dev-impersonate-user', value: String(repId), url: baseURL }]); await page.goto(url());
    await expect(page.getByRole('combobox', { name: 'Salesperson', exact: true })).toHaveValue(String(repId)); await assertReconciliation(page, '875.00', '760.00');
    await context.clearCookies();
  }
});
test('desktop, tablet and mobile keep details usable and tables within scrolling containers', async ({ page }) => {
  await signInAs(page, 'admin');
  for (const [width, height] of [[1440, 900], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height }); await page.goto(url());
    await expect(page.getByRole('heading', { name: 'Pipeline Movement', exact: true })).toBeVisible(); await assertReconciliation(page, '875.00', '835.00');
    const row = page.locator(`[data-opportunity-id="${dealIds['Multi-change slip']}"]`); await row.locator('summary').click();
    await expect(row.getByText('Expected close date (previous → current)', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const table = page.getByRole('region', { name: 'Deal movement', exact: true });
    if (width < 1100) expect(await table.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
    await page.screenshot({ path: `reports/pipeline-movement/movement-${width}.png`, fullPage: true, caret: 'initial' });
  }
});
