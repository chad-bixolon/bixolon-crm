'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireMutation } from '@/lib/current-user';
import { supportUserZone } from '@/lib/support-case-ui';
import { logSupportOutboundEmail, outboundEmailSaveErrorMessage, parseOutboundEmail } from '@/lib/support-outbound-email';
import type { OutboundEmailState } from '@/lib/support-outbound-email-fields';

export async function logEmailResponse(caseId: number, _state: OutboundEmailState, form: FormData): Promise<OutboundEmailState> {
  const actor = await requireMutation('support-cases.write');
  const parsed = parseOutboundEmail(form, await supportUserZone(actor));
  if (!parsed.value) return { errors: parsed.errors, message: 'Check the highlighted fields.' };
  let accountId: number | null;
  try { accountId = (await logSupportOutboundEmail(prisma, actor, caseId, parsed.value)).accountId; }
  catch (error) { return { message: outboundEmailSaveErrorMessage(error) }; }
  revalidatePath(`/support/cases/${caseId}`);
  revalidatePath('/tasks');
  revalidatePath('/reports/engagement');
  if (accountId) revalidatePath(`/accounts/${accountId}`);
  return { success: true, message: 'Email response logged.' };
}
