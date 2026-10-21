import type { PrismaClient } from '@prisma/client';
import { can, type Actor } from './authorization';
import { operationalActivityWhere, operationalOpportunityWhere, operationalTaskWhere } from './operational-where';
import { accountProjectsWhere } from './projects';
import { accountPriceExceptionWhere } from './price-exceptions';
import { dayBounds } from './work';
import { detailPage } from './detail-pagination';
import { demoListSelect } from './demo-list-data';

export const accountTabs = ['Overview', 'Contacts', 'Support', 'Opportunities', 'Projects', 'Demos', 'Activity', 'Tasks', 'Notes', 'Documents'] as const;
export type AccountTab = typeof accountTabs[number];
export type AccountDetailParams = {
  tab?: string; page?: string; pePage?: string; tasksView?: string; activitiesView?: string;
  notesView?: string; documentsView?: string; demoContext?: string; saved?: string;
};
export function resolveAccountTab(raw: string | undefined, actor: Actor): AccountTab {
  const tab = accountTabs.find(tab => tab.toLowerCase() === (raw ?? 'Overview').toLowerCase()) ?? 'Overview';
  return actor.role === 'SUPPORT' && !['Overview', 'Contacts', 'Support'].includes(tab) ? 'Overview' : tab;
}
export function visibleAccountTabs(actor: Actor) {
  return accountTabs.filter(tab => (actor.role !== 'SUPPORT' || ['Overview', 'Contacts', 'Support'].includes(tab)) &&
    (tab !== 'Demos' || can(actor, 'sales.read')) && (tab !== 'Support' || can(actor, 'support-cases.read')));
}

/** Header and tab badges only. Never hydrate relationship lists for navigation. */
export async function loadAccountContext(db: PrismaClient, id: number, actor: Actor) {
  const account = await db.account.findUnique({ where: { id }, select: {
    id: true, name: true, status: true, archivedAt: true, strategicAccount: true,
    industry: true, territory: true, website: true, phone: true,
    addressLine1: true, addressLine2: true, city: true, stateProvince: true, postalCode: true, country: true,
    businessRoles: { select: { role: true } }, owner: { select: { firstName: true, lastName: true } },
    industryCategory: { select: { name: true } }, territoryCategory: { select: { name: true } },
    _count: { select: {
      contacts: { where: { archivedAt: null } },
      ...(actor.role !== 'SUPPORT' ? {
        opportunityMemberships: { where: { opportunity: operationalOpportunityWhere } },
        activities: { where: operationalActivityWhere }, tasks: { where: operationalTaskWhere }, notes: { where: { archivedAt: null } },
      } : {}),
      ...(can(actor, 'sales.read') ? { demoRequests: true } : {}),
    } },
  } });
  if (!account) return null;
  // Projects include archived history, as before; a primary/participant OR avoids double counting.
  const projects = actor.role !== 'SUPPORT' ? await db.project.count({ where: accountProjectsWhere(id, actor) }) : 0;
  return { account, counts: {
    Contacts: account._count.contacts, Opportunities: account._count.opportunityMemberships ?? 0,
    Projects: projects, Demos: account._count.demoRequests ?? 0,
    Activity: account._count.activities ?? 0, Tasks: account._count.tasks ?? 0, Notes: account._count.notes ?? 0,
  } };
}

/** Called only after resolving the tab and confirming the Account exists. */
export async function loadAccountTab(db: PrismaClient, id: number, actor: Actor, tab: AccountTab,
  params: AccountDetailParams, counts: Record<string, number>) {
  const overview = tab === 'Overview';
  const engagement = overview && actor.role !== 'SUPPORT';
  const pricing = overview && can(actor, 'pricing.read');
  const demoContext = ['linked', 'unlinked'].includes(params.demoContext ?? '') ? params.demoContext : '';
  const demoWhere = { accountId: id, ...(demoContext === 'linked' ? { OR: [{ projectId: { not: null } }, { opportunityId: { not: null } }] } : demoContext === 'unlinked' ? { projectId: null, opportunityId: null } : {}) };
  const [priceExceptionCount, filteredDemoCount] = await Promise.all([
    pricing ? db.priceException.count({ where: accountPriceExceptionWhere(id, actor) }) : 0,
    tab === 'Demos' && can(actor, 'sales.read') && demoContext ? db.demoRequest.count({ where: demoWhere }) : counts.Demos,
  ]);
  const pagination = detailPage(tab === 'Demos' ? filteredDemoCount : counts[tab] ?? 0, params.page);
  const pePagination = detailPage(priceExceptionCount, params.pePage);
  const bounds = { skip: pagination.skip, take: pagination.take };
  const [contacts, opportunities, projects, demos, primary, lastActivity, openTasks, overdueTasks, openOpportunities, odmSkus, priceExceptions] = await Promise.all([
    tab === 'Contacts' ? db.contact.findMany({ where: { accountId: id, archivedAt: null },
      select: { id: true, firstName: true, lastName: true, title: true, active: true, isPrimary: true },
      orderBy: [{ isPrimary: 'desc' }, { lastName: 'asc' }, { id: 'asc' }], ...bounds }) : [],
    tab === 'Opportunities' ? db.opportunityAccount.findMany({ where: { accountId: id, opportunity: operationalOpportunityWhere },
      select: { opportunityId: true, opportunity: { select: { name: true, stage: { select: { name: true } } } } },
      // The old membership list had no explicit sort; its key makes pages repeatable.
      orderBy: { opportunityId: 'asc' }, ...bounds }) : [],
    tab === 'Projects' ? db.project.findMany({ where: accountProjectsWhere(id, actor), select: {
      id: true, name: true, status: true, archivedAt: true, primaryAccountId: true, primaryAccountRole: true,
      participants: { where: { accountId: id }, select: { accountId: true, roles: { select: { role: true } } } },
    }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], ...bounds }) : [],
    tab === 'Demos' && can(actor, 'sales.read') ? db.demoRequest.findMany({ where: demoWhere, select: demoListSelect,
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }], ...bounds }) : [],
    engagement ? db.contact.findFirst({ where: { accountId: id, archivedAt: null, isPrimary: true },
      select: { id: true, firstName: true, lastName: true }, orderBy: [{ lastName: 'asc' }, { id: 'asc' }] }) : null,
    engagement ? db.activity.findFirst({ where: { accountId: id, AND: [operationalActivityWhere] },
      orderBy: [{ activityDate: 'desc' }, { id: 'desc' }], select: { activityDate: true } }) : null,
    engagement ? db.task.count({ where: { accountId: id, AND: [operationalTaskWhere], status: { in: ['OPEN', 'IN_PROGRESS'] } } }) : 0,
    engagement ? db.task.count({ where: { accountId: id, AND: [operationalTaskWhere], status: { in: ['OPEN', 'IN_PROGRESS'] }, dueDate: { lt: dayBounds().start } } }) : 0,
    engagement ? db.opportunityAccount.count({ where: { accountId: id, opportunity: { AND: [operationalOpportunityWhere], stage: { isClosed: false } } } }) : 0,
    overview ? db.productSku.findMany({ where: { catalogSource: 'ODM', odmCustomers: { some: { accountId: id } } },
      select: { id: true, partNumber: true, odmDescription: true, product: { select: { id: true, name: true, category: { select: { name: true } } } } },
      orderBy: { partNumber: 'asc' }, take: 20 }) : [],
    pricing ? db.priceException.findMany({ where: accountPriceExceptionWhere(id, actor), orderBy: [{ expirationDate: 'desc' }, { id: 'desc' }],
      select: { id: true, peCode: true, status: true, expirationDate: true, distributorAccountId: true, varAccountId: true, endUserAccountId: true, _count: { select: { lines: { where: { retiredAt: null } } } } },
      skip: pePagination.skip, take: pePagination.take }) : [],
  ]);
  return { contacts, opportunities, projects, demos, primary, lastActivity, openTasks, overdueTasks, openOpportunities,
    odmSkus, priceExceptions, priceExceptionCount, demoContext, pagination, pePagination };
}
