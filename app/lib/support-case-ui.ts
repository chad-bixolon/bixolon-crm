import type { Actor } from './authorization';
import { prisma } from './prisma';
import { eligibleUserWhere, defaultEligibleUserId } from './assignment-eligibility';
import { listSupportCaseCategories } from './support-case-categories';
import { DEFAULT_USER_TIME_ZONE } from './user-time-zone';

export async function supportFormOptions(actor: Actor) {
  const [categories, users, profile] = await Promise.all([
    listSupportCaseCategories(prisma, actor, false),
    prisma.user.findMany({ where: eligibleUserWhere('support-cases.write'), select: { id: true, firstName: true, lastName: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
    prisma.user.findUnique({ where: { id: actor.id }, select: { timeZone: true } }),
  ]);
  return { categories: categories.map(c => ({ id: c.id, name: c.name, active: c.active })), assignees: users.map(u => ({ id: u.id, name: `${u.firstName} ${u.lastName}` })), defaultAssigneeId: defaultEligibleUserId(users, actor.id), zone: profile?.timeZone ?? DEFAULT_USER_TIME_ZONE };
}
export async function supportUserZone(actor: Actor) { return (await prisma.user.findUnique({ where: { id: actor.id }, select: { timeZone: true } }))?.timeZone ?? DEFAULT_USER_TIME_ZONE; }
