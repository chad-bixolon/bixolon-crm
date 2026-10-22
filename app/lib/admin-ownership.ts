import { Prisma, type PrismaClient } from '@prisma/client';
import { assertAdmin } from './admin-maintenance';
import type { Actor } from './authorization';
import { eligibleUserWhere, type Eligibility } from './assignment-eligibility';
import { operationalAccountWhere, operationalContactWhere, operationalOpportunityWhere, operationalProjectWhere, operationalTaskWhere } from './operational-where';

export const ownershipTypes = ['Account', 'Contact', 'Opportunity', 'Project', 'Task', 'Support Case'] as const;
export type OwnershipType = typeof ownershipTypes[number];
export const adminPageSize = 25;
export function adminPage(raw?: string) { const n = Number(raw); return Number.isSafeInteger(n) && n > 0 ? Math.min(n, 100000) : 1; }
export function ownershipType(raw?: string) { return ownershipTypes.find(type => type === raw) ?? 'Account'; }
const invalidUser = (permission: Eligibility): Prisma.UserWhereInput => ({ NOT: eligibleUserWhere(permission) });
// Null owners/assignees are allowed by the existing edit forms. Contacts inherit Account ownership.
export function ownershipWhere(type: OwnershipType, owner?: number) {
  switch (type) {
    case 'Account': return { AND: [operationalAccountWhere], owner: { is: invalidUser('account-owner') }, ...(owner ? { ownerId: owner } : {}) } satisfies Prisma.AccountWhereInput;
    case 'Contact': return { AND: [operationalContactWhere], account: { is: { owner: { is: invalidUser('account-owner') }, ...(owner ? { ownerId: owner } : {}) } } } satisfies Prisma.ContactWhereInput;
    case 'Opportunity': return { AND: [operationalOpportunityWhere], stage: { isClosed: false }, owner: { is: invalidUser('opportunity-owner') }, ...(owner ? { ownerId: owner } : {}) } satisfies Prisma.OpportunityWhereInput;
    case 'Project': return { AND: [operationalProjectWhere], status: { in: ['PLANNING', 'ACTIVE', 'ON_HOLD'] }, owner: { is: invalidUser('project-owner') }, ...(owner ? { ownerId: owner } : {}) } satisfies Prisma.ProjectWhereInput;
    case 'Task': return { AND: [operationalTaskWhere], status: { in: ['OPEN', 'IN_PROGRESS'] }, OR: [{ supportCaseId: null, assignedTo: { is: invalidUser('general-task') } }, { supportCaseId: { not: null }, assignedTo: { is: invalidUser('support-task') } }], ...(owner ? { assignedToId: owner } : {}) } satisfies Prisma.TaskWhereInput;
    case 'Support Case': return { archivedAt: null, status: { notIn: ['CLOSED', 'RESOLVED'] }, assignedTo: { is: invalidUser('support-case') }, ...(owner ? { assignedToId: owner } : {}) } satisfies Prisma.SupportCaseWhereInput;
  }
}
const userSelect = { id: true, firstName: true, lastName: true } as const;
export async function ownershipCounts(db: PrismaClient, actor: Actor, owner?: number) {
  assertAdmin(actor);
  const counts = await Promise.all(ownershipTypes.map(type => count(db, type, owner)));
  return Object.fromEntries(ownershipTypes.map((type, i) => [type, counts[i]])) as Record<OwnershipType, number>;
}
function count(db: PrismaClient, type: OwnershipType, owner?: number) {
  const where = ownershipWhere(type, owner);
  switch (type) {
    case 'Account': return db.account.count({ where: where as Prisma.AccountWhereInput });
    case 'Contact': return db.contact.count({ where: where as Prisma.ContactWhereInput });
    case 'Opportunity': return db.opportunity.count({ where: where as Prisma.OpportunityWhereInput });
    case 'Project': return db.project.count({ where: where as Prisma.ProjectWhereInput });
    case 'Task': return db.task.count({ where: where as Prisma.TaskWhereInput });
    case 'Support Case': return db.supportCase.count({ where: where as Prisma.SupportCaseWhereInput });
  }
}
export async function ownershipRows(db: PrismaClient, actor: Actor, type: OwnershipType, owner: number | undefined, page: number) {
  assertAdmin(actor);
  const where = ownershipWhere(type, owner), paging = { take: adminPageSize, skip: (page - 1) * adminPageSize, orderBy: { id: 'asc' as const } };
  const label = (user: { firstName: string; lastName: string } | null) => user ? `${user.firstName} ${user.lastName}` : 'Unavailable user';
  if (type === 'Contact') return (await db.contact.findMany({ where: where as Prisma.ContactWhereInput, ...paging, select: { id: true, firstName: true, lastName: true, updatedAt: true, accountId: true, account: { select: { owner: { select: userSelect } } } } })).map(row => ({ id: row.id, name: `${row.firstName} ${row.lastName}`, owner: label(row.account?.owner ?? null), href: `/contacts/${row.id}`, edit: `/accounts/${row.accountId}/edit`, updatedAt: row.updatedAt.toISOString() }));
  if (type === 'Task') return (await db.task.findMany({ where: where as Prisma.TaskWhereInput, ...paging, select: { id: true, subject: true, updatedAt: true, assignedTo: { select: userSelect } } })).map(row => ({ id: row.id, name: row.subject, owner: label(row.assignedTo), href: `/tasks/${row.id}`, edit: `/tasks/${row.id}/edit`, updatedAt: row.updatedAt.toISOString() }));
  if (type === 'Support Case') return (await db.supportCase.findMany({ where: where as Prisma.SupportCaseWhereInput, ...paging, select: { id: true, caseNumber: true, subject: true, updatedAt: true, assignedTo: { select: userSelect } } })).map(row => ({ id: row.id, name: `${row.caseNumber}: ${row.subject}`, owner: label(row.assignedTo), href: `/support/cases/${row.id}`, edit: `/support/cases/${row.id}/edit`, updatedAt: row.updatedAt.toISOString() }));
  const select = { id: true, name: true, updatedAt: true, owner: { select: userSelect } } as const;
  const rows = type === 'Account' ? await db.account.findMany({ where: where as Prisma.AccountWhereInput, ...paging, select }) : type === 'Opportunity' ? await db.opportunity.findMany({ where: where as Prisma.OpportunityWhereInput, ...paging, select }) : await db.project.findMany({ where: where as Prisma.ProjectWhereInput, ...paging, select });
  const path = type === 'Account' ? 'accounts' : type === 'Opportunity' ? 'opportunities' : 'projects';
  return rows.map(row => ({ id: row.id, name: row.name, owner: label(row.owner), href: `/${path}/${row.id}`, edit: `/${path}/${row.id}/edit`, updatedAt: row.updatedAt.toISOString() }));
}
