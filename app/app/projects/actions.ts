'use server';
import { assertModuleEnabled } from '@/lib/module-availability';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireMutation } from '@/lib/current-user';
import { parseProject, projectFailureState, saveProject, setProjectArchived } from '@/lib/projects';
import { friendlyError } from '@/lib/crm-validation';
import { saveFeedbackPath } from '@/lib/save-feedback';

import { requireEditToken, isRecordChanged, recordChangedMessage } from '../../lib/stale-edit';
import { captureActionError } from '../../lib/request-observability';
export type ProjectFormState = { errors: Record<string, string>; message?: string; redirectTo?: string; values?: Record<string, string>; recordChanged?: boolean };
export async function submitProject(id: number | null, _old: ProjectFormState, form: FormData): Promise<ProjectFormState> {
  await assertModuleEnabled('PROJECTS');
  const actor = await requireMutation('projects.write');
  const parsed = parseProject(form);
  if (!parsed.value) return projectFailureState(form, parsed.errors);
  try {
    const projectId = await saveProject(prisma, parsed.value, actor, id ?? undefined, id ? requireEditToken(form) : undefined);
    revalidatePath('/projects'); revalidatePath('/accounts'); revalidatePath('/opportunities'); revalidatePath('/pipeline');
    revalidatePath(`/projects/${projectId}`);
    return { errors: {}, redirectTo: saveFeedbackPath(`/projects/${projectId}`, id ? 'updated' : 'created') };
  } catch (error) { if (isRecordChanged(error)) return { ...projectFailureState(form, {}, recordChangedMessage), recordChanged: true }; const fallback = 'Project could not be saved.'; const business = friendlyError(error, fallback); const incident = business === fallback ? await captureActionError(error, 'project.save', { userId: actor.id, entityType: 'Project', entityId: id }) : undefined; return projectFailureState(form, {}, incident ?? business); }
}
export async function changeProjectArchive(id: number, archive: boolean, _old: ProjectFormState): Promise<ProjectFormState> {
  await assertModuleEnabled('PROJECTS');
  void _old;
  const actor = await requireMutation('projects.write');
  try { await setProjectArchived(prisma, id, archive, actor); }
  catch (error) { const fallback = 'Project status could not be changed.'; const business = friendlyError(error, fallback); const incident = business === fallback ? await captureActionError(error, 'project.archive', { userId: actor.id, entityType: 'Project', entityId: id }) : undefined; return { errors: {}, message: incident ?? business }; }
  revalidatePath('/projects'); revalidatePath('/accounts'); revalidatePath(`/projects/${id}`);
  return { errors: {}, message: archive ? 'Project archived.' : 'Project reactivated.' };
}
