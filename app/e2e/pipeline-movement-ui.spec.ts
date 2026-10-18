import { Prisma, PrismaClient } from '@prisma/client';
import { test, expect, type Page } from './fixtures';
import { databaseUrl, emails } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';
import { snapshotWeek, FORECAST_SNAPSHOT_SCOPE } from '../lib/opportunity-snapshots';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let year: number;
const runs: Record<string, number[]> = { Q1: [], Q2: [], Q3: [] };
const route = (quarter = 'Q2', extra = '') => `/reports/pipeline-movement/history?year=${year}&quarter=${quarter}&window=quarter${extra}`;

test.beforeAll(async () => {
  year = 2010;
  while (year < 2080 && await db.opportunitySnapshotRun.findFirst({ where: { snapshotWeek: { gte: new Date(`${year}-01-01`), lt: new Date(`${year + 1}-01-08`) } } })) year++;
  if (year >= 2080) throw new Error('No free UI fixture year in the isolated E2E database.');
  const owner = await db.user.findUniqueOrThrow({ where: { email: emails.sales } });
  const stage = await db.salesStage.findUniqueOrThrow({ where: { name: 'E2E Qualification' } });
  const account = await db.account.create({ data: { name: uniqueName('Polish Account') } });
  const opportunity = await db.opportunity.create({ data: { name: uniqueName('Polish Opportunity'), ownerId: owner.id, stageId: stage.id, currencyCode: 'USD', participants: { create: { accountId: account.id } } } });
  for (const [quarter, month, count] of [['Q1', 1, 2], ['Q2', 4, 3], ['Q3', 7, 1]] as const) for (let i = 0; i < count; i++) {
    const at = new Date(Date.UTC(year, month, 20 + i * 7, 15));
    await db.$transaction(async tx => {
      const run = await tx.opportunitySnapshotRun.create({ data: { snapshotAt: at, snapshotWeek: snapshotWeek(at), source: 'SCHEDULED', createdByName: 'Automated UI fixture', scopeVersion: FORECAST_SNAPSHOT_SCOPE, opportunityCount: 1 } });
      await tx.opportunitySnapshot.create({ data: { runId: run.id, snapshotAt: at, opportunityId: opportunity.id, opportunityName: opportunity.name, ownerId: owner.id, ownerName: 'Snapshot owner', ownerForecastEligible: true, stageId: stage.id, stageName: 'Qualification', stageProbability: 20, probability: 20, forecastCategory: 'COMMIT', status: 'OPEN', amount: new Prisma.Decimal([100, 120, 150][i]), currencyCode: 'USD', expectedCloseDate: new Date(Date.UTC(year, month, 25, 12)), accounts: [{ id: account.id, name: account.name }], accountIds: [account.id], productCount: 0 } });
      runs[quarter].push(run.id);
    });
  }
});
test.afterAll(() => db.$disconnect());

async function expectBounded(page: Page, tablet: boolean) {
  const result = await page.locator('main').evaluate(main => {
    const bounds = main.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      controls: [...main.querySelectorAll('input.field, select.field')].map(field => field.getBoundingClientRect()).filter(box => box.width > 0).map(box => ({ height: box.height, bounded: box.left >= bounds.left - 1 && box.right <= bounds.right + 1 })),
    };
  });
  expect(result.overflow).toBe(false);
  for (const control of result.controls) {
    expect(control.bounded).toBe(true);
    if (tablet) expect(control.height).toBeCloseTo(44, 0);
  }
}

test('business labels, main filters and Advanced filter values survive collapse and submit', async ({ page }) => {
  await signInAs(page, 'salesManager'); await page.goto(route());
  await expect(page.getByRole('heading', { name: 'Pipeline Movement', exact: true })).toBeVisible();
  const advanced = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Advanced filters$/ }) });
  await expect(advanced).not.toHaveAttribute('open');
  for (const label of ['Quarter', 'Comparison window', 'Salesperson', 'Currency', 'Forecast Category']) await expect(page.getByRole('combobox', { name: label, exact: true })).toBeVisible();
  await expect(page.getByLabel('Year', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Account', exact: true })).toBeHidden();
  await advanced.locator('summary').focus(); await page.keyboard.press('Enter');
  await expect(advanced).toHaveAttribute('open', '');
  await page.getByRole('combobox', { name: 'Reference Snapshot', exact: true }).selectOption(String(runs.Q2[0]));
  await page.getByRole('combobox', { name: 'Outcome View', exact: true }).selectOption('lost-commit');
  await advanced.locator('summary').click(); await page.getByRole('button', { name: 'Update history' }).click();
  await expect(page).toHaveURL(new RegExp(`cohortRun=${runs.Q2[0]}`)); await expect(page).toHaveURL(/reasonView=lost-commit/);
  await expect(advanced).toHaveAttribute('open', '');
  await expect(page.locator('[data-history-measure="Pipeline change"]')).toHaveAttribute('data-value', '50.00');
  await expect(page.getByRole('heading', { name: 'Forecast Outcome Analysis', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Account & Owner Movement', exact: true })).toBeVisible();
  await expect(page.locator('main h1')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Pipeline Movement Help', exact: true })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'History & Outcomes', exact: true })).toHaveAttribute('aria-current', 'page');
  const currentHref = await page.getByRole('link', { name: 'History & Outcomes', exact: true }).getAttribute('href');
  expect(currentHref).toContain('reasonView=lost-commit');
  await expect(page.getByRole('link', { name: 'Weekly Comparison', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Weekly Comparison', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Weekly Comparison', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: 'History & Outcomes', exact: true })).not.toHaveAttribute('aria-current');
  await expect(page.getByLabel('Year', { exact: true })).toHaveValue(String(year));
  await expect(page.getByRole('combobox', { name: 'Quarter', exact: true })).toHaveValue('Q2');
  await expect(page.locator('main h1')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Pipeline Movement Help', exact: true })).toHaveCount(1);
  await expect(page.locator('main')).not.toContainText(/\(v[12]\)|Pipeline Movement v2/);
});

test('unavailable history, a single snapshot, two snapshots and valid zero results are distinct', async ({ page }) => {
  await signInAs(page, 'admin');
  await page.goto(route('Q4')); await expect(page.getByRole('status').filter({ hasText: 'No weekly snapshots are available for this quarter yet.' })).toBeVisible(); await expect(page.getByRole('region', { name: 'Executive summary', exact: true })).toHaveCount(0);
  await page.goto(route('Q3'));
  const figure = page.getByRole('figure', { name: 'Pipeline trend chart' });
  await expect(figure).toContainText('One weekly snapshot is available'); await expect(figure.locator('svg')).toHaveCount(0);
  await expect(page.locator('[data-history-measure="Pipeline change"]')).toHaveAttribute('data-value', '');
  await expect(page.getByRole('region', { name: 'Trend data', exact: true }).locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Deals That Slipped', exact: true })).toContainText('More weekly history is needed');
  await page.goto(route('Q1')); await expect(figure).toContainText('Two snapshots are available'); await expect(figure.locator('svg')).toHaveCount(1);
  await page.goto(route('Q2', '&category=BEST_CASE&cohortCategory=BEST_CASE'));
  await expect(page.locator('[data-history-measure="Pipeline change"]')).toHaveAttribute('data-value', '0.00');
  await expect(page.getByRole('region', { name: 'Forecast outcomes', exact: true })).toContainText('No matching Opportunities for the selected filters.');
  await expect(page.getByRole('region', { name: 'Deals That Slipped', exact: true })).toContainText('No observed slipped deals in this period.');
});

test('responsive main and Advanced filters, 44px tablet controls and readable charts', async ({ page }, info) => {
  await signInAs(page, 'admin'); await page.goto(route(), { waitUntil: 'networkidle' });
  const width = page.viewportSize()!.width;
  await expect(page.getByRole('link', { name: 'History & Outcomes', exact: true })).toHaveAttribute('aria-current', 'page');
  for (const link of await page.getByRole('navigation', { name: 'Pipeline Movement views' }).getByRole('link').all()) {
    expect(await link.evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('region', { name: 'Executive summary', exact: true }).screenshot({ path: info.outputPath('summary.png'), caret: 'initial' });

  await expectBounded(page, width >= 640 && width < 1280);
  await expect(page.getByRole('combobox', { name: 'Comparison window', exact: true })).toBeVisible();
  await page.locator('summary').filter({ hasText: /^Advanced filters$/ }).click();
  await expect(page.getByRole('combobox', { name: 'Reference Snapshot', exact: true })).toBeVisible();
  await expectBounded(page, width >= 640 && width < 1280);
  const disclosureHeight = await page.locator('summary').filter({ hasText: /^Advanced filters$/ }).evaluate(node => node.getBoundingClientRect().height); expect(disclosureHeight).toBeGreaterThanOrEqual(44);
  await page.getByRole('form', { name: 'Pipeline history filters' }).screenshot({ path: info.outputPath('advanced-filters.png'), caret: 'initial' });
  await page.getByRole('figure', { name: 'Pipeline trend chart' }).screenshot({ path: info.outputPath('trend.png'), caret: 'initial' });
  await page.locator('summary').filter({ hasText: /^Advanced filters$/ }).click();
  await page.getByRole('form', { name: 'Pipeline history filters' }).screenshot({ path: info.outputPath('main-filters.png'), caret: 'initial' });
  await page.getByRole('link', { name: 'Pipeline Movement Help', exact: true }).click();
  await page.waitForURL('**/help/pipeline-movement');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'Forecast Outcome Analysis', exact: true })).toBeVisible();
  await expect(page.locator('main')).toContainText('Advanced filters');
  await page.goto(`/reports/pipeline-movement?before=${runs.Q2[0]}&after=${runs.Q2[2]}&year=${year}&quarter=Q2`);
  await expectBounded(page, width >= 640 && width < 1280);
  await expect(page.locator('[data-measure="Starting Pipeline"]')).toHaveAttribute('data-value', '100.00');
  await expect(page.locator('[data-measure="Ending Pipeline"]')).toHaveAttribute('data-value', '150.00');
});
