import { gmailWorkflow } from './support-gmail-runtime';
import { beginIntegrationAttempt, finishIntegrationAttempt, gmailContext, gmailFailure } from './integration-attempts';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Actor } from './authorization';
import type { DocumentStorage } from './document-storage';
import { assertInboxActor, assertEmailPersistenceAllowed, inboxMailboxIdentity } from './support-email';
import { signEmailSource, validateEmailSource } from './support-email-source';
import { supportMailbox, type GmailSupportMailbox, type SupportMailMessage, type SupportMailReview } from './support-gmail';
import type { SupportMailFile } from './support-gmail-files';
import { assertSupportAttachmentAccess, uploadSupportAttachment } from './support-attachments';
import { validateSupportAttachmentEnvelope } from './support-attachment-rules';
import { validateSupportAttachment } from './support-attachment-validation';

const INVALID = 'Invalid email file selection. Return to the email form and select files again.';
function mac(value: string) { if (!process.env.AUTH_SECRET) throw new Error(INVALID); return createHmac('sha256', process.env.AUTH_SECRET).update(`support-email-file:${value}`).digest('base64url'); }
function sourceHash(value: string) { return createHash('sha256').update(value).digest('hex'); }
export type EmailFileGrant = { origin: string; messageId: string; threadId: string; file: SupportMailFile };
export type EmailFileOption = { token: string; name: string; mimeType: string; size: number; kind: 'attachment' | 'inline'; received: string; subject: string; hiddenReason: string | null; unavailableReason: string | null; alreadyImported?: string };
export function emailFileOptions(actor: Actor, sourceToken: string, messages: SupportMailMessage[]): EmailFileOption[] {
  const source = validateEmailSource(actor, sourceToken);
  return messages.filter(message => message.threadId === source.threadId).flatMap(message => (message.files ?? []).map(file => {
    let name = file.fileName;
    try { name = validateSupportAttachmentEnvelope(file.fileName, file.mimeType, file.size).originalFileName; } catch {}
    const grant: EmailFileGrant = { origin: sourceHash(sourceToken), messageId: message.id, threadId: message.threadId, file };
    const encoded = Buffer.from(JSON.stringify(grant)).toString('base64url');
    return { token: file.unavailableReason ? '' : `${encoded}.${mac(encoded)}`, name, mimeType: file.mimeType, size: file.size, kind: file.kind, received: message.messageDate.toISOString(), subject: message.subject, hiddenReason: file.hiddenReason, unavailableReason: file.unavailableReason };
  })).slice(0, 200);
}
export function selectedEmailFiles(actor: Actor, sourceToken: string, tokens: string[]): EmailFileGrant[] {
  const source = validateEmailSource(actor, sourceToken);
  if (tokens.length > 50) throw new Error('Select at most 50 email files per import.');
  const result = new Map<string, EmailFileGrant>();
  for (const token of tokens) {
    const parts = token.split('.');
    if (token.length > 8192 || parts.length !== 2) throw new Error(INVALID);
    const expected = Buffer.from(mac(parts[0])), actual = Buffer.from(parts[1]);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error(INVALID);
    let grant: EmailFileGrant;
    try { grant = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { throw new Error(INVALID); }
    if (!grant || grant.origin !== sourceHash(sourceToken) || grant.threadId !== source.threadId || !/^[A-Za-z0-9_-]{1,128}$/.test(grant.messageId) || !grant.file || !/^[A-Za-z0-9_.-]{1,128}$/.test(grant.file.partId) || grant.file.unavailableReason) throw new Error(INVALID);
    validateSupportAttachmentEnvelope(grant.file.fileName, grant.file.mimeType, grant.file.size);
    result.set(`${grant.messageId}:${grant.file.partId}`, grant);
  }
  return [...result.values()];
}
export type EmailFileFailure = { threadId: string; messageId: string; partId: string; name: string; reason: string };
export type EmailFileImportResult = { imported: number; duplicate: number; failures: EmailFileFailure[] };
function safeFailure(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return /^(File |The selected file |Choose a file |Attachments cannot |Email file |Support Gmail )/.test(message) ? message : 'Could not copy this file. Please retry.';
}
export async function importSelectedEmailFiles(...args: Parameters<typeof importEmailFiles>) {
  return gmailWorkflow('file-import', () => importEmailFiles(...args));
}
async function importEmailFiles(db: PrismaClient, storage: DocumentStorage, actor: Actor, caseId: number, sourceToken: string, tokens: string[], mailbox = supportMailbox()): Promise<EmailFileImportResult> {
  assertInboxActor(actor); assertEmailPersistenceAllowed();
  const source = validateEmailSource(actor, sourceToken);
  const files = selectedEmailFiles(actor, sourceToken, tokens);
  if (!await db.supportCaseEmail.findFirst({ where: { supportCaseId: caseId, gmailThreadId: source.threadId }, select: { id: true } })) throw new Error('This email is not linked to this Case.');
  const result: EmailFileImportResult = { imported: 0, duplicate: 0, failures: [] };
  for (const grant of files) {
    const identity = { supportCaseId: caseId, sourceMailbox: source.mailbox, sourceGmailMessageId: grant.messageId, sourceGmailPartId: grant.file.partId };
    const attempt = await beginIntegrationAttempt(db, gmailContext('IMPORT_ATTACHMENT', source.mailbox, `${grant.messageId}:${grant.file.partId}`, actor.id, caseId));
    let uploadedKey: string | null = null;
    const trackedStorage: DocumentStorage = { ...storage, async uploadDocumentObject(input) { uploadedKey = input.storageKey; await storage.uploadDocumentObject(input); }, async deleteDocumentObject(key) { await storage.deleteDocumentObject(key); if (uploadedKey === key) uploadedKey = null; } };
    try {
      await assertSupportAttachmentAccess(db, actor, caseId, true);
      // Include removed metadata: a deliberate removal must not be undone by a retry.
      if (await db.supportCaseAttachment.findFirst({ where: identity, select: { id: true } })) { result.duplicate++; await finishIntegrationAttempt(db, attempt.id); continue; }
      const download = await mailbox.attachment(grant.messageId, grant.file.partId);
      if (download.message.id !== grant.messageId || download.message.threadId !== source.threadId || download.file.partId !== grant.file.partId || download.file.attachmentId !== grant.file.attachmentId || download.file.fileName !== grant.file.fileName || download.file.mimeType !== grant.file.mimeType || download.file.size !== grant.file.size) throw new Error('Email file metadata changed. Review the email files again.');
      const file = await validateSupportAttachment({ name: download.file.fileName, type: download.file.mimeType, size: download.file.size, arrayBuffer: async () => Uint8Array.from(download.body).buffer });
      const created = await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`email-file:${caseId}:${source.mailbox}:${grant.messageId}:${grant.file.partId}`}, 0))`;
        if (await tx.supportCaseAttachment.findFirst({ where: identity, select: { id: true } })) return false;
        await uploadSupportAttachment(tx, trackedStorage, actor, caseId, file, { sourceMailbox: source.mailbox, sourceGmailMessageId: grant.messageId, sourceGmailThreadId: source.threadId, sourceGmailAttachmentId: grant.file.attachmentId, sourceGmailPartId: grant.file.partId });
        return true;
      }, { maxWait: 10000, timeout: 30000 });
      if (created) result.imported++; else result.duplicate++;
      await finishIntegrationAttempt(db, attempt.id);
    } catch (error) {
      if (uploadedKey) {
        // A lost commit acknowledgement is ambiguous. Confirm metadata before
        // deleting an object that may already belong to a committed attachment.
        try {
          const committed = await db.supportCaseAttachment.findFirst({ where: { storageKey: uploadedKey }, select: { id: true } });
          if (committed) { result.imported++; await finishIntegrationAttempt(db, attempt.id); continue; }
          await storage.deleteDocumentObject(uploadedKey);
        } catch { console.error('Support email file object cleanup could not be confirmed.'); }
      }
      let name = grant.file.fileName;
      try { name = validateSupportAttachmentEnvelope(name, grant.file.mimeType, grant.file.size).originalFileName; } catch {}
      result.failures.push({ threadId: source.threadId, messageId: grant.messageId, partId: grant.file.partId, name, reason: safeFailure(error) });
      await finishIntegrationAttempt(db, attempt.id, gmailFailure(error));
    }
  }
  return result;
}
export async function recordEmailFileImport(db: PrismaClient, actor: Actor, caseId: number, result: EmailFileImportResult) {
  if (!result.imported && !result.duplicate && !result.failures.length) return;
  await db.supportCaseLifecycleEvent.create({ data: { supportCaseId: caseId, actorId: actor.id, field: 'EMAIL_FILE_IMPORT', source: 'SUPPORT_EMAIL', newValue: JSON.stringify(result), newLabel: `${result.imported} email files imported; ${result.duplicate} already imported; ${result.failures.length} failed${result.failures.length ? `: ${result.failures.map(row => row.name).join(', ')}` : ''}` } });
}
export async function emailFileRecovery(db: PrismaClient, caseId: number) {
  const events = await db.supportCaseLifecycleEvent.findMany({ where: { supportCaseId: caseId, field: 'EMAIL_FILE_IMPORT' }, orderBy: { id: 'desc' }, take: 50, select: { newValue: true } });
  const failures = new Map<string, EmailFileFailure>();
  for (const event of events) {
    try { const result = JSON.parse(event.newValue ?? '') as EmailFileImportResult; for (const failure of (result.failures ?? []).slice(0, 50)) { const key = `${failure.messageId}:${failure.partId}`; if (!failures.has(key)) failures.set(key, failure); } } catch {}
  }
  if (!failures.size) return [];
  // Each of the 50 retained import events contains at most 50 selections.
  const imported = await db.supportCaseAttachment.findMany({ where: { supportCaseId: caseId, sourceMailbox: inboxMailboxIdentity(), OR: [...failures.values()].map(row => ({ sourceGmailMessageId: row.messageId, sourceGmailPartId: row.partId })) }, take: 2500, select: { sourceGmailMessageId: true, sourceGmailPartId: true } });
  const complete = new Set(imported.map(row => `${row.sourceGmailMessageId}:${row.sourceGmailPartId}`));
  return [...failures.entries()].filter(([key]) => !complete.has(key)).map(([, failure]) => failure);
}

export type EmailFileUnavailable = { messageId: string; reason: string };
const REVIEW_PAGE_SIZE = 50;
export async function caseEmailFileContext(...args: Parameters<typeof fileContext>) {
  return gmailWorkflow('file-review', () => fileContext(...args));
}
async function fileContext(db: PrismaClient, actor: Actor, caseId: number, cursor?: number, mailbox: GmailSupportMailbox = supportMailbox(), retryPage = 0) {
  assertInboxActor(actor); await assertSupportAttachmentAccess(db, actor, caseId, true);
  if (!Number.isSafeInteger(retryPage) || retryPage < 0 || retryPage >= 50) throw new Error('Invalid email attachment retry page.');
  if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 1)) throw new Error('Invalid email attachment page.');
  if (cursor !== undefined && !await db.supportCaseEmail.findFirst({ where: { id: cursor, supportCaseId: caseId }, select: { id: true } })) throw new Error('Invalid email attachment page.');
  const [page, failures] = await Promise.all([
    db.supportCaseEmail.findMany({ where: { supportCaseId: caseId }, orderBy: [{ messageDate: 'desc' }, { id: 'desc' }], take: REVIEW_PAGE_SIZE + 1, ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }), select: { id: true, gmailMessageId: true, gmailThreadId: true } }),
    emailFileRecovery(db, caseId),
  ]);
  const linked = page.slice(0, REVIEW_PAGE_SIZE);
  // Retry sources bypass the recent-link window, but a lifecycle event alone
  // cannot authorize a thread. Verify that it is still linked to this Case.
  const allRetrySources = [...new Map(failures.map(row => [row.messageId, { gmailMessageId: row.messageId, gmailThreadId: row.threadId }])).values()];
  const retrySources = allRetrySources.slice(retryPage * REVIEW_PAGE_SIZE, (retryPage + 1) * REVIEW_PAGE_SIZE);
  const retryLinks = retrySources.length ? await db.supportCaseEmail.findMany({ where: { supportCaseId: caseId, gmailThreadId: { in: [...new Set(retrySources.map(row => row.gmailThreadId))] } }, orderBy: [{ messageDate: 'desc' }, { id: 'desc' }], distinct: ['gmailThreadId'], take: REVIEW_PAGE_SIZE, select: { gmailMessageId: true, gmailThreadId: true } }) : [];
  const allowedThreads = new Set([...linked, ...retryLinks].map(link => link.gmailThreadId));
  const retainedSources = allowedThreads.size ? await db.supportCaseAttachment.findMany({ where: { supportCaseId: caseId, sourceMailbox: inboxMailboxIdentity(), sourceGmailThreadId: { in: [...allowedThreads] }, sourceGmailMessageId: { not: null } }, distinct: ['sourceGmailMessageId'], orderBy: { id: 'desc' }, take: REVIEW_PAGE_SIZE, select: { sourceGmailMessageId: true, sourceGmailThreadId: true } }) : [];
  const extraSources = retainedSources.map(row => ({ gmailMessageId: row.sourceGmailMessageId!, gmailThreadId: row.sourceGmailThreadId! }));
  // At most 200 distinct exact metadata reads: 50 retry sources, 50 page
  // links, 50 retry-thread anchors and 50 retained-provenance messages.
  const sources = [...new Map([...retrySources, ...linked, ...retryLinks, ...extraSources].filter(link => allowedThreads.has(link.gmailThreadId)).map(link => [link.gmailMessageId, link])).values()];
  const messages: SupportMailMessage[] = [];
  const unavailable: EmailFileUnavailable[] = [];
  // Live review shares one token/profile verification, with per-source failures.
  let reviewed: SupportMailReview[] | undefined;
  if (mailbox.review && sources.length) {
    try { reviewed = await mailbox.review(sources.map(link => link.gmailMessageId)); }
    catch (error) { reviewed = sources.map(() => ({ message: null, error: safeFailure(error) })); }
  }
  for (const [index, link] of sources.entries()) {
    try {
      if (reviewed?.[index].error) throw new Error(reviewed[index].error);
      const message = reviewed ? reviewed[index].message : await mailbox.get(link.gmailMessageId);
      if (!message || message.id !== link.gmailMessageId || message.threadId !== link.gmailThreadId) {
        unavailable.push({ messageId: link.gmailMessageId, reason: 'Source email is missing or no longer matches its saved identity. Its files cannot be recovered here. Restore the original email if possible, then retry.' });
      } else messages.push(message);
    } catch (error) {
      const reason = error instanceof Error && /^Support Gmail /.test(error.message) ? error.message : 'Source email could not be read. Check the Gmail connection and retry; other available emails can still be reviewed.';
      unavailable.push({ messageId: link.gmailMessageId, reason });
    }
  }
  // A missing origin may have a surviving reply in the existing bounded
  // inbox window. Trust its actual Gmail thread/message IDs, never filenames.
  if (unavailable.length) {
    try {
      const seen = new Set(messages.map(message => message.id));
      for (const message of (await mailbox.recent()).slice(0, REVIEW_PAGE_SIZE)) {
        if (allowedThreads.has(message.threadId) && !seen.has(message.id) && /^[A-Za-z0-9_-]{1,128}$/.test(message.id)) {
          // The inbox cache contains metadata only; file grants require a fresh full read.
          const full = await mailbox.get(message.id);
          if (full && full.id === message.id && full.threadId === message.threadId) { messages.push(full); seen.add(full.id); }
        }
      }
    } catch { /* Per-source retry messages remain visible if Gmail is unavailable. */ }
  }
  const imported = messages.length ? await db.supportCaseAttachment.findMany({ where: { supportCaseId: caseId, sourceMailbox: inboxMailboxIdentity(), sourceGmailMessageId: { in: messages.map(message => message.id) } }, take: messages.length * 200, select: { sourceGmailMessageId: true, sourceGmailPartId: true, deletedAt: true } }) : [];
  const complete = new Map(imported.map(row => [`${row.sourceGmailMessageId}:${row.sourceGmailPartId}`, row]));
  const failed = new Set(failures.map(row => `${row.messageId}:${row.partId}`));
  const rank = (messageId: string, partId: string) => complete.has(`${messageId}:${partId}`) ? 2 : failed.has(`${messageId}:${partId}`) ? 0 : 1;
  const newestFirst = (a: SupportMailMessage, b: SupportMailMessage) => b.messageDate.getTime() - a.messageDate.getTime() || a.id.localeCompare(b.id);
  const groups = [...new Set(messages.map(message => message.threadId))].map(threadId => {
    const thread = messages.filter(message => message.threadId === threadId).sort(newestFirst);
    // Sign a surviving, identity-checked message in the linked thread. Each
    // file grant still retains its actual message and part IDs.
    const token = signEmailSource(actor, thread[0]);
    const allOptions = thread.flatMap(message => {
      const files = [...(message.files ?? [])].sort((a, b) => rank(message.id, a.partId) - rank(message.id, b.partId) || a.partId.localeCompare(b.partId));
      return emailFileOptions(actor, token, [{ ...message, files }]).map((option, index) => {
        const file = files[index];
        const existing = complete.get(`${message.id}:${file.partId}`);
        return { option: { ...option, alreadyImported: existing ? existing.deletedAt ? 'Already imported (removed from Case)' : 'Already imported' : undefined }, rank: rank(message.id, file.partId), date: message.messageDate.getTime(), messageId: message.id, partId: file.partId };
      });
    });
    // Sort across messages before applying the per-thread option limit.
    allOptions.sort((a, b) => a.rank - b.rank || b.date - a.date || a.messageId.localeCompare(b.messageId) || a.partId.localeCompare(b.partId));
    for (const failure of failures.filter(row => row.threadId === threadId && !complete.has(`${row.messageId}:${row.partId}`))) {
      const message = thread.find(message => message.id === failure.messageId);
      if (message && !message.files?.some(file => file.partId === failure.partId)) unavailable.push({ messageId: failure.messageId, reason: `${failure.name}: the original file is no longer available. Restore that file at its original source if possible, then retry.` });
    }
    return { token, options: allOptions.slice(0, 200).map(row => row.option), rank: allOptions[0]?.rank ?? 3, date: thread[0].messageDate.getTime(), threadId };
  }).sort((a, b) => a.rank - b.rank || b.date - a.date || a.threadId.localeCompare(b.threadId));
  return { groups, unavailable, nextRetryPage: allRetrySources.length > (retryPage + 1) * REVIEW_PAGE_SIZE ? retryPage + 1 : null, nextCursor: page.length > REVIEW_PAGE_SIZE ? linked.at(-1)!.id : null };
}
