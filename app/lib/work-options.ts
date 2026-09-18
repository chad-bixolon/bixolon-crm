import { prisma } from './prisma';
export async function workOptions(current?: { accountId?: number | null; opportunityId?: number | null; projectId?: number | null; userId?: number | null; contactIds?: number[] }) {
  const [accounts, opportunities, users, activityTypes, projects, contacts] = await Promise.all([
    prisma.account.findMany({ where: { OR: [{ archivedAt: null }, ...(current?.accountId ? [{ id: current.accountId }] : [])] }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.opportunity.findMany({ where: { OR: [{ archivedAt: null }, ...(current?.opportunityId ? [{ id: current.opportunityId }] : [])] }, select: { id: true, name: true, participants: { select: { accountId: true } } }, orderBy: { name: 'asc' } }),
    prisma.user.findMany({ where: { OR: [{ active: true, archivedAt: null }, ...(current?.userId ? [{ id: current.userId }] : [])] }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: 'asc' } }),
    prisma.activityType.findMany({ where: { active: true }, select: { code: true, name: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.project.findMany({ where: { OR: [{ archivedAt: null }, ...(current?.projectId ? [{ id: current.projectId }] : [])] }, select: { id: true, name: true, primaryAccountId: true, participants: { select: { accountId: true } } }, orderBy: { name: 'asc' } }),
    prisma.contact.findMany({ where: { OR: [{ archivedAt: null }, ...(current?.contactIds?.length ? [{ id: { in: current.contactIds } }] : [])] }, select: { id: true, accountId: true, firstName: true, lastName: true, active: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
  ]);
  return { accounts, opportunities: opportunities.map(o => ({ id: o.id, name: o.name, accountIds: o.participants.map(p => p.accountId) })), projects: projects.map(p => ({ id: p.id, name: p.name, accountIds: [p.primaryAccountId, ...p.participants.map(a => a.accountId)] })), contacts: contacts.map(c => ({ id: c.id, accountId: c.accountId, active: c.active, name: `${c.firstName} ${c.lastName}` })), users: users.map(u => ({ id: u.id, name: `${u.firstName} ${u.lastName}` })), activityTypes };
}
