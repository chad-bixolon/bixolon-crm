import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';
import { databaseUrl, emails } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';
import { createSupportCase } from '../lib/support-cases';

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const linkedId = 'poc-unrelated-1';
const ignoredId = 'poc-vendor';
test.beforeAll(async () => {
  const actor = await db.user.findUniqueOrThrow({ where: { email: emails.support } });
  const row = await createSupportCase(db, actor, { customerNameText: 'Triage customer', subject: uniqueName('E2E triage'), description: 'Triage fixture', source: 'EMAIL' });
  await db.supportCaseEmail.upsert({ where: { gmailMessageId: linkedId }, update: {}, create: { supportCaseId: row.id, gmailMessageId: linkedId, gmailThreadId: 'poc-unrelated-thread', senderEmail: 'stranger@example.test', subject: 'Unrelated mailbox message', bodyText: 'Synthetic fixture', messageDate: new Date(), linkedByUserId: actor.id } });
  await db.supportInboxDismissal.upsert({ where: { mailbox_gmailMessageId: { mailbox: 'support@bixolonusa.com', gmailMessageId: ignoredId } }, update: {}, create: { mailbox: 'support@bixolonusa.com', gmailMessageId: ignoredId, ignoredByUserId: actor.id } });
});
test.afterAll(async () => {
  await db.supportInboxDismissal.deleteMany({ where: { gmailMessageId: ignoredId } });
  await db.supportCaseEmail.deleteMany({ where: { gmailMessageId: linkedId } });
  await db.$disconnect();
});

test('views count and filter only the current batch without any request; Help and older Gmail path explain scope', async ({ page }) => {
  await signInAs(page, 'support');
  await page.goto('/support/inbox');
  const batch = page.getByRole('region', { name: 'Recent Inbox batch' });
  const views = batch.getByRole('group', { name: 'Inbox triage views' });
  const all = views.getByRole('button', { name: /^All / });
  const unlinked = views.getByRole('button', { name: /^Unlinked / });
  const review = views.getByRole('button', { name: /^Needs Review / });
  const allCount = await batch.getByRole('article').count();
  const unlinkedCount = await batch.locator('article:not([data-message-state="linked"])').count();
  const reviewCount = await batch.locator('article[data-message-state="needs-review"]').count();
  expect(allCount).toBeGreaterThan(0); expect(allCount).toBeLessThan(50);
  expect(unlinkedCount).toBeLessThan(allCount); expect(reviewCount).toBeGreaterThan(0);
  await expect(all).toHaveText(`All ${allCount}`);
  await expect(unlinked).toHaveText(`Unlinked ${unlinkedCount}`);
  await expect(review).toHaveText(`Needs Review ${reviewCount}`);
  await expect(batch.getByRole('status')).toHaveText(`${allCount} messages shown · Up to 50 messages from the last 30 days`);
  await expect(batch.getByRole('article', { name: 'Invoice reminder', exact: true })).toHaveCount(0);
  // Drain startup/prefetch work; filter clicks themselves must generate no request.
  await page.waitForLoadState('networkidle');
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  for (const [button, count] of [[unlinked, unlinkedCount], [review, reviewCount], [all, allCount]] as const) {
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(batch.getByRole('article')).toHaveCount(count);
    await expect(batch.getByRole('status')).toHaveText(`${count} message${count === 1 ? '' : 's'} shown · Up to 50 messages from the last 30 days`);
    if (button === unlinked) await expect(batch.getByRole('article', { name: 'Unrelated mailbox message', exact: true })).toHaveCount(0);
    if (button === review) await expect(batch.getByRole('article', { name: 'Two cases', exact: true })).toBeVisible();
  }
  expect(requests).toEqual([]);
  await expect(page.getByRole('link', { name: 'Older messages in Gmail' })).toHaveAttribute('href', 'https://mail.google.com/');
  await page.getByRole('link', { name: /Show ignored messages/ }).click();
  await expect(page.getByRole('region', { name: 'Ignored messages' })).toContainText('Invoice reminder');
  await expect(batch.getByRole('status')).toContainText(`${allCount} messages shown · Up to 50`);
  await expect(all).toHaveText(`All ${allCount}`);
  await page.getByRole('link', { name: 'Help with Support Inbox' }).click();
  await expect(page).toHaveURL(/\/help\/support-inbox$/);
  const help = page.getByRole('article', { name: 'Support Inbox' });
  await expect(help).toContainText('bounded recent Gmail batch');
  await expect(help).toContainText('filter only that current batch');
  await expect(help).toContainText('Older mail remains in Gmail');
});

for (const [width, height] of [[1440, 900], [768, 1024], [820, 1180], [1024, 768], [390, 844]]) {
  test.describe(`triage viewport ${width}`, () => {
    test.use({ viewport: { width, height }, isMobile: width < 1100, hasTouch: width < 1100 });
    test(`compact triage fits ${width}px with accessible controls and no overflow`, async ({ page }, testInfo) => {
      await signInAs(page, 'support');
      await page.goto('/support/inbox');
      const batch = page.getByRole('region', { name: 'Recent Inbox batch' });
      const controls = batch.getByRole('group', { name: 'Inbox triage views' });
      for (const button of await controls.getByRole('button').all()) {
        await expect(button).toBeVisible();
        const box = (await button.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
        await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'true');
      }
      await controls.getByRole('button', { name: /^All / }).focus();
      await page.keyboard.press('Space');
      await expect(controls.getByRole('button', { name: /^All / })).toHaveAttribute('aria-pressed', 'true');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`triage-${width}.png`), fullPage: false });
    });
  });
}
