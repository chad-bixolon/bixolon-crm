'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/current-user';
import { parseOpportunity } from '@/lib/opportunities';
import { convertTradeShowLead } from '@/lib/trade-show-conversion';
import { friendlyError } from '@/lib/crm-validation';
import { saveFeedbackPath } from '@/lib/save-feedback';

export type ConversionFormState = { errors: Record<string,string>; message?: string; redirectTo?: string };
export async function submitTradeShowConversion(tradeShowId: number, leadId: number, _state: ConversionFormState, form: FormData): Promise<ConversionFormState> {
  const actor = await currentUser();
  const parsed = parseOpportunity(form);
  if (!parsed.value) return { errors: parsed.errors, message: 'Please correct the highlighted fields.' };
  try {
    const opportunityId = await convertTradeShowLead(prisma, tradeShowId, leadId, parsed.value, actor);
    revalidatePath('/opportunities');
    revalidatePath(`/trade-shows/${tradeShowId}`);
    revalidatePath(`/trade-shows/${tradeShowId}/leads/${leadId}`);
    return { errors: {}, redirectTo: saveFeedbackPath(`/opportunities/${opportunityId}`, 'created') };
  } catch (error) {
    return { errors: {}, message: friendlyError(error, 'The lead could not be converted. No Opportunity was created.') };
  }
}
