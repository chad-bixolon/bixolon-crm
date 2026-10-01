import type { PrismaClient } from '@prisma/client';
import { can, type Actor } from './authorization';
import { canEditProject } from './projects';

export type UpdateContext = { kind: 'project' | 'opportunity'; id: number };
export function projectUpdateWhere(context: UpdateContext) {
  return context.kind === 'project' ? { projectId: context.id } : { opportunityId: context.id };
}

export async function saveProjectUpdate(client: PrismaClient, actor: Actor, context: UpdateContext, updateId: number | null, form: FormData) {
  if (!Number.isSafeInteger(context.id) || context.id < 1 || (updateId !== null && (!Number.isSafeInteger(updateId) || updateId < 1))) throw new Error('Invalid update.');
  const body = String(form.get('body') ?? '').trim();
  if (!body || body.length > 5000) throw new Error('Enter an update of 1 to 5,000 characters.');
  const other = String(form.get(context.kind === 'project' ? 'opportunityId' : 'projectId') ?? '');
  const otherId = other ? Number(other) : null;
  if (otherId !== null && (!Number.isSafeInteger(otherId) || otherId < 1)) throw new Error('Choose a valid linked record.');

  return client.$transaction(async tx => {
    const existing = updateId === null ? null : await tx.projectUpdate.findUnique({ where: { id: updateId } });
    if (updateId !== null && (!existing || (context.kind === 'project' ? existing.projectId !== context.id : existing.opportunityId !== context.id))) throw new Error('Update not found in this record.');
    const projectId = context.kind === 'project' ? context.id : otherId;
    const opportunityId = context.kind === 'opportunity' ? context.id : otherId;
    const [project, opportunity] = await Promise.all([
      projectId ? tx.project.findUnique({ where: { id: projectId }, include: { primaryAccount: { select: { ownerId: true } } } }) : null,
      opportunityId ? tx.opportunity.findUnique({ where: { id: opportunityId } }) : null,
    ]);
    if (projectId && (!project || project.archivedAt || !canEditProject(actor, project))) throw new Error('Access denied to this Project.');
    if (opportunityId && (!opportunity || opportunity.archivedAt || !can(actor, 'sales.write') || (actor.role === 'SALES' && opportunity.ownerId !== actor.id))) throw new Error('Access denied to this Opportunity.');
    if (projectId && opportunityId) {
      const link = await tx.opportunityProject.findUnique({ where: { opportunityId_projectId: { opportunityId, projectId } } });
      if (!link) throw new Error('Choose a linked Project and Opportunity.');
    }
    // Editing from either context also requires access to the record's old links.
    if (existing?.projectId && existing.projectId !== projectId) {
      const oldProject = await tx.project.findUnique({ where: { id: existing.projectId }, include: { primaryAccount: { select: { ownerId: true } } } });
      if (!oldProject || !canEditProject(actor, oldProject)) throw new Error('Access denied to the linked Project.');
    }
    if (existing?.opportunityId && existing.opportunityId !== opportunityId) {
      const oldOpportunity = await tx.opportunity.findUnique({ where: { id: existing.opportunityId } });
      if (!oldOpportunity || !can(actor, 'sales.write') || (actor.role === 'SALES' && oldOpportunity.ownerId !== actor.id)) throw new Error('Access denied to the linked Opportunity.');
    }
    const data = { projectId, opportunityId, body };
    const saved = existing ? await tx.projectUpdate.update({ where: { id: existing.id }, data: { ...data, updatedById: actor.id } }) : await tx.projectUpdate.create({ data: { ...data, createdById: actor.id } });
    return { id: saved.id, projectId, opportunityId, oldProjectId: existing?.projectId, oldOpportunityId: existing?.opportunityId };
  });
}
