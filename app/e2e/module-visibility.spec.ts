import { PrismaClient, type DeploymentModule } from '@prisma/client';
import { test, expect } from './fixtures';
import { databaseUrl, names } from './constants.mjs';
import { signInAs } from './helpers';
import { saveOpportunity } from '@/lib/opportunities';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const allModules: DeploymentModule[] = ['OPPORTUNITIES','PROJECTS','SUPPORT_CASES','SUPPORT_INBOX','MARKETING','TRADE_SHOWS','DEMOS','PRICE_EXCEPTIONS','PRODUCTS','SALES_PLANS','FORECASTING'];
const original = new Map<DeploymentModule, boolean>();
test.beforeAll(async () => { for (const row of await db.deploymentModuleVisibility.findMany()) original.set(row.module, row.enabled); });
test.afterAll(async () => {
  for (const feature of allModules) await db.deploymentModuleVisibility.upsert({ where: { module: feature }, create: { module: feature, enabled: original.get(feature) ?? true }, update: { enabled: original.get(feature) ?? true } });
  await db.$disconnect();
});

test('Admin choices govern routes, navigation, search, Quick Actions, dependencies, and restore', async ({ page }) => {
  test.setTimeout(90_000);
  await signInAs(page, 'admin');
  await page.goto('/administration/modules');
  await expect(page.getByRole('heading', { name: 'Modules' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Opportunities' })).toContainText('Enabled');
  await page.getByRole('button', { name: 'Disable Opportunities' }).click();
  await expect(page.getByRole('status')).toContainText('Module setting saved');
  await expect(page.getByRole('region', { name: 'Forecasting' })).toContainText('Unavailable while Opportunities is disabled');
  await expect(page.getByRole('region', { name: 'Sales Plans' })).toContainText('Your Enabled choice is preserved');
  await page.goto('/opportunities');
  await expect(page).toHaveURL(/module-unavailable/);
  await page.goto('/projects');
  await expect(page).not.toHaveURL(/module-unavailable/);
  await page.goto('/reports/pipeline-view');
  await expect(page).toHaveURL(/module-unavailable/);
  await page.goto('/reports');
  await expect(page.getByRole('link', { name: /Trade Show Pipeline/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Leads by Trade Show/ })).toBeVisible();
  await page.goto(`/accounts/${(await db.account.findFirstOrThrow({ where: { name: names.account } })).id}`);
  await expect(page.getByRole('region', { name: 'Quick Actions' }).getByRole('link', { name: 'New Opportunity' })).toHaveCount(0);
  const search = await page.request.get('/api/global-search?q=Opportunity');
  expect(search.status()).toBe(200);
  expect(JSON.stringify(await search.json())).not.toContain('E2E Picker Opportunity');
  expect((await page.request.get('/administration/data-quality?issue=opportunity-owner'))?.status()).toBe(404);
  expect((await page.request.get('/administration/ownership?entity=Opportunity'))?.status()).toBe(200);
  await page.goto('/administration/ownership?entity=Opportunity');
  await expect(page.getByText('Opportunities is currently disabled.')).toBeVisible();
  await page.goto('/administration/maintenance-history?entity=Module');
  await expect(page.getByText('Opportunities: Enabled', { exact: true }).first()).toBeVisible();
  await page.goto('/administration/modules');
  await page.getByRole('button', { name: 'Enable Opportunities' }).click();
  await expect.poll(() => db.deploymentModuleVisibility.findUnique({ where: { module: 'OPPORTUNITIES' } }).then(row => row?.enabled)).toBe(true);
  await expect(page.getByRole('region', { name: 'Opportunities' })).toContainText('Enabled');
  const restoredRoute = await page.request.get('/opportunities', { maxRedirects: 0 });
  expect(restoredRoute.status()).toBe(200);
  await page.goto('/opportunities');
  await expect(page).not.toHaveURL(/module-unavailable/);
  await page.goto('/administration/modules');
  await expect(page.getByRole('region', { name: 'Forecasting' })).not.toContainText('Unavailable while');
  await page.getByRole('button', { name: 'Disable Demos' }).click();
  await expect.poll(() => db.deploymentModuleVisibility.findUnique({ where: { module: 'DEMOS' } }).then(row => row?.enabled)).toBe(false);
  await page.goto('/demos');
  await expect(page).toHaveURL(/module-unavailable/);
  await page.goto('/opportunities');
  await expect(page).not.toHaveURL(/module-unavailable/);
  await page.goto('/administration/modules');
  await page.getByRole('button', { name: 'Enable Demos' }).click();
  await expect.poll(() => db.deploymentModuleVisibility.findUnique({ where: { module: 'DEMOS' } }).then(row => row?.enabled)).toBe(true);
  await expect(page.getByRole('region', { name: 'Demos' })).toContainText('Enabled');
  await page.getByRole('button', { name: 'Disable Trade Shows' }).click();
  await expect.poll(() => db.deploymentModuleVisibility.findUnique({ where: { module: 'TRADE_SHOWS' } }).then(row => row?.enabled)).toBe(false);
  await page.goto('/trade-shows');
  await expect(page).toHaveURL(/module-unavailable/);
  await page.goto('/marketing/campaigns');
  await expect(page).not.toHaveURL(/module-unavailable/);
  await page.goto('/administration/modules');
  await page.getByRole('button', { name: 'Enable Trade Shows' }).click();
  await expect.poll(() => db.deploymentModuleVisibility.findUnique({ where: { module: 'TRADE_SHOWS' } }).then(row => row?.enabled)).toBe(true);
});

test('a small deployment keeps core CRM routes and hides disabled optional modules', async ({ page }) => {
  test.setTimeout(75_000);
  const kept = new Set<DeploymentModule>(['OPPORTUNITIES', 'PROJECTS']);
  try {
    for (const feature of allModules) await db.deploymentModuleVisibility.update({ where: { module: feature }, data: { enabled: kept.has(feature) } });
    await signInAs(page, 'admin');
    for (const path of ['/accounts', '/contacts', '/tasks', '/reports', '/opportunities', '/projects']) {
      await page.goto(path);
      await expect(page.locator('main')).toBeVisible();
      await expect(page).not.toHaveURL(/module-unavailable/);
    }
    for (const path of ['/support/cases', '/marketing/campaigns', '/trade-shows', '/demos', '/price-exceptions', '/products', '/sales-plan', '/reports/forecast-snapshots', '/reports/support-cases']) {
      await page.goto(path);
      await expect(page).toHaveURL(/module-unavailable/);
    }
    const caseCount = await db.supportCase.count();
    const deniedMutation = await page.request.post('/support/cases', { data: { subject: 'Must not be created' }, maxRedirects: 0 });
    expect(deniedMutation.status()).toBe(307);
    expect(await db.supportCase.count()).toBe(caseCount);
    expect((await page.request.get('/api/support/cases/999999/attachments')).status()).toBe(404);
    expect((await page.request.get('/api/saved-views?route=support-cases')).status()).toBe(403);
    expect((await page.request.get('/opportunities/product-search?q=printer', { maxRedirects: 0 })).status()).toBe(307);
    expect((await page.request.get('/opportunities/price-exception-search?skuId=1', { maxRedirects: 0 })).status()).toBe(307);
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Support Cases' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Trade Shows' })).toHaveCount(0);
    await page.goto('/reports');
    await expect(page.locator('a[href="/reports/support-cases"]')).toHaveCount(0);
    await page.goto('/reports/new');
    await expect(page.getByRole('link', { name: 'Product Performance' })).toHaveCount(0);
    await expect(page.getByLabel('Product Category')).toHaveCount(0);
    await page.goto('/reports/new?configured=1&groupBy=productCategory');
    await expect(page.getByRole('option', { name: 'Product Category' })).toHaveCount(0);
    await page.goto('/help');
    await expect(page.locator('a[href="/help/support-cases"]')).toHaveCount(0);
    await expect(page.locator('a[href="/help/trade-shows"]')).toHaveCount(0);
    await page.goto('/administration/data-quality');
    await expect(page.locator('a[href*="issue=project-"]').first()).toBeVisible();
    await expect(page.locator('a[href*="issue=opportunity-"]').first()).toBeVisible();
    await expect(page.locator('a[href="/administration/price-exceptions"]')).toHaveCount(0);
    await page.goto('/administration/ownership');
    await expect(page.getByRole('link', { name: /Support Case.*Module disabled/ })).toBeVisible();
    await expect(page.locator('a[href*="entity=Project"]')).toBeVisible();
    expect((await page.request.get('/administration/ownership?entity=Support%20Case'))?.status()).toBe(200);
  } finally {
    for (const feature of allModules) await db.deploymentModuleVisibility.update({ where: { module: feature }, data: { enabled: original.get(feature) ?? true } });
  }
});

test('only a true Admin can open Modules and controls fit all required widths', async ({ page }) => {
  for (const role of ['salesManager','executive'] as const) {
    await signInAs(page, role);
    await page.goto('/administration/modules');
    await expect(page).toHaveURL(/access-denied/);
  }
  await signInAs(page, 'admin');
  for (const width of [1440, 1024, 820, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/administration/modules', '/']) {
      await page.goto(path);
      await expect(page.locator('main')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${path} at ${width}px`).toBe(true);
    }
  }
});

test('editing an Opportunity while Products and Projects are hidden preserves historical links', async ({ page }) => {
  test.setTimeout(60_000);
  const [admin, stage, account, product, project] = await Promise.all([
    db.user.findFirstOrThrow({ where: { email: 'admin@e2e.saleshub.local' } }),
    db.salesStage.findFirstOrThrow({ where: { name: 'E2E Qualification' } }),
    db.account.findFirstOrThrow({ where: { name: names.account } }),
    db.product.findFirstOrThrow({ where: { sku: names.sku } }),
    db.project.findFirstOrThrow({ where: { name: 'E2E Picker Project' } }),
  ]);
  const id = await saveOpportunity(db, { name: `Visibility preservation ${Date.now()}`, description: null, ownerId: null, projectIds: [project.id], stageId: stage.id, expectedCloseDate: null, probability: null, forecastCategory: 'PIPELINE', currencyCode: 'USD', participants: [{ accountId: account.id, roles: ['END_USER'] }], contacts: [], lines: [{ productId: product.id, quantity: 2, price: '75.00' }] }, undefined, admin);
  try {
    await db.deploymentModuleVisibility.update({ where: { module: 'PRODUCTS' }, data: { enabled: false } });
    await db.deploymentModuleVisibility.update({ where: { module: 'PROJECTS' }, data: { enabled: false } });
    await signInAs(page, 'admin');
    await page.goto(`/opportunities/${id}/edit`);
    await expect(page.getByRole('heading', { name: 'Opportunity products' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Projects' })).toHaveCount(0);
    await page.getByLabel('Opportunity name').fill('Visibility preservation edited');
    await page.getByRole('button', { name: 'Save opportunity' }).click();
    await page.getByRole('button', { name: 'Save anyway' }).last().click();
    await expect(page).toHaveURL(new RegExp(`/opportunities/${id}$`));
    await expect.poll(() => db.opportunity.findUniqueOrThrow({ where: { id } }).then(row => row.name)).toBe('Visibility preservation edited');
    expect(await db.opportunityProduct.count({ where: { opportunityId: id, archivedAt: null } })).toBe(1);
    expect(await db.opportunityProject.count({ where: { opportunityId: id, projectId: project.id } })).toBe(1);
  } finally {
    await db.deploymentModuleVisibility.update({ where: { module: 'PRODUCTS' }, data: { enabled: original.get('PRODUCTS') ?? true } });
    await db.deploymentModuleVisibility.update({ where: { module: 'PROJECTS' }, data: { enabled: original.get('PROJECTS') ?? true } });
  }
});
