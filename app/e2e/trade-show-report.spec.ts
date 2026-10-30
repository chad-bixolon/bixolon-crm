import { PrismaClient, type TradeShowLeadRouting } from '@prisma/client';
import { test, expect } from './fixtures';
import { databaseUrl, emails } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';
import { tradeShowColumnLabels, tradeShowMetricLabels } from '../lib/trade-show-report-presentation';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let showId: number, competitorId: number, partnerId: number;
const prefix = uniqueName('Report UX');

test.beforeAll(async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: emails.admin } });
  const sales = await db.user.findUniqueOrThrow({ where: { email: emails.sales } });
  const partner = await db.account.create({ data: { name: `${prefix} partner`, businessRoles: { create: { role: 'PARTNER' } } } });
  partnerId = partner.id;
  const competitor = await db.competitorOption.create({ data: { name: `${prefix} competitor` } });
  competitorId = competitor.id;
  const show = await db.tradeShow.create({ data: { name: prefix, startDate: new Date('2026-10-15T12:00:00Z'), createdById: admin.id } });
  showId = show.id;
  const imported = await db.tradeShowImport.create({ data: { tradeShowId: show.id, format: 'CUSTOM_MAPPING', sourceFileName: 'report.xlsx', sourceSheet: 'Leads', fileSha256: 'c'.repeat(64), uploadedById: admin.id } });
  const routes: TradeShowLeadRouting[] = ['BIXOLON_SALES', 'REFERRED_TO_PARTNER', 'MARKETING_FOLLOW_UP', 'UNREVIEWED'];
  for (const [index, routing] of routes.entries()) await db.tradeShowLead.create({ data: {
    tradeShowId: show.id, firstImportId: imported.id, sourceKey: `report-${index}`, sourceFileName: 'report.xlsx', sourceSheet: 'Leads', sourceRow: index + 1, rawSourceData: {},
    firstName: 'Report', lastName: `Lead ${index}`, sourceCompany: prefix, productInterest: 'Warehouse', routing,
    assignedSalesRepUserId: routing === 'BIXOLON_SALES' ? sales.id : null,
    routedPartnerAccountId: routing === 'REFERRED_TO_PARTNER' ? partner.id : null,
    competitorId: competitor.id, competitorSourceText: 'Existing equipment', capturedAt: new Date('2026-10-16'),
  } });
});

test.afterAll(async () => {
  if (showId) {
    await db.tradeShowLead.deleteMany({ where: { tradeShowId: showId } });
    await db.tradeShowImport.deleteMany({ where: { tradeShowId: showId } });
    await db.tradeShow.delete({ where: { id: showId } });
  }
  if (competitorId) await db.competitorOption.delete({ where: { id: competitorId } });
  if (partnerId) {
    await db.accountBusinessRole.deleteMany({ where: { accountId: partnerId } });
    await db.account.delete({ where: { id: partnerId } });
  }
  await db.$disconnect();
});

for (const width of [1440, 768, 390]) test(`Trade Show Performance → filters → advanced filters → metric customization → Preview at ${width}px`, async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width, height: 1000 });
  await signInAs(page, 'marketing');
  await page.goto(`/reports/trade-shows?configured=1&tradeShowId=${showId}`);
  const form = page.getByRole('form', { name: 'Trade Show report options' });
  const advanced = form.locator('details').filter({ has: page.locator('summary', { hasText: 'Advanced Filters' }) });
  const metrics = form.locator('details').filter({ has: page.locator('summary', { hasText: 'Customize metrics' }) });
  const columns = form.locator('details').filter({ has: page.locator('summary', { hasText: 'Customize columns' }) });
  const summary = page.getByRole('region', { name: 'Routing summary' });
  await expect(summary.locator('.panel').filter({ has: page.getByText('Total Leads', { exact: true }) })).toContainText('4');
  await expect(summary.locator('.panel').filter({ has: page.getByText('Routed Leads', { exact: true }) })).toContainText('3');
  await expect(page.getByText('Assigned Leads', { exact: true })).toHaveCount(0);
  for (const section of [advanced, metrics, columns]) await expect(section).not.toHaveAttribute('open');
  for (const name of ['Trade Show', 'Assigned Sales Rep', 'Lead Status', 'Routing', 'Follow-Up']) await expect(form.getByRole('combobox', { name, exact: true })).toBeVisible();
  for (const name of ['Search', 'Product Interest']) await expect(form.getByRole('textbox', { name, exact: true })).toBeVisible();
  await expect(form.getByRole('combobox', { name: 'Partner', exact: true })).toBeVisible();
  await expect(advanced.getByRole('combobox', { name: 'Account Match', exact: true })).toBeHidden();
  await page.screenshot({ path: `/tmp/trade-show-report-${width}-collapsed.png`, fullPage: true, caret: 'initial' });

  await form.getByRole('combobox', { name: 'Routing', exact: true }).selectOption('REFERRED_TO_PARTNER');
  await form.getByRole('combobox', { name: 'Lead Status', exact: true }).selectOption('NEW');
  await form.getByRole('textbox', { name: 'Search', exact: true }).fill('Report');
  await form.getByRole('textbox', { name: 'Product Interest', exact: true }).fill('Warehouse');
  await form.getByRole('combobox', { name: 'Partner', exact: true }).fill(`${prefix} partner`);
  await page.getByRole('option', { name: `${prefix} partner` }).click();
  const advancedToggle = advanced.locator('summary');
  await advancedToggle.focus();
  await page.keyboard.press('Enter');
  await expect(advanced).toHaveAttribute('open', '');
  await advanced.getByRole('combobox', { name: 'Account Match', exact: true }).selectOption('false');
  await advanced.getByRole('combobox', { name: 'Contact Match', exact: true }).selectOption('false');
  await advanced.getByRole('combobox', { name: 'Competitor', exact: true }).selectOption(String(competitorId));
  await advanced.getByRole('combobox', { name: 'Event Date', exact: true }).selectOption('CUSTOM');
  await form.getByLabel('Event date from', { exact: true }).fill('2026-10-01');
  await form.getByLabel('Event date to', { exact: true }).fill('2026-10-31');
  await expect(advanced.getByRole('combobox', { name: 'Opportunity Stage', exact: true })).toBeVisible();
  await expect(advanced.getByRole('combobox', { name: 'Forecast Category', exact: true })).toBeVisible();
  await advancedToggle.focus();
  await page.keyboard.press('Space');
  await expect(advanced).not.toHaveAttribute('open');
  await form.getByRole('combobox', { name: 'Group By', exact: true }).selectOption('routing');
  await form.getByRole('combobox', { name: 'Sort', exact: true }).selectOption('capturedDate');
  await form.getByRole('combobox', { name: 'Sort Order', exact: true }).selectOption('asc');

  for (const [section, labels] of [[metrics, tradeShowMetricLabels], [columns, tradeShowColumnLabels]] as const) {
    await section.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(section.getByRole('checkbox')).toHaveCount(Object.keys(labels).length);
    for (const [key, label] of Object.entries(labels)) {
      const checkbox = section.getByRole('checkbox', { name: label, exact: true });
      await expect(checkbox).toHaveValue(key);
      await checkbox.uncheck();
      await checkbox.check();
    }
  }
  // Check layout with every customization option exposed, including on a phone.
  expect(await form.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: `/tmp/trade-show-report-${width}-customize.png`, fullPage: true, caret: 'initial' });
  for (const section of [metrics, columns]) await section.locator('summary').click();
  await form.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page).toHaveURL(/accountLinked=false/);
  const query = new URL(page.url()).searchParams;
  expect(query.get('contactLinked')).toBe('false');
  expect(query.get('competitorId')).toBe(String(competitorId));
  expect(query.get('referralPartnerId')).toBe(String(partnerId));
  expect(query.get('showDatePreset')).toBe('CUSTOM');
  expect(query.get('sortDirection')).toBe('asc');
  expect(query.getAll('metrics').sort()).toEqual(Object.keys(tradeShowMetricLabels).sort());
  expect(query.getAll('columns').sort()).toEqual(Object.keys(tradeShowColumnLabels).sort());
  await expect(advanced).not.toHaveAttribute('open');
  await expect(advanced.locator('summary')).toContainText('4 applied');
  await expect(summary.locator('.panel').filter({ has: page.getByText('Routed Leads', { exact: true }) })).toContainText('1');
  await expect(page.getByRole('heading', { name: 'Lead details (1)', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Conversion funnel', exact: true })).toBeVisible();
  const details = page.getByRole('region', { name: 'Trade Show lead details table', exact: true });
  for (const label of ['Opportunity', 'Pipeline Value', 'Weighted Pipeline', 'Competitor Detail', 'Lead Captured Date']) await expect(details.getByRole('columnheader', { name: label, exact: true })).toBeAttached();
  await metrics.locator('summary').click();
  await columns.locator('summary').click();
  for (const section of [metrics, columns]) for (const checkbox of await section.getByRole('checkbox').all()) await expect(checkbox).toBeChecked();
});
