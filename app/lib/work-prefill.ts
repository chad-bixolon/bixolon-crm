import { notFound } from 'next/navigation';
import { prisma } from './prisma';
import { can, type Actor } from './authorization';
import { projectReadWhere } from './projects';

type Keys = 'accountId' | 'contactId' | 'opportunityId' | 'projectId';
export type WorkPrefill = Partial<Record<Keys, string | string[]>>;

export async function validatedWorkPrefill(input: WorkPrefill, actor: Actor): Promise<Partial<Record<Keys, number>>> {
  const ids = {} as Record<Keys, number | undefined>;
  for (const key of ['accountId', 'contactId', 'opportunityId', 'projectId'] as const) {
    const raw = input[key];
    if (raw === undefined) continue;
    if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) notFound();
    ids[key] = Number(raw);
  }
  const [account, contact, opportunity, project] = await Promise.all([
    ids.accountId ? prisma.account.findFirst({ where: { id: ids.accountId, status: 'ACTIVE', archivedAt: null }, select: { id: true } }) : null,
    ids.contactId ? prisma.contact.findFirst({ where: { id: ids.contactId, archivedAt: null, active: true }, select: { id: true, accountId: true } }) : null,
    ids.opportunityId && can(actor, 'opportunities.read') ? prisma.opportunity.findFirst({ where: { id: ids.opportunityId, archivedAt: null, ...(actor.role === 'SALES' ? { ownerId: actor.id } : {}) }, select: { id: true, participants: { select: { accountId: true } }, projects: { select: { projectId: true } } } }) : null,
    ids.projectId && can(actor, 'projects.read') ? prisma.project.findFirst({ where: { AND: [{ id: ids.projectId, archivedAt: null }, projectReadWhere(actor)] }, select: { id: true, primaryAccountId: true, participants: { select: { accountId: true } }, opportunities: { select: { opportunityId: true } } } }) : null,
  ]);
  if (ids.accountId && !account || ids.contactId && !contact || ids.opportunityId && !opportunity || ids.projectId && !project) notFound();
  if (contact?.accountId && ids.accountId && contact.accountId !== ids.accountId) notFound();
  if (opportunity && ids.accountId && !opportunity.participants.some(row => row.accountId === ids.accountId)) notFound();
  if (project && ids.accountId && project.primaryAccountId !== ids.accountId && !project.participants.some(row => row.accountId === ids.accountId)) notFound();
  if (opportunity && project && !opportunity.projects.some(row => row.projectId === project.id)) notFound();
  return ids;
}
