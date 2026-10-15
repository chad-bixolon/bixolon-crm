import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';
import { signInAs, uniqueName } from './helpers';
import { databaseUrl, emails } from './constants.mjs';

// All fixtures and assertions use the disposable E2E database, never production.
const db = new PrismaClient({ datasourceUrl: databaseUrl });
const requestsByPage = new WeakMap<import('@playwright/test').Page, string[]>();
test.afterAll(() => db.$disconnect());
async function createCase(options: { noContact?: boolean; noAccount?: boolean; linked?: boolean; status?: 'OPEN' | 'CLOSED'; archived?: boolean } = {}) {
  const user = await db.user.findUniqueOrThrow({ where: { email: emails.support } });
  const account = options.noAccount ? null : await db.account.findFirstOrThrow({ where: { name: 'E2E Picker Account' } });
  const contact = options.noContact || !account ? null : await db.contact.findFirstOrThrow({ where: { accountId: account.id, email: 'e2e-picker-00@example.test' } });
  const row = await db.supportCase.create({ data: { caseNumber: uniqueName('BXS-E2E-OUTBOUND'), subject: uniqueName('Outbound case'), description: 'Synthetic Case for outbound logging.', source: options.linked ? 'EMAIL' : 'PHONE', status: options.status || 'OPEN', customerNameText: 'Email logging customer', accountId: account?.id, contactId: contact?.id, assignedToId: user.id, createdById: user.id, updatedById: user.id, archivedAt: options.archived ? new Date() : null } });
  if (options.linked) await db.supportCaseEmail.create({ data: { supportCaseId: row.id, gmailMessageId: uniqueName('outbound-context'), gmailThreadId: uniqueName('outbound-thread'), senderName: 'Linked Requester', senderEmail: 'requester@example.test', subject: 'Re: RFID calibration', bodyText: 'Existing inbound body is not outbound summary.', messageDate: new Date(), linkedByUserId: user.id } });
  return { row, user, account, contact };
}
test.beforeEach(async ({ page }) => {
  const googleRequests: string[] = [];
  requestsByPage.set(page, googleRequests);
  page.on('request', request => { if (/googleapis\.com|accounts\.google\.com|\/api\/support-gmail\//.test(request.url())) googleRequests.push(request.url()); });
  await page.route(/https:\/\/([^/]+\.)?(googleapis\.com|google\.com)\//, route => route.abort());
  // Browser requests are checked alongside server/domain no-network unit tests.
});
test.afterEach(async ({ page }) => { expect(requestsByPage.get(page)).toEqual([]); });

for (const [width, height] of [[1440, 900], [768, 1024], [390, 844]]) {
  test(`Support logs a prefilled outbound response and timeline at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    const { row, user, account, contact } = await createCase({ linked: true });
    await signInAs(page, 'support');
    await page.goto(`/support/cases/${row.id}`);
    const trigger = page.getByRole('button', { name: 'Log Email Response', exact: true });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    const panel = page.getByRole('region', { name: 'Log Email Response' });
    await expect(panel).toContainText(row.caseNumber);
    await expect(panel).toContainText(account!.name);
    await expect(panel).toContainText(`${contact!.firstName} ${contact!.lastName}`);
    await expect(panel).toContainText(`${user.firstName} ${user.lastName}`);
    await expect(panel.getByLabel('Recipient email', { exact: true })).toHaveValue(contact!.email!);
    await expect(panel.getByLabel('Email subject', { exact: true })).toHaveValue('Re: RFID calibration');
    const sentAt = panel.getByLabel(/^Sent at/);
    await expect(sentAt).not.toHaveValue('');
    const summary = panel.getByLabel('Short summary', { exact: true });
    await expect(summary).toHaveValue('');
    await expect(summary).toHaveAttribute('rows', '5');
    await expect(summary).toHaveAttribute('maxlength', '2000');
    const initial = (await summary.boundingBox())!.height;
    expect(initial).toBeGreaterThanOrEqual(118); expect(initial).toBeLessThan(180);
    await summary.pressSequentially('Firmware sent.\nAsked for a retest.\nReviewed setup.\nConfirmed model.\nRequested logs.\nAwaiting reply.\nFollow-up planned.');
    expect((await summary.boundingBox())!.height).toBeGreaterThan(initial);
    await summary.scrollIntoViewIfNeeded();
    const box = (await summary.boundingBox())!;
    await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4);
    await page.mouse.down(); await page.mouse.move(box.x + box.width - 4, box.y + box.height + 45, { steps: 8 }); await page.mouse.up();
    expect((await summary.boundingBox())!.height).toBeGreaterThan(box.height + 20);
    const longSummary = Array.from({ length: 60 }, (_, i) => `Step ${i + 1}: sent setup guidance.`).join('\n');
    await summary.selectText(); await page.keyboard.insertText(longSummary);
    await expect(summary).toHaveValue(longSummary);
    const dimensions = await summary.evaluate(element => ({ height: element.getBoundingClientRect().height, max: parseFloat(getComputedStyle(element).maxHeight), resize: getComputedStyle(element).resize, scroll: element.scrollHeight, client: element.clientHeight }));
    expect(dimensions.resize).toBe('vertical'); expect(dimensions.height).toBeLessThanOrEqual(dimensions.max + 1); expect(dimensions.scroll).toBeGreaterThan(dimensions.client);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await panel.locator('input[type="file"], [contenteditable="true"]').count()).toBe(0);
    await expect(panel.getByRole('button', { name: /^Send$/ })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`outbound-form-${width}.png`), fullPage: true });
    await panel.getByLabel('Email subject', { exact: true }).fill('Edited reply subject');
    await summary.fill('Sent updated firmware and asked customer to retest RFID calibration.');
    await panel.getByRole('button', { name: 'Log response', exact: true }).click();
    await expect(panel.getByRole('status')).toHaveText('Email response logged.');
    const activity = await db.activity.findFirstOrThrow({ where: { supportCaseId: row.id }, include: { contacts: true } });
    expect(activity.type).toBe('EMAIL'); expect(activity.direction).toBe('OUTBOUND'); expect(activity.userId).toBe(user.id); expect(activity.createdById).toBe(user.id); expect(activity.updatedById).toBe(user.id);
    expect(activity.accountId).toBe(account!.id); expect(activity.contacts.map(link => link.contactId)).toEqual([contact!.id]);
    expect(activity.subject).toBe('Edited reply subject'); expect(activity.emailRecipientEmail).toBe(contact!.email);
    expect(activity.description).toBe('Sent updated firmware and asked customer to retest RFID calibration.');
    await panel.getByRole('button', { name: 'Done' }).click();
    const timeline = page.getByRole('region', { name: 'Case Timeline' });
    await timeline.getByRole('button', { name: 'Show timeline' }).click();
    await expect(timeline.getByRole('heading', { name: 'Outbound Email', exact: true })).toBeVisible();
    await expect(timeline).toContainText(`${user.firstName} ${user.lastName} → ${contact!.firstName} ${contact!.lastName}`);
    await expect(timeline).toContainText('Edited reply subject'); await expect(timeline).toContainText(activity.description!);
    await expect(timeline.getByText('Inbound Email', { exact: true })).toBeVisible();
    const outboundItem = timeline.locator('li').filter({ has: page.getByRole('heading', { name: 'Outbound Email', exact: true }) });
    await expect(outboundItem.locator('details')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`outbound-timeline-${width}.png`), fullPage: true });
  });
}

test('missing recipient stays blank and editable; a Case without Account can log a response', async ({ page }) => {
  const { row } = await createCase({ noAccount: true });
  await signInAs(page, 'support'); await page.goto(`/support/cases/${row.id}`);
  await page.getByRole('button', { name: 'Log Email Response', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Log Email Response' });
  const recipient = panel.getByLabel('Recipient email', { exact: true });
  await expect(recipient).toHaveValue('');
  await expect(panel.getByLabel('Email subject', { exact: true })).toHaveValue(`Re: ${row.subject}`);
  await panel.getByRole('button', { name: 'Log response', exact: true }).click();
  expect(await recipient.evaluate(el => (el as HTMLInputElement).validity.valueMissing)).toBe(true);
  await recipient.fill('manual@example.test');
  const summary = panel.getByLabel('Short summary', { exact: true });
  // Bypass the browser cap to exercise server validation and retention.
  await summary.evaluate(el => el.removeAttribute('maxlength'));
  await summary.fill('x'.repeat(2001));
  await panel.getByLabel('Email subject', { exact: true }).fill('Retained edited subject');
  await panel.getByRole('button', { name: 'Log response', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveText('Check the highlighted fields.');
  await expect(summary).toHaveValue('x'.repeat(2001));
  await expect(recipient).toHaveValue('manual@example.test');
  await expect(panel.getByLabel('Email subject', { exact: true })).toHaveValue('Retained edited subject');
  expect(await db.activity.count({ where: { supportCaseId: row.id } })).toBe(0);
  await summary.fill('Sent setup instructions.');
  await panel.getByRole('button', { name: 'Log response', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('Email response logged.');
  const activity = await db.activity.findFirstOrThrow({ where: { supportCaseId: row.id } });
  expect(activity.accountId).toBeNull(); expect(activity.emailRecipientEmail).toBe('manual@example.test');
});

test('linked requester fallback works without a Contact; Admin can log; Read Only has no control', async ({ page }) => {
  const { row } = await createCase({ noContact: true, linked: true });
  await signInAs(page, 'admin'); await page.goto(`/support/cases/${row.id}`);
  await page.getByRole('button', { name: 'Log Email Response', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Log Email Response' });
  await expect(panel.getByLabel('Recipient email', { exact: true })).toHaveValue('requester@example.test');
  await expect(panel.getByLabel('Recipient name (optional)', { exact: true })).toHaveValue('Linked Requester');
  await panel.getByLabel('Short summary', { exact: true }).fill('Sent troubleshooting guidance.');
  await panel.getByRole('button', { name: 'Log response', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('Email response logged.');
  const admin = await db.user.findUniqueOrThrow({ where: { email: emails.admin } });
  expect((await db.activity.findFirstOrThrow({ where: { supportCaseId: row.id } })).createdById).toBe(admin.id);
  await signInAs(page, 'readOnly'); await page.goto(`/support/cases/${row.id}`);
  await expect(page.getByRole('button', { name: 'Log Email Response', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show timeline', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Outbound Email', exact: true })).toBeVisible();
});

test('closed and archived Cases do not offer outbound logging', async ({ page }) => {
  await signInAs(page, 'support');
  for (const options of [{ status: 'CLOSED' as const }, { archived: true }]) {
    const { row } = await createCase(options);
    await page.goto(`/support/cases/${row.id}`);
    await expect(page.getByRole('button', { name: 'Log Email Response', exact: true })).toHaveCount(0);
  }
});
