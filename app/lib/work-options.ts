import { prisma } from './prisma';
import { eligibleUserWhere, taskAssigneePolicy } from './assignment-eligibility';
import { getModuleAvailability } from './module-availability';
export async function workOptions(current?: { accountId?: number | null; opportunityId?: number | null; projectId?: number | null; userId?: number | null; contactIds?: number[]; supportCaseId?: number | null }) {
  const availability = await getModuleAvailability();
  const optionalModules = { opportunities: availability.effective.has('OPPORTUNITIES'), projects: availability.effective.has('PROJECTS'), supportCases: availability.effective.has('SUPPORT_CASES') };
  const [accounts, opportunities, users, activityTypes, projects, contacts] = await Promise.all([
    prisma.account.findMany({ where: { id: { in: current?.accountId ? [current.accountId] : [] } }, select: { id: true, name: true } }),
    optionalModules.opportunities?prisma.opportunity.findMany({ where: { id: { in: current?.opportunityId ? [current.opportunityId] : [] } }, select: { id: true, name: true, participants: { select: { accountId: true } }, projects: { select: { projectId: true } } } }):[],
    prisma.user.findMany({ where: eligibleUserWhere(taskAssigneePolicy(current ?? {})), select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: 'asc' } }),
    prisma.activityType.findMany({ where: { active: true }, select: { code: true, name: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    optionalModules.projects?prisma.project.findMany({ where: { id: { in: current?.projectId ? [current.projectId] : [] } }, select: { id: true, name: true, primaryAccountId: true, participants: { select: { accountId: true } }, opportunities: { select: { opportunityId: true } } } }):[],
    prisma.contact.findMany({ where: { id: { in: current?.contactIds ?? [] } }, select: { id: true, accountId: true, account: { select: { name: true } }, firstName: true, lastName: true, email: true, active: true, archivedAt: true } }),
  ]);
  const currentUser = current?.userId && !users.some(user => user.id === current.userId)
    ? await prisma.user.findUnique({ where: { id: current.userId }, select: { id: true, firstName: true, lastName: true } }) : null;
  return { optionalModules, accounts, opportunities: opportunities.map(o => ({ id: o.id, name: o.name, accountIds: o.participants.map(p => p.accountId), projectIds: o.projects.map(p => p.projectId) })), projects: projects.map(p => ({ id: p.id, name: p.name, accountIds: [...(p.primaryAccountId ? [p.primaryAccountId] : []), ...p.participants.map(a => a.accountId)], opportunityIds: p.opportunities.map(o => o.opportunityId) })), contacts: contacts.map(c => ({ id: c.id, accountId: c.accountId, accountName: c.account?.name ?? null, active: c.active, archivedAt: c.archivedAt, name: `${c.firstName} ${c.lastName}`, email: c.email })), users: users.map(u => ({ id: u.id, name: `${u.firstName} ${u.lastName}` })), currentUser: currentUser ? { id: currentUser.id, name: `${currentUser.firstName} ${currentUser.lastName}` } : null, activityTypes };
}
