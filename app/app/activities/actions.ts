'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { parseActivity, saveActivity } from '@/lib/work';
import type { WorkState } from '@/app/tasks/actions';
import { currentUser } from '@/lib/current-user';
import { assertProjectWorkEdit } from '@/lib/projects';
export async function submitActivity(id: number | null, _old: WorkState, form: FormData): Promise<WorkState> {
  const parsed = parseActivity(form); if (!parsed.value) return { errors: parsed.errors, message: 'Correct the highlighted fields.' };
  let destination: string;
  try { const actor = await currentUser(); const existing = id ? await prisma.activity.findUnique({ where: { id }, select: { projectId: true } }) : null; await assertProjectWorkEdit(prisma, actor, existing?.projectId); await assertProjectWorkEdit(prisma, actor, parsed.value.projectId); const row = await saveActivity(prisma, parsed.value, id ?? undefined); revalidatePath('/'); if (row.accountId) revalidatePath(`/accounts/${row.accountId}`); if (row.opportunityId) revalidatePath(`/opportunities/${row.opportunityId}`); if (row.projectId) revalidatePath(`/projects/${row.projectId}`); destination = row.projectId ? `/projects/${row.projectId}?tab=activities` : row.opportunityId ? `/opportunities/${row.opportunityId}` : `/accounts/${row.accountId}?tab=activity`; }
  catch (e) { return { errors: {}, message: e instanceof Error ? e.message : 'Activity could not be saved.' }; }
  redirect(destination);
}
