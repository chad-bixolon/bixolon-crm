'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireMutation } from '@/lib/current-user';
import { parseProject, saveProject, setProjectArchived } from '@/lib/projects';
import { friendlyError } from '@/lib/crm-validation';

export type ProjectFormState = { errors: Record<string, string>; message?: string; redirectTo?: string };
export async function submitProject(id: number | null, _old: ProjectFormState, form: FormData): Promise<ProjectFormState> {
  const actor = await requireMutation('projects.write');
  const parsed = parseProject(form);
  if (!parsed.value) return { errors: parsed.errors, message: 'Correct the highlighted fields.' };
  try {
    const projectId = await saveProject(prisma, parsed.value, actor, id ?? undefined);
    revalidatePath('/projects'); revalidatePath('/accounts'); revalidatePath('/opportunities'); revalidatePath('/pipeline');
    revalidatePath(`/projects/${projectId}`);
    return { errors: {}, redirectTo: `/projects/${projectId}` };
  } catch (error) { return { errors: {}, message: friendlyError(error, 'Project could not be saved.') }; }
}
export async function changeProjectArchive(id: number, archive: boolean, _old: ProjectFormState): Promise<ProjectFormState> {
  void _old;
  const actor = await requireMutation('projects.write');
  try { await setProjectArchived(prisma, id, archive, actor); }
  catch (error) { return { errors: {}, message: friendlyError(error, 'Project status could not be changed.') }; }
  revalidatePath('/projects'); revalidatePath('/accounts'); revalidatePath(`/projects/${id}`);
  return { errors: {}, message: archive ? 'Project archived.' : 'Project reactivated.' };
}
