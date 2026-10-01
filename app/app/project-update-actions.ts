'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/current-user';
import { saveProjectUpdate, type UpdateContext } from '@/lib/project-updates';

export type UpdateState = { message?: string; saved?: boolean };
export async function submitProjectUpdate(context: UpdateContext, updateId: number | null, _state: UpdateState, form: FormData): Promise<UpdateState> {
  const actor = await currentUser();
  try {
    const saved = await saveProjectUpdate(prisma, actor, context, updateId, form);
    for (const id of [saved.projectId, saved.oldProjectId]) if (id) revalidatePath(`/projects/${id}`);
    for (const id of [saved.opportunityId, saved.oldOpportunityId]) if (id) revalidatePath(`/opportunities/${id}`);
    return { message: updateId ? 'Update saved.' : 'Update added.', saved: true };
  } catch (error) { return { message: error instanceof Error ? error.message : 'Update could not be saved.' }; }
}
