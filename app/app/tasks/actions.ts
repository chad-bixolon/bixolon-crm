'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { parseTask, saveTask } from '@/lib/work';
import { currentUser } from '@/lib/current-user';
import { assertProjectWorkEdit } from '@/lib/projects';
import { saveFeedbackPath } from '../../lib/save-feedback';
export type WorkState = { errors: Record<string,string>; message?: string; values?: Record<string,string> };
const taskFields = ['subject', 'description', 'accountId', 'opportunityId', 'projectId', 'assignedToId', 'status', 'priority', 'dueDate'] as const;
function submittedValues(form: FormData) { return Object.fromEntries(taskFields.map(key => [key, String(form.get(key) ?? '')])); }
export async function submitTask(id: number | null, _old: WorkState, form: FormData): Promise<WorkState> {
  const parsed = parseTask(form); if (!parsed.value) return { errors: parsed.errors, message: 'Correct the highlighted fields.', values: submittedValues(form) };
  const createKey = form.get('createKey');
  if (!id && (typeof createKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(createKey))) return { errors: {}, message: 'Reload the form and try again.', values: submittedValues(form) };
  let destination: string;
  try { const actor = await currentUser(); const existing = id ? await prisma.task.findUnique({ where: { id }, select: { projectId: true } }) : null; await assertProjectWorkEdit(prisma, actor, existing?.projectId); await assertProjectWorkEdit(prisma, actor, parsed.value.projectId); const row = await saveTask(prisma, parsed.value, id ?? undefined, id ? undefined : createKey as string, actor.id); revalidatePath('/tasks'); revalidatePath('/'); if (row.accountId) revalidatePath(`/accounts/${row.accountId}`); if (row.opportunityId) revalidatePath(`/opportunities/${row.opportunityId}`); if (row.projectId) revalidatePath(`/projects/${row.projectId}`); destination = saveFeedbackPath(id ? `/tasks/${row.id}/edit` : `/tasks/${row.id}`, id ? 'updated' : 'created'); }
  catch (e) { return { errors: {}, message: e instanceof Error ? e.message : 'Task could not be saved.', values: submittedValues(form) }; }
  redirect(destination);
}
export async function archiveTask(id: number, _old: WorkState): Promise<WorkState> {
  void _old; const row = await prisma.task.findUnique({ where: { id } }); if (!row) return { errors: {}, message: 'Task not found.' }; await assertProjectWorkEdit(prisma, await currentUser(), row.projectId);
  if (!row.archivedAt) await prisma.task.update({ where: { id }, data: { archivedAt: new Date() } });
  revalidatePath('/tasks'); revalidatePath(`/tasks/${id}/edit`); revalidatePath('/'); if (row.accountId) revalidatePath(`/accounts/${row.accountId}`); if (row.opportunityId) revalidatePath(`/opportunities/${row.opportunityId}`);
  redirect('/tasks?visibility=archived');
}
export async function reactivateTask(id: number, _old: WorkState): Promise<WorkState> {
  void _old; const row = await prisma.task.findUnique({ where: { id } }); if (!row) return { errors: {}, message: 'Task not found.' }; await assertProjectWorkEdit(prisma, await currentUser(), row.projectId);
  if (row.archivedAt) await prisma.task.update({ where: { id }, data: { archivedAt: null } });
  revalidatePath('/tasks'); revalidatePath(`/tasks/${id}/edit`); revalidatePath('/'); if (row.accountId) revalidatePath(`/accounts/${row.accountId}`); if (row.opportunityId) revalidatePath(`/opportunities/${row.opportunityId}`);
  redirect(`/tasks/${id}/edit`);
}
