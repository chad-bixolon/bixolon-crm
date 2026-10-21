import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';
import { databaseUrl, emails, baseURL } from './constants.mjs';
import { signInAs } from './helpers';
import { ensureLargeAccount, fixtureCounts, largeAccountName } from './account-detail-fixture.mjs';
import { loadAccountContext, loadAccountTab, resolveAccountTab, visibleAccountTabs, type AccountTab } from '../lib/account-detail';
import { loadRelatedWork } from '../lib/related-work-data';
import { loadDocumentList } from '../lib/document-list';
import { resolveUserContext } from '../lib/dev-impersonation';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let id: number;
test.beforeAll(async () => { id = await ensureLargeAccount(); });
test.afterAll(() => db.$disconnect());
const user = (role: keyof typeof emails) => db.user.findUniqueOrThrow({ where: { email: emails[role] } });

test('large Account loaders preserve counts, cross-Sales visibility, pagination, archived/inactive relationships and impersonation', async () => {
  const admin = await user('admin'), sales = await user('sales');
  for (const role of ['admin', 'salesManager', 'sales', 'marketing', 'readOnly'] as const) {
    const actor = await user(role), context = (await loadAccountContext(db, id, actor))!;
    expect(context.counts).toEqual({ ...fixtureCounts, Demos: role === 'marketing' ? 0 : 30 });
    for (const [tab, key, expected] of [['Contacts', 'contacts', 125], ['Opportunities', 'opportunities', 35], ['Projects', 'projects', 35]] as const) {
      const ids: number[] = [];
      for (let page = 1; page <= Math.ceil(expected / 25); page++) {
        const data = await loadAccountTab(db, id, actor, tab, { page: String(page) }, context.counts);
        const rows = data[key];
        expect(rows.length).toBeLessThanOrEqual(25);
        ids.push(...rows.map(row => 'id' in row ? row.id : row.opportunityId));
      }
      expect(ids.length).toBe(expected); expect(new Set(ids).size).toBe(expected);
    }
  }
  const context = (await loadAccountContext(db, id, admin))!;
  const overview = await loadAccountTab(db, id, admin, 'Overview', {}, context.counts);
  expect(overview.primary?.lastName).toBe('Contact 000');
  expect(overview.openTasks).toBe(40); expect(overview.overdueTasks).toBe(40); expect(overview.openOpportunities).toBe(35);
  expect(overview.priceExceptionCount).toBe(35); expect(overview.priceExceptions).toHaveLength(25);
  const secondPE = await loadAccountTab(db, id, admin, 'Overview', { pePage: '2' }, context.counts);
  expect(secondPE.priceExceptions).toHaveLength(10);
  expect([...overview.priceExceptions, ...secondPE.priceExceptions].some(row => row.status === 'ARCHIVED')).toBe(true);
  const contacts = await loadAccountTab(db, id, admin, 'Contacts', {}, context.counts);
  expect(contacts.contacts.some(row => !row.active)).toBe(true);
  const projects = await loadAccountTab(db, id, admin, 'Projects', {}, context.counts);
  expect(projects.projects.some(row => row.archivedAt)).toBe(true);
  const effective = (await resolveUserContext({ ...admin, name: 'Admin' }, String(sales.id), db, { NODE_ENV: 'development', ENABLE_DEV_IMPERSONATION: 'true' })).effective!;
  expect(visibleAccountTabs(effective)).toEqual(visibleAccountTabs(sales));
  const impersonated = await loadAccountTab(db, id, effective, 'Overview', {}, context.counts);
  expect(impersonated.priceExceptionCount).toBe(10);
  expect(impersonated.priceExceptions).toHaveLength(10);
  for (const [kind, total, archived, all] of [['activities', 150, 5, 156], ['tasks', 60, 5, 66], ['notes', 70, 3, 73]] as const) {
    const seen = new Set<number>();
    for (let page = 1; page <= Math.ceil(total / 25); page++) {
      const work = await loadRelatedWork(db, { accountId: id, kind, page: String(page) });
      expect(work.total).toBe(total); expect(work.rows.length).toBeLessThanOrEqual(25);
      for (const row of work.rows) { expect(seen.has(row.id)).toBe(false); seen.add(row.id); }
    }
    expect(seen.size).toBe(total);
    expect((await loadRelatedWork(db, { accountId: id, kind, visibility: 'archived' })).total).toBe(archived);
    expect((await loadRelatedWork(db, { accountId: id, kind, visibility: 'all' })).total).toBe(all);
  }
  const docs = await loadDocumentList(db, { type: 'account', id }, false);
  expect(docs.pagination?.total).toBe(40); expect(docs.documents).toHaveLength(25);
  expect((await loadDocumentList(db, { type: 'account', id }, false, '2')).documents).toHaveLength(15);
  expect((await loadDocumentList(db, { type: 'account', id }, true)).documents).toHaveLength(3);
  const demos = await loadAccountTab(db, id, admin, 'Demos', { demoContext: 'linked' }, context.counts);
  expect(demos.pagination.total).toBe(5); expect(demos.demos).toHaveLength(5);
  expect((await loadAccountTab(db, id, admin, 'Demos', { page: '2' }, context.counts)).demos).toHaveLength(5);
});

test('actual queries for every selected tab avoid unrelated collections', async () => {
  const actor = await user('admin');
  const reads: { model: string; operation: string; take?: number }[] = [];
  const traced = db.$extends({ query: { $allModels: { async $allOperations({ model, operation, args, query }) {
    reads.push({ model, operation, take: 'take' in args ? args.take as number : undefined });
    return query(args);
  } } } });
  for (const [tab, expected] of [['Overview', ['ProductSku', 'PriceException']], ['Contacts', ['Contact']], ['Opportunities', ['OpportunityAccount']], ['Projects', ['Project']], ['Activity', ['Activity']], ['Tasks', ['Task']], ['Notes', ['Note']], ['Documents', ['Document']], ['Demos', ['DemoRequest']]] as [AccountTab, string[]][]) {
    reads.length = 0;
    const context = (await loadAccountContext(traced as unknown as PrismaClient, id, actor))!;
    await loadAccountTab(traced as unknown as PrismaClient, id, actor, tab, {}, context.counts);
    if (['Activity', 'Tasks', 'Notes'].includes(tab)) await loadRelatedWork(traced as unknown as PrismaClient, { accountId: id, kind: tab === 'Activity' ? 'activities' : tab === 'Tasks' ? 'tasks' : 'notes' });
    if (tab === 'Documents') await loadDocumentList(traced as unknown as PrismaClient, { type: 'account', id }, false);
    const collections = reads.filter(r => r.operation === 'findMany');
    expect(collections.map(r => r.model).sort(), tab).toEqual([...expected].sort());
    expect(collections.every(r => r.take !== undefined && r.take <= 25), tab).toBe(true);
  }
});

test('major tabs, direct URLs, default/invalid tabs, filters and history pagination preserve navigation', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAs(page, 'admin');
  await page.goto(`/accounts/${id}?tab=CoNtAcTs`);
  await expect(page.getByRole('heading', { name: 'Contacts (125)', exact: true })).toBeVisible();
  const sections = page.getByRole('navigation', { name: 'Account sections' });
  for (const tab of ['Overview', 'Contacts', 'Support', 'Opportunities', 'Projects', 'Demos', 'Activity', 'Tasks', 'Notes', 'Documents']) {
    await sections.getByRole('link', { name: new RegExp(`^${tab}( \\(|$)`) }).click();
    await expect(sections.getByRole('link', { name: new RegExp(`^${tab}( \\(|$)`) })).toHaveAttribute('aria-current', 'page');
  }
  await page.goto(`/accounts/${id}?tab=activity`);
  const activityPages = page.getByRole('navigation', { name: 'Activity pages' });
  await expect(activityPages).toContainText('Page 1 of 6');
  await page.getByRole('navigation', { name: 'Activity pages' }).getByRole('link', { name: 'Next' }).click();
  await expect(activityPages).toContainText('Page 2 of 6');
  await expect(page).toHaveURL(/tab=activity.*activitiesView=active.*page=2/);
  await expect(page.getByRole('link', { name: 'History Activity 124', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Activity visibility' }).getByRole('link', { name: 'Archived', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Activity (5)', exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/page=/);
  await page.goto(`/accounts/${id}?tab=documents&documentsView=archived`);
  await expect(page.getByText('History Document 042.txt', { exact: true })).toBeVisible();
  await page.goto(`/accounts/${id}?tab=demos&demoContext=linked`);
  await expect(page.locator('tbody tr')).toHaveCount(5);
  for (const query of ['', '?tab=invalid']) {
    await page.goto(`/accounts/${id}${query}`);
    await expect(sections.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute('aria-current', 'page');
  }
});

for (const role of ['admin', 'salesManager', 'sales', 'support', 'marketing', 'readOnly'] as const) {
  test(`Account tabs and actions retain ${role} permissions and Recent Items`, async ({ page }) => {
    await signInAs(page, role);
    await page.goto(`/accounts/${id}?tab=projects`);
    const actor = await user(role);
    const nav = page.getByRole('navigation', { name: 'Account sections' });
    const labels = (await nav.getByRole('link').allTextContents()).map(label => label.replace(/ \(\d+\)$/, ''));
    expect(labels).toEqual(visibleAccountTabs(actor));
    await expect(nav.getByRole('link', { name: new RegExp(`^${resolveAccountTab('projects', actor)}( \\(|$)`) })).toHaveAttribute('aria-current', 'page');
    const writable = ['admin', 'salesManager', 'sales'].includes(role);
    await expect(page.getByRole('link', { name: 'Edit account', exact: true })).toHaveCount(writable ? 1 : 0);
    await expect(page.getByRole('link', { name: 'Add Contact', exact: true })).toHaveCount(writable ? 1 : 0);
    if (writable) await expect(page.getByRole('link', { name: 'New Opportunity', exact: true })).toHaveAttribute('href', `/opportunities/new?accountId=${id}`);
    await expect.poll(() => db.recentItem.count({ where: { userId: actor.id, entityType: 'ACCOUNT', recordId: id } })).toBe(1);
  });
}

test('Account uses the effective impersonated role for tabs, pricing, actions and return to Admin', async ({ page, context }) => {
  test.skip(process.env.ENABLE_DEV_IMPERSONATION !== 'true', 'Run with ENABLE_DEV_IMPERSONATION=true for development impersonation.');
  await signInAs(page, 'admin');
  const support = await user('support'), sales = await user('sales');
  await context.addCookies([{ name: 'saleshub-dev-impersonate-user', value: String(support.id), url: baseURL }]);
  await page.goto(`/accounts/${id}?tab=projects`);
  await expect(page.getByRole('navigation', { name: 'Account sections' }).getByRole('link')).toHaveCount(3);
  await expect(page.getByRole('link', { name: 'Edit account', exact: true })).toHaveCount(0);
  await context.addCookies([{ name: 'saleshub-dev-impersonate-user', value: String(sales.id), url: baseURL }]);
  await page.goto(`/accounts/${id}`);
  await expect(page.getByRole('heading', { name: 'Price Exceptions (10)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Return to Admin', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Return to Admin', exact: true })).toHaveCount(0);
  await page.goto(`/accounts/${id}`);
  await expect(page.getByRole('heading', { name: 'Price Exceptions (35)', exact: true })).toBeVisible();
});

test('archived Account keeps historical tabs and documents without enabling write shortcuts', async ({ page }) => {
  const admin = await user('admin');
  const archived = await db.account.create({ data: { name: `E2E Account Detail Archived ${Date.now()}`, status: 'ARCHIVED', archivedAt: new Date(), archivedById: admin.id,
    contacts: { create: { firstName: 'Retained', lastName: 'Inactive contact', active: false } },
  } });
  await signInAs(page, 'admin');
  await page.goto(`/accounts/${archived.id}?tab=contacts`);
  await expect(page.getByRole('heading', { name: 'Contacts (1)', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Retained Inactive contact', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit account', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Add Contact', exact: true })).toHaveCount(0);
  await page.goto(`/accounts/${archived.id}?tab=activity`);
  await expect(page.getByRole('heading', { name: 'Activity (0)', exact: true })).toBeVisible();
  await page.goto(`/accounts/${archived.id}?tab=documents`);
  await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload', exact: true })).toHaveCount(0);
});

for (const width of [1440, 768, 820, 1024, 390]) {
  test(`Account presentation at ${width}px keeps bounded lists, touch controls and local table scrolling`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1024 });
    await signInAs(page, 'admin');
    await page.goto(`/accounts/${id}?tab=contacts`);
    await expect(page.getByRole('heading', { name: largeAccountName, exact: true })).toBeVisible();
    const pager = page.getByRole('navigation', { name: 'Contacts pages' });
    const next = pager.getByRole('link', { name: 'Next' });
    const box = await next.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(width === 1440 ? 40 : 44);
    await next.click(); await expect(pager).toContainText('Page 2 of 5');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`contacts-${width}.png`), fullPage: true });
    await page.goto(`/accounts/${id}?tab=demos`);
    const table = page.locator('table'); await expect(table).toBeVisible();
    expect(await table.evaluate(element => {
      const container = element.parentElement!;
      return getComputedStyle(container).overflowX === 'auto' && container.clientWidth <= window.innerWidth;
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`demos-${width}.png`), fullPage: true });
  });
}
