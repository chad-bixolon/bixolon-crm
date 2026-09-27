'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/current-user';
import { parseOpportunity } from '@/lib/opportunities';
import { convertTradeShowLead } from '@/lib/trade-show-conversion';
import { friendlyError } from '@/lib/crm-validation';
import { saveFeedbackPath } from '@/lib/save-feedback';
import { opportunitySaveReview } from '@/lib/sales-readiness';
import type { FormState } from '@/app/opportunities/actions';
import { canConvertTradeShowLead } from '@/lib/trade-show-conversion';

export type ConversionFormState = FormState;
export async function submitTradeShowConversion(tradeShowId: number, leadId: number, _state: ConversionFormState, form: FormData): Promise<ConversionFormState> {
  const actor = await currentUser();
  const parsed = parseOpportunity(form);
  if (!parsed.value) return { errors: parsed.errors, message: 'Please correct the highlighted fields.' };
  const lead = await prisma.tradeShowLead.findFirst({ where: { id: leadId, tradeShowId }, select: { assignedSalesRepUserId: true, convertedOpportunityId: true, tradeShow: { select: { archivedAt: true } } } });
  if (!lead || lead.tradeShow.archivedAt || lead.convertedOpportunityId || !canConvertTradeShowLead(actor, lead)) return { errors: {}, message: 'Trade Show Lead not found or unavailable for conversion.' };
  const review = await opportunitySaveReview(prisma, parsed.value, form, true, actor.role === 'SALES' ? actor.id : undefined);
  if (review) return { errors: {}, ...review };
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
