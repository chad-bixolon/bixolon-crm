'use server';
import { SupportCasePriority, SupportCaseSource, SupportCaseStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { archiveSupportCase, createSupportCase, restoreSupportCase, updateSupportCase, type SupportCaseInput, type SupportCasePatch } from '@/lib/support-cases';
import { calendarLocalToUtc } from '@/lib/calendar-time';
import { DEFAULT_USER_TIME_ZONE } from '@/lib/user-time-zone';

export type SupportFormState = { message?: string; field?: string };
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
  if (String(form.get('productSkuQuery') ?? '').trim() && !String(form.get('productSkuId') ?? '').trim()) throw new Error('Select a product from the suggestions.');
  if (String(form.get('assignedToId') ?? '') && !optionalId(form, 'assignedToId')) throw new Error('Select an eligible Support Rep.');
  return { customerNameText, accountId, contactId: optionalId(form, 'contactId'), subject: String(form.get('subject') ?? '').trim(), description: String(form.get('description') ?? '').trim(), purchaseSourceText: String(form.get('purchaseSourceText') ?? '').trim() || null, purchasedFromAccountId: optionalId(form, 'purchasedFromAccountId'), status, priority, categoryId: optionalId(form, 'categoryId'), assignedToId: optionalId(form, 'assignedToId'), productSkuId: optionalId(form, 'productSkuId'), serialNumber: String(form.get('serialNumber') ?? '').trim() || null, source, nextFollowUpAt, resolutionSummary: String(form.get('resolutionSummary') ?? '').trim() || null };
}
export async function saveSupportCase(id: number | null, _state: SupportFormState, form: FormData): Promise<SupportFormState> {
  const actor = await requireMutation('support-cases.write');
  let caseId: number;
  try {
    const input = await readForm(form, actor.id);
    if (id) {
      const before = await prisma.supportCase.findUnique({ where: { id } });
      if (!before) throw new Error('Case not found.');
      const patch = Object.fromEntries(Object.entries(input).filter(([key, value]) => {
        const old = before[key as keyof typeof before];
        return (value instanceof Date ? value.toISOString() : value) !== (old instanceof Date ? old.toISOString() : old);
      })) as SupportCasePatch;
      await updateSupportCase(prisma, actor, id, patch); caseId = id;
    }
    else { const { status: _status, ...createInput } = input; void _status; const row = await createSupportCase(prisma, actor, createInput as SupportCaseInput); caseId = row.id; }
  } catch (error) { const message = error instanceof Error ? error.message : 'Could not save Support Case.'; return { message, field: message.includes('customer/end user') ? 'customerNameText' : message.includes('product') || message.includes('Product') ? 'productSkuId' : message.includes('Support Rep') || message.includes('assignee') ? 'assignedToId' : message.includes('Contact') ? 'contactId' : message.includes('Account') ? 'accountId' : message.includes('source') ? 'source' : message.includes('follow-up') ? 'nextFollowUpAt' : undefined }; }
  revalidatePath('/support/cases');
  revalidatePath(`/support/cases/${caseId}`);
  redirect(`/support/cases/${caseId}`);
}
export async function changeSupportArchive(id: number, archive: boolean, _state: SupportFormState): Promise<SupportFormState> {
  void _state;
  const actor = await requireMutation('support-cases.write');
  try { if (archive) await archiveSupportCase(prisma, actor, id); else await restoreSupportCase(prisma, actor, id); }
  catch (error) { return { message: error instanceof Error ? error.message : 'Could not update archive state.' }; }
  revalidatePath('/support/cases');
  revalidatePath(`/support/cases/${id}`);
  return { message: archive ? 'Case archived.' : 'Case restored.' };
}
