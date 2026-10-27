import { can, type Actor } from './authorization';
import { prisma } from './prisma';
import { listEligibleUserOptions, defaultEligibleUserId } from './assignment-eligibility';
import { listSupportCaseCategories } from './support-case-categories';
import { DEFAULT_USER_TIME_ZONE } from './user-time-zone';
import { cache } from 'react';

const requestSupportZone = cache(async (userId: number) =>
  (await prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } }))?.timeZone ?? DEFAULT_USER_TIME_ZONE);

export async function supportFormOptions(actor: Actor) {
  const [categories, users, zone] = await Promise.all([
    listSupportCaseCategories(prisma, actor, false),
    listEligibleUserOptions(prisma, 'support-case'),
    requestSupportZone(actor.id),
  ]);
  return { canManageTeam: can(actor, 'support-oversight.manage'), actorId: actor.id, categories: categories.map(c => ({ id: c.id, name: c.name, active: c.active })), assignees: users.map(u => ({ id: u.id, name: `${u.firstName} ${u.lastName}` })), defaultAssigneeId: defaultEligibleUserId(users, actor.id), zone };
}
export async function supportUserZone(actor: Actor) { return requestSupportZone(actor.id); }
