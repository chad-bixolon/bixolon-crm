import { prisma } from './prisma';
export async function workOptions() {
  const [accounts, opportunities, users, activityTypes] = await Promise.all([
    prisma.account.findMany({ where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.opportunity.findMany({ where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.user.findMany({ where: { active: true, archivedAt: null }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: 'asc' } }),
    prisma.activityType.findMany({ where: { active: true }, select: { code: true, name: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
  ]);
  return { accounts, opportunities, users: users.map(u => ({ id: u.id, name: `${u.firstName} ${u.lastName}` })), activityTypes };
}
