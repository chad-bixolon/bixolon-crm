'use server';
import { requireEditToken, isRecordChanged, recordChangedMessage } from '../../../lib/stale-edit';
import { Prisma, SupportCasePriority, SupportCaseSource, SupportCaseStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { archiveSupportCase, createSupportCase, restoreSupportCase, updateSupportCase, type SupportCaseInput, type SupportCasePatch } from '@/lib/support-cases';
import { calendarLocalToUtc } from '@/lib/calendar-time';
import { createCaseFromSupportEmail } from '@/lib/support-email';
import { resolveEmailSource, validateEmailSource } from '@/lib/support-email-source';
import { beginIntegrationAttempt, finishIntegrationAttempt, gmailContext, gmailFailure } from '@/lib/integration-attempts';
import { documentStorage } from '@/lib/document-storage';
import { selectedEmailFiles, importSelectedEmailFiles, recordEmailFileImport } from '@/lib/support-email-file-import';
import { DEFAULT_USER_TIME_ZONE } from '@/lib/user-time-zone';

export type SupportFormState = { recordChanged?: boolean; message?: string; field?: string; savedCaseId?: number; fileFailures?: { name: string; reason: string }[] };
function optionalId(form: FormData, key: string) { const value = String(form.get(key) ?? ''); if (!value) return null; const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) throw new Error(`Choose a valid ${key}.`); return number; }
async function readForm(form: FormData, actorId: number) {
  const zone = (await prisma.user.findUnique({ where: { id: actorId }, select: { timeZone: true } }))?.timeZone ?? DEFAULT_USER_TIME_ZONE;
  const followUp = String(form.get('nextFollowUpAt') ?? '');
  const nextFollowUpAt = followUp ? calendarLocalToUtc(followUp, zone) : null;
  if (followUp && !nextFollowUpAt) throw new Error('Choose a valid next follow-up time.');
  const status = String(form.get('status') ?? 'NEW') as SupportCaseStatus;
  const priority = String(form.get('priority') ?? 'NORMAL') as SupportCasePriority;
  const source = String(form.get('source') ?? '') as SupportCaseSource;
  if (!Object.values(SupportCaseStatus).includes(status)) throw new Error('Choose a valid status.');
  if (!Object.values(SupportCasePriority).includes(priority)) throw new Error('Choose a valid priority.');
  if (!Object.values(SupportCaseSource).includes(source)) throw new Error('Choose a source.');
  const accountId = optionalId(form, 'accountId');
  const customerNameText = String(form.get('customerNameText') ?? '').trim() || null;
  if (!customerNameText && !accountId) throw new Error('Enter a customer/end user or link a CRM Account.');
  if (String(form.get('productSkuIdQuery') ?? '').trim() && !String(form.get('productSkuId') ?? '').trim()) throw new Error('Select a product from the suggestions.');
  if (String(form.get('accountIdQuery') ?? '').trim() && !String(form.get('accountId') ?? '').trim()) throw new Error('Select an Account from the suggestions.');
  if (String(form.get('contactIdQuery') ?? '').trim() && !String(form.get('contactId') ?? '').trim()) throw new Error('Select a Contact from the suggestions.');
  if (String(form.get('purchasedFromAccountIdQuery') ?? '').trim() && !String(form.get('purchasedFromAccountId') ?? '').trim()) throw new Error('Select a Purchased From Account from the suggestions.');
  if (String(form.get('assignedToId') ?? '') && !optionalId(form, 'assignedToId')) throw new Error('Select an eligible Support Rep.');
  return { customerNameText, accountId, contactId: optionalId(form, 'contactId'), subject: String(form.get('subject') ?? '').trim(), description: String(form.get('description') ?? '').trim(), purchaseSourceText: String(form.get('purchaseSourceText') ?? '').trim() || null, purchasedFromAccountId: optionalId(form, 'purchasedFromAccountId'), status, priority, categoryId: optionalId(form, 'categoryId'), assignedToId: optionalId(form, 'assignedToId'), productSkuId: optionalId(form, 'productSkuId'), serialNumber: String(form.get('serialNumber') ?? '').trim() || null, source, nextFollowUpAt, resolutionSummary: String(form.get('resolutionSummary') ?? '').trim() || null };
}
export async function saveSupportCase(id: number | null, _state: SupportFormState, form: FormData): Promise<SupportFormState> {
  const actor = await requireMutation('support-cases.write');
  let caseId: number;
  let duplicate = false;
  let fileStatus = '';
  const emailSource = String(form.get('emailSource') ?? '');
  const fileTokens = form.getAll('emailFiles').map(String);
  let attemptId: number | undefined;
  try {
    if (id && emailSource) throw new Error('Email intake can only create a new Case.');
    if (emailSource) {
      const source = validateEmailSource(actor, emailSource);
      attemptId = (await beginIntegrationAttempt(prisma, gmailContext('CREATE_CASE', source.mailbox, source.threadId, actor.id))).id;
    }
    const context = emailSource ? await resolveEmailSource(actor, emailSource) : null;
    if (fileTokens.length) { if (!context) throw new Error('Invalid email file selection.'); selectedEmailFiles(actor, emailSource, fileTokens); }
    const input = await readForm(form, actor.id);
    if (id) {
      const before = await prisma.supportCase.findUnique({ where: { id } });
      if (!before) throw new Error('Case not found.');
      const patch = Object.fromEntries(Object.entries(input).filter(([key, value]) => {
        const old = before[key as keyof typeof before];
        return (value instanceof Date ? value.toISOString() : value) !== (old instanceof Date ? old.toISOString() : old);
      })) as SupportCasePatch;
      await updateSupportCase(prisma, actor, id, patch, requireEditToken(form)); caseId = id;
    }
    else if (context) {
      const result = await createCaseFromSupportEmail(prisma, actor, input as SupportCaseInput, context.message, context.firstMessage);
      caseId = result.id; duplicate = result.duplicate;
    }
    else { const row = await createSupportCase(prisma, actor, input as SupportCaseInput); caseId = row.id; }
    if (attemptId) await finishIntegrationAttempt(prisma, attemptId, undefined, caseId);
  } catch (error) { if (isRecordChanged(error)) return { message: recordChangedMessage, recordChanged: true }; if (attemptId) await finishIntegrationAttempt(prisma, attemptId, gmailFailure(error)); const databaseError = error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientUnknownRequestError; const message = form.get('emailSource') && databaseError ? 'Could not create and link the Case. No Case was saved. Please retry from this form.' : error instanceof Error ? error.message : 'Could not save Support Case.'; return { message, field: message.includes('Resolution Summary') ? 'resolutionSummary' : message.includes('customer/end user') ? 'customerNameText' : message.includes('product') || message.includes('Product') ? 'productSkuId' : message.includes('Support Rep') || message.includes('assignee') ? 'assignedToId' : message.includes('Contact') ? 'contactId' : message.includes('Purchased From Account') ? 'purchasedFromAccountId' : message.includes('Account') ? 'accountId' : message.includes('source') ? 'source' : message.includes('follow-up') ? 'nextFollowUpAt' : undefined }; }
  // Case and email link are committed. Optional file failures must not report
  // that the Case rolled back, and retries must never create a second Case.
  if (fileTokens.length) {
    try {
      const result = await importSelectedEmailFiles(prisma, documentStorage, actor, caseId, emailSource, fileTokens);
      fileStatus = result.failures.length ? 'partial' : 'complete';
      try { await recordEmailFileImport(prisma, actor, caseId, result); }
      catch { return { message: 'Case saved and email linked. The file import report could not be saved; review the Case attachments before retrying.', savedCaseId: caseId, fileFailures: result.failures }; }
    } catch { return { message: 'Case saved and email linked, but selected files could not be imported. Open the saved Case to review and retry.', savedCaseId: caseId }; }
  }
  revalidatePath('/support/cases');
  revalidatePath(`/support/cases/${caseId}`);
  revalidatePath('/support/inbox');
  const params = new URLSearchParams();
  if (duplicate) params.set('emailIntake', 'already-linked');
  if (fileStatus) params.set('emailFiles', fileStatus);
  redirect(`/support/cases/${caseId}${params.size ? `?${params}` : ''}`);
}
export async function changeSupportArchive(id: number, archive: boolean, _state: SupportFormState): Promise<SupportFormState> {
  void _state;
  const actor = await requireMutation('support-oversight.manage');
  try { if (archive) await archiveSupportCase(prisma, actor, id); else await restoreSupportCase(prisma, actor, id); }
  catch (error) { return { message: error instanceof Error ? error.message : 'Could not update archive state.' }; }
  revalidatePath('/support/cases');
  revalidatePath(`/support/cases/${id}`);
  return { message: archive ? 'Case archived.' : 'Case restored.' };
}
