'use server';
import { requireEditToken, isRecordChanged, recordChangedMessage, nextUpdatedAt } from '../../lib/stale-edit';
import { recordMaintenance } from '../../lib/admin-maintenance';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { syncTaskNotifications } from '@/lib/work-notification-evaluator';
import { parseTask, saveTask } from '@/lib/work';
import { currentUser } from '@/lib/current-user';
import { assertProjectWorkEdit } from '@/lib/projects';
import { saveFeedbackPath } from '../../lib/save-feedback';
import { assertWorkPermission, caseWorkContext, saveSupportCaseTask } from '@/lib/support-work';
import { assertPermission } from '@/lib/authorization';
export type WorkState = { errors: Record<string,string>; message?: string; values?: Record<string,string>; recordChanged?: boolean };
const taskFields = ['subject', 'description', 'accountId', 'opportunityId', 'projectId', 'assignedToId', 'supportCaseId', 'contactId', 'status', 'priority', 'dueDate'] as const;
function submittedValues(form: FormData) { return Object.fromEntries(taskFields.map(key => [key, String(form.get(key) ?? '')])); }
export async function submitTask(id: number | null, _old: WorkState, form: FormData): Promise<WorkState> {
  const parsed = parseTask(form); if (!parsed.value) return { errors: parsed.errors, message: 'Correct the highlighted fields.', values: submittedValues(form) };
  const createKey = form.get('createKey');
  if (!id && (typeof createKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(createKey))) return { errors: {}, message: 'Reload the form and try again.', values: submittedValues(form) };
  let destination: string;
  try {
    const actor = await currentUser();
    let row;
    if (actor.role === 'SUPPORT' && id) {
      row = await saveSupportCaseTask(prisma, actor, parsed.value, id, requireEditToken(form));
    } else {
      assertWorkPermission(actor, parsed.value.supportCaseId);
      const existing = id ? await prisma.task.findUnique({ where: { id }, select: { projectId: true, supportCaseId: true } }) : null;
      if (actor.role === 'SUPPORT' && (parsed.value.opportunityId || parsed.value.projectId)) throw new Error('Access denied to Sales relationships.');
      if (parsed.value.supportCaseId) await caseWorkContext(prisma, actor, parsed.value.supportCaseId, parsed.value.accountId, parsed.value.contactId ? [parsed.value.contactId] : [], !!id && existing?.supportCaseId === parsed.value.supportCaseId);
      await assertProjectWorkEdit(prisma, actor, existing?.projectId);
      await assertProjectWorkEdit(prisma, actor, parsed.value.projectId);
      row = await saveTask(prisma, parsed.value, id ?? undefined, id ? undefined : createKey as string, actor.id, id ? requireEditToken(form) : undefined);
    }
    if (row.supportCaseId) revalidatePath(`/support/cases/${row.supportCaseId}`);
    revalidatePath(`/tasks/${row.id}`); revalidatePath('/tasks'); revalidatePath('/');
    if (row.accountId) revalidatePath(`/accounts/${row.accountId}`);
    if (row.opportunityId) revalidatePath(`/opportunities/${row.opportunityId}`);
    if (row.projectId) revalidatePath(`/projects/${row.projectId}`);
    destination = saveFeedbackPath(id ? `/tasks/${row.id}/edit` : `/tasks/${row.id}`, id ? 'updated' : 'created');
  }
  catch (e) { if (isRecordChanged(e)) return { errors: {}, message: recordChangedMessage, recordChanged: true, values: submittedValues(form) }; const message = e instanceof Error ? e.message : 'Task could not be saved.'; return { errors: message.startsWith('Contact ') ? { contactId: message } : {}, message, values: submittedValues(form) }; }
  redirect(destination);
}
export async function archiveTask(id: number, _old: WorkState): Promise<WorkState> {
  void _old; const actor = await currentUser(); assertPermission(actor, 'tasks.write'); const row = await prisma.task.findUnique({ where: { id } }); if (!row) return { errors: {}, message: 'Task not found.' }; await assertProjectWorkEdit(prisma, await currentUser(), row.projectId);
  try { if (!row.archivedAt) await prisma.$transaction(async tx => { await tx.task.update({ where: { id, updatedAt: row.updatedAt }, data: { updatedAt: nextUpdatedAt(row.updatedAt), archivedAt: new Date(), archivedById: actor.id, updatedById: actor.id } }); await recordMaintenance(tx, actor.id, 'Task', 'Archive', [id]); await syncTaskNotifications(tx, id); }); } catch (error) { if (isRecordChanged(error)) return { errors: {}, message: recordChangedMessage }; throw error; }
  revalidatePath('/tasks'); revalidatePath(`/tasks/${id}/edit`); revalidatePath('/'); if (row.accountId) revalidatePath(`/accounts/${row.accountId}`); if (row.opportunityId) revalidatePath(`/opportunities/${row.opportunityId}`);
  redirect('/tasks?visibility=archived');
}
export async function reactivateTask(id: number, _old: WorkState): Promise<WorkState> {
  void _old; const actor = await currentUser(); assertPermission(actor, 'tasks.write'); const row = await prisma.task.findUnique({ where: { id } }); if (!row) return { errors: {}, message: 'Task not found.' }; await assertProjectWorkEdit(prisma, await currentUser(), row.projectId);
  try { if (row.archivedAt) await prisma.$transaction(async tx => { await tx.task.update({ where: { id, updatedAt: row.updatedAt }, data: { updatedAt: nextUpdatedAt(row.updatedAt), archivedAt: null, archivedById: null, updatedById: actor.id } }); await recordMaintenance(tx, actor.id, 'Task', 'Restore', [id]); await syncTaskNotifications(tx, id); }); } catch (error) { if (isRecordChanged(error)) return { errors: {}, message: recordChangedMessage }; throw error; }
  revalidatePath('/tasks'); revalidatePath(`/tasks/${id}/edit`); revalidatePath('/'); if (row.accountId) revalidatePath(`/accounts/${row.accountId}`); if (row.opportunityId) revalidatePath(`/opportunities/${row.opportunityId}`);
  redirect(`/tasks/${id}/edit`);
}
