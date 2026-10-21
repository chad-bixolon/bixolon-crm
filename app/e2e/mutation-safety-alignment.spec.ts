import { PrismaClient, type User, type Prisma } from '@prisma/client';
import { test, expect } from './fixtures';
import { databaseUrl, emails, names, baseURL } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';
import { saveTradeShowLeadUpdate } from '../lib/trade-show-leads';
import { correctPriceExceptionReference } from '../lib/price-exception-maintenance';
import { recordChangedMessage } from '../lib/stale-edit';
import { resolveUserContext } from '../lib/dev-impersonation';
import { adminAudit } from '../lib/admin-audit';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let admin: User, sales: User, manager: User, marketing: User;
let accountId: number, otherAccountId: number, skuId: number, secondSkuId: number;
test.beforeAll(async () => {
  [admin, sales, manager, marketing] = await Promise.all([emails.admin, emails.sales, emails.salesManager, emails.marketing].map(email => db.user.findUniqueOrThrow({ where: { email } })));
  accountId = (await db.account.findFirstOrThrow({ where: { name: names.account } })).id;
  otherAccountId = (await db.account.findFirstOrThrow({ where: { name: names.otherAccount } })).id;
  const product = await db.product.findUniqueOrThrow({ where: { sku: names.sku } });
  skuId = (await db.productSku.findFirstOrThrow({ where: { productId: product.id, active: true } })).id;
  const partNumber = uniqueName('MUTATION-SKU');
  secondSkuId = (await db.productSku.create({ data: { productId: product.id, partNumber, normalizedPartNumber: partNumber.toUpperCase() } })).id;
});
test.afterAll(() => db.$disconnect());

async function leadFixture() {
  const show = await db.tradeShow.create({ data: { name: uniqueName('Mutation safety show'), timezone: 'America/New_York', createdById: admin.id } });
  const imported = await db.tradeShowImport.create({ data: { tradeShowId: show.id, format: 'CUSTOM_MAPPING', sourceFileName: 'fixture.xlsx', sourceSheet: 'Leads', fileSha256: 'a'.repeat(64), uploadedById: admin.id } });
  return db.tradeShowLead.create({ data: { tradeShowId: show.id, firstImportId: imported.id, sourceKey: 'lead', sourceFileName: 'fixture.xlsx', sourceSheet: 'Leads', sourceRow: 1, rawSourceData: {}, firstName: 'Mutation', lastName: 'Lead', routing: 'UNREVIEWED', assignedSalesRepUserId: sales.id, salesNotes: 'Original notes' } });
}
async function peFixture() {
  return db.priceException.create({ data: { peCode: uniqueName('PE-MUTATION'), sourceType: 'EXTERNAL_EXPORT', sourceKey: uniqueName('mutation'), status: 'ACTIVE', distributorAccountId: accountId, assignedSalesRepUserId: sales.id, lines: { create: { sourceLineKey: 'line', sourceSku: 'ORIGINAL-SOURCE', productSkuId: skuId, approvedUnitPrice: '12.50' } } }, include: { lines: true } });
}
function leadForm(row: { updatedAt: Date }, fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ editToken: row.updatedAt.toISOString(), status: 'NEW', salesNotes: 'My notes', ...fields })) form.set(key, value);
  return form;
}
// Force both transactions past their parent read before either conditional write.
function concurrentReads(model: 'tradeShowLead' | 'priceException', method: 'findFirst' | 'findUnique') {
  let arrived = 0;
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  return { $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => db.$transaction(tx => fn(new Proxy(tx, {
    get(target, prop) {
      if (prop !== model) return Reflect.get(target, prop);
      return new Proxy(target[model], { get(delegate, key) {
        if (key !== method) return Reflect.get(delegate, key);
        return async (args: never) => {
          const row = await (Reflect.get(delegate, key) as (args: never) => Promise<unknown>)(args);
          if (++arrived === 2) release();
          await ready; return row;
        };
      } });
    },
  })), { timeout: 15000 }) } as unknown as PrismaClient;
}

test('real overlapping lead transactions accept one save and retain its routing, notes and Task', async () => {
  const lead = await leadFixture(), concurrent = concurrentReads('tradeShowLead', 'findFirst');
  const results = await Promise.allSettled([
    saveTradeShowLeadUpdate(concurrent, lead.tradeShowId, lead.id, leadForm(lead, { routing: 'BIXOLON_SALES', assignedSalesRepUserId: String(sales.id), salesNotes: 'Sales routing' }), admin),
    saveTradeShowLeadUpdate(concurrent, lead.tradeShowId, lead.id, leadForm(lead, { routing: 'BIXOLON_SALES', assignedSalesRepUserId: String(manager.id), salesNotes: 'Manager routing' }), manager),
  ]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  // Prisma's conditional update reports P2025; the server action maps it to the shared notice.
  expect(rejected.reason.code).toBe('P2025');
  const saved = await db.tradeShowLead.findUniqueOrThrow({ where: { id: lead.id } });
  expect(saved.updatedAt.getTime()).toBeGreaterThan(lead.updatedAt.getTime());
  const tasks = await db.task.findMany({ where: { tradeShowLeadId: lead.id } });
  expect(tasks).toHaveLength(1); expect(tasks[0].assignedToId).toBe(saved.assignedSalesRepUserId);
  expect(saved.salesNotes).toBe(saved.assignedSalesRepUserId === sales.id ? 'Sales routing' : 'Manager routing');
  expect(await db.taskAssignmentEvent.count({ where: { taskId: tasks[0].id } })).toBe(1);
});

test('lead Task failure rolls back parent token, routing, Task and assignment history in PostgreSQL', async () => {
  const lead = await leadFixture();
  const failing = { $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => db.$transaction(tx => fn(new Proxy(tx, {
    get(target, prop) {
      if (prop !== 'taskAssignmentEvent') return Reflect.get(target, prop);
      return { create: async () => { throw new Error('Forced Task history failure'); } };
    },
  }))) } as unknown as PrismaClient;
  await expect(saveTradeShowLeadUpdate(failing, lead.tradeShowId, lead.id, leadForm(lead, { routing: 'BIXOLON_SALES', assignedSalesRepUserId: String(sales.id) }), admin)).rejects.toThrow('Forced Task history failure');
  expect(await db.tradeShowLead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ updatedAt: lead.updatedAt, routing: 'UNREVIEWED', salesNotes: 'Original notes' });
  expect(await db.task.count({ where: { tradeShowLeadId: lead.id } })).toBe(0);
});

for (const correction of ['reference', 'SKU'] as const) test(`overlapping PE ${correction} corrections accept one parent claim and one history entry`, async () => {
  const pe = await peFixture(), concurrent = concurrentReads('priceException', 'findUnique');
  const field = correction === 'SKU' ? 'productSkuId' : 'distributorAccountId';
  const targets = correction === 'SKU' ? [secondSkuId, skuId] : [otherAccountId, accountId];
  const results = await Promise.allSettled(targets.map(target => correctPriceExceptionReference(concurrent, admin, pe.id, field, target, pe.updatedAt, pe.lines[0].id)));
  const winner = results.findIndex(result => result.status === 'fulfilled');
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.message).toBe(recordChangedMessage);
  const saved = await db.priceException.findUniqueOrThrow({ where: { id: pe.id }, include: { lines: true } });
  expect(saved.updatedAt.getTime()).toBeGreaterThan(pe.updatedAt.getTime());
  expect(correction === 'SKU' ? saved.lines[0].productSkuId : saved.distributorAccountId).toBe(targets[winner]);
  expect(saved.lines[0].sourceSku).toBe('ORIGINAL-SOURCE'); expect(saved.lines[0].approvedUnitPrice?.toString()).toBe('12.5');
  const history = await db.adminMaintenanceEvent.findMany({ where: { entityType: 'Price Exception', recordIds: { has: pe.id } } });
  expect(history).toHaveLength(1); expect(history[0].actorId).toBe(admin.id);
  const report = await adminAudit(db, admin, { entity: 'Price Exception', action: correction === 'SKU' ? 'Corrected Price Exception SKU' : 'Updated Price Exception reference' }, true);
  expect(report.rows.find(row => row.recordId === pe.id)?.name).toBe(pe.peCode);
});

test('direct lead and PE calls retain permissions, eligibility, and effective impersonation rights', async () => {
  const lead = await leadFixture(), pe = await peFixture();
  for (const actor of [sales, manager, marketing, admin]) {
    const current = await db.tradeShowLead.findUniqueOrThrow({ where: { id: lead.id } });
    await saveTradeShowLeadUpdate(db, lead.tradeShowId, lead.id, leadForm(current), actor);
  }
  const current = await db.tradeShowLead.findUniqueOrThrow({ where: { id: lead.id } });
  for (const token of [null, 'bad', lead.updatedAt.toISOString()]) {
    const form = leadForm(current); if (token === null) form.delete('editToken'); else form.set('editToken', token);
    await expect(saveTradeShowLeadUpdate(db, lead.tradeShowId, lead.id, form, admin)).rejects.toThrow(recordChangedMessage);
  }
  const context = await resolveUserContext({ ...admin, name: 'Admin' }, String(sales.id), db, { NODE_ENV: 'development', ENABLE_DEV_IMPERSONATION: 'true' });
  for (const actor of [sales, manager, marketing, context.effective!]) await expect(correctPriceExceptionReference(db, actor, pe.id, 'distributorAccountId', otherAccountId, pe.updatedAt)).rejects.toThrow(/Access denied/);
  await expect(saveTradeShowLeadUpdate(db, lead.tradeShowId, lead.id, leadForm(current, { assignedSalesRepUserId: String(manager.id) }), context.effective!)).rejects.toThrow(/Access denied/);
  await saveTradeShowLeadUpdate(db, lead.tradeShowId, lead.id, leadForm(current, { assignedSalesRepUserId: String(manager.id) }), admin);
  await expect(saveTradeShowLeadUpdate(db, lead.tradeShowId, lead.id, leadForm(current), sales)).rejects.toThrow(recordChangedMessage);
  const reassigned = await db.tradeShowLead.findUniqueOrThrow({ where: { id: lead.id } });
  await expect(saveTradeShowLeadUpdate(db, lead.tradeShowId, lead.id, leadForm(reassigned), sales)).rejects.toThrow('Access denied');
  await expect(correctPriceExceptionReference(db, admin, pe.id, 'productSkuId', secondSkuId, pe.updatedAt, pe.lines[0].id + 1000000)).rejects.toThrow('Pricing line not found');
  expect((await db.priceException.findUniqueOrThrow({ where: { id: pe.id } })).updatedAt).toEqual(pe.updatedAt);
});

for (const width of [1440, 768, 390]) {
  test(`individual lead normal and stale browser saves preserve entries and conflict controls at ${width}px`, async ({ page, browser }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 1000 });
    const lead = await leadFixture(), path = `/trade-shows/${lead.tradeShowId}/leads/${lead.id}`;
    const context = await browser.newContext({ baseURL, viewport: { width, height: 1000 } });
    const newer = await context.newPage();
    try {
      await signInAs(page, 'sales'); await signInAs(newer, 'salesManager');
      await page.goto(`${path}/edit`); await newer.goto(`${path}/edit`);
      await page.getByLabel('Sales Notes', { exact: true }).fill('My unsaved notes');
      await page.getByLabel('Product Interest', { exact: true }).fill('Keep this product interest');
      await newer.getByLabel('Sales Notes', { exact: true }).fill('Newer saved notes');
      await newer.getByLabel('Routing', { exact: true }).selectOption('BIXOLON_SALES');
      await newer.getByRole('button', { name: 'Save Lead', exact: true }).click();
      await expect(newer).toHaveURL(new RegExp(`${path}(\\?|$)`));
      const saved = await db.tradeShowLead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(saved.updatedAt.getTime()).toBeGreaterThan(lead.updatedAt.getTime());
      for (let attempt = 0; attempt < 2; attempt++) {
        await page.getByRole('button', { name: 'Save Lead', exact: true }).click();
        await expect(page.getByText(recordChangedMessage, { exact: true })).toBeInViewport();
        await expect(page.getByLabel('Sales Notes', { exact: true })).toHaveValue('My unsaved notes');
        await expect(page.getByLabel('Product Interest', { exact: true })).toHaveValue('Keep this product interest');
      }
      await expect(page.getByRole('link', { name: 'Review latest record' })).toHaveAttribute('href', path);
      expect((await db.tradeShowLead.findUniqueOrThrow({ where: { id: lead.id } })).salesNotes).toBe('Newer saved notes');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: 'Reload latest form' }).click();
      await expect(page.getByLabel('Sales Notes', { exact: true })).toHaveValue('Newer saved notes');
      await page.waitForLoadState('networkidle');
      await page.locator('[name="editToken"]').evaluate(element => element.remove());
      await page.getByRole('button', { name: 'Save Lead', exact: true }).click();
      await expect(page.getByText(recordChangedMessage, { exact: true })).toBeVisible();
    } finally { await context.close(); }
  });

  for (const correction of ['reference', 'SKU'] as const) test(`PE ${correction} normal and stale corrections preserve selection at ${width}px`, async ({ page, browser }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 1000 });
    const pe = await peFixture();
    const context = await browser.newContext({ baseURL, viewport: { width, height: 1000 } });
    const newer = await context.newPage();
    const open = async (tab: typeof page) => {
      await signInAs(tab, 'admin'); await tab.goto('/administration/price-exceptions');
      await tab.waitForLoadState('networkidle');
      await tab.getByLabel('Search PE or customer').fill(pe.peCode!);
      await tab.getByRole('button', { name: 'Review / correct', exact: true }).click();
      await tab.getByLabel('Correction').selectOption(correction === 'SKU' ? 'productSkuId' : 'assignedSalesRepUserId');
      if (correction === 'SKU') await tab.getByLabel('Pricing line').selectOption(String(pe.lines[0].id));
      const picker = tab.getByRole('combobox', { name: correction === 'SKU' ? 'active SKU' : 'active salesperson', exact: true });
      const query = correction === 'SKU' ? (await db.productSku.findUniqueOrThrow({ where: { id: secondSkuId } })).partNumber : manager.firstName;
      await tab.getByRole('textbox', { name: correction === 'SKU' ? 'Search active SKU' : 'Search active salesperson', exact: true }).fill(query);
      await picker.selectOption(String(correction === 'SKU' ? secondSkuId : manager.id));
    };
    try {
      await open(page); await open(newer);
      await newer.getByRole('button', { name: 'Save correction', exact: true }).click();
      await expect(newer.getByRole('button', { name: 'Close correction', exact: true })).toHaveCount(0);
      const saved = await db.priceException.findUniqueOrThrow({ where: { id: pe.id } });
      expect(saved.updatedAt.getTime()).toBeGreaterThan(pe.updatedAt.getTime());
      for (let attempt = 0; attempt < 2; attempt++) {
        await page.getByRole('button', { name: 'Save correction', exact: true }).click();
        await expect(page.getByText(recordChangedMessage, { exact: true })).toBeInViewport();
        await expect(page.getByLabel('Correction')).toHaveValue(correction === 'SKU' ? 'productSkuId' : 'assignedSalesRepUserId');
        await expect(page.getByRole('button', { name: 'Save correction', exact: true })).toBeEnabled();
        await expect(page.getByRole('combobox', { name: correction === 'SKU' ? 'active SKU' : 'active salesperson', exact: true })).toHaveValue(String(correction === 'SKU' ? secondSkuId : manager.id));
      }
      await expect(page.getByRole('link', { name: 'Review latest record' })).toHaveAttribute('href', `/price-exceptions/${pe.id}`);
      const history = await db.adminMaintenanceEvent.findMany({ where: { entityType: 'Price Exception', recordIds: { has: pe.id } } });
      expect(history).toHaveLength(1);
      const line = await db.priceExceptionLine.findUniqueOrThrow({ where: { id: pe.lines[0].id } });
      expect(correction === 'SKU' ? line.productSkuId : saved.assignedSalesRepUserId).toBe(correction === 'SKU' ? secondSkuId : manager.id);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: `test-results/mutation-safety-pe-${correction}-${width}.png`, fullPage: true });
    } finally { await context.close(); }
  });
}
