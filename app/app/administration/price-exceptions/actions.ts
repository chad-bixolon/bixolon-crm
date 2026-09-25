'use server';
import { revalidatePath } from 'next/cache';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { applyPriceExceptionCleanup, previewPriceExceptionCleanup, type CleanupRequest } from '@/lib/price-exception-cleanup';

export async function previewCleanup(request: CleanupRequest) {
  const actor = await requireMutation('users.manage');
  try {
    const plan = await previewPriceExceptionCleanup(prisma, actor, request);
    return { ok: true as const, fingerprint: plan.fingerprint, count: plan.rows.length, changes: plan.changes };
  } catch (error) { return { ok: false as const, message: error instanceof Error ? error.message : 'Preview failed.' }; }
}
export async function confirmCleanup(request: CleanupRequest, fingerprint: string, confirmedCount: number, confirmed: boolean) {
  const actor = await requireMutation('users.manage');
  try {
    const count = await applyPriceExceptionCleanup(prisma, actor, request, fingerprint, confirmedCount, confirmed);
    revalidatePath('/administration/price-exceptions'); revalidatePath('/price-exceptions'); revalidatePath('/accounts');
    return { ok: true as const, count };
  } catch (error) { return { ok: false as const, message: error instanceof Error ? error.message : 'Update failed. Preview again.' }; }
}
