'use server';
import { assertModuleEnabled } from '@/lib/module-availability';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireMutation } from '@/lib/current-user';
import { parseTradeShow, saveTradeShow, setTradeShowArchived, tradeShowFailureState } from '@/lib/trade-shows';
import { friendlyError } from '@/lib/crm-validation';
import { saveFeedbackPath } from '@/lib/save-feedback';
import { requireEditToken, isRecordChanged, recordChangedMessage } from '@/lib/stale-edit';
import { captureActionError } from '../../lib/request-observability';

export type TradeShowFormState = { errors: Record<string, string>; message?: string; redirectTo?: string; values?: Record<string, string>; recordChanged?: boolean };

export async function submitTradeShow(id: number | null, _old: TradeShowFormState, form: FormData): Promise<TradeShowFormState> {
  await assertModuleEnabled('TRADE_SHOWS');
  const actor = await requireMutation('trade-shows.manage');
  const parsed = parseTradeShow(form);
  if (!parsed.value) return tradeShowFailureState(form, parsed.errors);
  try {
    const showId = await saveTradeShow(prisma, parsed.value, actor, id ?? undefined, id ? requireEditToken(form) : undefined);
    revalidatePath('/trade-shows'); revalidatePath(`/trade-shows/${showId}`);
    return { errors: {}, redirectTo: saveFeedbackPath(`/trade-shows/${showId}`, id ? 'updated' : 'created') };
  } catch (error) {
    if (isRecordChanged(error)) return { ...tradeShowFailureState(form, {}, recordChangedMessage), recordChanged: true };
    const fallback = 'Trade Show could not be saved.';
    const business = friendlyError(error, fallback);
    const incident = business === fallback ? await captureActionError(error, 'trade-show.save', { userId: actor.id, entityType: 'TradeShow', entityId: id }) : undefined;
    return tradeShowFailureState(form, {}, incident ?? business);
  }
}

export async function changeTradeShowArchive(id: number, archive: boolean, _old: TradeShowFormState): Promise<TradeShowFormState> {
  await assertModuleEnabled('TRADE_SHOWS');
  void _old;
  const actor = await requireMutation('trade-shows.manage');
  try { await setTradeShowArchived(prisma, id, archive, actor); }
  catch (error) { const fallback = 'Trade Show status could not be changed.'; const business = friendlyError(error, fallback); const incident = business === fallback ? await captureActionError(error, 'trade-show.archive', { userId: actor.id, entityType: 'TradeShow', entityId: id }) : undefined; return { errors: {}, message: incident ?? business }; }
  revalidatePath('/trade-shows'); revalidatePath(`/trade-shows/${id}`);
  return { errors: {}, message: archive ? 'Trade Show archived.' : 'Trade Show reactivated.' };
}
