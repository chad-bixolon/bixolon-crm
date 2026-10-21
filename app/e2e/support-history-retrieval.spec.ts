import { Prisma, PrismaClient, type User } from '@prisma/client';
import { test, expect } from './fixtures';
import { databaseUrl, emails, names } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';
import { createSupportCase } from '../lib/support-cases';
import { caseHistoryPage, caseHistorySource, caseNoteForReading } from '../lib/support-case-history';
import { caseHistoryView } from '../lib/support-case-timeline';
import { resolveUserContext } from '../lib/dev-impersonation';

const queries: { query: string; params: string; duration: number }[] = [];
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [{ level: 'query', emit: 'event' }] });
db.$on('query', event => queries.push(event));
let admin: User, support: User, sales: User, accountId: number;
test.beforeAll(async () => {
  [admin, support, sales] = await Promise.all([emails.admin, emails.support, emails.sales].map(email => db.user.findUniqueOrThrow({ where: { email } })));
  accountId = (await db.account.findFirstOrThrow({ where: { name: names.account } })).id;
});
test.afterAll(() => db.$disconnect());
const longBody = 'Diagnostic details. '.repeat(180) + '\n\n  Indented printer configuration\nFULL NOTE END — all details preserved';
async function fixture(count = 55, state: 'OPEN' | 'CLOSED' | 'ARCHIVED' = 'OPEN', linked = true) {
  const row = await createSupportCase(db, admin, { customerNameText: 'History retrieval customer', accountId: linked ? accountId : null, subject: uniqueName('E2E Case History'), description: 'History retrieval fixture', source: 'PHONE', status: state === 'CLOSED' ? 'CLOSED' : 'OPEN', ...(state === 'CLOSED' ? { resolutionSummary: 'Customer confirmed the fix.' } : {}) });
  if (state === 'ARCHIVED') await db.supportCase.update({ where: { id: row.id }, data: { archivedAt: new Date() } });
  await db.note.createMany({ data: Array.from({ length: count }, (_, index) => ({ supportCaseId: row.id, createdById: support.id, body: index === 0 ? longBody : `History note ${String(index).padStart(3, '0')}`, createdAt: new Date(row.createdAt.getTime() + 1000 * (index + 1)) })) });
  const oldest = await db.note.findFirstOrThrow({ where: { supportCaseId: row.id }, orderBy: { createdAt: 'asc' } });
  return { row, oldest };
}

test('PostgreSQL history has stable first/next/previous pages, exact counts, all sources, no duplicate completions', async () => {
  const f = await fixture();
  const first = (await caseHistoryPage(db, support, f.row.id))!;
  const second = (await caseHistoryPage(db, support, f.row.id, { page: '2' }))!;
  const last = (await caseHistoryPage(db, support, f.row.id, { page: '3' }))!;
  expect([first.count, first.pages, first.items.length, second.items.length, last.items.length]).toEqual([56, 3, 25, 25, 6]);
  expect(first.items[0].detail).toBe('History note 054');
  expect((await caseHistoryPage(db, support, f.row.id, { page: '1' }))!.items.map(item => item.key)).toEqual(first.items.map(item => item.key));
  const all = [...first.items, ...second.items, ...last.items];
  expect(new Set(all.map(item => item.key)).size).toBe(56);
  expect(all.filter(item => item.title === 'Case created')).toHaveLength(1);
  expect(all.every((item, index) => index === 0 || all[index - 1].at >= item.at)).toBe(true);
  expect(last.items.find(item => item.source === 'Note')?.detail?.length).toBeLessThanOrEqual(241);
  const recent = await caseHistoryView(db, f.row.id, f.row.createdAt, 'UTC');
  expect(recent.timeline.filter(item => item.source === 'Note')).toHaveLength(40);
  expect(recent.timeline.some(item => item.key === `note-${f.oldest.id}`)).toBe(false);
  expect(JSON.stringify(recent)).not.toContain('FULL NOTE END');

  const task = await db.task.create({ data: { supportCaseId: f.row.id, subject: 'Check diagnostics', assignedToId: support.id, completedAt: new Date(), status: 'COMPLETED' } });
  await db.supportCaseLifecycleEvent.create({ data: { supportCaseId: f.row.id, field: 'TASK_COMPLETED', source: `TASK:${task.id}`, actorId: support.id, createdAt: task.completedAt!, oldValue: '{"status":"OPEN"}', newValue: '{"status":"COMPLETED"}', newLabel: 'Check diagnostics' } });
  await db.supportCaseLifecycleEvent.create({ data: { supportCaseId: f.row.id, field: 'description', source: 'CRM', actorId: support.id, oldValue: 'Original details', newValue: 'Updated troubleshooting details' } });
  await db.activity.create({ data: { supportCaseId: f.row.id, type: 'EMAIL', direction: 'OUTBOUND', subject: 'Sent troubleshooting steps', description: 'Sent steps and asked the customer to retest.', emailRecipientEmail: 'customer@example.test', userId: support.id } });
  await db.supportCaseEmail.create({ data: { supportCaseId: f.row.id, gmailMessageId: uniqueName('history-message'), gmailThreadId: uniqueName('history-thread'), senderEmail: 'customer@example.test', subject: 'Printer diagnostic results', bodyText: 'Stored inbound response', messageDate: new Date(), linkedByUserId: support.id } });
  const file = await db.supportCaseAttachment.create({ data: { supportCaseId: f.row.id, originalFileName: 'retained-diagnostics.txt', storageKey: uniqueName('not-a-live-object'), contentType: 'text/plain', fileSizeBytes: 12, uploadedByUserId: support.id, deletedAt: new Date(), deletedByUserId: support.id } });
  const tasks = (await caseHistoryPage(db, support, f.row.id, { type: 'tasks' }))!;
  expect(tasks.items.map(item => item.title).sort()).toEqual(['Task completed', 'Task created']);
  const email = (await caseHistoryPage(db, support, f.row.id, { type: 'email' }))!;
  expect(email.items.map(item => item.kind).sort()).toEqual(['Email Response Logged', 'Inbound Email']);
  const changes = (await caseHistoryPage(db, support, f.row.id, { type: 'changes' }))!;
  expect(changes.items.some(item => item.title === 'Description changed' && item.detail?.includes('Updated troubleshooting details'))).toBe(true);
  const combined = (await caseHistoryPage(db, support, f.row.id))!;
  const remaining = await Promise.all(Array.from({ length: combined.pages - 1 }, (_, index) => caseHistoryPage(db, support, f.row.id, { page: String(index + 2) })));
  const combinedItems = [combined, ...remaining].flatMap(page => page!.items);
  expect(combinedItems.filter(item => item.key.includes(`attachment-`) && item.key.endsWith(`-${file.id}`))).toHaveLength(2);
  expect(combinedItems.filter(item => item.source === 'Attachment').every(item => !item.href && item.unavailable === 'Attachment unavailable')).toBe(true);
  await db.task.delete({ where: { id: task.id } });
  const missing = (await caseHistoryPage(db, support, f.row.id, { type: 'tasks' }))!.items;
  expect(missing).toHaveLength(1); expect(missing[0].unavailable).toBe('Task unavailable'); expect(missing[0].href).toBeUndefined();
});

test('full Note and history preserve Case visibility for roles, impersonation, closed/archived Cases, and forged parent URLs', async () => {
  for (const state of ['CLOSED', 'ARCHIVED'] as const) {
    const f = await fixture(1, state), hidden = await fixture(1, state, false);
    for (const role of ['support', 'admin', 'sales', 'salesManager', 'marketing', 'readOnly'] as const) {
      const actor = await db.user.findUniqueOrThrow({ where: { email: emails[role] } });
      expect((await caseHistoryPage(db, actor, f.row.id))!.count).toBe(2);
      expect((await caseNoteForReading(db, actor, f.row.id, f.oldest.id))!.body).toBe(longBody);
      const visible = ['support', 'admin'].includes(role);
      expect(!!await caseHistoryPage(db, actor, hidden.row.id)).toBe(visible);
      expect(!!await caseNoteForReading(db, actor, hidden.row.id, hidden.oldest.id)).toBe(visible);
    }
    const context = await resolveUserContext({ ...admin, name: 'Admin' }, String(sales.id), db, { NODE_ENV: 'development', ENABLE_DEV_IMPERSONATION: 'true' });
    expect(await caseHistoryPage(db, context.effective!, hidden.row.id)).toBeNull();
    expect(await caseNoteForReading(db, context.effective!, hidden.row.id, hidden.oldest.id)).toBeNull();
    expect(await caseNoteForReading(db, support, hidden.row.id, f.oldest.id)).toBeNull();
    await db.note.update({ where: { id: f.oldest.id }, data: { archivedAt: new Date() } });
    expect(await caseNoteForReading(db, support, f.row.id, f.oldest.id)).toBeNull();
  }
});

test('1000-Note query review: only 25 keys/previews hydrate, with bounded database reads and no N+1', async () => {
  const f = await fixture(1000);
  queries.length = 0;
  const started = performance.now();
  const result = (await caseHistoryPage(db, support, f.row.id, { type: 'notes', page: '20' }))!;
  const elapsed = performance.now() - started;
  expect(result.count).toBe(1000); expect(result.items).toHaveLength(25);
  expect(result.items.every(item => !item.fullBody && (item.detail?.length ?? 0) <= 241)).toBe(true);
  const reads = [...queries];
  expect(reads.filter(query => query.query.includes('left(n.body, 241)'))).toHaveLength(1);
  expect(reads.filter(query => query.query.startsWith('SELECT')).length).toBeLessThanOrEqual(8);
  expect(reads.some(query => /LIMIT [\s\S]*OFFSET/.test(query.query))).toBe(true);
  expect(reads.some(query => /"Note"[\s\S]*"body"/.test(query.query) && !query.query.includes('left(n.body, 241)') && !query.query.includes('UNION ALL'))).toBe(false);
  const source = caseHistorySource(f.row.id, []);
  const plan = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT key, id, at, model FROM (${source}) history WHERE category = 'notes' ORDER BY at DESC, key COLLATE "C" DESC LIMIT 25 OFFSET 475`);
  const explained = (plan[0]['QUERY PLAN'] as { 'Execution Time': number; Plan: { 'Actual Rows': number } }[])[0];
  expect(explained.Plan['Actual Rows']).toBe(25);
  expect(JSON.stringify(plan)).toContain('Note_supportCaseId_createdAt_idx');
  console.log(`Support history query review: 1000 Notes, page 20, ${elapsed.toFixed(1)}ms, ${reads.filter(query => query.query.startsWith('SELECT')).length} SELECTs; EXPLAIN returned 25 rows in ${explained['Execution Time']}ms using existing Case indexes.`);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
  test(`Case → older history → full Note → history/Case; closed and archived access at ${viewport.width}px`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    const f = await fixture(), path = `/support/cases/${f.row.id}`;
    await signInAs(page, 'support'); await page.goto(path);
    const timeline = page.getByRole('region', { name: 'Case Timeline', exact: true });
    await expect(timeline.getByText('Recent activity · Newest first')).toBeVisible();
    await expect(timeline.getByRole('button', { name: 'Show timeline' })).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('link', { name: 'View older history', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Case History', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Case history entries' }).locator(':scope > ol > li')).toHaveCount(25);
    await expect(page.getByRole('navigation', { name: 'History pages' })).toContainText('56 entries · Page 1 of 3');
    // Keyboard activation also avoids the development-only Next.js badge over the phone pager.
    await page.getByRole('link', { name: 'Next', exact: true }).press('Enter');
    await expect(page.getByRole('navigation', { name: 'History pages' })).toContainText('Page 2 of 3');
    await page.getByRole('link', { name: 'Previous', exact: true }).press('Enter');
    await expect(page.getByRole('navigation', { name: 'History pages' })).toContainText('Page 1 of 3');
    await page.getByRole('navigation', { name: 'History filters' }).getByRole('link', { name: 'Notes', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'History pages' })).toContainText('55 entries');
    await page.getByRole('link', { name: 'Next', exact: true }).press('Enter');
    await expect(page.getByRole('navigation', { name: 'History pages' })).toContainText('Page 2 of 3');
    await page.getByRole('link', { name: 'Next', exact: true }).press('Enter');
    await expect(page.getByRole('navigation', { name: 'History pages' })).toContainText('Page 3 of 3');
    const entry = page.getByRole('region', { name: 'Case history entries' }).locator('li').filter({ hasText: 'Diagnostic details.' });
    await expect(entry).toBeVisible();
    await expect(entry).not.toContainText('FULL NOTE END');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await entry.getByRole('link', { name: 'View full note', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Full Note' })).toContainText('FULL NOTE END — all details preserved');
    await expect(page.getByRole('article', { name: 'Full Note' })).toContainText('Indented printer configuration');
    await expect(page.locator('main form')).toHaveCount(0);
    expect(await page.getByRole('article', { name: 'Full Note' }).locator('p').last().textContent()).toBe(longBody);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`support-history-note-${viewport.width}.png`), fullPage: true });
    await page.getByRole('link', { name: 'Back to history', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'History pages' })).toContainText('Page 3 of 3');
    await page.getByRole('link', { name: 'Back to Case', exact: true }).click(); await expect(page).toHaveURL(path);
    await timeline.getByRole('button', { name: 'Show timeline' }).click();
    await timeline.getByRole('link', { name: 'View full note', exact: true }).first().click();
    await expect(page.getByRole('article', { name: 'Full Note' })).toBeVisible();
    for (const state of ['CLOSED', 'ARCHIVED'] as const) {
      const historical = await fixture(1, state);
      await page.goto(`/support/cases/${historical.row.id}`);
      await page.getByRole('link', { name: 'View older history', exact: true }).click();
      await expect(page.locator('main')).toContainText(state === 'CLOSED' ? 'Closed Case' : 'Archived Case');
      await page.getByRole('link', { name: 'View full note', exact: true }).click();
      await expect(page.getByRole('article', { name: 'Full Note' })).toContainText('FULL NOTE END');
    }
    await signInAs(page, 'readOnly');
    await page.goto(`${path}/notes/${f.oldest.id}`);
    await expect(page.getByRole('article', { name: 'Full Note' })).toContainText('FULL NOTE END');
    await expect(page.getByRole('link', { name: /Edit/ })).toHaveCount(0);
    const hidden = await fixture(1, 'OPEN', false);
    expect((await page.request.get(`/support/cases/${hidden.row.id}/history`)).status()).toBe(404);
    expect((await page.request.get(`/support/cases/${hidden.row.id}/notes/${hidden.oldest.id}`)).status()).toBe(404);
    expect((await page.request.get(`${path}/notes/${hidden.oldest.id}`)).status()).toBe(404);
  });
}
