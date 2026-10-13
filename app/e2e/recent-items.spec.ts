import { PrismaClient, type RecentEntityType } from '@prisma/client';
import { test, expect } from './fixtures';
import { databaseUrl, emails, names } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';
import { listRecentItems, recordRecentView, resolveRecentTargets } from '../lib/recent-items';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const user = (role: keyof typeof emails) => db.user.findUniqueOrThrow({ where: { email: emails[role] } });
const panel = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'Recent Items' });
test.afterAll(() => db.$disconnect());
test.beforeAll(() => db.activityType.upsert({ where: { code: 'E2E_RECENT' }, update: {}, create: { code: 'E2E_RECENT', name: 'Recent test activity' } }));
test.beforeEach(async () => { const admin = await user('admin'); await db.recentItem.deleteMany({ where: { userId: admin.id } }); });

test('first actual view persists, revisiting moves it to top, and lists/search/prefetch never track', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const admin = await user('admin');
  const accounts = await db.account.findMany({ where: { name: { in: [names.account, names.otherAccount] } }, orderBy: { id: 'asc' } });
  await signInAs(page, 'admin');
  await page.goto('/accounts');
  expect((await page.request.get('/api/recent-items')).ok()).toBe(true);
  await page.request.get(`/accounts/${accounts[0].id}`, { headers: { 'Next-Router-Prefetch': '1', RSC: '1' } });
  await page.request.get('/api/global-search?q=E2E');
  expect(await db.recentItem.count({ where: { userId: admin.id } })).toBe(0);
  await page.goto(`/accounts/${accounts[0].id}`);
  await expect.poll(() => db.recentItem.count({ where: { userId: admin.id } })).toBe(1);
  const before = await db.recentItem.findFirstOrThrow({ where: { userId: admin.id } });
  await page.goto(`/accounts/${accounts[1].id}`);
  await expect.poll(() => db.recentItem.count({ where: { userId: admin.id } })).toBe(2);
  await page.goto(`/accounts/${accounts[0].id}`);
  await expect.poll(async () => (await db.recentItem.findFirstOrThrow({ where: { id: before.id } })).lastViewedAt.getTime()).toBeGreaterThan(before.lastViewedAt.getTime());
  expect(await db.recentItem.count({ where: { userId: admin.id } })).toBe(2);
  const other = await browser.newContext();
  try {
    const second = await other.newPage();
    await signInAs(second, 'admin');
    await second.getByRole('button', { name: 'Recent Items', exact: true }).click();
    await expect(panel(second).getByRole('link').first()).toHaveAttribute('href', `/accounts/${accounts[0].id}`);
    await expect(panel(second).getByRole('link')).toHaveCount(2);
    await signInAs(second, 'readOnly');
    const reader = await user('readOnly');
    await db.recentItem.deleteMany({ where: { userId: reader.id } });
    const response = await second.request.get(`/api/recent-items?userId=${admin.id}`);
    expect((await response.json()).items).toEqual([]);
    expect((await page.request.get(`/api/recent-items?userId=${reader.id}`)).headers()['cache-control']).toBe('private, no-store');
    expect((await (await page.request.get(`/api/recent-items?userId=${reader.id}`)).json()).items).toHaveLength(2);
  } finally { await other.close(); }
});

test('history stays at 50 under concurrent touches, including revisits', async () => {
  const admin = await user('admin');
  const accounts = await db.account.findMany({ where: { name: { startsWith: 'E2E Picker Account' } }, take: 55, orderBy: { id: 'asc' } });
  expect(accounts.length).toBe(55);
  for (let i = 0; i < accounts.length; i += 5) await Promise.all(accounts.slice(i, i + 5).map(row => recordRecentView(db, admin, 'ACCOUNT', row.id)));
  expect(await db.recentItem.count({ where: { userId: admin.id } })).toBe(50);
  expect(await db.recentItem.count({ where: { userId: admin.id, recordId: { in: accounts.slice(0, 5).map(row => row.id) } } })).toBe(0);
  await recordRecentView(db, admin, 'ACCOUNT', accounts[54].id);
  expect(await db.recentItem.count({ where: { userId: admin.id } })).toBe(50);
  expect((await listRecentItems(db, admin))).toHaveLength(8);
});

test('archived, inactive, deleted, changed ownership and unresolved cases are filtered on read and write', async () => {
  const admin = await user('admin'), sales = await user('sales'), reader = await user('readOnly');
  const account = await db.account.create({ data: { name: uniqueName('E2E recent filter') } });
  const contact = await db.contact.create({ data: { firstName: 'E2E', lastName: 'Recent', accountId: account.id } });
  const stage = await db.salesStage.findUniqueOrThrow({ where: { name: 'E2E Qualification' } });
  const opportunity = await db.opportunity.create({ data: { name: uniqueName('E2E recent ownership'), stageId: stage.id, ownerId: sales.id, currencyCode: 'USD' } });
  const supportCase = await db.supportCase.create({ data: { caseNumber: uniqueName('E2E-RECENT'), customerNameText: 'Unlinked customer', subject: 'Unlinked customer', description: 'Test', source: 'OTHER', updatedById: admin.id, createdById: admin.id } });
  const pe = await db.priceException.create({ data: { sourceType: 'EXTERNAL_EXPORT', sourceKey: uniqueName('E2E-recent-pe'), status: 'ACTIVE', peCode: 'Recent PE', assignedSalesRepUserId: sales.id } });
  const activity = await db.activity.create({ data: { subject: 'Recent parent activity', type: 'E2E_RECENT', accountId: account.id } });
  try {
    await recordRecentView(db, admin, 'ACCOUNT', account.id);
    await recordRecentView(db, admin, 'CONTACT', contact.id);
    await recordRecentView(db, admin, 'ACTIVITY', activity.id);
    await recordRecentView(db, sales, 'OPPORTUNITY', opportunity.id);
    await recordRecentView(db, sales, 'PRICE_EXCEPTION', pe.id);
    await db.account.update({ where: { id: account.id }, data: { status: 'INACTIVE' } });
    expect((await listRecentItems(db, admin))).toEqual([]);
    await db.account.update({ where: { id: account.id }, data: { status: 'ACTIVE' } });
    await db.contact.update({ where: { id: contact.id }, data: { active: false } });
    expect((await listRecentItems(db, admin)).some(row => row.key === `CONTACT:${contact.id}`)).toBe(false);
    await db.account.update({ where: { id: account.id }, data: { status: 'ARCHIVED', archivedAt: new Date() } });
    expect((await listRecentItems(db, admin))).toEqual([]);
    await db.opportunity.update({ where: { id: opportunity.id }, data: { ownerId: admin.id } });
    await db.priceException.update({ where: { id: pe.id }, data: { assignedSalesRepUserId: admin.id } });
    const items = await listRecentItems(db, sales);
    expect(items.some(row => row.key === `OPPORTUNITY:${opportunity.id}` || row.key === `PRICE_EXCEPTION:${pe.id}`)).toBe(false);
    await recordRecentView(db, reader, 'SUPPORT_CASE', supportCase.id);
    expect(await db.recentItem.count({ where: { userId: reader.id, entityType: 'SUPPORT_CASE', recordId: supportCase.id } })).toBe(0);
    expect(await resolveRecentTargets(db, { ...admin, role: 'SUPPORT' }, 'OPPORTUNITY', [opportunity.id])).toEqual([]);
    await db.recentItem.create({ data: { userId: admin.id, entityType: 'ACCOUNT', recordId: 2147483647 } });
    expect((await listRecentItems(db, admin))).toEqual([]);
    await db.activity.delete({ where: { id: activity.id } });
    await db.contact.delete({ where: { id: contact.id } });
    await db.account.delete({ where: { id: account.id } });
    expect((await listRecentItems(db, admin))).toEqual([]);
  } finally {
    await db.activity.deleteMany({ where: { id: activity.id } }); await db.contact.deleteMany({ where: { id: contact.id } }); await db.account.deleteMany({ where: { id: account.id } });
    await db.opportunity.delete({ where: { id: opportunity.id } }); await db.priceException.delete({ where: { id: pe.id } }); await db.supportCase.delete({ where: { id: supportCase.id } });
    await db.recentItem.deleteMany({ where: { userId: { in: [sales.id, reader.id] }, recordId: { in: [opportunity.id, pe.id, supportCase.id] } } });
  }
});

test('all eight detail destinations track actual visits and produce useful links', async ({ page }) => {
  test.setTimeout(120_000);
  const admin = await user('admin');
  const account = await db.account.findFirstOrThrow({ where: { name: names.account } });
  const contact = await db.contact.findFirstOrThrow({ where: { accountId: account.id } });
  const opportunity = await db.opportunity.findFirstOrThrow({ where: { name: 'E2E Picker Opportunity' } });
  const project = await db.project.findFirstOrThrow({ where: { name: 'E2E Picker Project' } });
  const pe = await db.priceException.findFirstOrThrow({ where: { peCode: names.pe } });
  const supportCase = await db.supportCase.create({ data: { caseNumber: uniqueName('E2E-RECENT'), subject: 'Recent case', description: 'Test', source: 'OTHER', updatedById: admin.id, accountId: account.id, createdById: admin.id } });
  const task = await db.task.create({ data: { subject: 'Recent task', assignedToId: admin.id } });
  await db.activityType.upsert({ where: { code: 'E2E_RECENT' }, update: {}, create: { code: 'E2E_RECENT', name: 'Recent test activity' } });
  const activity = await db.activity.create({ data: { subject: 'Recent activity', type: 'E2E_RECENT', userId: admin.id, accountId: account.id } });
  const routes: [RecentEntityType, number, string][] = [['ACCOUNT', account.id, '/accounts'], ['CONTACT', contact.id, '/contacts'], ['OPPORTUNITY', opportunity.id, '/opportunities'], ['PROJECT', project.id, '/projects'], ['PRICE_EXCEPTION', pe.id, '/price-exceptions'], ['SUPPORT_CASE', supportCase.id, '/support/cases'], ['TASK', task.id, '/tasks'], ['ACTIVITY', activity.id, '/activities']];
  try {
    await signInAs(page, 'admin');
    for (const [type, id, path] of routes) {
      await page.goto(`${path}/${id}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect.poll(() => db.recentItem.count({ where: { userId: admin.id, entityType: type, recordId: id } })).toBe(1);
    }
    await page.getByRole('button', { name: 'Recent Items', exact: true }).click();
    await expect(panel(page).getByRole('link')).toHaveCount(8);
    for (const [, id, path] of routes) await expect(panel(page).locator(`a[href="${path}/${id}"]`)).toBeVisible();
    await panel(page).getByRole('link').first().click();
    await expect(panel(page)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/activities/${activity.id}$`));
    await signInAs(page, 'readOnly');
    await page.goto(`/activities/${activity.id}`);
    await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit activity' })).toHaveCount(0);
    const reader = await user('readOnly');
    await expect.poll(() => db.recentItem.count({ where: { userId: reader.id, entityType: 'ACTIVITY', recordId: activity.id } })).toBe(1);
  } finally { await db.task.delete({ where: { id: task.id } }); await db.activity.delete({ where: { id: activity.id } }); await db.supportCaseLifecycleEvent.deleteMany({ where: { supportCaseId: supportCase.id } }); await db.supportCase.delete({ where: { id: supportCase.id } }); }
});

test('Support history includes case-linked tasks and filters an archived case parent', async ({ page }) => {
  const support = await user('support');
  const account = await db.account.findFirstOrThrow({ where: { name: names.account } });
  const supportCase = await db.supportCase.create({ data: { caseNumber: uniqueName('E2E-RECENT'), subject: 'Recent task parent', description: 'Test', source: 'PHONE', accountId: account.id, createdById: support.id, updatedById: support.id } });
  const task = await db.task.create({ data: { subject: 'Recent Support task', supportCaseId: supportCase.id, accountId: account.id } });
  try {
    await signInAs(page, 'support');
    await page.goto(`/tasks/${task.id}`);
    await expect(page.getByRole('heading', { name: task.subject })).toBeVisible();
    await expect.poll(() => db.recentItem.count({ where: { userId: support.id, entityType: 'TASK', recordId: task.id } })).toBe(1);
    expect((await listRecentItems(db, support)).some(row => row.key === `TASK:${task.id}`)).toBe(true);
    await db.supportCase.update({ where: { id: supportCase.id }, data: { archivedAt: new Date() } });
    expect((await listRecentItems(db, support)).some(row => row.key === `TASK:${task.id}`)).toBe(false);
  } finally {
    await db.recentItem.deleteMany({ where: { entityType: 'TASK', recordId: task.id } });
    await db.task.delete({ where: { id: task.id } });
    await db.supportCase.delete({ where: { id: supportCase.id } });
  }
});

for (const [width, height] of [[390, 844], [768, 1024], [1024, 768], [1440, 900]]) {
  test(`popover empty state, focus, outside click, Escape and layout at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await signInAs(page, 'admin');
    const trigger = page.getByRole('button', { name: 'Recent Items', exact: true });
    await trigger.focus(); await page.keyboard.press('Enter');
    await expect(panel(page)).toContainText('No recent records yet.');
    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false'); await expect(trigger).toBeFocused();
    const admin = await user('admin');
    const account = await db.account.findFirstOrThrow({ where: { name: names.account } });
    await recordRecentView(db, admin, 'ACCOUNT', account.id);
    await trigger.click();
    await expect(panel(page).getByRole('link')).toHaveCount(1);
    await page.keyboard.press('Tab'); await expect(panel(page).getByRole('link')).toBeFocused();
    await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
    await trigger.click(); await expect(panel(page).getByRole('link')).toBeVisible();
    const box = await panel(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width); expect(box!.y + box!.height).toBeLessThanOrEqual(height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/recent-items-${width}.png` });
    await page.mouse.click(8, height - 8); await expect(panel(page)).toHaveCount(0);
  });
}
