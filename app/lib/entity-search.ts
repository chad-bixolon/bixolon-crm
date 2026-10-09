import { AccountBusinessRoleCode, Prisma, type PrismaClient } from '@prisma/client';
import { assertPermission, can, opportunityScope, type Actor } from './authorization';
import { operationalAccountWhere, operationalContactWhere, operationalOpportunityWhere, operationalProjectWhere } from './operational-where';
import { projectReadWhere } from './projects';

export type EntityType = 'account' | 'contact' | 'opportunity' | 'project';
export type EntitySearchResult = { id: number; name: string; context: string | null; address?: { addressLine1: string | null; addressLine2: string | null; city: string | null; stateProvince: string | null; postalCode: string | null; country: string | null }; firstName?: string; lastName?: string; email?: string | null; accountId?: number | null; accountIds?: number[]; projectIds?: number[]; opportunityIds?: number[] };
export type EntitySearchFilters = { accountId?: number; opportunityId?: number; projectId?: number; excludeProjectId?: number; openOnly?: boolean; projectStatus?: 'PLANNING' | 'ACTIVE'; partnerOnly?: boolean; includeUnassigned?: boolean; editableOnly?: boolean };
export const ENTITY_SEARCH_LIMIT = 25;

function rank(name: string, context: string | null, query: string) {
  const q = query.toLocaleLowerCase();
  const label = name.toLocaleLowerCase();
  if (label === q) return 0;
  if (label.startsWith(q)) return 1;
  if (label.split(/\s+/).some(word => word.startsWith(q))) return 2;
  if (label.includes(q)) return 3;
  return context?.toLocaleLowerCase().includes(q) ? 4 : 5;
}
function order<T extends EntitySearchResult>(rows: T[], query: string, limit: number): T[] {
  return [...new Map(rows.map(row => [row.id, row])).values()]
    .sort((a, b) => rank(a.name, a.context, query) - rank(b.name, b.context, query)
      || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id - b.id)
    .slice(0, limit);
}

/** Each tier is filtered in PostgreSQL and capped before labels reach Node. */
export async function searchEntities(db: PrismaClient, actor: Actor, entityType: EntityType, rawQuery: string, filters: EntitySearchFilters = {}, limit = ENTITY_SEARCH_LIMIT): Promise<EntitySearchResult[]> {
  const query = rawQuery.trim().slice(0, 100);
  if (query.length < 2) return [];
  const take = Math.min(ENTITY_SEARCH_LIMIT, Math.max(1, limit));
  const modes = ['equals', 'startsWith', 'contains'] as const;
  if (entityType === 'account') {
    assertPermission(actor, 'accounts.read');
    const base: Prisma.AccountWhereInput = { AND: [operationalAccountWhere, ...(filters.partnerOnly ? [{ businessRoles: { some: { role: { in: [AccountBusinessRoleCode.DISTRIBUTOR, AccountBusinessRoleCode.VAR, AccountBusinessRoleCode.ISV, AccountBusinessRoleCode.OEM, AccountBusinessRoleCode.PARTNER] } } } }] : [])] };
    const batches = await Promise.all(modes.map(mode => db.account.findMany({
      where: { AND: [base, { name: { [mode]: query, mode: 'insensitive' } }] },
      select: { id: true, name: true, addressLine1: true, addressLine2: true, city: true, stateProvince: true, postalCode: true, country: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take,
    })));
    return order(batches.flat().map(row => ({ id: row.id, name: row.name, context: [row.city, row.stateProvince].filter(Boolean).join(', ') || null, address: { addressLine1: row.addressLine1, addressLine2: row.addressLine2, city: row.city, stateProvince: row.stateProvince, postalCode: row.postalCode, country: row.country } })), query, take);
  }
  if (entityType === 'contact') {
    assertPermission(actor, 'contacts.read');
    const base: Prisma.ContactWhereInput = { AND: [operationalContactWhere, ...(filters.accountId ? [filters.includeUnassigned ? { OR: [{ accountId: filters.accountId }, { accountId: null }] } : { accountId: filters.accountId }] : [])] };
    const parts = query.split(/\s+/);
    const direct = (mode: 'equals' | 'startsWith') => db.contact.findMany({
      where: { AND: [base, { OR: [{ firstName: { [mode]: query, mode: 'insensitive' } }, { lastName: { [mode]: query, mode: 'insensitive' } }, ...(parts.length > 1 ? [{ AND: [{ firstName: { [mode]: parts[0], mode: 'insensitive' as const } }, { lastName: { [mode]: parts.slice(1).join(' '), mode: 'insensitive' as const } }] }] : [])] }] },
      select: { id: true, firstName: true, lastName: true, email: true, accountId: true, account: { select: { name: true } } }, orderBy: [{ lastName: 'asc' as const }, { firstName: 'asc' as const }, { id: 'asc' as const }], take,
    });
    const batches = await Promise.all([direct('equals'), direct('startsWith'), ...modes.map(mode => db.contact.findMany({
      where: { AND: [base, { OR: [{ firstName: { [mode]: query, mode: 'insensitive' } }, { lastName: { [mode]: query, mode: 'insensitive' } }, { email: { [mode]: query, mode: 'insensitive' } }, { account: { name: { [mode]: query, mode: 'insensitive' } } }, ...(query.includes(' ') ? [{ AND: [{ firstName: { startsWith: query.split(/\s+/)[0], mode: 'insensitive' as const } }, { lastName: { startsWith: query.split(/\s+/).at(-1)!, mode: 'insensitive' as const } }] }] : [])] }] },
      select: { id: true, firstName: true, lastName: true, email: true, accountId: true, account: { select: { name: true } } }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }], take,
    }))]);
    return order(batches.flat().map(row => ({ id: row.id, name: `${row.firstName} ${row.lastName}`, context: [row.account?.name, row.email].filter(Boolean).join(' · ') || null, firstName: row.firstName, lastName: row.lastName, email: row.email, accountId: row.accountId })), query, take);
  }
  if (entityType === 'opportunity') {
    assertPermission(actor, 'opportunities.read');
    const base: Prisma.OpportunityWhereInput = { AND: [operationalOpportunityWhere, opportunityScope(actor), ...(filters.accountId ? [{ participants: { some: { accountId: filters.accountId } } }] : []), ...(filters.projectId ? [{ projects: { some: { projectId: filters.projectId } } }] : []), ...(filters.excludeProjectId ? [{ projects: { none: { projectId: filters.excludeProjectId } } }] : []), ...(filters.openOnly ? [{ stage: { isClosed: false } }] : [])] };
    const batches = await Promise.all([...(['equals', 'startsWith'] as const).map(mode => db.opportunity.findMany({
      where: { AND: [base, { name: { [mode]: query, mode: 'insensitive' } }] },
      select: { id: true, name: true, participants: { select: { accountId: true, account: { select: { name: true } } }, take: 10, orderBy: { account: { name: 'asc' as const } } }, projects: { select: { projectId: true }, take: 20 } }, orderBy: [{ name: 'asc' as const }, { id: 'asc' as const }], take,
    })), ...modes.map(mode => db.opportunity.findMany({
      where: { AND: [base, { OR: [{ name: { [mode]: query, mode: 'insensitive' } }, { participants: { some: { account: { name: { [mode]: query, mode: 'insensitive' } } } } }] }] },
      select: { id: true, name: true, participants: { select: { accountId: true, account: { select: { name: true } } }, take: 10, orderBy: { account: { name: 'asc' } } }, projects: { select: { projectId: true }, take: 20 } }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take,
    }))]);
    return order(batches.flat().map(row => ({ id: row.id, name: row.name, context: row.participants.slice(0, 2).map(link => link.account.name).join(' · ') || null, accountIds: row.participants.map(link => link.accountId), projectIds: row.projects.map(link => link.projectId) })), query, take);
  }
  assertPermission(actor, 'projects.read');
  const base: Prisma.ProjectWhereInput = { AND: [operationalProjectWhere, projectReadWhere(actor), ...(filters.editableOnly ? [can(actor, 'projects.write') ? actor.role === 'SALES' ? { OR: [{ ownerId: actor.id }, { primaryAccount: { ownerId: actor.id } }] } : {} : { id: -1 }] : []), ...(filters.accountId ? [{ OR: [{ primaryAccountId: filters.accountId }, { participants: { some: { accountId: filters.accountId } } }] }] : []), ...(filters.opportunityId ? [{ opportunities: { some: { opportunityId: filters.opportunityId } } }] : []), ...(filters.projectStatus ? [{ status: filters.projectStatus }] : [])] };
  const batches = await Promise.all([...(['equals', 'startsWith'] as const).map(mode => db.project.findMany({
    where: { AND: [base, { name: { [mode]: query, mode: 'insensitive' } }] },
    select: { id: true, name: true, primaryAccountId: true, primaryAccount: { select: { name: true } }, participants: { select: { accountId: true, account: { select: { name: true } } }, take: 10, orderBy: { account: { name: 'asc' as const } } }, opportunities: { select: { opportunityId: true }, take: 20 } }, orderBy: [{ name: 'asc' as const }, { id: 'asc' as const }], take,
  })), ...modes.map(mode => db.project.findMany({
    where: { AND: [base, { OR: [{ name: { [mode]: query, mode: 'insensitive' } }, { primaryAccount: { name: { [mode]: query, mode: 'insensitive' } } }, { participants: { some: { account: { name: { [mode]: query, mode: 'insensitive' } } } } }] }] },
    select: { id: true, name: true, primaryAccountId: true, primaryAccount: { select: { name: true } }, participants: { select: { accountId: true, account: { select: { name: true } } }, take: 10, orderBy: { account: { name: 'asc' } } }, opportunities: { select: { opportunityId: true }, take: 20 } }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take,
  }))]);
  return order(batches.flat().map(row => ({ id: row.id, name: row.name, context: row.primaryAccount?.name ?? row.participants[0]?.account.name ?? null, accountIds: [...(row.primaryAccountId ? [row.primaryAccountId] : []), ...row.participants.map(link => link.accountId)], opportunityIds: row.opportunities.map(link => link.opportunityId) })), query, take);
}
