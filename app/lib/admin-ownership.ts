import { Prisma, type PrismaClient } from '@prisma/client';
import { assertAdmin } from './admin-maintenance';
import type { Actor } from './authorization';
import { operationalAccountWhere, operationalContactWhere, operationalOpportunityWhere, operationalProjectWhere, operationalTaskWhere } from './operational-where';
import { moduleForAuditEntity, type ModuleAvailability } from './module-policy';
import { activeDemoWhere, activePeFollowUpWhere, activeTradeShowLeadWhere, activeTradeShowWhere, unavailableUser } from './unavailable-work';
import { reportOwnerRoles, reportTypes } from './reporting';

export const ownershipTypes = ['Account', 'Contact', 'Opportunity', 'Project', 'Task', 'Support Case', 'Trade Show Lead', 'Trade Show', 'Demo', 'Price Exception Follow-up', 'Audience', 'Saved Report'] as const;
export type OwnershipType = typeof ownershipTypes[number];
export const adminPageSize = 25;
export function adminPage(raw?: string) { const n = Number(raw); return Number.isSafeInteger(n) && n > 0 ? Math.min(n, 100000) : 1; }
export function ownershipType(raw?: string) { return ownershipTypes.find(type => type === raw) ?? 'Account'; }
const invalidUser = unavailableUser;
export function ownershipModule(type: OwnershipType) {
  if (type === 'Trade Show' || type === 'Trade Show Lead') return 'TRADE_SHOWS' as const;
  if (type === 'Demo') return 'DEMOS' as const;
  if (type === 'Price Exception Follow-up') return 'PRICE_EXCEPTIONS' as const;
  if (type === 'Audience') return 'MARKETING' as const;
  if (type === 'Saved Report') return null;
  return moduleForAuditEntity(type);
}
// Null owners/assignees are allowed by the existing edit forms. Contacts inherit Account ownership.
export function ownershipWhere(type: OwnershipType, owner?: number, now = new Date()) {
  switch (type) {
    case 'Account': return { AND: [operationalAccountWhere], owner: { is: invalidUser('account-owner') }, ...(owner ? { ownerId: owner } : {}) } satisfies Prisma.AccountWhereInput;
    case 'Contact': return { AND: [operationalContactWhere], account: { is: { owner: { is: invalidUser('account-owner') }, ...(owner ? { ownerId: owner } : {}) } } } satisfies Prisma.ContactWhereInput;
    case 'Opportunity': return { AND: [operationalOpportunityWhere], stage: { isClosed: false }, owner: { is: invalidUser('opportunity-owner') }, ...(owner ? { ownerId: owner } : {}) } satisfies Prisma.OpportunityWhereInput;
    case 'Project': return { AND: [operationalProjectWhere], status: { in: ['PLANNING', 'ACTIVE', 'ON_HOLD'] }, owner: { is: invalidUser('project-owner') }, ...(owner ? { ownerId: owner } : {}) } satisfies Prisma.ProjectWhereInput;
    case 'Task': return { AND: [operationalTaskWhere], status: { in: ['OPEN', 'IN_PROGRESS'] }, OR: [{ supportCaseId: null, assignedTo: { is: invalidUser('general-task') } }, { supportCaseId: { not: null }, assignedTo: { is: invalidUser('support-task') } }], ...(owner ? { assignedToId: owner } : {}) } satisfies Prisma.TaskWhereInput;
    case 'Support Case': return { archivedAt: null, status: { notIn: ['CLOSED', 'RESOLVED'] }, assignedTo: { is: invalidUser('support-case') }, ...(owner ? { assignedToId: owner } : {}) } satisfies Prisma.SupportCaseWhereInput;
    case 'Trade Show Lead': return { AND: [activeTradeShowLeadWhere], assignedSalesRep: { is: invalidUser('trade-show-sales') }, ...(owner ? { assignedSalesRepUserId: owner } : {}) } satisfies Prisma.TradeShowLeadWhereInput;
    case 'Trade Show': return { AND: [activeTradeShowWhere(now)], marketingOwner: { is: invalidUser('marketing-owner') }, ...(owner ? { marketingOwnerId: owner } : {}) } satisfies Prisma.TradeShowWhereInput;
    case 'Demo': return { AND: [activeDemoWhere], ...(owner ? { operationalOwnerId: owner, operationalOwner: { is: invalidUser('demo-owner') } } : { OR: [{ operationalOwnerId: null }, { operationalOwner: { is: invalidUser('demo-owner') } }] }) } satisfies Prisma.DemoRequestWhereInput;
    case 'Price Exception Follow-up': return { AND: [activePeFollowUpWhere(now)], ...(owner ? { followUp: { ownerId: owner, owner: { is: invalidUser('pe-follow-up') } } } : { OR: [{ followUp: null }, { followUp: { ownerId: null } }, { followUp: { owner: { is: invalidUser('pe-follow-up') } } }] }) } satisfies Prisma.PriceExceptionWhereInput;
    case 'Audience': return { archivedAt: null, owner: { is: invalidUser('audience-owner') }, ...(owner ? { ownerId: owner } : {}) } satisfies Prisma.MarketingAudienceWhereInput;
    case 'Saved Report': return { archivedAt: null, OR: reportTypes.map(reportType => ({ reportType, owner: { is: { NOT: { active: true, archivedAt: null, role: { in: reportOwnerRoles(reportType) } } } } })), ...(owner ? { ownerId: owner } : {}) } satisfies Prisma.ReportDefinitionWhereInput;
  }
}
const userSelect = { id: true, firstName: true, lastName: true } as const;
function taskWhere(owner: number | undefined): Prisma.TaskWhereInput { return ownershipWhere('Task', owner) as Prisma.TaskWhereInput; }
export async function ownershipCounts(db: PrismaClient, actor: Actor, owner?: number, availability?: ModuleAvailability, now = new Date()) {
  assertAdmin(actor);
  void availability;
  const counts = await Promise.all(ownershipTypes.map(type => count(db, type, owner, now)));
  return Object.fromEntries(ownershipTypes.map((type, i) => [type, counts[i]])) as Record<OwnershipType, number>;
}
function count(db: PrismaClient, type: OwnershipType, owner: number | undefined, now: Date) {
  const where = ownershipWhere(type, owner, now);
  switch (type) {
    case 'Account': return db.account.count({ where: where as Prisma.AccountWhereInput });
    case 'Contact': return db.contact.count({ where: where as Prisma.ContactWhereInput });
    case 'Opportunity': return db.opportunity.count({ where: where as Prisma.OpportunityWhereInput });
    case 'Project': return db.project.count({ where: where as Prisma.ProjectWhereInput });
    case 'Task': return db.task.count({ where: taskWhere(owner) });
    case 'Support Case': return db.supportCase.count({ where: where as Prisma.SupportCaseWhereInput });
    case 'Trade Show Lead': return db.tradeShowLead.count({ where: where as Prisma.TradeShowLeadWhereInput });
    case 'Trade Show': return db.tradeShow.count({ where: where as Prisma.TradeShowWhereInput });
    case 'Demo': return db.demoRequest.count({ where: where as Prisma.DemoRequestWhereInput });
    case 'Price Exception Follow-up': return db.priceException.count({ where: where as Prisma.PriceExceptionWhereInput });
    case 'Audience': return db.marketingAudience.count({ where: where as Prisma.MarketingAudienceWhereInput });
    case 'Saved Report': return db.reportDefinition.count({ where: where as Prisma.ReportDefinitionWhereInput });
  }
}
export async function ownershipRows(db: PrismaClient, actor: Actor, type: OwnershipType, owner: number | undefined, page: number, availability?: ModuleAvailability, now = new Date()) {
  assertAdmin(actor);
  void availability;
  const where = ownershipWhere(type, owner, now), paging = { take: adminPageSize, skip: (page - 1) * adminPageSize, orderBy: { id: 'asc' as const } };
  const label = (user: { firstName: string; lastName: string } | null) => user ? `${user.firstName} ${user.lastName}` : 'Unavailable user';
  if (type === 'Contact') return (await db.contact.findMany({ where: where as Prisma.ContactWhereInput, ...paging, select: { id: true, firstName: true, lastName: true, updatedAt: true, accountId: true, account: { select: { owner: { select: userSelect } } } } })).map(row => ({ id: row.id, name: `${row.firstName} ${row.lastName}`, owner: label(row.account?.owner ?? null), href: `/contacts/${row.id}`, edit: `/accounts/${row.accountId}/edit`, updatedAt: row.updatedAt.toISOString() }));
  if (type === 'Task') return (await db.task.findMany({ where: taskWhere(owner), ...paging, select: { id: true, subject: true, updatedAt: true, assignedTo: { select: userSelect } } })).map(row => ({ id: row.id, name: row.subject, owner: label(row.assignedTo), href: `/tasks/${row.id}`, edit: `/tasks/${row.id}/edit`, updatedAt: row.updatedAt.toISOString() }));
  if (type === 'Support Case') return (await db.supportCase.findMany({ where: where as Prisma.SupportCaseWhereInput, ...paging, select: { id: true, caseNumber: true, subject: true, updatedAt: true, assignedTo: { select: userSelect } } })).map(row => ({ id: row.id, name: `${row.caseNumber}: ${row.subject}`, owner: label(row.assignedTo), href: `/support/cases/${row.id}`, edit: `/support/cases/${row.id}/edit`, updatedAt: row.updatedAt.toISOString() }));
  if (type === 'Trade Show Lead') return (await db.tradeShowLead.findMany({ where: where as Prisma.TradeShowLeadWhereInput, ...paging, select: { id: true, firstName: true, lastName: true, updatedAt: true, tradeShowId: true, assignedSalesRep: { select: userSelect } } })).map(row => ({ id: row.id, name: `${row.firstName} ${row.lastName}`, owner: label(row.assignedSalesRep), href: `/trade-shows/${row.tradeShowId}/leads/${row.id}`, edit: `/trade-shows/${row.tradeShowId}/leads/${row.id}/edit`, updatedAt: row.updatedAt.toISOString() }));
  if (type === 'Trade Show') return (await db.tradeShow.findMany({ where: where as Prisma.TradeShowWhereInput, ...paging, select: { id: true, name: true, updatedAt: true, marketingOwner: { select: userSelect } } })).map(row => ({ id: row.id, name: row.name, owner: label(row.marketingOwner), href: `/trade-shows/${row.id}`, edit: `/trade-shows/${row.id}/edit`, updatedAt: row.updatedAt.toISOString() }));
  if (type === 'Demo') return (await db.demoRequest.findMany({ where: where as Prisma.DemoRequestWhereInput, ...paging, select: { id: true, demoNumber: true, updatedAt: true, operationalOwner: { select: userSelect } } })).map(row => ({ id: row.id, name: row.demoNumber ?? `Demo #${row.id}`, owner: row.operationalOwner ? label(row.operationalOwner) : 'Unassigned', href: `/demos/${row.id}`, edit: `/demos/${row.id}`, updatedAt: row.updatedAt.toISOString() }));
  if (type === 'Price Exception Follow-up') return (await db.priceException.findMany({ where: where as Prisma.PriceExceptionWhereInput, ...paging, select: { id: true, peCode: true, updatedAt: true, followUp: { select: { updatedAt: true, owner: { select: userSelect } } } } })).map(row => ({ id: row.id, name: row.peCode ?? `Price Exception #${row.id}`, owner: row.followUp?.owner ? label(row.followUp.owner) : 'Unassigned', href: `/price-exceptions/${row.id}`, edit: `/price-exceptions/${row.id}`, updatedAt: (row.followUp?.updatedAt ?? row.updatedAt).toISOString() }));
  if (type === 'Audience') return (await db.marketingAudience.findMany({ where: where as Prisma.MarketingAudienceWhereInput, ...paging, select: { id: true, name: true, updatedAt: true, owner: { select: userSelect } } })).map(row => ({ id: row.id, name: row.name, owner: label(row.owner), href: `/marketing/audiences/${row.id}`, edit: `/marketing/audiences/${row.id}`, updatedAt: row.updatedAt.toISOString() }));
  if (type === 'Saved Report') return (await db.reportDefinition.findMany({ where: where as Prisma.ReportDefinitionWhereInput, ...paging, select: { id: true, name: true, updatedAt: true, owner: { select: userSelect } } })).map(row => ({ id: row.id, name: row.name, owner: label(row.owner), href: `/reports/${row.id}`, edit: `/reports/${row.id}`, updatedAt: row.updatedAt.toISOString() }));
  const select = { id: true, name: true, updatedAt: true, owner: { select: userSelect } } as const;
  const rows = type === 'Account' ? await db.account.findMany({ where: where as Prisma.AccountWhereInput, ...paging, select }) : type === 'Opportunity' ? await db.opportunity.findMany({ where: where as Prisma.OpportunityWhereInput, ...paging, select }) : await db.project.findMany({ where: where as Prisma.ProjectWhereInput, ...paging, select });
  const path = type === 'Account' ? 'accounts' : type === 'Opportunity' ? 'opportunities' : 'projects';
  return rows.map(row => ({ id: row.id, name: row.name, owner: label(row.owner), href: `/${path}/${row.id}`, edit: `/${path}/${row.id}/edit`, updatedAt: row.updatedAt.toISOString() }));
}
