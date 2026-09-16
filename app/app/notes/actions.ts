'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { parseNote, saveNote } from '@/lib/work';
import type { WorkState } from '@/app/tasks/actions';
export async function submitNote(id: number | null, _old: WorkState, form: FormData): Promise<WorkState> {
  const parsed = parseNote(form); if (!parsed.value) return { errors: parsed.errors, message: 'Correct the highlighted fields.' };
  let destination: string;
  try { const row = await saveNote(prisma, parsed.value, id ?? undefined); if (row.accountId) revalidatePath(`/accounts/${row.accountId}`); if (row.opportunityId) revalidatePath(`/opportunities/${row.opportunityId}`); destination = row.opportunityId ? `/opportunities/${row.opportunityId}` : `/accounts/${row.accountId}?tab=notes`; }
  catch (e) { return { errors: {}, message: e instanceof Error ? e.message : 'Note could not be saved.' }; }
  redirect(destination);
}
export async function archiveNote(id: number, _old: WorkState): Promise<WorkState> {
  void _old; const row = await prisma.note.findUnique({ where: { id } }); if (!row) return { errors: {}, message: 'Note not found.' };
  if (!row.archivedAt) await prisma.note.update({ where: { id }, data: { archivedAt: new Date() } });
  revalidatePath(`/notes/${id}/edit`); if (row.accountId) revalidatePath(`/accounts/${row.accountId}`); if (row.opportunityId) revalidatePath(`/opportunities/${row.opportunityId}`);
  redirect(row.opportunityId ? `/opportunities/${row.opportunityId}?notesView=archived` : row.accountId ? `/accounts/${row.accountId}?tab=notes&notesView=archived` : '/tasks');
}
export async function reactivateNote(id: number, _old: WorkState): Promise<WorkState> {
  void _old; const row = await prisma.note.findUnique({ where: { id } }); if (!row) return { errors: {}, message: 'Note not found.' };
  if (row.archivedAt) await prisma.note.update({ where: { id }, data: { archivedAt: null } });
  revalidatePath(`/notes/${id}/edit`); if (row.accountId) revalidatePath(`/accounts/${row.accountId}`); if (row.opportunityId) revalidatePath(`/opportunities/${row.opportunityId}`);
  redirect(`/notes/${id}/edit`);
}
