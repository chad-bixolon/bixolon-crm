import type { Prisma, PrismaClient } from '@prisma/client';
import { assertPermission, type Actor } from './authorization';
import type { SupportMailMessage } from './support-gmail';
import { assertSupportGmailEnabled, supportGmailMockMode, supportGmailTestFixtureMode, assertLiveSupportGmailEnvironment } from './support-gmail';
import { createSupportCaseInTransaction, type SupportCaseInput } from './support-cases';

export function assertInboxActor(actor: Actor) {
  assertSupportGmailEnabled();
  assertPermission(actor, 'support-cases.write');
}
// Explicit CRM writes use the same environment boundary as Gmail reads.
export function assertEmailPersistenceAllowed() {
  assertSupportGmailEnabled();
  if (!supportGmailMockMode() && !supportGmailTestFixtureMode()) assertLiveSupportGmailEnvironment();
}
export function inboxMailboxIdentity() {
  const mailbox = process.env.SUPPORT_GMAIL_MAILBOX?.trim().toLowerCase();
  if (!mailbox || !/^[^@\s]+@[^@\s]+$/.test(mailbox)) throw new Error('Configure the dedicated Support mailbox identity.');
  return mailbox;
}
export async function ignoreSupportEmail(db: PrismaClient, actor: Actor, mailbox: string, messageId: string) {
  assertInboxActor(actor);
  assertEmailPersistenceAllowed();
  if (mailbox !== inboxMailboxIdentity() || !/^[A-Za-z0-9_-]{1,128}$/.test(messageId)) throw new Error('Invalid Support inbox message.');
  await db.$transaction(async tx => {
    await lockEmailMessage(tx, mailbox, messageId);
    const linked = await tx.supportCaseEmail.findUnique({ where: { gmailMessageId: messageId }, select: { id: true } });
    if (linked) throw new Error('This message is already linked to a Support Case.');
    await tx.supportInboxDismissal.upsert({ where: { mailbox_gmailMessageId: { mailbox, gmailMessageId: messageId } }, update: {}, create: { mailbox, gmailMessageId: messageId, ignoredByUserId: actor.id } });
  });
}
export async function restoreSupportEmail(db: PrismaClient, actor: Actor, mailbox: string, messageId: string) {
  assertInboxActor(actor);
  assertEmailPersistenceAllowed();
  if (mailbox !== inboxMailboxIdentity() || !/^[A-Za-z0-9_-]{1,128}$/.test(messageId)) throw new Error('Invalid Support inbox message.');
  await db.supportInboxDismissal.deleteMany({ where: { mailbox, gmailMessageId: messageId } });
}
export function limitedEmailBody(body: string) { return Array.from(body).slice(0, 20000).join(''); }
export function caseReferences(message: SupportMailMessage) {
  const currentBody = message.bodyText.split(/\r?\n/).filter(line => !/^\s*[>|]/.test(line)).join('\n');
  return [...new Set((message.subject + '\n' + currentBody).match(/\bBXS-\d{4}-\d{6}\b/gi)?.map(value => value.toUpperCase()) ?? [])];
}
export async function suggestSupportEmail(db: PrismaClient, message: SupportMailMessage) {
  const linkedThreads = await db.supportCaseEmail.findMany({ where: { gmailThreadId: message.threadId }, select: { supportCase: { select: { id: true, caseNumber: true, subject: true, status: true, accountId: true } } }, distinct: ['supportCaseId'], take: 2 });
  const threadConflict = linkedThreads.length > 1;
  const linkedThread = threadConflict ? null : linkedThreads[0];
  const exactContacts = await db.contact.findMany({ where: { email: { equals: message.senderEmail, mode: 'insensitive' }, active: true, archivedAt: null }, select: { id: true, firstName: true, lastName: true, accountId: true, account: { select: { id: true, name: true, archivedAt: true, status: true } } }, take: 2 });
  const contact = exactContacts.length === 1 ? exactContacts[0] : null;
  const account = contact?.account?.archivedAt ? null : contact?.account ?? null;
  const references = caseReferences(message);
  const number = references.length === 1 ? references[0] : null;
  const numberedCase = number ? await db.supportCase.findFirst({ where: { caseNumber: number, archivedAt: null }, select: { id: true, caseNumber: true, subject: true, status: true, accountId: true } }) : null;
  const cases = account ? await db.supportCase.findMany({ where: { archivedAt: null, status: { in: ['NEW', 'OPEN', 'WAITING_ON_CUSTOMER', 'WAITING_ON_INTERNAL'] }, accountId: account.id, OR: [{ contactId: contact!.id }, { contactId: null }] }, select: { id: true, caseNumber: true, subject: true, status: true, accountId: true }, orderBy: { openedAt: 'desc' }, take: 5 }) : [];
  const suggestedCases = [...new Map([linkedThread?.supportCase, numberedCase, ...cases].filter((value): value is NonNullable<typeof value> => !!value).map(row => [row.id, row])).values()];
  return { contact, account, suggestedCases: threadConflict ? [] : suggestedCases, linkedThreadCaseId: linkedThread?.supportCase.id ?? null, numberedCaseId: numberedCase?.id ?? null, threadConflict, multipleCaseReferences: references.length > 1, caseReferenceConflict: !!linkedThread && !!numberedCase && linkedThread.supportCase.id !== numberedCase.id, ambiguousContact: exactContacts.length > 1, relatedCaseCount: cases.length };
}

export async function suggestSupportEmails(db: PrismaClient, messages: SupportMailMessage[]) {
  if (!messages.length) return [];
  const refs = caseReferences;
  const threadIds = [...new Set(messages.map(message => message.threadId))];
  const emails = [...new Set(messages.map(message => message.senderEmail.toLowerCase()))];
  const numbers = [...new Set(messages.flatMap(refs))];
  const [links, contacts, numbered] = await Promise.all([
    db.supportCaseEmail.findMany({ where: { gmailThreadId: { in: threadIds } }, select: { gmailThreadId: true, gmailMessageId: true, supportCase: { select: { id: true, caseNumber: true, subject: true, status: true, accountId: true } } } }),
    db.contact.findMany({ where: { email: { in: emails, mode: 'insensitive' }, active: true, archivedAt: null }, select: { id: true, email: true, firstName: true, lastName: true, accountId: true, account: { select: { id: true, name: true, archivedAt: true, status: true } } } }),
    db.supportCase.findMany({ where: { caseNumber: { in: numbers }, archivedAt: null }, select: { id: true, caseNumber: true, subject: true, status: true, accountId: true } }),
  ]);
  const byThread = new Map<string, typeof links>();
  for (const link of links) byThread.set(link.gmailThreadId, [...(byThread.get(link.gmailThreadId) ?? []), link]);
  const byEmail = new Map<string, typeof contacts>();
  for (const contact of contacts) { const key = contact.email?.toLowerCase(); if (key) byEmail.set(key, [...(byEmail.get(key) ?? []), contact]); }
  const byNumber = new Map(numbered.map(row => [row.caseNumber, row]));
  const uniqueContacts = [...new Map([...byEmail.values()].filter(rows => rows.length === 1).map(rows => [rows[0].id, rows[0]])).values()];
  const accountIds = [...new Set(uniqueContacts.map(row => row.accountId).filter((id): id is number => id !== null))];
  const open = accountIds.length ? await db.supportCase.findMany({ where: { accountId: { in: accountIds }, archivedAt: null, status: { in: ['NEW', 'OPEN', 'WAITING_ON_CUSTOMER', 'WAITING_ON_INTERNAL'] } }, select: { id: true, caseNumber: true, subject: true, status: true, accountId: true, contactId: true }, orderBy: { openedAt: 'desc' } }) : [];
  return messages.map(message => {
    const threadLinks = byThread.get(message.threadId) ?? [];
    const distinctThreadCases = [...new Map(threadLinks.map(link => [link.supportCase.id, link.supportCase])).values()];
    const threadConflict = distinctThreadCases.length > 1;
    const linkedThread = threadConflict ? null : distinctThreadCases[0] ?? null;
    const candidates = byEmail.get(message.senderEmail.toLowerCase()) ?? [];
    const contact = candidates.length === 1 ? candidates[0] : null;
    const account = contact?.account?.archivedAt ? null : contact?.account ?? null;
    const references = refs(message);
    const numberedCase = references.length === 1 ? byNumber.get(references[0]) ?? null : null;
    const related = account ? open.filter(row => row.accountId === account.id && (row.contactId === contact?.id || row.contactId === null)).slice(0, 5) : [];
    const suggestedCases = threadConflict ? [] : [...new Map([linkedThread, numberedCase, ...related].filter((value): value is NonNullable<typeof value> => !!value).map(row => [row.id, row])).values()];
    return { message, suggestion: { contact, account, suggestedCases, linkedThreadCaseId: linkedThread?.id ?? null, numberedCaseId: numberedCase?.id ?? null, threadConflict, multipleCaseReferences: references.length > 1, caseReferenceConflict: !!linkedThread && !!numberedCase && linkedThread.id !== numberedCase.id, alreadyLinkedCaseId: threadLinks.find(link => link.gmailMessageId === message.id)?.supportCase.id ?? null, ambiguousContact: candidates.length > 1, relatedCaseCount: related.length } };
  });
}

export async function linkSupportEmail(db: PrismaClient, actor: Actor, message: SupportMailMessage, caseId: number) {
  assertInboxActor(actor);
  assertEmailPersistenceAllowed();
  return db.$transaction(async tx => {
    await lockEmailThread(tx, message.threadId);
    return linkSupportEmailInTransaction(tx, actor, message, caseId);
  });
}

async function linkSupportEmailInTransaction(db: Prisma.TransactionClient, actor: Actor, message: SupportMailMessage, caseId: number) {
  assertInboxActor(actor);
  assertEmailPersistenceAllowed();
  if (!Number.isSafeInteger(caseId) || caseId < 1) throw new Error('Choose a valid Support Case.');
  const row = await db.supportCase.findFirst({ where: { id: caseId, archivedAt: null }, select: { id: true } });
  if (!row) throw new Error('Support Case not found.');
  const mailbox = inboxMailboxIdentity();
  await lockEmailMessage(db, mailbox, message.id);
  const existing = await db.supportCaseEmail.findUnique({ where: { gmailMessageId: message.id }, select: { supportCaseId: true } });
  if (existing) { if (existing.supportCaseId === caseId) { await db.supportInboxDismissal.deleteMany({ where: { mailbox, gmailMessageId: message.id } }); return { duplicate: true }; } throw new Error('This email is already linked to another Support Case.'); }
  const threadCases = await db.supportCaseEmail.findMany({ where: { gmailThreadId: message.threadId }, select: { supportCaseId: true }, distinct: ['supportCaseId'], take: 2 });
  if (threadCases.length > 1 || (threadCases.length === 1 && threadCases[0].supportCaseId !== caseId)) throw new Error('This Gmail thread is linked to a different or conflicting Support Case. Review the thread before linking.');
  await db.supportCaseEmail.create({ data: { supportCaseId: caseId, gmailMessageId: message.id, gmailThreadId: message.threadId, senderEmail: message.senderEmail, senderName: message.senderName, subject: Array.from(message.subject).slice(0, 300).join(''), bodyText: limitedEmailBody(message.bodyText), messageDate: message.messageDate, linkedByUserId: actor.id } });
  await db.supportInboxDismissal.deleteMany({ where: { mailbox, gmailMessageId: message.id } });
  return { duplicate: false };
}

// Link takes the thread lock before the message lock. Ignore takes only the
// message lock, preventing both contradictory state and a cyclic lock order.
async function lockEmailMessage(tx: Prisma.TransactionClient, mailbox: string, messageId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`support-email-message:${mailbox}:${messageId}`}, 0))`;
}

// Shared by manual linking and intake; serializes different messages in the same thread.
async function lockEmailThread(tx: Prisma.TransactionClient, threadId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`support-email:${inboxMailboxIdentity()}:${threadId}`}, 0))`;
}
export async function existingEmailCase(db: Prisma.TransactionClient, message: SupportMailMessage) {
  const links = await db.supportCaseEmail.findMany({ where: { OR: [{ gmailMessageId: message.id }, { gmailThreadId: message.threadId }] }, select: { supportCaseId: true }, distinct: ['supportCaseId'], take: 2 });
  if (links.length > 1) throw new Error('This Gmail thread has conflicting Case links. Review it in the Support Inbox.');
  return links[0]?.supportCaseId ?? null;
}
export async function createCaseFromSupportEmail(db: PrismaClient, actor: Actor, input: SupportCaseInput, message: SupportMailMessage, firstMessage = message) {
  assertInboxActor(actor);
  assertEmailPersistenceAllowed();
  if (message.threadId !== firstMessage.threadId) throw new Error('Invalid Support email source. Return to the Support Inbox.');
  return db.$transaction(async tx => {
    await lockEmailThread(tx, message.threadId);
    const existingId = await existingEmailCase(tx, message);
    if (existingId) {
      const direct = await tx.supportCaseEmail.findUnique({ where: { gmailMessageId: message.id }, select: { supportCaseId: true } });
      if (direct) await linkSupportEmailInTransaction(tx, actor, message, existingId);
      return { id: existingId, duplicate: true };
    }
    const row = await createSupportCaseInTransaction(tx, actor, { ...input, source: 'EMAIL' }, `EMAIL_ORIGIN:${message.id}`);
    await linkSupportEmailInTransaction(tx, actor, message, row.id);
    if (firstMessage.id !== message.id) await linkSupportEmailInTransaction(tx, actor, firstMessage, row.id);
    return { id: row.id, duplicate: false };
  });
}
