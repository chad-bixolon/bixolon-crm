import { mkdirSync } from 'node:fs';
import { PrismaClient, type User } from '@prisma/client';
import { test, expect, type Page } from './fixtures';
import { baseURL, databaseUrl, emails } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';
import { listOpportunities } from '../lib/opportunities';
import { resolveUserContext } from '../lib/dev-impersonation';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const prefix = uniqueName('Outcome retrieval');
let admin: User, sales: User, manager: User, reader: User;
let wonReason: number, lostReason: number, historicalReason: number;
let historicName: string, currentName: string;
test.beforeAll(async () => {
  [admin, sales, manager, reader] = await Promise.all([emails.admin, emails.sales, emails.salesManager, emails.readOnly].map(email => db.user.findUniqueOrThrow({ where: { email } })));
  const stages = await Promise.all(['Open', 'Won', 'Lost'].map(state => db.salesStage.create({ data: { name: `${prefix} ${state}`, isClosed: state !== 'Open', isWon: state === 'Won', probability: state === 'Won' ? 100 : 0, sortOrder: 1900 } })));
  historicName = `${prefix} Original price`;
  currentName = `${prefix} Revised price`;
  const reasons = await Promise.all([
    db.outcomeReason.create({ data: { name: `${prefix} Expansion`, isWon: true, sortOrder: 1900 } }),
    db.outcomeReason.create({ data: { name: `${prefix} Competitor`, isWon: false, sortOrder: 1900 } }),
    db.outcomeReason.create({ data: { name: currentName, isWon: false, active: false, sortOrder: 1900 } }),
  ]);
  [wonReason, lostReason, historicalReason] = reasons.map(reason => reason.id);
  const base = { currencyCode: 'USD', forecastCategory: 'OMITTED' as const, expectedCloseDate: new Date('2027-01-01T12:00:00Z') };
  await db.opportunity.createMany({ data: [
    ...Array.from({ length: 25 }, (_, i) => ({ ...base, name: `${prefix} Won ${String(i + 1).padStart(2, '0')}`, ownerId: i < 22 ? sales.id : manager.id, stageId: stages[1].id, actualCloseDate: new Date('2026-10-15T00:00:00Z'), outcomeReasonId: wonReason, outcomeReasonName: reasons[0].name, expectedCloseDate: new Date(`2027-01-${String(i + 1).padStart(2, '0')}T12:00:00Z`) })),
    { ...base, name: `${prefix} Spring boundary`, ownerId: manager.id, stageId: stages[1].id, actualCloseDate: new Date('2026-03-08T00:00:00Z'), outcomeReasonId: wonReason, outcomeReasonName: reasons[0].name },
    { ...base, name: `${prefix} Fall boundary`, ownerId: sales.id, stageId: stages[1].id, actualCloseDate: new Date('2026-11-01T00:00:00Z'), outcomeReasonId: wonReason, outcomeReasonName: reasons[0].name },
    { ...base, name: `${prefix} Legacy Won`, ownerId: manager.id, stageId: stages[1].id },
    { ...base, name: `${prefix} Historical Lost`, ownerId: manager.id, stageId: stages[2].id, actualCloseDate: new Date('2026-10-01T00:00:00Z'), outcomeReasonId: historicalReason, outcomeReasonName: historicName },
    { ...base, name: `${prefix} Competitor Lost`, ownerId: sales.id, stageId: stages[2].id, actualCloseDate: new Date('2026-10-31T00:00:00Z'), outcomeReasonId: lostReason, outcomeReasonName: reasons[1].name },
    { ...base, name: `${prefix} Legacy Lost`, ownerId: sales.id, stageId: stages[2].id },
    { ...base, name: `${prefix} Open`, ownerId: manager.id, stageId: stages[0].id, forecastCategory: 'PIPELINE' },
  ] });
  mkdirSync('reports/outcome-filters', { recursive: true });
});
test.afterAll(async () => {
  await db.savedView.deleteMany({ where: { name: { startsWith: prefix } } });
  await db.$disconnect();
});

test('database results and counts share status/date/reason/search/owner criteria and stable pagination', async () => {
  const list = (filters: Parameters<typeof listOpportunities>[1]) => listOpportunities(db, { q: prefix, ...filters }, sales);
  expect((await list({})).count).toBe(32);
  expect((await list({ outcomeStatus: 'open' })).count).toBe(1);
  expect((await list({ outcomeStatus: 'won' })).count).toBe(28);
  expect((await list({ outcomeStatus: 'lost' })).count).toBe(3);
  expect((await list({ actualCloseFrom: '2026-11-01' })).count).toBe(1);
  expect((await list({ actualCloseTo: '2026-03-08' })).count).toBe(1);
  expect((await list({ actualCloseFrom: '2026-10-01', actualCloseTo: '2026-10-31' })).count).toBe(27);
  expect((await list({ outcomeReasonId: String(historicalReason) })).count).toBe(1);
  expect((await list({ outcomeStatus: 'lost', competitorId: '-1', outcomeReasonId: String(lostReason) })).count).toBe(1);
  const filters = { outcomeStatus: 'won', actualCloseFrom: '2026-10-15', actualCloseTo: '2026-10-15', closePeriod: '2027-Q1' };
  const first = await list(filters), second = await list({ ...filters, page: '2' });
  expect([first.count, first.pages, first.opportunities.length, second.count, second.page, second.opportunities.length]).toEqual([25, 2, 20, 25, 2, 5]);
  expect(new Set([...first.opportunities, ...second.opportunities].map(row => row.id)).size).toBe(25);
  const dates = [...first.opportunities, ...second.opportunities].map(row => row.expectedCloseDate!.getTime());
  expect(dates).toEqual([...dates].sort((a, b) => a - b));
  expect((await list({ ...filters, page: '999' })).page).toBe(2);
  expect((await list({ ...filters, ownerId: String(sales.id) })).count).toBe(22);
  expect((await list({ outcomeStatus: 'won', q: `${prefix} Legacy` })).opportunities[0].actualCloseDate).toBeNull();
  expect((await list({ outcomeStatus: 'won', q: `${prefix} Legacy`, actualCloseFrom: '2026-01-01' })).count).toBe(0);
  for (const actor of [admin, manager, sales, reader]) expect((await listOpportunities(db, { q: prefix, ...filters, ownerId: String(manager.id) }, actor)).count).toBe(3);
  const context = await resolveUserContext({ ...admin, name: 'Admin' }, String(reader.id), db, { NODE_ENV: 'development', ENABLE_DEV_IMPERSONATION: 'true' });
  expect((await listOpportunities(db, { q: prefix, outcomeStatus: 'lost' }, context.effective!)).count).toBe(3);
});

async function expandFilters(page: Page) {
  const form = page.getByRole('form', { name: 'Filter opportunities' });
  const toggle = form.getByRole('button', { name: /Show filters/ });
  if (await toggle.isVisible()) await toggle.click();
  const details = form.locator('details').filter({ has: page.locator('summary', { hasText: 'Outcome filters' }) });
  if (await details.getAttribute('open') === null) await details.locator('summary').click();
  return form;
}

for (const width of [1440, 1024, 768, 390]) test.describe(`${width}px outcome retrieval`, () => {
  test.use({ viewport: { width, height: width === 390 ? 844 : 1024 }, isMobile: width < 1024, hasTouch: width < 1024 });
  test('apply, paginate, save, reopen and clear an outcome view', async ({ page }) => {
    test.setTimeout(120_000);
    await signInAs(page, 'sales');
    await page.goto(`/opportunities?q=${encodeURIComponent(prefix)}`);
    let form = await expandFilters(page);
    await form.getByLabel('Status / Outcome', { exact: true }).selectOption('won');
    await expect(form.getByLabel('Outcome Reason', { exact: true })).not.toContainText(currentName);
    await form.getByLabel('Actual Close Date From', { exact: true }).fill('2026-10-15');
    await form.getByLabel('Actual Close Date Through', { exact: true }).fill('2026-10-15');
    await form.getByLabel('Expected Close Period', { exact: true }).selectOption('2027-Q1');
    await form.getByLabel('Outcome Reason', { exact: true }).selectOption(String(wonReason));
    await form.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByText('25 opportunities · Page 1 of 2', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Next', exact: true }).click();
    await expect(page.getByText('25 opportunities · Page 2 of 2', { exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('actualCloseTo')).toBe('2026-10-15');
    const viewName = `${prefix} ${width} Won`;
    await page.locator('.saved-views-menu summary').click();
    await page.getByRole('button', { name: 'Save current view', exact: true }).click();
    await page.getByRole('dialog', { name: 'Save current view' }).getByLabel('View name').fill(viewName);
    await page.getByRole('button', { name: 'Save view', exact: true }).click();
    // Several named views may intentionally have identical criteria. The existing
    // control can show any matching name; verify this save and apply it explicitly.
    await expect(page.getByRole('dialog', { name: 'Save current view' })).toHaveCount(0);
    const stored = await db.savedView.findFirstOrThrow({ where: { name: viewName } });
    expect(stored.queryState).toEqual({ q: prefix, closePeriod: '2027-Q1', outcomeStatus: 'won', actualCloseFrom: '2026-10-15', actualCloseTo: '2026-10-15', outcomeReasonId: String(wonReason) });
    await page.goto('/accounts');
    await page.goto('/opportunities?closePeriod=');
    await page.locator('.saved-views-menu summary').click();
    await page.getByRole('button', { name: viewName, exact: true }).click();
    await expect(page.getByText('25 opportunities · Page 1 of 2', { exact: true })).toBeVisible();
    form = await expandFilters(page);
    await expect(form.getByLabel('Status / Outcome', { exact: true })).toHaveValue('won');
    await expect(form.getByLabel('Actual Close Date From', { exact: true })).toHaveValue('2026-10-15');
    await expect(form.getByLabel('Actual Close Date Through', { exact: true })).toHaveValue('2026-10-15');
    await expect(form.getByLabel('Outcome Reason', { exact: true })).toHaveValue(String(wonReason));
    await expect(form.locator('details summary')).toContainText('Actual close through 2026-10-15');
    if (width < 1024) await expect(form.getByRole('button', { name: 'Hide filters, 5 active' })).toBeVisible();
    for (const control of await form.locator('details input, details select').all()) {
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.height).toBeGreaterThanOrEqual(40);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `reports/outcome-filters/outcome-filters-${width}.png`, fullPage: true });
    await form.getByLabel('Status / Outcome', { exact: true }).selectOption('lost');
    await expect(form.getByLabel('Outcome Reason', { exact: true })).toHaveValue('');
    await expect(form.getByLabel('Outcome Reason', { exact: true })).not.toContainText(`${prefix} Expansion`);
    await expect(page.locator('.saved-views-menu summary')).toContainText('Modified');
    if (width < 1024) {
      await form.getByRole('button', { name: /Hide filters/ }).click();
      await form.getByRole('link', { name: 'Clear', exact: true }).filter({ visible: true }).click();
    } else await form.getByRole('link', { name: 'Clear', exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}/opportunities?closePeriod=`);
    if (width < 1024) await expect(form.getByRole('button', { name: 'Show filters', exact: true })).toBeVisible();
    form = await expandFilters(page);
    for (const label of ['Status / Outcome', 'Actual Close Date From', 'Actual Close Date Through', 'Outcome Reason']) await expect(form.getByLabel(label, { exact: true })).toHaveValue('');
    await expect(form.getByLabel('Expected Close Period', { exact: true })).toHaveValue('');
  });
});

test('historical reason filtering preserves stored labels; legacy dates and invalid ranges are explained', async ({ page }) => {
  await signInAs(page, 'readOnly');
  await page.goto(`/opportunities?${new URLSearchParams({ q: prefix, outcomeStatus: 'lost', outcomeReasonId: String(historicalReason) })}`);
  const form = await expandFilters(page);
  await expect(form.getByLabel('Outcome Reason', { exact: true })).toContainText(`${currentName} (Inactive)`);
  await expect(page.locator('tbody')).toContainText(historicName);
  await expect(page.locator('tbody')).not.toContainText(currentName);
  await expect(page.getByRole('link', { name: 'New opportunity', exact: true })).toHaveCount(0);
  await page.locator('.saved-views-menu summary').click();
  await page.getByRole('button', { name: 'Save current view', exact: true }).click();
  await page.getByRole('dialog', { name: 'Save current view' }).getByLabel('View name').fill(`${prefix} historical`);
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Save current view' })).toHaveCount(0);
  const saved = await page.request.get('/api/saved-views?route=opportunities');
  expect((await saved.json()).views.find((view: { name: string }) => view.name === `${prefix} historical`).query.outcomeReasonId).toBe(String(historicalReason));
  await page.goto(`/opportunities?${new URLSearchParams({ q: `${prefix} Legacy`, outcomeStatus: 'lost' })}`);
  await expect(page.locator('tbody')).toContainText('Not recorded');
  await page.goto('/opportunities?actualCloseFrom=2026-10-31&actualCloseTo=2026-10-01');
  await expect(page.getByRole('alert')).toContainText('range must end on or after its start');
  await page.goto('/opportunities?actualCloseFrom=2026-02-30');
  await expect(page.getByRole('alert')).toContainText('Choose a valid Actual Close Date');
});
