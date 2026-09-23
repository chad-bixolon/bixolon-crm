'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/current-user';
import { saveTradeShowLeadUpdate, tradeShowLeadFailureState } from '@/lib/trade-show-leads';

export type TradeShowLeadFormState = { errors: Record<string, string>; message?: string; redirectTo?: string; values?: Record<string, string> };

export async function submitTradeShowLead(tradeShowId: number, leadId: number, _old: TradeShowLeadFormState, form: FormData): Promise<TradeShowLeadFormState> {
  const actor = await currentUser();
  try {
    const result = await saveTradeShowLeadUpdate(prisma, tradeShowId, leadId, form, actor);
    if (Object.keys(result.errors).length) return tradeShowLeadFailureState(form, result.errors, 'message' in result ? result.message : undefined);
    revalidatePath(`/trade-shows/${tradeShowId}`); revalidatePath(`/trade-shows/${tradeShowId}/leads/${leadId}`);
    return { errors: {}, redirectTo: `/trade-shows/${tradeShowId}/leads/${leadId}` };
  } catch (error) {
    const message = error instanceof Error && /^(Access denied|Trade Show Lead not found|Only Opportunity conversion|Converted lead status|Choose an active|Contact belongs|Select an active|Select a Partner)/.test(error.message) ? error.message : 'Lead could not be saved.';
    return tradeShowLeadFailureState(form, {}, message);
  }
}
