import { Prisma, ProjectPartyRole, ProjectStatus, type PrismaClient } from '@prisma/client';
import { can, type Actor } from './authorization';
import { field, optional, positiveId, required, type Errors } from './crm-validation';
import { dateField } from './work';
import { projectRoleLabels } from './project-labels';
export { projectRoleLabels, projectStatusLabels } from './project-labels';
export type ProjectParticipant = { accountId: number; roles: ProjectPartyRole[] };
export type ProjectInput = {
  name: string; primaryAccountId: number; primaryAccountRole: ProjectPartyRole; ownerId: number | null;
  status: ProjectStatus; startDate: Date | null; targetEndDate: Date | null; description: string | null;
  participants: ProjectParticipant[];
};
export function parseProject(form: FormData) {
  const errors: Errors = {};
  const name = required(form, 'name', 'Project name', 200, errors);
  const primaryAccountId = positiveId(field(form, 'primaryAccountId'));
  if (!primaryAccountId) errors.primaryAccountId = 'Choose a Primary Account.';
  const rawRole = field(form, 'primaryAccountRole');
  const primaryAccountRole = Object.values(ProjectPartyRole).includes(rawRole as ProjectPartyRole) ? rawRole as ProjectPartyRole : null;
  if (!primaryAccountRole) errors.primaryAccountRole = 'Choose a Primary Account Role.';
  const rawOwner = field(form, 'ownerId'), ownerId = rawOwner ? positiveId(rawOwner) : null;
  if (rawOwner && !ownerId) errors.ownerId = 'Choose a valid owner.';
  const rawStatus = field(form, 'status');
  const status = Object.values(ProjectStatus).includes(rawStatus as ProjectStatus) ? rawStatus as ProjectStatus : null;
  if (!status) errors.status = 'Choose a status.';
  const startDate = dateField(field(form, 'startDate'), 'startDate', errors);
  const targetEndDate = dateField(field(form, 'targetEndDate'), 'targetEndDate', errors);
  if (startDate && targetEndDate && targetEndDate < startDate) errors.targetEndDate = 'Target end date must be on or after the start date.';
  const description = optional(form, 'description', 5000, errors);
  const ids = form.getAll('accountId').map(String), rawRoles = form.getAll('participantRoles').map(String);
  const participants: ProjectParticipant[] = [];
  if (ids.length !== rawRoles.length) errors.participants = 'Each participant needs at least one role.';
  for (let i = 0; i < ids.length; i++) {
    const accountId = positiveId(ids[i]);
    const roles = rawRoles[i]?.split(',').filter(Boolean) ?? [];
    if (!accountId || !roles.length || roles.some(role => !Object.values(ProjectPartyRole).includes(role as ProjectPartyRole))) {
      errors.participants = 'Each additional Account needs at least one valid Project role.'; continue;
    }
    if (accountId === primaryAccountId) { errors.participants = 'The Primary Account cannot also be an additional participant.'; continue; }
    if (participants.some(p => p.accountId === accountId)) { errors.participants = 'Choose each additional Account only once.'; continue; }
    participants.push({ accountId, roles: [...new Set(roles)] as ProjectPartyRole[] });
  }
  return { errors, value: Object.keys(errors).length ? undefined : {
    name, primaryAccountId: primaryAccountId!, primaryAccountRole: primaryAccountRole!, ownerId,
    status: status!, startDate, targetEndDate, description, participants,
  } satisfies ProjectInput };
}
export function projectReadWhere(actor: Actor): Prisma.ProjectWhereInput {
  if (!can(actor, 'projects.read')) return { id: -1 };
  return actor.role === 'SALES' ? { OR: [{ archivedAt: null }, { ownerId: actor.id }, { primaryAccount: { ownerId: actor.id } }] } : {};
}
export function canEditProject(actor: Actor, project: { ownerId: number | null; primaryAccount: { ownerId: number | null } }) {
  if (!can(actor, 'projects.write')) return false;
  return actor.role !== 'SALES' || project.ownerId === actor.id || project.primaryAccount.ownerId === actor.id;
}
export function accountProjectsWhere(accountId: number, actor: Actor): Prisma.ProjectWhereInput {
  return { AND: [projectReadWhere(actor), { OR: [{ primaryAccountId: accountId }, { participants: { some: { accountId } } }] }] };
}
export async function listAccountProjects(client: PrismaClient, accountId: number, actor: Actor) {
  return client.project.findMany({ where: accountProjectsWhere(accountId, actor),
    include: { primaryAccount: { select: { name: true } }, participants: { where: { accountId }, include: { roles: true } } },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }] });
}
export function accountProjectRelationship(project: { primaryAccountId: number; primaryAccountRole: ProjectPartyRole; participants: { accountId: number; roles: { role: ProjectPartyRole }[] }[] }, accountId: number) {
  return project.primaryAccountId === accountId ? `Primary Account · ${projectRoleLabels[project.primaryAccountRole]}` :
    `Additional Participant · ${project.participants.find(p => p.accountId === accountId)?.roles.map(r => projectRoleLabels[r.role]).join(', ') || 'No role'}`;
}
export function pipelineProjectFilter(raw?: string): Prisma.OpportunityWhereInput {
  if (raw === 'none') return { projectId: null };
  const id = positiveId(raw ?? '');
  return id ? { projectId: id } : {};
}
export async function assertProjectWorkEdit(client: PrismaClient, actor: Actor, projectId: number | null | undefined) {
  if (!projectId) return;
  const project = await client.project.findUnique({ where: { id: projectId }, include: { primaryAccount: { select: { ownerId: true } } } });
  if (!project || project.archivedAt || !canEditProject(actor, project)) throw new Error('Access denied to Project work.');
}
export async function saveProject(client: PrismaClient, input: ProjectInput, actor: Actor, id?: number) {
  if (!can(actor, 'projects.write')) throw new Error('Access denied');
  if (input.participants.some(p => p.accountId === input.primaryAccountId || !p.roles.length) ||
      new Set(input.participants.map(p => p.accountId)).size !== input.participants.length) throw new Error('Invalid Project participants.');
  return client.$transaction(async tx => {
    const existing = id ? await tx.project.findUnique({ where: { id }, include: { primaryAccount: { select: { ownerId: true } }, participants: { include: { roles: true } } } }) : null;
    if (id && (!existing || existing.archivedAt)) throw new Error('Project not found or archived.');
    if (existing && !canEditProject(actor, existing)) throw new Error('Access denied');
    const ids = [input.primaryAccountId, ...input.participants.map(p => p.accountId)];
    const [accounts, owner] = await Promise.all([
      tx.account.findMany({ where: { id: { in: ids }, status: 'ACTIVE', archivedAt: null }, select: { id: true } }),
      input.ownerId ? tx.user.findFirst({ where: { id: input.ownerId, active: true, archivedAt: null } }) : null,
    ]);
    if (accounts.length !== ids.length) throw new Error('Choose active Accounts for the Primary Account and all participants.');
    if (input.ownerId && !owner) throw new Error('Choose an active owner.');
    const data = { name: input.name, primaryAccountId: input.primaryAccountId, primaryAccountRole: input.primaryAccountRole,
      ownerId: input.ownerId, status: input.status, startDate: input.startDate, targetEndDate: input.targetEndDate,
      description: input.description, updatedById: actor.id };
    // Remove memberships that would collide with a changed Primary Account before updating Project.
    for (const membership of existing?.participants ?? []) {
      if (membership.accountId === input.primaryAccountId || !input.participants.some(p => p.accountId === membership.accountId)) {
        await tx.projectAccountRole.deleteMany({ where: { projectId: id!, accountId: membership.accountId } });
        await tx.projectAccount.delete({ where: { projectId_accountId: { projectId: id!, accountId: membership.accountId } } });
      }
    }
    const project = existing ? await tx.project.update({ where: { id: id! }, data }) : await tx.project.create({ data: { ...data, createdById: actor.id } });
    for (const participant of input.participants) {
      await tx.projectAccount.upsert({ where: { projectId_accountId: { projectId: project.id, accountId: participant.accountId } },
        create: { projectId: project.id, accountId: participant.accountId }, update: {} });
      const old = existing?.participants.find(p => p.accountId === participant.accountId)?.roles.map(r => r.role) ?? [];
      const remove = old.filter(role => !participant.roles.includes(role));
      if (remove.length) await tx.projectAccountRole.deleteMany({ where: { projectId: project.id, accountId: participant.accountId, role: { in: remove } } });
      for (const role of participant.roles.filter(role => !old.includes(role))) {
        await tx.projectAccountRole.create({ data: { projectId: project.id, accountId: participant.accountId, role } });
      }
    }
    return project.id;
  });
}
export async function setProjectArchived(client: PrismaClient, id: number, archived: boolean, actor: Actor) {
  const project = await client.project.findUnique({ where: { id }, include: { primaryAccount: { select: { ownerId: true } } } });
  if (!project) throw new Error('Project not found.');
  if (!canEditProject(actor, project)) throw new Error('Access denied');
  if (!!project.archivedAt === archived) throw new Error(archived ? 'Project already archived.' : 'Project already active.');
  await client.project.update({ where: { id }, data: { archivedAt: archived ? new Date() : null, updatedById: actor.id } });
}
