'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { activityErrorField, activityFailureState, parseActivity, saveActivity } from '@/lib/work';
import type { WorkState } from '@/app/tasks/actions';
import { currentUser } from '@/lib/current-user';
import { assertProjectWorkEdit } from '@/lib/projects';
import { assertPermission } from '@/lib/authorization';
import { saveFeedbackPath } from '@/lib/save-feedback';
export async function submitActivity(id: number | null, _old: WorkState, form: FormData): Promise<WorkState> {
  const parsed = parseActivity(form); if (!parsed.value) return activityFailureState(form, parsed.errors);
  if (!id && !parsed.value.userId) return activityFailureState(form, { userId: 'Choose a responsible user.' });
  let destination: string;
  try { const actor = await currentUser(); assertPermission(actor, 'tasks.write'); const existing = id ? await prisma.activity.findUnique({ where: { id }, select: { projectId: true } }) : null; await assertProjectWorkEdit(prisma, actor, existing?.projectId); await assertProjectWorkEdit(prisma, actor, parsed.value.projectId); const row = await saveActivity(prisma, parsed.value, id ?? undefined, actor.id); revalidatePath('/'); revalidatePath('/tasks'); revalidatePath('/reports/engagement'); if (row.accountId) revalidatePath(`/accounts/${row.accountId}`); if (row.opportunityId) revalidatePath(`/opportunities/${row.opportunityId}`); if (row.projectId) revalidatePath(`/projects/${row.projectId}`); const base = row.projectId ? `/projects/${row.projectId}?tab=activities` : row.opportunityId ? `/opportunities/${row.opportunityId}` : `/accounts/${row.accountId}?tab=activity`; destination = saveFeedbackPath(base, id ? 'updated' : row.followUpTaskCreated ? 'activity-task-created' : 'activity-created'); }
  catch (e) { const message = e instanceof Error ? e.message : 'Activity could not be saved.'; const field = activityErrorField(message); return activityFailureState(form, field ? { [field]: message } : {}, field ? undefined : message); }
  redirect(destination);
}
export async function setActivityArchived(form: FormData) {
  const actor=await currentUser();assertPermission(actor,'tasks.write');
  const id=Number(form.get('id')), archived=String(form.get('archived'))==='true';
  if(!Number.isSafeInteger(id)||id<1)throw new Error('Activity not found.');
  const row=await prisma.activity.findUnique({where:{id},select:{projectId:true,accountId:true,opportunityId:true,archivedAt:true}});
  if(!row)throw new Error('Activity not found.');
  await assertProjectWorkEdit(prisma,actor,row.projectId);
  if(Boolean(row.archivedAt)===archived)throw new Error('Activity state has already changed.');
  await prisma.activity.update({where:{id},data:{archivedAt:archived?new Date():null,archivedById:archived?actor.id:null,updatedById:actor.id}});
  revalidatePath('/');revalidatePath('/reports/engagement');revalidatePath(`/activities/${id}/edit`);
  if(row.accountId)revalidatePath(`/accounts/${row.accountId}`);
  if(row.opportunityId)revalidatePath(`/opportunities/${row.opportunityId}`);
  if(row.projectId)revalidatePath(`/projects/${row.projectId}`);
  redirect(`/activities/${id}/edit`);
}
