import { operationalOpportunityWhere, operationalProjectWhere, operationalContactWhere, operationalAccountWhere } from './operational-where';
import { prisma } from './prisma';
import { eligibleUserWhere } from './assignment-eligibility';
export async function workOptions(current?: { accountId?: number | null; opportunityId?: number | null; projectId?: number | null; userId?: number | null; contactIds?: number[] }) {
  const [accounts, opportunities, users, activityTypes, projects, contacts] = await Promise.all([
    prisma.account.findMany({ where: { OR: [operationalAccountWhere, ...(current?.accountId ? [{ id: current.accountId }] : [])] }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.opportunity.findMany({ where: { OR: [operationalOpportunityWhere, ...(current?.opportunityId ? [{ id: current.opportunityId }] : [])] }, select: { id: true, name: true, participants: { select: { accountId: true } }, projects: { select: { projectId: true } } }, orderBy: { name: 'asc' } }),
    prisma.user.findMany({ where: eligibleUserWhere('tasks.write'), select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: 'asc' } }),
    prisma.activityType.findMany({ where: { active: true }, select: { code: true, name: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.project.findMany({ where: { OR: [operationalProjectWhere, ...(current?.projectId ? [{ id: current.projectId }] : [])] }, select: { id: true, name: true, primaryAccountId: true, participants: { select: { accountId: true } }, opportunities: { select: { opportunityId: true } } }, orderBy: { name: 'asc' } }),
    prisma.contact.findMany({ where: { OR: [operationalContactWhere, ...(current?.contactIds?.length ? [{ id: { in: current.contactIds } }] : [])] }, select: { id: true, accountId: true, account: { select: { name: true } }, firstName: true, lastName: true, email: true, active: true, archivedAt: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
  ]);
  const currentUser = current?.userId && !users.some(user => user.id === current.userId)
    ? await prisma.user.findUnique({ where: { id: current.userId }, select: { id: true, firstName: true, lastName: true } }) : null;
  return { accounts, opportunities: opportunities.map(o => ({ id: o.id, name: o.name, accountIds: o.participants.map(p => p.accountId), projectIds: o.projects.map(p => p.projectId) })), projects: projects.map(p => ({ id: p.id, name: p.name, accountIds: [...(p.primaryAccountId ? [p.primaryAccountId] : []), ...p.participants.map(a => a.accountId)], opportunityIds: p.opportunities.map(o => o.opportunityId) })), contacts: contacts.map(c => ({ id: c.id, accountId: c.accountId, accountName: c.account?.name ?? null, active: c.active, archivedAt: c.archivedAt, name: `${c.firstName} ${c.lastName}`, email: c.email })), users: users.map(u => ({ id: u.id, name: `${u.firstName} ${u.lastName}` })), currentUser: currentUser ? { id: currentUser.id, name: `${currentUser.firstName} ${currentUser.lastName}` } : null, activityTypes };
}
