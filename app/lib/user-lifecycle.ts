import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { assertPermission, type Actor } from './authorization';
import { eligibleUser, type Eligibility } from './assignment-eligibility';

export type UserImpact = { area: string; count: number };
export class UserImpactRequired extends Error {
  constructor(public impact: UserImpact[], public confirmation: string) { super('This change will make this user ineligible for some active work. Historical attribution will remain unchanged.'); }
}
export async function userChangeImpact(tx: Prisma.TransactionClient, actor: Actor, before: Actor, after: Actor, now = new Date()): Promise<UserImpact[]> {
  assertPermission(actor, 'users.manage');
  const lost = (policy: Eligibility) => eligibleUser(before, policy) && !eligibleUser(after, policy);
  const id = before.id, year = now.getUTCFullYear();
  const counts: Promise<UserImpact>[] = [];
  const add = (area: string, enabled: boolean, count: () => Promise<number>) => { if (enabled) counts.push(count().then(count => ({ area, count }))); };
  add('Accounts', lost('account-owner'), () => tx.account.count({ where: { ownerId: id, archivedAt: null, status: 'ACTIVE' } }));
  add('Open Opportunities', lost('opportunity-owner'), () => tx.opportunity.count({ where: { ownerId: id, archivedAt: null, stage: { isClosed: false } } }));
  add('Active Projects', lost('project-owner'), () => tx.project.count({ where: { ownerId: id, archivedAt: null, status: { in: ['PLANNING','ACTIVE','ON_HOLD'] } } }));
  add('Open Sales Tasks', lost('general-task'), () => tx.task.count({ where: { assignedToId: id, archivedAt: null, supportCaseId: null, status: { in: ['OPEN','IN_PROGRESS'] } } }));
  add('Open Support Tasks', lost('support-task'), () => tx.task.count({ where: { assignedToId: id, archivedAt: null, supportCaseId: { not: null }, status: { in: ['OPEN','IN_PROGRESS'] } } }));
  add('Unresolved Support Cases', lost('support-case'), () => tx.supportCase.count({ where: { assignedToId: id, archivedAt: null, status: { notIn: ['RESOLVED','CLOSED'] } } }));
  add('Trade Show Sales assignments', lost('trade-show-sales'), () => tx.tradeShowLead.count({ where: { assignedSalesRepUserId: id, tradeShow: { archivedAt: null }, status: { in: ['NEW','CONTACTED','QUALIFIED'] } } }));
  add('Trade Show Marketing ownership', lost('marketing-owner'), () => tx.tradeShow.count({ where: { marketingOwnerId: id, archivedAt: null, OR: [{ endDate: null }, { endDate: { gte: now } }] } }));
  add('Price Exception follow-up', lost('account-owner'), () => tx.priceException.count({ where: { status: 'ACTIVE', archivedAt: null, OR: [{ followUp: { ownerId: id, status: { notIn: ['COMPLETED','NO_RENEWAL_NEEDED'] } } }, { followUp: null, assignedSalesRepUserId: id }] } }));
  add('Outstanding Demos', lost('account-owner'), () => tx.demoRequest.count({ where: { requestedById: id, OR: [{ status: { in: ['PENDING','APPROVED'] } }, { status: 'SHIPPED', items: { some: { retiredAt: null, units: { some: { status: 'DEPLOYED' } } } } }] } }));
  add('Active Sales Plans', lost('sales-plan-owner'), () => tx.salesPlan.count({ where: { ownerId: id, status: 'ACTIVE', planYear: { gte: year } } }));
  add('Current/future Sales targets', lost('sales-plan-owner'), () => tx.salesTarget.count({ where: { userId: id, archivedAt: null, year: { gte: year } } }));
  return (await Promise.all(counts)).filter(row => row.count > 0);
}
export function impactConfirmation(before: Actor, after: Actor, impact: UserImpact[]) {
  return createHash('sha256').update(JSON.stringify({ before, after, impact })).digest('hex');
}
export type UserHistoryAction = 'User created' | 'Role changed' | 'Status changed' | 'Email changed' | 'Timezone changed' | 'Delegation changed' | 'Identity reset';
export async function recordUserHistory(tx: Prisma.TransactionClient, actorId: number, targetId: number, action: UserHistoryAction, oldValue?: string, newValue?: string) {
  await tx.adminMaintenanceEvent.create({ data: { actorId, entityType: 'User', recordIds: [targetId], recordCount: 1, action, oldValue, newValue } });
}
