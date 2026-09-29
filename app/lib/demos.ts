import { Prisma, type PrismaClient } from '@prisma/client';
import { can, type Actor } from './authorization';
import { accountProjectsWhere, canEditProject, projectReadWhere } from './projects';

type Db = PrismaClient | Prisma.TransactionClient;
export const demoLabel = (demo: { demoNumber: string | null; sourceRequestId: string | null; id: number }) =>
  demo.demoNumber || `Pending (${demo.sourceRequestId?.slice(0, 8) ?? demo.id})`;

export function demoReadWhere(actor: Actor): Prisma.DemoRequestWhereInput {
  if (!can(actor, 'accounts.read') || !can(actor, 'sales.read')) return { id: -1 };
  // Account detail is available to every CRM user with accounts.read.
  return {};
}

export async function assertDemoContext(db: Db, actor: Actor, accountId: number, projectId: number | null, opportunityId: number | null) {
  if (!can(actor, 'accounts.read') || !can(actor, 'sales.write')) throw new Error('Access denied');
  const account = await db.account.findFirst({ where: { id: accountId, status: 'ACTIVE', archivedAt: null }, select: { id: true } });
  if (!account) throw new Error('Choose an active Account.');
  if (projectId !== null) {
    const project = await db.project.findFirst({ where: { AND: [{ id: projectId, archivedAt: null }, accountProjectsWhere(accountId, actor)] }, include: { primaryAccount: { select: { ownerId: true } } } });
    if (!project || !canEditProject(actor, project)) throw new Error('Project is not available for this Account.');
  }
  if (opportunityId !== null) {
    const opportunity = await db.opportunity.findFirst({ where: { id: opportunityId, archivedAt: null, participants: { some: { accountId } }, ...(actor.role === 'SALES' ? { ownerId: actor.id } : {}) }, select: { id: true } });
    if (!opportunity) throw new Error('Opportunity is not available for this Account.');
  }
}

export async function demoContextChoices(db: PrismaClient, actor: Actor, accountId: number) {
  const [projects, opportunities] = await Promise.all([
    db.project.findMany({ where: { AND: [{ archivedAt: null }, accountProjectsWhere(accountId, actor), projectReadWhere(actor)] }, select: { id: true, name: true, ownerId: true, primaryAccount: { select: { ownerId: true } } }, orderBy: { name: 'asc' } }),
    db.opportunity.findMany({ where: { archivedAt: null, participants: { some: { accountId } }, ...(actor.role === 'SALES' ? { ownerId: actor.id } : {}) }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  return { projects: projects.filter(project => canEditProject(actor, project)), opportunities };
}
