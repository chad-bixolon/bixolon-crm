import type { UserRole, Prisma, PrismaClient } from '@prisma/client';
import { cache } from 'react';
import { prisma } from './prisma';

/** Eligibility is a business population, independent of module write permissions.
 * Admin remains eligible for operational Tasks and Support work because existing
 * case handling and follow-up workflows explicitly use Admin assignees.
 */
export const eligibilityRoles = {
  'account-owner': ['SALES', 'SALES_MANAGER'],
  'opportunity-owner': ['SALES', 'SALES_MANAGER'],
  'project-owner': ['SALES', 'SALES_MANAGER'],
  'sales-plan-owner': ['SALES', 'SALES_MANAGER'],
  'general-task': ['ADMIN', 'SALES', 'SALES_MANAGER', 'MARKETING_MANAGER'],
  'support-task': ['ADMIN', 'SALES', 'SALES_MANAGER', 'MARKETING_MANAGER', 'SUPPORT', 'SUPPORT_MANAGER'],
  'support-case': ['ADMIN', 'SUPPORT', 'SUPPORT_MANAGER'],
  'trade-show-sales': ['SALES', 'SALES_MANAGER'],
  'marketing-owner': ['MARKETING_MANAGER'],
  'audience-owner': ['ADMIN', 'MARKETING_MANAGER'],
  'demo-owner': ['SALES', 'SALES_MANAGER'],
  'pe-follow-up': ['SALES', 'SALES_MANAGER'],
  'report-owner': ['ADMIN', 'SALES', 'SALES_MANAGER', 'MARKETING_MANAGER'],
} as const satisfies Record<string, readonly UserRole[]>;
export type Eligibility = keyof typeof eligibilityRoles;
export function eligibleUserWhere(policy: Eligibility): Prisma.UserWhereInput {
  return { active: true, archivedAt: null, role: { in: [...eligibilityRoles[policy]] } };
}
export function eligibleUser(user: { role: UserRole; active: boolean; archivedAt?: Date | null } | null, policy: Eligibility) {
  return !!user?.active && !user.archivedAt && (eligibilityRoles[policy] as readonly UserRole[]).includes(user.role);
}
export function taskAssigneePolicy(task: { supportCaseId?: number | null }): Eligibility {
  return task.supportCaseId ? 'support-task' : 'general-task';
}

export function defaultEligibleUserId<T extends { id: number }>(users: readonly T[], effectiveUserId: number, contextUserId?: number | null): number | null {
  if (contextUserId && users.some(user => user.id === contextUserId)) return contextUserId;
  return users.some(user => user.id === effectiveUserId) ? effectiveUserId : null;
}

// Forecast and named sales-rep assignments are scoped to the sales organization.
export function activeSalesRepWhere(): Prisma.UserWhereInput {
  return eligibleUserWhere('sales-plan-owner');
}

export function selectedSalesRepWhere(value?: string): Prisma.UserWhereInput | null {
  if (!value) return null;
  const id = /^\d+$/.test(value) ? Number(value) : 0;
  return { ...activeSalesRepWhere(), id: Number.isSafeInteger(id) && id > 0 ? id : 0 };
}

const salesRepSelection = { id: true, firstName: true, lastName: true } as const;
export function listSalesReps(client: Pick<PrismaClient, 'user'>) {
  return listEligibleUserOptions(client, 'sales-plan-owner');
}

type OptionOrder = 'last-first' | 'last-id' | 'last' | 'first';
const optionOrder = (order: OptionOrder) => order === 'last-first' ? [{ lastName: 'asc' as const }, { firstName: 'asc' as const }] : order === 'last-id' ? [{ lastName: 'asc' as const }, { id: 'asc' as const }] : order === 'first' ? [{ firstName: 'asc' as const }] : [{ lastName: 'asc' as const }];
// Several policy names intentionally describe the same Sales population.
const canonicalOptionPolicy = (policy: Eligibility): Eligibility =>
  (Object.keys(eligibilityRoles) as Eligibility[]).find(candidate => eligibilityRoles[candidate].join(',') === eligibilityRoles[policy].join(',')) ?? policy;
const requestEligibleOptions = cache((policy: Eligibility, order: OptionOrder) => prisma.user.findMany({ where: eligibleUserWhere(policy), select: salesRepSelection, orderBy: optionOrder(order) }));
/** Request-scoped only for the application singleton; test and transaction clients always read directly. */
export function listEligibleUserOptions(client: Pick<PrismaClient, 'user'>, policy: Eligibility, order: OptionOrder = 'last-first') {
  return client === prisma ? requestEligibleOptions(canonicalOptionPolicy(policy), order) : client.user.findMany({ where: eligibleUserWhere(policy), select: salesRepSelection, orderBy: optionOrder(order) });
}
