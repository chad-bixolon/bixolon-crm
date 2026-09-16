'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { parseTask, saveTask } from '@/lib/work';
export type WorkState = { errors: Record<string,string>; message?: string };
export async function submitTask(id: number | null, _old: WorkState, form: FormData): Promise<WorkState> {
  const parsed = parseTask(form); if (!parsed.value) return { errors: parsed.errors, message: 'Correct the highlighted fields.' };
  const createKey = form.get('createKey');
  if (!id && (typeof createKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(createKey))) return { errors: {}, message: 'Reload the form and try again.' };
  let destination: string;
  try { const row = await saveTask(prisma, parsed.value, id ?? undefined, id ? undefined : createKey as string); revalidatePath('/tasks'); revalidatePath('/'); if (row.accountId) revalidatePath(`/accounts/${row.accountId}`); if (row.opportunityId) revalidatePath(`/opportunities/${row.opportunityId}`); destination = `/tasks/${row.id}/edit`; }
  catch (e) { return { errors: {}, message: e instanceof Error ? e.message : 'Task could not be saved.' }; }
  redirect(destination);
}
export async function archiveTask(id: number, _old: WorkState): Promise<WorkState> {
  void _old; const row = await prisma.task.findUnique({ where: { id } }); if (!row) return { errors: {}, message: 'Task not found.' };
  if (!row.archivedAt) await prisma.task.update({ where: { id }, data: { archivedAt: new Date() } });
  revalidatePath('/tasks'); revalidatePath(`/tasks/${id}/edit`); revalidatePath('/'); if (row.accountId) revalidatePath(`/accounts/${row.accountId}`); if (row.opportunityId) revalidatePath(`/opportunities/${row.opportunityId}`);
  redirect('/tasks?visibility=archived');
}
export async function reactivateTask(id: number, _old: WorkState): Promise<WorkState> {
  void _old; const row = await prisma.task.findUnique({ where: { id } }); if (!row) return { errors: {}, message: 'Task not found.' };
  if (row.archivedAt) await prisma.task.update({ where: { id }, data: { archivedAt: null } });
  revalidatePath('/tasks'); revalidatePath(`/tasks/${id}/edit`); revalidatePath('/'); if (row.accountId) revalidatePath(`/accounts/${row.accountId}`); if (row.opportunityId) revalidatePath(`/opportunities/${row.opportunityId}`);
  redirect(`/tasks/${id}/edit`);
}
