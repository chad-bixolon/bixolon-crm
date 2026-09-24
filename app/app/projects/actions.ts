'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireMutation } from '@/lib/current-user';
import { parseProject, projectFailureState, saveProject, setProjectArchived } from '@/lib/projects';
import { friendlyError } from '@/lib/crm-validation';
import { saveFeedbackPath } from '@/lib/save-feedback';

export type ProjectFormState = { errors: Record<string, string>; message?: string; redirectTo?: string; values?: Record<string, string> };
export async function submitProject(id: number | null, _old: ProjectFormState, form: FormData): Promise<ProjectFormState> {
  const actor = await requireMutation('projects.write');
  const parsed = parseProject(form);
  if (!parsed.value) return projectFailureState(form, parsed.errors);
  try {
    const projectId = await saveProject(prisma, parsed.value, actor, id ?? undefined);
    revalidatePath('/projects'); revalidatePath('/accounts'); revalidatePath('/opportunities'); revalidatePath('/pipeline');
    revalidatePath(`/projects/${projectId}`);
    return { errors: {}, redirectTo: saveFeedbackPath(`/projects/${projectId}`, id ? 'updated' : 'created') };
  } catch (error) { return projectFailureState(form, {}, friendlyError(error, 'Project could not be saved.')); }
}
export async function changeProjectArchive(id: number, archive: boolean, _old: ProjectFormState): Promise<ProjectFormState> {
  void _old;
  const actor = await requireMutation('projects.write');
  try { await setProjectArchived(prisma, id, archive, actor); }
  catch (error) { return { errors: {}, message: friendlyError(error, 'Project status could not be changed.') }; }
  revalidatePath('/projects'); revalidatePath('/accounts'); revalidatePath(`/projects/${id}`);
  return { errors: {}, message: archive ? 'Project archived.' : 'Project reactivated.' };
}
