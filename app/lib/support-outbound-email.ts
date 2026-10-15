import { Prisma, type PrismaClient } from '@prisma/client';
import { assertPermission, can, type Actor } from './authorization';
import { assertWorkPermission, caseWorkContext } from './support-work';
import { calendarLocalToUtc } from './calendar-time';
import { saveActivity } from './work';
import { OUTBOUND_EMAIL_SUMMARY_MAX, type OutboundEmailPrefill } from './support-outbound-email-fields';

type CaseContext = Awaited<ReturnType<typeof caseWorkContext>>;
type LinkedEmail = { senderName: string | null; senderEmail: string; subject: string };
export function canLogSupportEmail(actor: Actor) {
  return can(actor, 'support-cases.write') && can(actor, 'support-work.write');
}
export function outboundEmailSaveErrorMessage(error: unknown) {
  const staleClient = error instanceof Prisma.PrismaClientValidationError && /Unknown argument `emailRecipient(?:Name|Email)`/.test(error.message);
  const missingColumn = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2022' && typeof error.meta?.column === 'string' && /emailRecipient(?:Name|Email)/.test(error.meta.column);
  if (staleClient || missingColumn) return 'Email logging is not ready on this server. Ask an administrator to apply the outbound email migration, regenerate Prisma Client, and restart the app.';
  // Only known validation messages become user-facing text. Database errors
  // can include recipient details or connection settings and must stay private.
  const messages: Record<string, string> = {
    'Choose an active activity type.': 'Email logging requires an active Email activity type. Ask an administrator to check Activity types.',
    'Account not found or archived.': 'The Case\'s linked Account is inactive or archived. Activate or restore it before logging a response.',
    'Choose an eligible responsible user.': 'Your user account is not eligible to log Case work. Ask an administrator to check your permissions.',
    'Reopen or restore the Support Case before adding work.': 'Reopen or restore the Support Case before logging an email response.',
    'Support Case not found or unavailable.': 'This Case is no longer available. Refresh the page before logging a response.',
    'Support Case Account does not match the selected Account.': 'The Case\'s Account changed. Refresh the Case and try again.',
    'This Contact is not associated with the selected Account. Choose an active Contact at this Account or an unassigned Contact.': 'The Contact is no longer active at the Case\'s Account. Refresh the Case and check its Contact before logging a response.',
    'Access denied': 'You do not have permission to log an email response for this Case.',
  };
  return error instanceof Error && Object.hasOwn(messages, error.message) ? messages[error.message] : 'Could not log the response. Please retry or ask an administrator for help.';
}
const validEmail = (email: string) => email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
export function outboundEmailPrefill(row: CaseContext, linked: LinkedEmail | null, mailbox = process.env.SUPPORT_GMAIL_MAILBOX || 'support@bixolonusa.com'): OutboundEmailPrefill {
  const contactName = row.contact ? `${row.contact.firstName} ${row.contact.lastName}` : null;
  const contactEmail = row.contact?.active && !row.contact.archivedAt ? row.contact.email?.trim() || '' : '';
  const safe = (email: string) => validEmail(email) && email.toLowerCase() !== mailbox.trim().toLowerCase();
  const useContact = safe(contactEmail);
  const senderEmail = linked?.senderEmail.trim() || '';
  const recipientEmail = useContact ? contactEmail : safe(senderEmail) ? senderEmail : '';
  const recipientName = useContact ? contactName || '' : recipientEmail ? linked?.senderName || '' : contactName || '';
  const subject = linked?.subject.trim() || row.subject.trim();
  return { caseNumber: row.caseNumber, accountName: row.account?.name || null, contactName, recipientName: recipientName.slice(0, 200), recipientEmail, subject: (/^re\s*:/i.test(subject) ? subject : `Re: ${subject}`).slice(0, 200) };
}
export async function supportOutboundEmailContext(db: PrismaClient, actor: Actor, caseId: number) {
  assertPermission(actor, 'support-cases.write');
  assertWorkPermission(actor, caseId);
  const row = await caseWorkContext(db, actor, caseId);
  // Only existing inbound metadata is needed. Never fetch Gmail or email bodies.
  const linked = await db.supportCaseEmail.findFirst({ where: { supportCaseId: caseId }, orderBy: [{ messageDate: 'desc' }, { id: 'desc' }], select: { senderName: true, senderEmail: true, subject: true } });
  return { row, prefill: outboundEmailPrefill(row, linked) };
}
type OutboundEmailInput = { recipientName: string | null; recipientEmail: string; subject: string; summary: string; sentAt: Date };
function validateOutboundEmail(input: Omit<OutboundEmailInput, 'sentAt'> & { sentAt: Date | null }, now: Date) {
  const errors: Record<string, string> = {};
  const { recipientName, recipientEmail, subject, summary, sentAt } = input;
  if ((recipientName?.length || 0) > 200) errors.recipientName = 'Recipient name must be 200 characters or fewer.';
  if (!validEmail(recipientEmail)) errors.recipientEmail = 'Enter a valid recipient email.';
  if (!subject.trim() || subject.length > 200) errors.subject = 'Enter a subject of 200 characters or fewer.';
  if (!summary.trim() || summary.length > OUTBOUND_EMAIL_SUMMARY_MAX) errors.summary = 'Enter a short summary of 2,000 characters or fewer.';
  if (!sentAt || !Number.isFinite(sentAt.getTime()) || sentAt.getTime() > now.getTime() + 60000) errors.sentAt = 'Choose a valid sent time that is not in the future.';
  return errors;
}
export function parseOutboundEmail(form: FormData, zone: string, now = new Date()) {
  const read = (key: string) => String(form.get(key) ?? '').trim();
  const input = { recipientName: read('recipientName') || null, recipientEmail: read('recipientEmail'), subject: read('subject'), summary: read('summary'), sentAt: calendarLocalToUtc(read('sentAt'), zone) };
  const errors = validateOutboundEmail(input, now);
  return { errors, value: Object.keys(errors).length ? undefined : { ...input, sentAt: input.sentAt! } };
}
export async function logSupportOutboundEmail(db: PrismaClient, actor: Actor, caseId: number, input: NonNullable<ReturnType<typeof parseOutboundEmail>['value']>) {
  const { row } = await supportOutboundEmailContext(db, actor, caseId);
  if (Object.keys(validateOutboundEmail(input, new Date())).length) throw new Error('Invalid outbound email metadata.');
  // Relationships and author come from authorized server context, never the form.
  const contact = row.contact;
  const contactIds = row.contactId && contact?.active && !contact.archivedAt && (!contact.accountId || contact.accountId === row.accountId) && contact.email?.trim().toLowerCase() === input.recipientEmail.toLowerCase() ? [row.contactId] : [];
  return saveActivity(db, {
    supportCaseId: row.id, accountId: row.accountId, contactIds, opportunityId: null, projectId: null,
    type: 'EMAIL', direction: 'OUTBOUND', subject: input.subject, description: input.summary,
    emailRecipientName: input.recipientName, emailRecipientEmail: input.recipientEmail,
    userId: actor.id, activityDate: input.sentAt, outcome: null, nextStep: null, followUpDate: null,
    createFollowUpTask: false, followUpTaskCreateKey: '',
  }, undefined, actor.id);
}
