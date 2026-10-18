import { test, expect, type Page } from './fixtures';
import { Prisma, PrismaClient, type User } from '@prisma/client';
import { signInAs, uniqueName } from './helpers';
import { databaseUrl, emails, baseURL } from './constants.mjs';
import { snapshotWeek, FORECAST_SNAPSHOT_SCOPE } from '../lib/opportunity-snapshots';
import { loadMovementHistory } from '../lib/pipeline-movement-history-report';
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const tag = uniqueName('History');
let year: number, rep: User, manager: User, accountId: number;
const runIds: number[] = [], dealIds: Record<string, number> = {};
const url = (extra = '') => `/reports/pipeline-movement/history?year=${year}&quarter=Q4&cohortRun=${runIds[0]}${extra}`;
async function openAdvanced(page: Page) { const summary = page.locator('summary').filter({ hasText: /^Advanced filters$/ }); if (!(await summary.evaluate(node => node.parentElement!.hasAttribute('open')))) await summary.click(); }
test.beforeAll(async () => {
  [rep, manager] = await Promise.all([emails.sales, emails.salesManager].map(email => db.user.findUniqueOrThrow({ where: { email } })));
  year = 2088;
  while (year > 2002 && await db.opportunitySnapshotRun.findFirst({ where: { snapshotWeek: { gte: new Date(`${year - 1}-09-24`), lt: new Date(`${year + 1}-01-08`) } } })) year -= 2;
  if (year <= 2002) throw new Error('No unused pair of fixture quarters. Reset the dedicated E2E database.');
  const admin = await db.user.findUniqueOrThrow({ where: { email: emails.admin } });
  const account = await db.account.create({ data: { name: `${tag} Frozen account` } }); accountId = account.id;
  const open = await db.salesStage.create({ data: { name: `${tag} Open`, probability: 20, sortOrder: 980 } });
  const won = await db.salesStage.create({ data: { name: `${tag} Won`, probability: 100, sortOrder: 981, isClosed: true, isWon: true } });
  const lost = await db.salesStage.create({ data: { name: `${tag} Lost`, probability: 0, sortOrder: 982, isClosed: true, isWon: false } });
  await db.currency.upsert({ where: { code: 'CAD' }, update: {}, create: { code: 'CAD', name: 'Canadian Dollar' } });
  const labels = ['Commit won', 'Best later', 'Slip lost', 'Reopened', 'Legacy', 'Lost commit', 'New', 'CAD', 'Other owner', 'Already won'];
  for (const label of labels) {
    const isWon = ['Commit won', 'Best later', 'Legacy', 'Already won'].includes(label), isLost = ['Slip lost', 'Lost commit'].includes(label);
    const later = ['Best later', 'Slip lost'].includes(label);
    dealIds[label] = (await db.opportunity.create({ data: { name: `${tag} ${label}`, ownerId: label === 'Other owner' ? manager.id : rep.id, stageId: isWon ? won.id : isLost ? lost.id : open.id, expectedCloseDate: new Date(`${year}-12-01T12:00:00Z`), actualCloseDate: label === 'Legacy' || !isWon && !isLost ? null : new Date(`${later ? year + 1 : year}-${later ? '02-03' : '12-20'}`), outcomeReasonName: isWon ? 'Historical won label (inactive)' : isLost ? 'Historical lost label' : null, currencyCode: label === 'CAD' ? 'CAD' : 'USD', participants: { create: { accountId } } } })).id;
  }
  for (const [i, eventType] of ['CLOSED', 'OUTCOME_REOPENED', 'CLOSED', 'OUTCOME_REOPENED'].entries()) await db.opportunityHistoryEvent.create({ data: { opportunityId: dealIds.Reopened, opportunityName: `${tag} Reopened`, eventType, occurredAt: new Date(`${year}-11-0${i + 1}T12:00:00Z`), newOutcome: { status: eventType === 'CLOSED' ? 'Closed Won' : 'Open', actualCloseDate: null } } });
  for (const y of [year - 1, year]) for (let i = 0; i < 13; i++) {
    if (y === year && i === 6) continue;
    const at = new Date(Date.UTC(y, 9, 4 + i * 7, 15));
    await db.$transaction(async tx => {
    const run = await tx.opportunitySnapshotRun.create({ data: { snapshotAt: at, snapshotWeek: snapshotWeek(at), createdById: i % 2 ? null : admin.id, createdByName: i % 2 ? 'Automated weekly capture' : 'Fixture Admin', source: i % 2 ? 'SCHEDULED' : 'MANUAL', scopeVersion: FORECAST_SNAPSHOT_SCOPE, opportunityCount: i < 3 ? 9 : 10 } });
    if (y === year) runIds.push(run.id);
    await tx.opportunitySnapshot.createMany({ data: labels.filter(label => label !== 'New' || i >= 3).map((label, n) => ({ runId: run.id, snapshotAt: at, opportunityId: dealIds[label], opportunityName: `${tag} ${label}`, accounts: [{ id: accountId, name: account.name }], accountIds: [accountId], ownerId: label === 'Other owner' ? manager.id : rep.id, ownerName: label === 'Other owner' ? 'Frozen manager' : 'Frozen sales', ownerForecastEligible: true, amount: new Prisma.Decimal((n + 1) * 100), currencyCode: label === 'CAD' ? 'CAD' : 'USD', expectedCloseDate: new Date(`${label === 'Slip lost' && i >= 2 ? y + 1 : y}-${label === 'Slip lost' && i >= 2 ? '01-20' : '12-01'}T12:00:00Z`), stageId: open.id, stageName: 'Captured Open', stageProbability: 20, probability: 20, forecastCategory: label === 'Already won' ? 'CLOSED' : ['Best later', 'Legacy'].includes(label) ? 'BEST_CASE' : 'COMMIT', status: label === 'Already won' || label === 'Commit won' && i >= 9 ? 'WON' : 'OPEN', productCount: 1 })) });
    });
  }
});
test.afterAll(async () => { await db.opportunity.updateMany({ where: { id: { in: Object.values(dealIds) } }, data: { archivedAt: new Date() } }); await db.$disconnect(); });
test('trend windows, quarter progression, missing weeks and frozen Account filter', async ({ page }) => {
  await signInAs(page, 'salesManager'); await page.goto(url('&window=quarter'));
  await expect(page.getByRole('region', { name: 'Trend data', exact: true }).locator('tbody tr')).toHaveCount(12);
  await expect(page.getByText('Missing weekly snapshots · change spans the gap', { exact: true })).toBeVisible();
  await expect(page.getByRole('figure', { name: 'Pipeline trend chart' })).toBeVisible();
  for (const [window, count] of [['4', 5], ['8', 8], ['12', 12]] as const) {
    await page.getByRole('combobox', { name: 'Comparison window', exact: true }).selectOption(window); await page.getByRole('button', { name: 'Update history' }).click();
    await expect(page.getByRole('region', { name: 'Trend data', exact: true }).locator('tbody tr')).toHaveCount(count);
  }
  await openAdvanced(page); await page.getByRole('combobox', { name: 'Account', exact: true }).selectOption(String(accountId)); await page.getByRole('button', { name: 'Update history' }).click(); await expect(page.getByRole('combobox', { name: 'Account', exact: true })).toHaveValue(String(accountId));
});
test('Commit/Best Case cohorts, unknown actual dates and reopened history count deals once', async ({ page }) => {
  await signInAs(page, 'salesManager'); await page.goto(url('&window=quarter'));
  const detail = page.getByRole('region', { name: 'Forecast outcome detail', exact: true });
  await expect(detail.getByRole('row').filter({ hasText: `${tag} Commit won` })).toContainText('Closed Won in-period');
  const reopened = detail.getByRole('row').filter({ hasText: `${tag} Reopened` }); await expect(reopened).toContainText('Still open'); await expect(reopened).toContainText('2 recorded closures · 2 reopenings');
  await reopened.getByText('Closure & Reopening History', { exact: true }).click(); await expect(reopened).toContainText('OUTCOME REOPENED');
  await openAdvanced(page); await page.getByRole('combobox', { name: 'Reference Category', exact: true }).selectOption('BEST_CASE'); await page.getByRole('button', { name: 'Update history' }).click();
  await expect(detail.getByRole('row').filter({ hasText: `${tag} Best later` })).toContainText('Closed Won later'); await expect(detail.getByRole('row').filter({ hasText: `${tag} Legacy` })).toContainText('Actual close unknown'); await expect(detail.locator('tbody tr')).toHaveCount(2);
});
test('slippage detail and outcome reason filters preserve historical labels', async ({ page }) => {
  await signInAs(page, 'salesManager'); await page.goto(url('&window=quarter'));
  const slip = page.getByRole('region', { name: 'Slippage detail', exact: true }); await expect(slip.locator('tbody tr')).toHaveCount(1); await expect(slip).toContainText(`${tag} Slip lost`); await expect(slip).toContainText(`${year + 1} Q1`);
  await openAdvanced(page); await page.getByRole('combobox', { name: 'Outcome View', exact: true }).selectOption('lost-slipped'); await page.getByRole('button', { name: 'Update history' }).click();
  const reasons = page.getByRole('region', { name: 'Outcome reason groups', exact: true }); await expect(reasons).toContainText('Historical lost label');
  await page.getByRole('combobox', { name: 'Outcome reason', exact: true }).selectOption('Historical lost label'); await page.getByRole('button', { name: 'Update history' }).click(); await expect(reasons.locator('tbody td').first()).toHaveText('1');
  await page.goto(url('&window=quarter&reasonView=won')); await expect(reasons).toContainText('Historical won label (inactive)');
});
test('quarter comparison requires compatible matching weeks', async ({ page }) => {
  await signInAs(page, 'salesManager'); await page.goto(url(`&window=quarter&compareYear=${year - 1}&compareQuarter=Q4`));
  const comparison = page.getByRole('region', { name: 'Quarter comparison', exact: true }); await expect(comparison.locator('table').first().locator('tbody tr')).toHaveCount(12); await expect(comparison).toContainText('Comparison quarter outcome mix');
  await page.goto(url('&window=quarter&compareYear=2000&compareQuarter=Q1')); await expect(comparison).toContainText('More weekly history is needed to compare these quarters');
});
test('Sales self default, cross-rep selection, currency, permissions and impersonation', async ({ page, context }) => {
  await signInAs(page, 'sales'); await page.goto(url('&window=quarter'));
  await expect(page.getByRole('combobox', { name: 'Salesperson', exact: true })).toHaveValue(String(rep.id)); await expect(page.getByRole('combobox', { name: 'Salesperson', exact: true }).locator('option[value="team"]')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Salesperson', exact: true }).selectOption(String(manager.id)); await page.getByRole('button', { name: 'Update history' }).click(); await expect(page.getByRole('region', { name: 'Forecast outcome detail', exact: true }).locator('tbody tr')).toHaveCount(1);
  await page.goto(url('&window=quarter&currencyCode=CAD')); await expect(page.getByRole('region', { name: 'Executive summary', exact: true })).toContainText('CAD'); await expect(page.getByRole('region', { name: 'Forecast outcome detail', exact: true }).locator('tbody tr')).toHaveCount(1);
  await page.goto(url('&ownerId=team')); await expect(page.getByRole('alert')).toContainText('eligible salesperson');
  if (process.env.ENABLE_DEV_IMPERSONATION === 'true') { await signInAs(page, 'admin'); await context.addCookies([{ name: 'saleshub-dev-impersonate-user', value: String(rep.id), url: baseURL }]); await page.goto(url()); await expect(page.getByRole('combobox', { name: 'Salesperson', exact: true })).toHaveValue(String(rep.id)); await context.clearCookies(); }
  for (const role of ['readOnly', 'marketing', 'support'] as const) { await signInAs(page, role); await page.goto(url()); await expect(page).toHaveURL(/access-denied/); }
});
test('desktop/tablet/mobile layouts and contextual Help', async ({ page }) => {
  await signInAs(page, 'admin');
  for (const [width, height] of [[1440, 900], [768, 1024], [390, 844]]) { await page.setViewportSize({ width, height }); await page.goto(url('&window=quarter')); await expect(page.getByRole('region', { name: 'Quarter progression', exact: true })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true); await page.screenshot({ path: `reports/pipeline-movement/history-${width}.png`, fullPage: true, caret: 'initial' }); await page.getByRole('figure', { name: 'Pipeline trend chart' }).screenshot({ path: `reports/pipeline-movement/history-chart-${width}.png`, caret: 'initial' }); }
  await page.getByRole('link', { name: 'Pipeline Movement Help', exact: true }).click(); for (const heading of ['Multi-week trends and quarter progression', 'Forecast Outcome Analysis', 'Expected vs Actual Close', 'Slippage detail', 'Won and Lost reasons', 'Quarter comparison and historical dimensions']) await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
});
test('service preserves immutable snapshots, null actual close and frozen Account labels', async () => {
  const before = await db.opportunitySnapshot.findMany({ where: { runId: { in: runIds } }, orderBy: { id: 'asc' } }); await db.account.update({ where: { id: accountId }, data: { name: `${tag} Renamed live account` } });
  const r = await loadMovementHistory(db, manager, { year: String(year), quarter: 'Q4', window: 'quarter', cohortRun: String(runIds[0]), cohortCategory: 'BEST_CASE' }); expect(r.cohort.find(c => c.row.opportunityId === dealIds.Legacy)?.timing).toBe('Actual close unknown'); expect(r.accounts[0].name).toBe(`${tag} Frozen account`); expect(await db.opportunitySnapshot.findMany({ where: { runId: { in: runIds } }, orderBy: { id: 'asc' } })).toEqual(before);
});
