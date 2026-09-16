'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { parseActivity, saveActivity } from '@/lib/work';
import type { WorkState } from '@/app/tasks/actions';
export async function submitActivity(id: number | null, _old: WorkState, form: FormData): Promise<WorkState> {
  const parsed = parseActivity(form); if (!parsed.value) return { errors: parsed.errors, message: 'Correct the highlighted fields.' };
  let destination: string;
  try { const row = await saveActivity(prisma, parsed.value, id ?? undefined); revalidatePath('/'); if (row.accountId) revalidatePath(`/accounts/${row.accountId}`); if (row.opportunityId) revalidatePath(`/opportunities/${row.opportunityId}`); destination = row.opportunityId ? `/opportunities/${row.opportunityId}` : `/accounts/${row.accountId}?tab=activity`; }
  catch (e) { return { errors: {}, message: e instanceof Error ? e.message : 'Activity could not be saved.' }; }
  redirect(destination);
}
