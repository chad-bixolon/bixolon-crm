import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { assertPermission, type Actor } from './authorization';
import { eligibleUser, type Eligibility } from './assignment-eligibility';
import { operationalAccountWhere, operationalOpportunityWhere, operationalProjectWhere, operationalTaskWhere } from './operational-where';
import { activeDemoWhere, activePeFollowUpWhere, activeTradeShowLeadWhere, activeTradeShowWhere } from './unavailable-work';
import { canOwnReportType, reportTypes } from './reporting';

export type UserImpact = { area: string; count: number };
export class UserImpactRequired extends Error {
  constructor(public impact: UserImpact[], public confirmation: string) { super('This change will make this user ineligible for some active work. Historical attribution will remain unchanged.'); }
}
export async function userChangeImpact(tx: Prisma.TransactionClient, actor: Actor, before: Actor, after: Actor, now = new Date()): Promise<UserImpact[]> {
  assertPermission(actor, 'users.manage');
  const lost = (policy: Eligibility) => eligibleUser(before, policy) && !eligibleUser(after, policy);
  const id = before.id;
  const counts: Promise<UserImpact>[] = [];
  const add = (area: string, enabled: boolean, count: () => Promise<number>) => { if (enabled) counts.push(count().then(count => ({ area, count }))); };
  add('Accounts', lost('account-owner'), () => tx.account.count({ where: { AND: [operationalAccountWhere], ownerId: id } }));
  add('Open Opportunities', lost('opportunity-owner'), () => tx.opportunity.count({ where: { AND: [operationalOpportunityWhere], ownerId: id, stage: { isClosed: false } } }));
  add('Active Projects', lost('project-owner'), () => tx.project.count({ where: { AND: [operationalProjectWhere], ownerId: id, status: { in: ['PLANNING','ACTIVE','ON_HOLD'] } } }));
  add('Open Sales Tasks', lost('general-task'), () => tx.task.count({ where: { AND: [operationalTaskWhere], assignedToId: id, supportCaseId: null, status: { in: ['OPEN','IN_PROGRESS'] } } }));
  add('Open Support Tasks', lost('support-task'), () => tx.task.count({ where: { AND: [operationalTaskWhere], assignedToId: id, supportCaseId: { not: null }, status: { in: ['OPEN','IN_PROGRESS'] } } }));
  add('Unresolved Support Cases', lost('support-case'), () => tx.supportCase.count({ where: { assignedToId: id, archivedAt: null, status: { notIn: ['RESOLVED','CLOSED'] } } }));
  add('Trade Show Sales assignments', lost('trade-show-sales'), () => tx.tradeShowLead.count({ where: { AND: [activeTradeShowLeadWhere], assignedSalesRepUserId: id } }));
  add('Trade Show Marketing ownership', lost('marketing-owner'), () => tx.tradeShow.count({ where: { AND: [activeTradeShowWhere(now)], marketingOwnerId: id } }));
  add('Price Exception follow-up', lost('pe-follow-up'), () => tx.priceException.count({ where: { AND: [activePeFollowUpWhere(now)], followUp: { ownerId: id } } }));
  add('Outstanding Demos', lost('demo-owner'), () => tx.demoRequest.count({ where: { AND: [activeDemoWhere], operationalOwnerId: id } }));
  add('Audiences', lost('audience-owner'), () => tx.marketingAudience.count({ where: { ownerId: id, archivedAt: null } }));
  const lostReportTypes = reportTypes.filter(type => canOwnReportType(before, type) && !canOwnReportType(after, type));
  if (lostReportTypes.length) counts.push(tx.reportDefinition.count({ where: { ownerId: id, archivedAt: null, reportType: { in: lostReportTypes } } }).then(count => ({ area: 'Saved Reports', count })));
  return (await Promise.all(counts)).filter(row => row.count > 0);
}
export function impactConfirmation(before: Actor, after: Actor, impact: UserImpact[]) {
  return createHash('sha256').update(JSON.stringify({ before, after, impact })).digest('hex');
}
export type UserHistoryAction = 'Name changed' | 'User created' | 'Role changed' | 'Status changed' | 'Email changed' | 'Timezone changed' | 'Delegation changed' | 'Identity reset';
export async function recordUserHistory(tx: Prisma.TransactionClient, actorId: number, targetId: number, action: UserHistoryAction, oldValue?: string, newValue?: string) {
  await tx.adminMaintenanceEvent.create({ data: { actorId, entityType: 'User', recordIds: [targetId], recordCount: 1, action, oldValue, newValue } });
}
