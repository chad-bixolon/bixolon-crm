import { PrismaClient, type User } from '@prisma/client';
import { test, expect } from './fixtures';
import { databaseUrl, emails, names } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';
import { saveProjectUpdate } from '../lib/project-updates';
import { saveTradeShow } from '../lib/trade-shows';
import { saveProduct } from '../lib/products';
import { applyProductImport, planProductImport } from '../lib/product-import';
import { saveSkuMetadata } from '../lib/odm-skus';
import { saveReportDefinition } from '../lib/saved-reports';
import { defaultReportConfiguration } from '../lib/reporting';
import { nextUpdatedAt, recordChangedMessage } from '../lib/stale-edit';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let admin: User, readonly: User;
test.beforeAll(async () => {
  [admin, readonly] = await Promise.all([emails.admin, emails.readOnly].map(email => db.user.findUniqueOrThrow({ where: { email } })));
});
test.afterAll(() => db.$disconnect());
const token = (row: { updatedAt: Date }) => row.updatedAt.toISOString();
const updateForm = (body: string, editToken?: string) => { const form = new FormData(); form.set('body', body); if (editToken) form.set('editToken', editToken); return form; };
async function hydratedInput(input: import('@playwright/test').Locator) {
  await expect.poll(() => input.evaluate(element => Object.keys(element).some(key => key.startsWith('__reactProps$')))).toBe(true);
}

test('Project and Opportunity Updates and saved Reports reject stale Admin edits', async () => {
  const [project, opportunity] = await Promise.all([
    db.project.findFirstOrThrow({ where: { name: 'E2E Picker Project' } }),
    db.opportunity.findFirstOrThrow({ where: { name: 'E2E Picker Opportunity' } }),
  ]);
  for (const context of [{ kind: 'project' as const, id: project.id }, { kind: 'opportunity' as const, id: opportunity.id }]) {
    const created = await saveProjectUpdate(db, admin, context, null, updateForm(uniqueName('Original update')));
    const opened = await db.projectUpdate.findUniqueOrThrow({ where: { id: created.id } });
    await saveProjectUpdate(db, admin, context, created.id, updateForm('Latest history', token(opened)));
    await expect(saveProjectUpdate(db, admin, context, created.id, updateForm('Stale history', token(opened)))).rejects.toThrow(recordChangedMessage);
    await expect(saveProjectUpdate(db, admin, context, created.id, updateForm('Missing token'))).rejects.toThrow(recordChangedMessage);
    const latest = await db.projectUpdate.findUniqueOrThrow({ where: { id: created.id } });
    expect(latest.body).toBe('Latest history');
    await expect(saveProjectUpdate(db, readonly, context, created.id, updateForm('Denied', token(latest)))).rejects.toThrow(/Access denied/);
  }
  const reportId = await saveReportDefinition(db, admin, { name: uniqueName('Shared report'), description: null, reportType: 'PIPELINE', visibility: 'SHARED', configuration: defaultReportConfiguration('PIPELINE') });
  const opened = await db.reportDefinition.findUniqueOrThrow({ where: { id: reportId } });
  const input = { name: 'Latest report', description: 'Current definition', reportType: 'PIPELINE', visibility: 'SHARED', configuration: defaultReportConfiguration('PIPELINE') };
  await saveReportDefinition(db, admin, input, reportId, token(opened));
  await expect(saveReportDefinition(db, admin, { ...input, name: 'Stale report' }, reportId, token(opened))).rejects.toThrow(recordChangedMessage);
  await expect(saveReportDefinition(db, admin, input, reportId)).rejects.toThrow(recordChangedMessage);
  const latest = await db.reportDefinition.findUniqueOrThrow({ where: { id: reportId } });
  expect(latest.name).toBe('Latest report');
  await expect(saveReportDefinition(db, readonly, input, reportId, token(latest))).rejects.toThrow(/cannot create|Access denied/);
});

test('concurrent Trade Show setup and Product/SKU saves preserve the winner and relationships', async () => {
  const input = { name: uniqueName('Concurrent show'), startDate: null, endDate: null, location: null, timezone: 'America/New_York', description: null, marketingOwnerId: null, boothNumber: null, resourceLinks: [{ id: null, label: 'Original resource', url: 'https://example.test/initial' }] };
  const showId = await saveTradeShow(db, input, admin);
  const show = await db.tradeShow.findUniqueOrThrow({ where: { id: showId }, include: { resourceLinks: true } });
  const currentLink = show.resourceLinks[0];
  const attempted = ['First', 'Second'].map(name => saveTradeShow(db, { ...input, name, resourceLinks: [{ id: currentLink.id, label: name, url: `https://example.test/${name.toLowerCase()}` }] }, admin, showId, token(show)));
  const results = await Promise.allSettled(attempted);
  expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  const saved = await db.tradeShow.findUniqueOrThrow({ where: { id: showId }, include: { resourceLinks: true } });
  expect(saved.resourceLinks).toHaveLength(1);
  expect(saved.resourceLinks[0].label).toBe(saved.name);
  await expect(saveTradeShow(db, { ...input, name: 'Stale', resourceLinks: [] }, admin, showId, token(show))).rejects.toThrow(recordChangedMessage);
  expect(await db.tradeShowResourceLink.count({ where: { tradeShowId: showId } })).toBe(1);

  const skuNumber = uniqueName('E2E-META').replaceAll(' ', '-');
  const productId = await saveProduct(db, { sku: skuNumber, name: 'Original model', active: true, categoryId: null });
  const product = await db.product.findUniqueOrThrow({ where: { id: productId } });
  const sku = await db.productSku.findUniqueOrThrow({ where: { normalizedPartNumber: skuNumber.toUpperCase() } });
  await saveSkuMetadata(db, { productId, skuId: sku.id, editToken: token(sku), productEditToken: token(product), partNumber: sku.partNumber, description: 'Current SKU description', active: true, catalogSource: null, odmSubtype: null, odmCustomerAccountIds: [], baseSkuId: null, odmDescription: null });
  await expect(saveProduct(db, { sku: skuNumber, name: 'Stale Product', active: false, categoryId: null }, productId, undefined, token(product))).rejects.toThrow(recordChangedMessage);
  await expect(saveSkuMetadata(db, { productId, skuId: sku.id, editToken: token(sku), productEditToken: token(product), partNumber: sku.partNumber, description: 'Stale SKU description', active: false, catalogSource: null, odmSubtype: null, odmCustomerAccountIds: [], baseSkuId: null, odmDescription: null })).rejects.toThrow(recordChangedMessage);
  expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).name).toBe('Original model');
  expect((await db.productSku.findUniqueOrThrow({ where: { id: sku.id } })).description).toBe('Current SKU description');
  const productAtRace = await db.product.findUniqueOrThrow({ where: { id: productId } });
  const productRace = await Promise.allSettled(['First model', 'Second model'].map(name => saveProduct(db, { sku: skuNumber, name, active: true, categoryId: null }, productId, undefined, token(productAtRace))));
  expect(productRace.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  expect(['First model', 'Second model']).toContain((await db.product.findUniqueOrThrow({ where: { id: productId } })).name);
  const [productAtSkuRace, skuAtRace] = await Promise.all([
    db.product.findUniqueOrThrow({ where: { id: productId } }),
    db.productSku.findUniqueOrThrow({ where: { id: sku.id } }),
  ]);
  const skuRace = await Promise.allSettled(['First SKU', 'Second SKU'].map(description => saveSkuMetadata(db, { productId, skuId: sku.id, editToken: token(skuAtRace), productEditToken: token(productAtSkuRace), partNumber: sku.partNumber, description, active: true, catalogSource: null, odmSubtype: null, odmCustomerAccountIds: [], baseSkuId: null, odmDescription: null })));
  expect(skuRace.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  expect(['First SKU', 'Second SKU']).toContain((await db.productSku.findUniqueOrThrow({ where: { id: sku.id } })).description);
});

test('Campaign and Audience edit forms retain entered values after a newer shared save', async ({ page }) => {
  const campaign = await db.marketingCampaign.create({ data: { name: uniqueName('Campaign'), status: 'PLANNED', createdById: admin.id } });
  const audience = await db.marketingAudience.create({ data: { name: uniqueName('Audience'), ownerId: admin.id, createdById: admin.id, visibility: 'SHARED', filterConfig: { preference: 'OPTED_IN' } } });
  await signInAs(page, 'admin');
  await page.goto(`/marketing/campaigns/${campaign.id}/edit`);
  const campaignForm = page.locator('form').filter({ has: page.locator('input[name="name"]') }).first();
  const campaignName = campaignForm.locator('input[name="name"]');
  await hydratedInput(campaignName);
  await campaignName.fill('My Campaign entry');
  await db.marketingCampaign.update({ where: { id: campaign.id }, data: { name: 'Newer Campaign', updatedAt: nextUpdatedAt(campaign.updatedAt) } });
  await campaignForm.getByRole('button', { name: 'Save Campaign' }).click();
  await expect(campaignForm.getByRole('alert').filter({ hasText: recordChangedMessage })).toBeVisible();
  await expect(campaignName).toHaveValue('My Campaign entry');
  expect((await db.marketingCampaign.findUniqueOrThrow({ where: { id: campaign.id } })).name).toBe('Newer Campaign');

  await page.goto(`/marketing/audiences/${audience.id}/edit`);
  const audienceForm = page.locator('form[aria-label="Edit marketing audience"]'), audienceName = audienceForm.locator('input[name="name"]');
  await hydratedInput(audienceName);
  await audienceName.fill('My Audience entry');
  await db.marketingAudience.update({ where: { id: audience.id }, data: { name: 'Newer Audience', updatedAt: nextUpdatedAt(audience.updatedAt) } });
  await audienceForm.getByRole('button', { name: 'Save audience' }).click();
  await expect(audienceForm.getByRole('alert').filter({ hasText: recordChangedMessage })).toBeVisible();
  await expect(audienceName).toHaveValue('My Audience entry');
  expect((await db.marketingAudience.findUniqueOrThrow({ where: { id: audience.id } })).name).toBe('Newer Audience');
});

test('Trade Show, Product and saved Report forms retain entered values on a stale save', async ({ page }) => {
  const show = await db.tradeShow.create({ data: { name: uniqueName('Show'), timezone: 'America/New_York', createdById: admin.id } });
  const skuNumber = uniqueName('E2E-UI-SKU').replaceAll(' ', '-');
  const productId = await saveProduct(db, { sku: skuNumber, name: 'Original Product', active: true, categoryId: null });
  const product = await db.product.findUniqueOrThrow({ where: { id: productId } });
  const reportId = await saveReportDefinition(db, admin, { name: uniqueName('Editable report'), description: null, reportType: 'PIPELINE', visibility: 'SHARED', configuration: defaultReportConfiguration('PIPELINE') });
  const report = await db.reportDefinition.findUniqueOrThrow({ where: { id: reportId } });
  await signInAs(page, 'admin');
  await page.goto(`/trade-shows/${show.id}/edit`);
  const showForm = page.locator('form[aria-label="Edit Trade Show"]'), showName = showForm.locator('input[name="name"]');
  await hydratedInput(showName);
  await showName.fill('My Trade Show entry');
  await db.tradeShow.update({ where: { id: show.id }, data: { name: 'Newer Trade Show', updatedAt: nextUpdatedAt(show.updatedAt) } });
  await showForm.getByRole('button', { name: 'Save Trade Show' }).click();
  await expect(showForm.getByRole('alert').filter({ hasText: recordChangedMessage })).toBeVisible();
  await expect(showName).toHaveValue('My Trade Show entry');
  expect((await db.tradeShow.findUniqueOrThrow({ where: { id: show.id } })).name).toBe('Newer Trade Show');

  await page.goto(`/products/${productId}/edit`);
  const productForm = page.locator('form[aria-label="Edit product"]'), productName = productForm.locator('input[name="name"]');
  await hydratedInput(productName);
  await productName.fill('My Product entry');
  await db.product.update({ where: { id: productId }, data: { name: 'Newer Product', updatedAt: nextUpdatedAt(product.updatedAt) } });
  await productForm.getByRole('button', { name: 'Save product' }).click();
  await expect(productForm.getByRole('alert').filter({ hasText: recordChangedMessage })).toBeVisible();
  await expect(productName).toHaveValue('My Product entry');
  expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).name).toBe('Newer Product');

  await page.goto(`/reports/new?reportId=${reportId}`);
  const reportForm = page.locator('form').filter({ has: page.locator('input[name="configuration"]') }), reportName = reportForm.locator('input[name="name"]');
  await hydratedInput(reportName);
  await reportName.fill('My Report entry');
  await db.reportDefinition.update({ where: { id: reportId }, data: { name: 'Newer Report', updatedAt: nextUpdatedAt(report.updatedAt) } });
  await reportForm.getByRole('button', { name: 'Save changes' }).click();
  await expect(reportForm.getByRole('alert').filter({ hasText: recordChangedMessage })).toBeVisible();
  await expect(reportName).toHaveValue('My Report entry');
  expect((await db.reportDefinition.findUniqueOrThrow({ where: { id: reportId } })).name).toBe('Newer Report');
});

test('Demo conflict notice retains notes and remains readable at five widths and three appearances', async ({ page }) => {
  const account = await db.account.findFirstOrThrow({ where: { name: names.account } });
  const demo = await db.demoRequest.create({ data: { accountId: account.id, requestedAt: new Date(), requestedById: admin.id, status: 'PENDING', notes: 'Original notes' } });
  await signInAs(page, 'admin');
  await page.goto(`/demos/${demo.id}`);
  const notes = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Notes' }) });
  const textarea = notes.locator('textarea[name="notes"]');
  await expect.poll(() => textarea.evaluate(element => Object.keys(element).some(key => key.startsWith('__reactProps$')))).toBe(true);
  await textarea.fill('My entered notes');
  await expect(textarea).toHaveValue('My entered notes');
  await db.demoRequest.update({ where: { id: demo.id }, data: { notes: 'Newer persisted notes', updatedAt: nextUpdatedAt(demo.updatedAt) } });
  await notes.getByRole('button', { name: 'Save notes' }).click();
  const notice = notes.getByRole('alert').filter({ hasText: recordChangedMessage });
  await expect(notice).toBeVisible();
  await expect(textarea).toHaveValue('My entered notes');
  expect((await db.demoRequest.findUniqueOrThrow({ where: { id: demo.id } })).notes).toBe('Newer persisted notes');
  for (const width of [1440, 1024, 820, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const appearance of ['light', 'dark', 'system']) {
      await page.evaluate(value => { document.documentElement.dataset.appearance = value; }, appearance);
      await page.emulateMedia({ colorScheme: appearance === 'system' ? 'dark' : 'light' });
      await notice.scrollIntoViewIfNeeded();
      await expect(notice).toBeInViewport();
      const visual = await notice.evaluate(element => {
        const box = element.getBoundingClientRect(), style = getComputedStyle(element);
        const channels = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
        const luminance = (value: string) => channels(value).map(channel => channel / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
        const values = [luminance(style.color), luminance(style.backgroundColor)];
        return { left: box.left, right: box.right, viewport: innerWidth, contrast: (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05) };
      });
      expect(visual.left).toBeGreaterThanOrEqual(0);
      expect(visual.right).toBeLessThanOrEqual(visual.viewport + 1);
      expect(visual.contrast).toBeGreaterThan(4.5);
    }
  }
});

test('Project and Opportunity Demo unlink controls submit their current Demo version', async ({ page }) => {
  const [project, opportunity] = await Promise.all([
    db.project.findFirstOrThrow({ where: { name: 'E2E Picker Project' }, include: { participants: true } }),
    db.opportunity.findFirstOrThrow({ where: { name: 'E2E Picker Opportunity' }, include: { participants: true } }),
  ]);
  const projectAccountId = project.primaryAccountId ?? project.participants[0]?.accountId;
  const opportunityAccountId = opportunity.participants[0]?.accountId;
  expect(projectAccountId).toBeTruthy();
  expect(opportunityAccountId).toBeTruthy();
  const projectLabel = uniqueName('Project Demo');
  const opportunityLabel = uniqueName('Opportunity Demo');
  const projectDemo = await db.demoRequest.create({ data: { accountId: projectAccountId!, projectId: project.id, requestedAt: new Date(), requestedById: admin.id, status: 'PENDING', demoNumber: projectLabel } });
  const opportunityDemo = await db.demoRequest.create({ data: { accountId: opportunityAccountId!, opportunityId: opportunity.id, requestedAt: new Date(), requestedById: admin.id, status: 'PENDING', demoNumber: opportunityLabel } });
  await signInAs(page, 'admin');
  await page.goto(`/projects/${project.id}?tab=demos`);
  const projectUnlink = page.getByRole('button', { name: `Unlink ${projectLabel} from Project` });
  await hydratedInput(projectUnlink);
  await projectUnlink.click();
  await expect.poll(async () => (await db.demoRequest.findUniqueOrThrow({ where: { id: projectDemo.id } })).projectId).toBeNull();
  await page.goto(`/opportunities/${opportunity.id}`);
  const opportunityUnlink = page.getByRole('button', { name: `Unlink ${opportunityLabel} from Opportunity` });
  await hydratedInput(opportunityUnlink);
  await opportunityUnlink.click();
  await expect.poll(async () => (await db.demoRequest.findUniqueOrThrow({ where: { id: opportunityDemo.id } })).opportunityId).toBeNull();

  const staleLabel = uniqueName('Stale Project Demo');
  const staleDemo = await db.demoRequest.create({ data: { accountId: projectAccountId!, projectId: project.id, requestedAt: new Date(), requestedById: admin.id, status: 'PENDING', demoNumber: staleLabel } });
  await page.goto(`/projects/${project.id}?tab=demos`);
  const staleUnlink = page.getByRole('button', { name: `Unlink ${staleLabel} from Project` });
  await hydratedInput(staleUnlink);
  await db.demoRequest.update({ where: { id: staleDemo.id }, data: { notes: 'Newer note', updatedAt: nextUpdatedAt(staleDemo.updatedAt) } });
  await staleUnlink.click();
  await expect(page.getByRole('alert').filter({ hasText: recordChangedMessage })).toBeVisible();
  expect((await db.demoRequest.findUniqueOrThrow({ where: { id: staleDemo.id } })).projectId).toBe(project.id);
});

test('reviewed catalog import advances Product and SKU tokens before a waiting metadata form saves', async () => {
  const name = uniqueName('Import version model');
  const partNumber = uniqueName('IMPORT-VERSION').replaceAll(' ', '-');
  const productId = await saveProduct(db, { sku: partNumber, name, active: true, categoryId: null });
  const [productAtOpen, skuAtOpen] = await Promise.all([
    db.product.findUniqueOrThrow({ where: { id: productId } }),
    db.productSku.findUniqueOrThrow({ where: { normalizedPartNumber: partNumber.toUpperCase() } }),
  ]);
  const csv = `model,part_number,standard_price,currency\n${name},${partNumber},11.00,USD\n`;
  const preview = await planProductImport(db, csv);
  expect(preview.items[0].status).toBe('READY');
  await applyProductImport(db, csv, preview.digest);
  const [productAfterImport, skuAfterImport] = await Promise.all([
    db.product.findUniqueOrThrow({ where: { id: productId } }),
    db.productSku.findUniqueOrThrow({ where: { id: skuAtOpen.id } }),
  ]);
  expect(productAfterImport.updatedAt.getTime()).toBeGreaterThan(productAtOpen.updatedAt.getTime());
  expect(skuAfterImport.updatedAt.getTime()).toBeGreaterThan(skuAtOpen.updatedAt.getTime());
  await expect(saveProduct(db, { sku: partNumber, name: 'Stale metadata', active: false, categoryId: null }, productId, undefined, token(productAtOpen))).rejects.toThrow(recordChangedMessage);
  await expect(saveSkuMetadata(db, { productId, skuId: skuAtOpen.id, editToken: token(skuAtOpen), productEditToken: token(productAtOpen), partNumber, description: 'Stale SKU description', active: false, catalogSource: null, odmSubtype: null, odmCustomerAccountIds: [], baseSkuId: null, odmDescription: null })).rejects.toThrow(recordChangedMessage);
  expect(await db.productPrice.count({ where: { skuId: skuAtOpen.id } })).toBe(1);
  const nextCsv = `model,part_number,standard_price,currency\n${name},${partNumber},12.00,USD\n`;
  const nextPreview = await planProductImport(db, nextCsv);
  await saveProduct(db, { sku: partNumber, name: 'Newer model metadata', active: true, categoryId: null }, productId, undefined, token(productAfterImport));
  await expect(applyProductImport(db, nextCsv, nextPreview.digest)).rejects.toThrow(/Preview changed/);
  expect((await db.productPrice.findFirstOrThrow({ where: { skuId: skuAtOpen.id } })).amount.toFixed(2)).toBe('11.00');
});
