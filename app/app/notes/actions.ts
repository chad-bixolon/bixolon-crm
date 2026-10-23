'use server';
import { isCaseOnlyWorker } from '../../lib/authorization';
import { nextUpdatedAt, requireEditToken, isRecordChanged, recordChangedMessage } from '../../lib/stale-edit';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { parseNote, saveNote } from '@/lib/work';
import type { WorkState } from '@/app/tasks/actions';
import { currentUser } from '@/lib/current-user';
import { assertProjectWorkEdit } from '@/lib/projects';
import { assertWorkPermission, caseWorkContext } from '@/lib/support-work';
import { assertPermission } from '@/lib/authorization';
import { assertWorkModuleContext } from '@/lib/module-availability';
export async function submitNote(id: number | null, _old: WorkState, form: FormData): Promise<WorkState> {
  const values = Object.fromEntries([...form.entries()].filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  const parsed = parseNote(form); if (!parsed.value) return { errors: parsed.errors, message: 'Correct the highlighted fields.', values };
  let destination: string;
  try { const actor = await currentUser(); assertWorkPermission(actor, parsed.value.supportCaseId); const existing = id ? await prisma.note.findUnique({ where: { id }, select: { opportunityId: true, projectId: true, supportCaseId: true } }) : null; await assertWorkModuleContext(parsed.value, existing ?? {}); if (isCaseOnlyWorker(actor) && id) throw new Error('Access denied'); if (isCaseOnlyWorker(actor) && (parsed.value.opportunityId || parsed.value.projectId)) throw new Error('Access denied to Sales relationships.'); if (parsed.value.supportCaseId) await caseWorkContext(prisma, actor, parsed.value.supportCaseId, parsed.value.accountId, [], !!id && existing?.supportCaseId === parsed.value.supportCaseId); await assertProjectWorkEdit(prisma, actor, existing?.projectId); await assertProjectWorkEdit(prisma, actor, parsed.value.projectId); const row = await saveNote(prisma, parsed.value, id ?? undefined, actor.id, id ? requireEditToken(form) : undefined); if (row.supportCaseId) revalidatePath(`/support/cases/${row.supportCaseId}`); if (row.accountId) revalidatePath(`/accounts/${row.accountId}`); if (row.opportunityId) revalidatePath(`/opportunities/${row.opportunityId}`); if (row.projectId) revalidatePath(`/projects/${row.projectId}`); destination = row.supportCaseId ? `/support/cases/${row.supportCaseId}` : row.projectId ? `/projects/${row.projectId}?tab=notes` : row.opportunityId ? `/opportunities/${row.opportunityId}` : `/accounts/${row.accountId}?tab=notes`; }
  catch (e) { if (isRecordChanged(e)) return { errors: {}, recordChanged: true, message: recordChangedMessage, values }; return { errors: {}, values, message: e instanceof Error ? e.message : 'Note could not be saved.' }; }
  redirect(destination);
}
export async function archiveNote(id: number, _old: WorkState): Promise<WorkState> {
  void _old; assertPermission(await currentUser(), 'tasks.write'); const row = await prisma.note.findUnique({ where: { id } }); if (!row) return { errors: {}, message: 'Note not found.' }; await assertProjectWorkEdit(prisma, await currentUser(), row.projectId);
  if (!row.archivedAt) await prisma.note.update({ where: { id, updatedAt: row.updatedAt }, data: { updatedAt: nextUpdatedAt(row.updatedAt), archivedAt: new Date() } });
  revalidatePath(`/notes/${id}/edit`); if (row.accountId) revalidatePath(`/accounts/${row.accountId}`); if (row.opportunityId) revalidatePath(`/opportunities/${row.opportunityId}`);
  redirect(row.projectId ? `/projects/${row.projectId}?tab=notes&notesView=archived` : row.opportunityId ? `/opportunities/${row.opportunityId}?notesView=archived` : row.accountId ? `/accounts/${row.accountId}?tab=notes&notesView=archived` : '/tasks');
}
export async function reactivateNote(id: number, _old: WorkState): Promise<WorkState> {
  void _old; assertPermission(await currentUser(), 'tasks.write'); const row = await prisma.note.findUnique({ where: { id } }); if (!row) return { errors: {}, message: 'Note not found.' }; await assertProjectWorkEdit(prisma, await currentUser(), row.projectId);
  if (row.archivedAt) await prisma.note.update({ where: { id, updatedAt: row.updatedAt }, data: { updatedAt: nextUpdatedAt(row.updatedAt), archivedAt: null } });
  revalidatePath(`/notes/${id}/edit`); if (row.accountId) revalidatePath(`/accounts/${row.accountId}`); if (row.opportunityId) revalidatePath(`/opportunities/${row.opportunityId}`);
  redirect(`/notes/${id}/edit`);
}
