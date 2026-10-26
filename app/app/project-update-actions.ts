'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/current-user';
import { saveProjectUpdate, type UpdateContext } from '@/lib/project-updates';
import { assertModuleEnabled } from '@/lib/module-availability';
import { isRecordChanged, recordChangedMessage } from '@/lib/stale-edit';

export type UpdateState = { message?: string; saved?: boolean; recordChanged?: boolean };
export async function submitProjectUpdate(context: UpdateContext, updateId: number | null, _state: UpdateState, form: FormData): Promise<UpdateState> {
  await assertModuleEnabled(context.kind === 'project' ? 'PROJECTS' : 'OPPORTUNITIES');
  const actor = await currentUser();
  if (context.kind === 'opportunity') await assertModuleEnabled('PROJECTS');
  else if (String(form.get('opportunityId') ?? '') || updateId && (await prisma.projectUpdate.findUnique({ where: { id: updateId }, select: { opportunityId: true } }))?.opportunityId) await assertModuleEnabled('OPPORTUNITIES');
  try {
    const saved = await saveProjectUpdate(prisma, actor, context, updateId, form);
    for (const id of [saved.projectId, saved.oldProjectId]) if (id) revalidatePath(`/projects/${id}`);
    for (const id of [saved.opportunityId, saved.oldOpportunityId]) if (id) revalidatePath(`/opportunities/${id}`);
    return { message: updateId ? 'Update saved.' : 'Update added.', saved: true };
  } catch (error) { return isRecordChanged(error) ? { message: recordChangedMessage, recordChanged: true } : { message: error instanceof Error ? error.message : 'Update could not be saved.' }; }
}
