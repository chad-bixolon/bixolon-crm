import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Actor } from './authorization';
import { assertInboxActor, inboxMailboxIdentity, suggestSupportEmail } from './support-email';
import { recentSupportMail, supportMailbox, type SupportMailMessage } from './support-gmail';
import type { PrismaClient } from '@prisma/client';

const SOURCE_ERROR = 'Invalid or expired Support email source. Return to the Support Inbox and try again.';
type Source = { userId: number; mailbox: string; messageId: string; threadId: string; firstMessageId: string; expires: number };
function signature(value: string) {
  if (!process.env.AUTH_SECRET) throw new Error('Support email intake is unavailable.');
  return createHmac('sha256', process.env.AUTH_SECRET).update(`support-email-intake:${value}`).digest('base64url');
}
export function signEmailSource(actor: Actor, message: SupportMailMessage, firstMessage = message, now = Date.now()) {
  assertInboxActor(actor);
  const source: Source = { userId: actor.id, mailbox: inboxMailboxIdentity(), messageId: message.id, threadId: message.threadId, firstMessageId: firstMessage.id, expires: now + 86400000 };
  const value = Buffer.from(JSON.stringify(source)).toString('base64url');
  return `${value}.${signature(value)}`;
}
export function validateEmailSource(actor: Actor, token: string, now = Date.now()): Source {
  assertInboxActor(actor);
  if (token.length > 2048) throw new Error(SOURCE_ERROR);
  const parts = token.split('.');
  const expected = Buffer.from(signature(parts[0] ?? ''));
  const actual = Buffer.from(parts[1] ?? '');
  if (parts.length !== 2 || expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error(SOURCE_ERROR);
  let source: Source;
  try { source = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { throw new Error(SOURCE_ERROR); }
  if (!source || source.userId !== actor.id || source.mailbox !== inboxMailboxIdentity() || !Number.isSafeInteger(source.expires) || source.expires <= now || source.expires > now + 86400000 || ![source.messageId, source.threadId, source.firstMessageId].every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id))) throw new Error(SOURCE_ERROR);
  return source;
}
export async function resolveEmailSource(actor: Actor, token: string) {
  const source = validateEmailSource(actor, token);
  const mailbox = supportMailbox();
  const message = await mailbox.get(source.messageId);
  const firstMessage = source.firstMessageId === source.messageId ? message : await mailbox.get(source.firstMessageId);
  if (!message || !firstMessage || message.id !== source.messageId || firstMessage.id !== source.firstMessageId || message.threadId !== source.threadId || firstMessage.threadId !== source.threadId) throw new Error(SOURCE_ERROR);
  return { message, firstMessage };
}
export async function emailIntakeContext(db: PrismaClient, actor: Actor, messageId: string) {
  assertInboxActor(actor);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(messageId)) throw new Error(SOURCE_ERROR);
  const messages = await recentSupportMail();
  const message = messages.find(row => row.id === messageId);
  if (!message) throw new Error(SOURCE_ERROR);
  // Use the earliest available customer request in this bounded inbox, then the
  // earliest available message if the thread consists entirely of internal mail.
  const thread = messages.filter(row => row.threadId === message.threadId).sort((a, b) => a.messageDate.getTime() - b.messageDate.getTime());
  const firstMessage = thread.find(row => !row.senderEmail.endsWith('@bixolonusa.com')) ?? thread[0];
  const suggestion = await suggestSupportEmail(db, firstMessage);
  const account = suggestion.account && suggestion.account.status === 'ACTIVE' ? suggestion.account : null;
  // Normal Case validation requires a Contact to belong to the linked Account.
  const contact = account ? suggestion.contact : null;
  return { messages: thread, message, firstMessage, account, contact, token: signEmailSource(actor, message, firstMessage), prefill: emailCasePrefill(firstMessage, message, account, contact) };
}
export function emailCasePrefill(request: SupportMailMessage, selected: SupportMailMessage, account: { id: number; name: string } | null, contact: { id: number; firstName: string; lastName: string } | null) {
  const heading = `Original email request\nFrom: ${request.senderName ? `${request.senderName} ` : ''}<${request.senderEmail}>\nSubject: ${request.subject}\nReceived: ${request.messageDate.toISOString()}\n\n`;
  const description = (heading + (request.bodyText || request.snippet || '(Email contains no text body.)')).slice(0, 20000).replace(/[\uD800-\uDBFF]$/, '');
  return { subject: selected.subject.slice(0, 300).replace(/[\uD800-\uDBFF]$/, ''), customerNameText: (request.senderName || request.senderEmail).slice(0, 500), description, source: 'EMAIL' as const, accountId: account?.id ?? null, account, contact };
}
