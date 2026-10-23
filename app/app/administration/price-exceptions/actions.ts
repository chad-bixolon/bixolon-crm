'use server';
import { assertModuleEnabled } from '@/lib/module-availability';
import { isRecordChanged, recordChangedMessage, requireEditToken } from '@/lib/stale-edit';
import { revalidatePath } from 'next/cache';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { applyPriceExceptionCleanup, previewPriceExceptionCleanup, type CleanupRequest } from '@/lib/price-exception-cleanup';
import { correctPriceExceptionReference, type MaintenanceField } from '@/lib/price-exception-maintenance';
import { createPeReviewAccount } from '@/lib/price-exception-account-create';

export async function previewCleanup(request: CleanupRequest) {
  await assertModuleEnabled('PRICE_EXCEPTIONS');
  const actor = await requireMutation('configuration.manage');
  try {
    const plan = await previewPriceExceptionCleanup(prisma, actor, request);
    return { ok: true as const, fingerprint: plan.fingerprint, count: plan.rows.length, skipped:plan.skipped, changes: plan.changes };
  } catch (error) { return { ok: false as const, message: error instanceof Error ? error.message : 'Preview failed.' }; }
}
export async function confirmCleanup(request: CleanupRequest, fingerprint: string, confirmedCount: number, confirmed: boolean) {
  await assertModuleEnabled('PRICE_EXCEPTIONS');
  const actor = await requireMutation('configuration.manage');
  try {
    const count = await applyPriceExceptionCleanup(prisma, actor, request, fingerprint, confirmedCount, confirmed);
    revalidatePath('/administration/price-exceptions'); revalidatePath('/price-exceptions'); revalidatePath('/accounts'); revalidatePath('/reports/price-exceptions-expiring'); revalidatePath('/');
    return { ok: true as const, count };
  } catch (error) { return { ok: false as const, message: error instanceof Error ? error.message : 'Update failed. Preview again.' }; }
}
export async function correctReference(id: number, field: MaintenanceField, targetId: number, updatedAt: string, lineId?: number) {
  await assertModuleEnabled('PRICE_EXCEPTIONS');
  const actor = await requireMutation('configuration.manage');
  try {
    const tokenForm = new FormData();
    tokenForm.set('editToken', updatedAt);
    const editToken = requireEditToken(tokenForm);
    await correctPriceExceptionReference(prisma, actor, id, field, targetId, new Date(editToken), lineId);
    revalidatePath('/administration/price-exceptions');
    revalidatePath(`/price-exceptions/${id}`);
    revalidatePath('/price-exceptions');
    revalidatePath('/accounts');
    revalidatePath('/administration/maintenance-history');
    return { ok: true as const };
  } catch (error) {
    const recordChanged = isRecordChanged(error);
    return { ok: false as const, recordChanged, message: recordChanged ? recordChangedMessage : error instanceof Error ? error.message : 'Correction failed.' };
  }
}
export async function createCleanupAccount(form:FormData,confirmed:boolean,acknowledgeDuplicate:boolean){
  await assertModuleEnabled('PRICE_EXCEPTIONS');
  const actor=await requireMutation('accounts.write');
  try{const result=await createPeReviewAccount(prisma,actor,form,confirmed,acknowledgeDuplicate);if(result.kind==='created')revalidatePath('/accounts');return result;}
  catch(error){return {kind:'error' as const,message:error instanceof Error?error.message:'Account could not be created.'};}
}
