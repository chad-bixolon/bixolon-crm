import { PrismaClient, type TradeShowLead, type TradeShowLeadRouting } from '@prisma/client';
import { test, expect } from './fixtures';
import { databaseUrl, emails } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';
import { loadTradeShowQueue } from '../lib/trade-show-queue';
import { tradeShowEventSummary } from '../lib/trade-show-event-summary';
import { bulkRouteTradeShowLeads } from '../lib/trade-show-routing';
import { normalizeSavedQuery } from '../lib/saved-views';
import { resolveUserContext } from '../lib/dev-impersonation';
import { canEditTradeShowLead } from '../lib/trade-shows';
import { can } from '../lib/authorization';
import { addCalendarDays, businessToday } from '../lib/business-date';
import { executeTradeShowReport, defaultReportConfiguration } from '../lib/reporting';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const prefix = uniqueName('E2E Follow-up queue');
const shows: number[] = [], opportunities: number[] = [];
const user = (role: keyof typeof emails) => db.user.findUniqueOrThrow({ where: { email: emails[role] } });
let fixture: Awaited<ReturnType<typeof makeShow>>;
async function makeShow(count = 2, routing: TradeShowLeadRouting = 'UNREVIEWED') {
  const admin = await user('admin'), sales = await user('sales');
  const show = await db.tradeShow.create({ data: { name: `${prefix} event ${shows.length}`, timezone: 'America/New_York', createdById: admin.id } }); shows.push(show.id);
  const imported = await db.tradeShowImport.create({ data: { tradeShowId: show.id, format: 'CUSTOM_MAPPING', sourceFileName: 'fixture.xlsx', sourceSheet: 'Leads', fileSha256: 'a'.repeat(64), uploadedById: admin.id } });
  const leads: TradeShowLead[] = [];
  for (let i = 0; i < count; i++) leads.push(await db.tradeShowLead.create({ data: { tradeShowId: show.id, firstImportId: imported.id, sourceKey: `lead-${i}`, sourceFileName: 'fixture.xlsx', sourceSheet: 'Leads', sourceRow: i + 1, rawSourceData: {}, firstName: `Queue ${i}`, lastName: 'Lead', sourceCompany: `${prefix} company`, routing, assignedSalesRepUserId: routing === 'BIXOLON_SALES' ? sales.id : null, followUpAt: new Date('2030-01-01T12:00:00Z') } }));
  return { show, leads };
}
const request = (rows: TradeShowLead[]) => ({ records: rows.map(row => ({ id: row.id, updatedAt: row.updatedAt.toISOString() })), action: 'route', value: '', confirmed: true });
const scope = { where: {}, page: 1 };
test.beforeAll(async () => {
  fixture = await makeShow(27, 'BIXOLON_SALES');
  const sales = await user('sales'), manager = await user('salesManager'), today = businessToday();
  for (const [index, offset, status, assignedToId] of [[0, -1, 'OPEN', sales.id], [1, 0, 'IN_PROGRESS', sales.id], [2, 7, 'OPEN', manager.id], [3, 8, 'OPEN', sales.id], [4, 0, 'COMPLETED', sales.id]] as const) {
    await db.task.create({ data: { tradeShowLeadId: fixture.leads[index].id, subject: `Queue Task ${index}`, dueDate: addCalendarDays(today, offset), status, assignedToId } });
  }
  // Older completed history must not make an open current Task match Completed.
  await db.task.create({ data: { tradeShowLeadId: fixture.leads[5].id, subject: 'Old completed follow-up', status: 'COMPLETED', assignedToId: sales.id } });
  await db.task.create({ data: { tradeShowLeadId: fixture.leads[5].id, subject: 'Current open follow-up', status: 'OPEN', assignedToId: sales.id } });
  await db.task.create({ data: { tradeShowLeadId: fixture.leads[6].id, subject: 'Archived follow-up', status: 'OPEN', archivedAt: new Date(), assignedToId: sales.id } });
  await db.tradeShowLead.update({ where: { id: fixture.leads[26].id }, data: { assignedSalesRepUserId: manager.id } });
});
test.afterAll(async () => {
  await db.savedView.deleteMany({ where: { name: { startsWith: prefix } } });
  const leads = await db.tradeShowLead.findMany({ where: { tradeShowId: { in: shows } }, select: { id: true } });
  const tasks = await db.task.findMany({ where: { tradeShowLeadId: { in: leads.map(row => row.id) } }, select: { id: true } });
  await db.notification.deleteMany({ where: { entityType: 'TASK', entityId: { in: tasks.map(row => row.id) } } });
  await db.taskAssignmentEvent.deleteMany({ where: { taskId: { in: tasks.map(row => row.id) } } });
  await db.task.deleteMany({ where: { id: { in: tasks.map(row => row.id) } } });
  // Maintenance History remains append-only, including in the isolated test DB.
  await db.tradeShowLead.deleteMany({ where: { tradeShowId: { in: shows } } });
  await db.tradeShowImport.deleteMany({ where: { tradeShowId: { in: shows } } });
  await db.tradeShow.deleteMany({ where: { id: { in: shows } } });
  await db.opportunity.deleteMany({ where: { id: { in: opportunities } } });
  await db.$disconnect();
});

test('server queue filters, latest Task selection, relative reload, pagination counts and impersonation', async () => {
  const sales = await user('sales'), marketing = await user('marketing'), manager = await user('salesManager');
  const base = { tradeShowId: String(fixture.show.id) };
  for (const [filters, expected] of [[{ duePeriod: 'overdue' }, [0]], [{ duePeriod: 'today' }, [1]], [{ duePeriod: 'next-7-days' }, [0 + 1, 2]], [{ taskStatus: 'completed' }, [4]], [{ assignedToId: String(manager.id) }, [2]]] as const) {
    const result = await loadTradeShowQueue(db, sales, { ...base, ...filters });
    expect(result.leads.map(row => row.id).sort()).toEqual(expected.map(index => fixture.leads[index].id).sort());
    expect(result.count).toBe(expected.length);
  }
  expect((await loadTradeShowQueue(db, sales, { ...base, taskStatus: 'none' })).count).toBe(20);
  expect((await loadTradeShowQueue(db, sales, { ...base, mine: 'yes' })).count).toBe(5);
  expect((await loadTradeShowQueue(db, marketing, { ...base, ownerId: String(manager.id) })).count).toBe(1);
  const first = await loadTradeShowQueue(db, sales, base), second = await loadTradeShowQueue(db, sales, { ...base, page: '2' });
  expect(first.count).toBe(26); expect(first.leads).toHaveLength(20); expect(second.leads).toHaveLength(6);
  expect(new Set([...first.leads, ...second.leads].map(row => row.id)).size).toBe(26);
  const saved = normalizeSavedQuery('trade-show-follow-up', { ...base, duePeriod: 'today', page: '2' });
  expect(saved).toEqual({ ...base, duePeriod: 'today' });
  expect((await loadTradeShowQueue(db, sales, saved, addCalendarDays(new Date(), 1))).leads).toHaveLength(0);
  const context = await resolveUserContext({ ...await user('admin'), name: 'Admin' }, String(sales.id), db, { NODE_ENV: 'development', ENABLE_DEV_IMPERSONATION: 'true' });
  expect((await loadTradeShowQueue(db, context.effective!, { ...base, view: 'all' })).count).toBe(26);
  expect(canEditTradeShowLead(context.effective!, { assignedSalesRepUserId: manager.id })).toBe(false);
  expect(can(context.effective!, 'trade-shows.assign')).toBe(false);
  const summary = await tradeShowEventSummary(db, sales, fixture.show.id);
  expect(summary.total).toBe(26); expect(summary.assigned).toBe(26); expect(summary.routing.BIXOLON_SALES).toBe(26);
});

test('bulk routing rejects stale, invalid assignee, foreign page, revoked permission and unconfirmed requests; writes rollback atomically', async () => {
  const f = await makeShow(), admin = await user('admin'), sales = await user('sales'), support = await user('support');
  const route = (rows = f.leads, repId = sales.id, actor = admin, req = request(rows)) => bulkRouteTradeShowLeads(db, f.show.id, req, 'BIXOLON_SALES', repId, null, null, actor, scope);
  await expect(route(f.leads, support.id)).rejects.toThrow(/active Sales rep/);
  await expect(route(f.leads, sales.id, admin, { ...request(f.leads), confirmed: false })).rejects.toThrow(/confirmation/);
  await expect(route(f.leads, sales.id, sales)).rejects.toThrow(/Access denied/);
  await expect(route(f.leads, sales.id, { ...sales, role: 'ADMIN' })).rejects.toThrow(/Access denied/);
  await db.tradeShowLead.update({ where: { id: f.leads[1].id }, data: { salesNotes: 'changed' } });
  await expect(route()).rejects.toThrow(/changed|unavailable/);
  expect(await db.task.count({ where: { tradeShowLeadId: { in: f.leads.map(row => row.id) } } })).toBe(0);
  const fresh = await db.tradeShowLead.findMany({ where: { tradeShowId: f.show.id }, orderBy: { id: 'asc' } });
  const failing = db.$extends({ query: { task: { create({ args, query }) { if (args.data.tradeShowLeadId === fresh[1].id) throw new Error('Injected Task write failure'); return query(args); } } } });
  await expect(bulkRouteTradeShowLeads(failing as unknown as PrismaClient, f.show.id, request(fresh), 'BIXOLON_SALES', sales.id, null, null, admin, scope)).rejects.toThrow(/Injected Task write failure/);
  expect((await db.tradeShowLead.findMany({ where: { tradeShowId: f.show.id } })).every(row => row.routing === 'UNREVIEWED')).toBe(true);
  expect(await db.task.count({ where: { tradeShowLeadId: { in: fresh.map(row => row.id) } } })).toBe(0);
  expect(await db.adminMaintenanceEvent.count({ where: { entityType: 'Trade Show Lead', recordIds: { hasSome: fresh.map(row => row.id) } } })).toBe(0);
  const results = await Promise.allSettled([route(fresh), route(fresh)]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(await db.task.count({ where: { tradeShowLeadId: { in: fresh.map(row => row.id) } } })).toBe(2);
  expect(await db.taskAssignmentEvent.count({ where: { task: { tradeShowLeadId: { in: fresh.map(row => row.id) } }, actorId: admin.id } })).toBe(2);
  expect(await db.adminMaintenanceEvent.count({ where: { entityType: 'Trade Show Lead', recordIds: { hasSome: fresh.map(row => row.id) } } })).toBe(1);
  // A current-page boundary is enforced even if a caller supplies a fresh off-page version.
  const foreign = await makeShow(21);
  await expect(bulkRouteTradeShowLeads(db, foreign.show.id, request([foreign.leads[0]]), 'BIXOLON_SALES', sales.id, null, null, admin, scope)).rejects.toThrow(/page changed/);
});

test('Sales work queue opens Tasks, applies Task status/date filters and resets pagination', async ({ page }) => {
  test.setTimeout(90_000);
  await signInAs(page, 'sales');
  await page.goto(`/trade-shows/my-leads?tradeShowId=${fixture.show.id}&page=2`);
  await expect(page.getByText('26 leads · Page 2 of 2', { exact: true })).toBeVisible();
  const form = page.getByRole('form', { name: 'Filter follow-up queue' });
  await form.getByLabel('Task due date', { exact: true }).selectOption('today');
  await form.getByRole('button', { name: 'Filter', exact: true }).click();
  await expect(page.getByText('1 leads · Page 1 of 1', { exact: true })).toBeVisible();
  await expect(page.locator('tbody')).toContainText('Queue Task 1');
  await expect(page.locator('tbody')).toContainText('Lead follow-up: 2030-01-01');
  await page.getByRole('link', { name: 'Open Task', exact: true }).click();
  await expect(page.locator('h1')).toHaveText('Queue Task 1');
  await page.goBack();
  for (const [period, title] of [['overdue', 'Queue Task 0'], ['next-7-days', 'Queue Task 2']]) {
    await form.getByLabel('Task due date', { exact: true }).selectOption(period); await form.getByRole('button', { name: 'Filter', exact: true }).click();
    await expect(page.locator('tbody')).toContainText(title);
  }
  await form.getByLabel('Task due date', { exact: true }).selectOption('');
  await form.getByLabel('Task status', { exact: true }).selectOption('completed'); await form.getByRole('button', { name: 'Filter', exact: true }).click();
  await expect(page.locator('tbody')).toContainText('Completed'); await expect(page.locator('tbody')).toContainText('Queue Task 4');
  await form.getByLabel('Task status', { exact: true }).selectOption('none'); await form.getByRole('button', { name: 'Filter', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(20); await expect(page.locator('tbody')).toContainText('No follow-up Task');
});

test('queue Saved View saves and restores event, owner, Task status, relative due period and search', async ({ page }) => {
  await signInAs(page, 'marketing');
  const sales = await user('sales'), viewName = `${prefix} saved`;
  await page.goto(`/trade-shows/my-leads?tradeShowId=${fixture.show.id}&ownerId=${sales.id}&taskStatus=open&duePeriod=today&q=Queue`);
  await page.locator('.saved-views-menu summary').click(); await page.getByRole('button', { name: 'Save current view', exact: true }).click();
  await page.getByRole('dialog', { name: 'Save current view' }).getByLabel('View name').fill(viewName);
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Save current view' })).toHaveCount(0);
  const saved = await db.savedView.findFirstOrThrow({ where: { name: viewName } });
  expect(saved.queryState).toEqual({ tradeShowId: String(fixture.show.id), ownerId: String(sales.id), taskStatus: 'open', duePeriod: 'today', q: 'Queue' });
  await page.goto('/trade-shows/my-leads?view=all');
  await page.locator('.saved-views-menu summary').click(); await page.getByRole('button', { name: viewName, exact: true }).click();
  await expect(page).toHaveURL(/duePeriod=today/); await page.reload();
  await expect(page.locator('tbody')).toContainText('Queue Task 1');
});

for (const [width, height] of [[1440, 900], [768, 1024], [390, 844]]) test(`queue and bulk routing confirmation fit ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height }); await signInAs(page, 'marketing');
  await page.goto(`/trade-shows/my-leads?tradeShowId=${fixture.show.id}&taskStatus=open&duePeriod=today`);
  if (width < 1024) await page.getByRole('button', { name: /Show filters/ }).click();
  await expect(page.getByLabel('Task due date', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Open Task', exact: true }).click(); await expect(page.locator('h1')).toHaveText('Queue Task 1');
  await page.goto(`/trade-shows/${fixture.show.id}`);
  await expect(page.getByText('27 leads · Page 1 of 2', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: /Select Queue/ }).first().check();
  await page.locator('select[name="bulkRouting"]').selectOption('MARKETING_FOLLOW_UP');
  await page.getByRole('button', { name: 'Apply Routing', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm bulk routing' }); await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test('bulk routing UI confirms, rejects a stale version, then succeeds after refresh', async ({ page }) => {
  const f = await makeShow(), sales = await user('sales');
  await signInAs(page, 'marketing'); await page.goto(`/trade-shows/${f.show.id}`);
  await page.getByRole('checkbox', { name: /Select Queue/ }).first().check();
  await page.locator('select[name="bulkRouting"]').selectOption('BIXOLON_SALES');
  await page.locator('select[name="bulkRepId"]').selectOption(String(sales.id));
  await page.getByRole('button', { name: 'Apply Routing', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm bulk routing' });
  expect(await db.task.count({ where: { tradeShowLeadId: { in: f.leads.map(row => row.id) } } })).toBe(0);
  await db.tradeShowLead.update({ where: { id: f.leads[1].id }, data: { salesNotes: 'updated since render' } });
  await dialog.getByRole('button', { name: 'Confirm routing', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('changed');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await page.reload();
  await page.getByRole('checkbox', { name: /Select Queue/ }).first().check();
  await page.locator('select[name="bulkRouting"]').selectOption('BIXOLON_SALES'); await page.locator('select[name="bulkRepId"]').selectOption(String(sales.id));
  await page.getByRole('button', { name: 'Apply Routing', exact: true }).click(); await dialog.getByRole('button', { name: 'Confirm routing', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('tbody')).toContainText('Open Task');
});

test('Sales can follow another rep Opportunity link from lead/report while edit boundaries stay unchanged', async ({ page }) => {
  test.setTimeout(90_000);
  const f = await makeShow(1, 'BIXOLON_SALES'), sales = await user('sales'), manager = await user('salesManager');
  const stage = await db.salesStage.findFirstOrThrow({ where: { active: true, isClosed: false } });
  const opp = await db.opportunity.create({ data: { name: `${prefix} cross-owner Opportunity`, ownerId: manager.id, stageId: stage.id, currencyCode: 'USD' } }); opportunities.push(opp.id);
  await db.tradeShowLead.update({ where: { id: f.leads[0].id }, data: { convertedOpportunityId: opp.id, status: 'CONVERTED', convertedAt: new Date() } });
  await signInAs(page, 'sales'); await page.goto(`/trade-shows/${f.show.id}/leads/${f.leads[0].id}`);
  await page.getByRole('link', { name: opp.name, exact: true }).click(); await expect(page.locator('h1')).toHaveText(opp.name);
  const report = await executeTradeShowReport(db, sales, { ...defaultReportConfiguration('TRADE_SHOW'), filters: [{ field: 'tradeShowId', operator: 'eq', value: f.show.id }] });
  expect(report.rows[0].canOpenOpportunity).toBe(true);
  await page.goto(`/reports/trade-shows?configured=1&tradeShowId=${f.show.id}`);
  await expect(page.getByRole('link', { name: opp.name, exact: true })).toBeVisible();
  const denied = await page.request.get(`/opportunities/${opp.id}/edit`);
  expect(denied.status()).toBe(404);
  expect(canEditTradeShowLead(sales, { assignedSalesRepUserId: manager.id })).toBe(false);
  await page.goto(`/trade-shows/${f.show.id}`); await expect(page.getByRole('button', { name: 'Apply Routing' })).toHaveCount(0);
  await signInAs(page, 'readOnly'); await page.goto(`/tasks/${(await db.task.findFirstOrThrow({ where: { tradeShowLeadId: fixture.leads[0].id } })).id}`);
  await expect(page.getByRole('link', { name: 'Edit task', exact: true })).toHaveCount(0);
});
