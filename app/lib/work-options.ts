import { prisma } from './prisma';
export async function workOptions() {
  const [accounts, opportunities, users, activityTypes, projects, contacts] = await Promise.all([
    prisma.account.findMany({ where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.opportunity.findMany({ where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.user.findMany({ where: { active: true, archivedAt: null }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: 'asc' } }),
    prisma.activityType.findMany({ where: { active: true }, select: { code: true, name: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.project.findMany({ where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.contact.findMany({ where: { archivedAt: null }, select: { id: true, accountId: true, firstName: true, lastName: true, active: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
  ]);
  return { accounts, opportunities, projects, contacts: contacts.map(c => ({ id: c.id, accountId: c.accountId, active: c.active, name: `${c.firstName} ${c.lastName}` })), users: users.map(u => ({ id: u.id, name: `${u.firstName} ${u.lastName}` })), activityTypes };
}
