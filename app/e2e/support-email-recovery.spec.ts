import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';
import { signInAs } from './helpers';
import { databaseUrl, emails, authToken } from './constants.mjs';
import { ignoreSupportEmail, linkSupportEmail, createCaseFromSupportEmail } from '../lib/support-email';
import type { SupportMailMessage } from '../lib/support-gmail';

// Direct database writes in this file are confined to disposable synthetic Cases.
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
test.beforeAll(async () => {
  // Release mock message identities after an interrupted run; retain audit history.
  await db.supportCaseEmail.deleteMany({ where: { supportCase: { caseNumber: { startsWith: 'E2E-recovery-' } } } });
  await db.supportCase.updateMany({ where: { caseNumber: { startsWith: 'E2E-recovery-' } }, data: { archivedAt: new Date() } });
});
test.afterAll(async () => { await db.$disconnect(); });
async function createCase() {
  const actor = await db.user.findUniqueOrThrow({ where: { email: emails.support } });
  const row = await db.supportCase.create({ data: { caseNumber: `E2E-recovery-${randomUUID()}`, customerNameText: 'Synthetic requester', subject: 'Email recovery regression', description: 'Synthetic regression data', source: 'EMAIL', createdById: actor.id, updatedById: actor.id } });
  return { row, actor };
}
async function cleanup(caseId: number, messageIds: string[] = []) {
  await db.supportInboxDismissal.deleteMany({ where: { gmailMessageId: { in: messageIds } } });
  await db.supportCaseEmail.deleteMany({ where: { supportCaseId: caseId } });
  await db.supportCase.update({ where: { id: caseId }, data: { archivedAt: new Date() } });
}
async function fixtureIdentity(page: import('@playwright/test').Page) {
  await page.goto('/support/inbox');
  const card = page.getByRole('article').filter({ hasText: 'POC intake files-unselected request' });
  const href = await card.getByRole('link', { name: 'Create Case', exact: true }).getAttribute('href');
  const messageId = new URL(href!, 'http://localhost').searchParams.get('emailMessageId')!;
  return { messageId, threadId: messageId.replace('files-unselected-', 'files-unselected-thread-') };
}

test('attachment review reaches newer links after 50 older messages and provides older-page navigation', async ({ page }) => {
  await signInAs(page, 'support');
  const identity = await fixtureIdentity(page);
  const { row, actor } = await createCase();
  try {
    await db.supportCaseEmail.createMany({ data: Array.from({ length: 51 }, (_, index) => ({ supportCaseId: row.id, gmailMessageId: `poc-recovery-${row.id}-${index}`, gmailThreadId: `poc-recovery-thread-${row.id}-${index}`, senderEmail: 'synthetic@example.test', subject: 'Older unavailable email', bodyText: '', messageDate: new Date('2020-01-01'), linkedByUserId: actor.id })) });
    await db.supportCaseEmail.create({ data: { supportCaseId: row.id, gmailMessageId: identity.messageId, gmailThreadId: identity.threadId, senderEmail: 'files@example.test', subject: 'Newest actionable email', bodyText: '', messageDate: new Date(), linkedByUserId: actor.id } });
    await page.goto(`/support/cases/${row.id}/email-attachments`);
    await expect(page.getByRole('checkbox', { name: /error-log.txt/ })).toBeEnabled();
    await page.getByRole('link', { name: 'Older linked emails', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Newest linked emails', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Older linked emails', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Newest linked emails', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /error-log.txt/ })).toBeEnabled();
    const failures = Array.from({ length: 51 }, (_, index) => ({ threadId: identity.threadId, messageId: `poc-failed-reply-${row.id}-${index}`, partId: 'log', name: `failed-${index}.txt`, reason: 'Please retry.' }));
    for (const batch of [failures.slice(0, 50), failures.slice(50)]) await db.supportCaseLifecycleEvent.create({ data: { supportCaseId: row.id, actorId: actor.id, field: 'EMAIL_FILE_IMPORT', source: 'SUPPORT_EMAIL', newValue: JSON.stringify({ failures: batch }) } });
    await page.reload();
    await page.getByRole('link', { name: 'More failed email sources', exact: true }).click();
    await expect(page).toHaveURL(/retryPage=1/);
    await expect(page.getByRole('link', { name: 'More failed email sources', exact: true })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: /error-log.txt/ })).toBeEnabled();
  } finally { await cleanup(row.id); }
});

test('missing origin shows a retry state while surviving reply files remain importable with original provenance', async ({ page }) => {
  await signInAs(page, 'support');
  const identity = await fixtureIdentity(page);
  const { row, actor } = await createCase();
  const missingId = `poc-deleted-origin-${row.id}`;
  try {
    await db.supportCaseEmail.create({ data: { supportCaseId: row.id, gmailMessageId: missingId, gmailThreadId: identity.threadId, senderEmail: 'files@example.test', subject: 'Deleted origin', bodyText: '', messageDate: new Date(), linkedByUserId: actor.id } });
    await db.supportCaseAttachment.create({ data: { supportCaseId: row.id, originalFileName: 'error-log.txt', storageKey: `e2e/support-cases/${randomUUID()}`, contentType: 'text/plain', fileSizeBytes: 1, uploadedByUserId: actor.id, sourceMailbox: 'support@bixolonusa.com', sourceGmailMessageId: identity.messageId, sourceGmailThreadId: identity.threadId, sourceGmailPartId: 'log' } });
    await page.goto(`/support/cases/${row.id}/email-attachments`);
    await expect(page.getByRole('region', { name: 'Unavailable email sources' })).toContainText(missingId);
    await expect(page.getByRole('link', { name: 'Retry source review' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /error-log.txt/ })).toBeDisabled();
    await page.getByRole('checkbox', { name: /printer-photo.png/ }).check();
    await page.getByRole('button', { name: 'Import selected files', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/support/cases/${row.id}\\?emailFiles=complete$`));
    const file = await db.supportCaseAttachment.findFirstOrThrow({ where: { supportCaseId: row.id, originalFileName: 'printer-photo.png' } });
    expect([file.sourceGmailMessageId, file.sourceGmailThreadId, file.sourceGmailPartId]).toEqual([identity.messageId, identity.threadId, 'photo']);
  } finally { await cleanup(row.id); }
});

test('concurrent Ignore and Link serialize in PostgreSQL; duplicate link and intake retries repair old ignored state', async () => {
  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: databaseUrl, E2E_AUTH_ENABLED: 'true', E2E_AUTH_TOKEN: authToken, SUPPORT_GMAIL_ENABLED: 'true', SUPPORT_GMAIL_MOCK: 'true', SUPPORT_GMAIL_MAILBOX: 'support@bixolonusa.com' });
  const { row, actor } = await createCase();
  const message: SupportMailMessage = { id: `poc-race-${row.id}`, threadId: `poc-race-thread-${row.id}`, senderEmail: 'synthetic@example.test', senderName: null, recipients: 'support@bixolonusa.com', subject: 'Synthetic race', bodyText: 'Help', snippet: '', messageDate: new Date() };
  try {
    for (let index = 0; index < 8; index++) {
      await db.supportCaseEmail.deleteMany({ where: { supportCaseId: row.id } });
      const ignore = () => ignoreSupportEmail(db, actor, 'support@bixolonusa.com', message.id);
      const link = () => linkSupportEmail(db, actor, message, row.id);
      const results = await Promise.allSettled(index % 2 ? [link(), ignore(), link()] : [ignore(), link(), link()]);
      expect(results.filter(result => result.status === 'rejected').every(result => result.status === 'rejected' && /already linked/.test(String(result.reason)))).toBe(true);
      expect(await db.supportCaseEmail.count({ where: { gmailMessageId: message.id } })).toBe(1);
      expect(await db.supportInboxDismissal.count({ where: { gmailMessageId: message.id } })).toBe(0);
    }
    for (const retry of [() => linkSupportEmail(db, actor, message, row.id), () => createCaseFromSupportEmail(db, actor, { customerNameText: 'Synthetic', subject: 'Retry', description: 'Retry', source: 'EMAIL' }, message)]) {
      await db.supportInboxDismissal.create({ data: { mailbox: 'support@bixolonusa.com', gmailMessageId: message.id, ignoredByUserId: actor.id } });
      expect((await retry()).duplicate).toBe(true);
      expect(await db.supportInboxDismissal.count({ where: { gmailMessageId: message.id } })).toBe(0);
      expect(await db.supportCaseEmail.count({ where: { gmailMessageId: message.id } })).toBe(1);
    }
  } finally { await cleanup(row.id, [message.id]); }
});
