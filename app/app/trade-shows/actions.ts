'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireMutation } from '@/lib/current-user';
import { parseTradeShow, saveTradeShow, setTradeShowArchived, tradeShowFailureState } from '@/lib/trade-shows';
import { friendlyError } from '@/lib/crm-validation';

export type TradeShowFormState = { errors: Record<string, string>; message?: string; redirectTo?: string; values?: Record<string, string> };

export async function submitTradeShow(id: number | null, _old: TradeShowFormState, form: FormData): Promise<TradeShowFormState> {
  const actor = await requireMutation('trade-shows.manage');
  const parsed = parseTradeShow(form);
  if (!parsed.value) return tradeShowFailureState(form, parsed.errors);
  try {
    const showId = await saveTradeShow(prisma, parsed.value, actor, id ?? undefined);
    revalidatePath('/trade-shows'); revalidatePath(`/trade-shows/${showId}`);
    return { errors: {}, redirectTo: `/trade-shows/${showId}` };
  } catch (error) {
    return tradeShowFailureState(form, {}, friendlyError(error, 'Trade Show could not be saved.'));
  }
}

export async function changeTradeShowArchive(id: number, archive: boolean, _old: TradeShowFormState): Promise<TradeShowFormState> {
  void _old;
  const actor = await requireMutation('trade-shows.manage');
  try { await setTradeShowArchived(prisma, id, archive, actor); }
  catch (error) { return { errors: {}, message: friendlyError(error, 'Trade Show status could not be changed.') }; }
  revalidatePath('/trade-shows'); revalidatePath(`/trade-shows/${id}`);
  return { errors: {}, message: archive ? 'Trade Show archived.' : 'Trade Show reactivated.' };
}
