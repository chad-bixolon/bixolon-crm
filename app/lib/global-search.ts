import type { PrismaClient } from '@prisma/client';
import { can, type Actor } from './authorization';
import { searchEntities, type EntityType } from './entity-search';
import { supportCaseReadWhere } from './support-cases';
import { moduleForPath, resolveModules, type ModuleAvailability } from './module-policy';

export type GlobalSearchResult = { group: string; label: string; context: string | null; href: string };
export const GLOBAL_SEARCH_GROUP_LIMIT = 6;
export const GLOBAL_SEARCH_TOTAL_LIMIT = 36;
const basic = [
  ['account', 'Accounts', '/accounts', 'accounts.read'],
  ['contact', 'Contacts', '/contacts', 'contacts.read'],
  ['opportunity', 'Opportunities', '/opportunities', 'opportunities.read'],
  ['project', 'Projects', '/projects', 'projects.read'],
] as const;

function rank(label: string, query: string) {
  const name = label.toLocaleLowerCase(), q = query.toLocaleLowerCase();
  return name === q ? 0 : name.startsWith(q) ? 1 : name.split(/\s+/).some(word => word.startsWith(q)) ? 2 : name.includes(q) ? 3 : 4;
}

export async function globalSearch(db: PrismaClient, actor: Actor, raw: string, availability: ModuleAvailability = resolveModules([])): Promise<GlobalSearchResult[]> {
  const query = raw.trim().slice(0, 100);
  if (query.length < 2) return [];
  const groups = await Promise.all(basic.map(async ([type, group, path, permission]) => can(actor, permission) && (!moduleForPath(path) || availability.effective.has(moduleForPath(path)!)) ? (await searchEntities(db, actor, type as EntityType, query, {}, GLOBAL_SEARCH_GROUP_LIMIT)).map(row => ({ group, label: row.name, context: row.context, href: `${path}/${row.id}` })) : []));
  const results: GlobalSearchResult[] = groups.flat();
  if (availability.effective.has('SUPPORT_CASES') && can(actor, 'support-cases.read') && can(actor, 'accounts.read')) {
    const scope = supportCaseReadWhere(actor);
    const filters = [
      { caseNumber: { equals: query, mode: 'insensitive' as const } },
      { OR: [{ caseNumber: { startsWith: query, mode: 'insensitive' as const } }, { subject: { startsWith: query, mode: 'insensitive' as const } }] },
      { OR: [{ caseNumber: { contains: query, mode: 'insensitive' as const } }, { subject: { contains: query, mode: 'insensitive' as const } }, { customerNameText: { contains: query, mode: 'insensitive' as const } }, { account: { name: { contains: query, mode: 'insensitive' as const } } }] },
    ];
    const batches = await Promise.all(filters.map(filter => db.supportCase.findMany({ where: { AND: [scope, filter] }, select: { id: true, caseNumber: true, subject: true, status: true, account: { select: { name: true } }, customerNameText: true }, orderBy: [{ caseNumber: 'asc' }, { id: 'asc' }], take: 30 })));
    const rows = [...new Map(batches.flat().map(row => [row.id, row])).values()];
    results.push(...rows.sort((a, b) => Math.min(rank(a.caseNumber, query), rank(a.subject, query)) - Math.min(rank(b.caseNumber, query), rank(b.subject, query)) || a.caseNumber.localeCompare(b.caseNumber)).slice(0, GLOBAL_SEARCH_GROUP_LIMIT).map(row => ({ group: 'Support Cases', label: `${row.caseNumber} · ${row.subject}`, context: `${row.account?.name ?? row.customerNameText ?? 'Unlinked customer'} · ${row.status.replaceAll('_', ' ')}`, href: `/support/cases/${row.id}` })));
  }
  if (availability.effective.has('PRODUCTS') && can(actor, 'products.read')) {
    const base = { active: true, product: { active: true, archivedAt: null } };
    const filters = [
      { partNumber: { equals: query, mode: 'insensitive' as const } },
      { OR: [{ partNumber: { startsWith: query, mode: 'insensitive' as const } }, { product: { name: { startsWith: query, mode: 'insensitive' as const } } }, { product: { sku: { startsWith: query, mode: 'insensitive' as const } } }] },
      { OR: [{ partNumber: { contains: query, mode: 'insensitive' as const } }, { product: { name: { contains: query, mode: 'insensitive' as const } } }, { product: { sku: { contains: query, mode: 'insensitive' as const } } }] },
    ];
    const batches = await Promise.all(filters.map(filter => db.productSku.findMany({ where: { AND: [base, filter] }, select: { id: true, partNumber: true, productId: true, product: { select: { name: true } } }, orderBy: [{ partNumber: 'asc' }, { id: 'asc' }], take: 30 })));
    const rows = [...new Map(batches.flat().map(row => [row.id, row])).values()];
    results.push(...rows.sort((a, b) => Math.min(rank(a.product.name, query), rank(a.partNumber, query)) - Math.min(rank(b.product.name, query), rank(b.partNumber, query)) || a.product.name.localeCompare(b.product.name) || a.id - b.id).slice(0, GLOBAL_SEARCH_GROUP_LIMIT).map(row => ({ group: 'Products', label: row.product.name, context: row.partNumber, href: `/products/${row.productId}` })));
  }
  return results.slice(0, GLOBAL_SEARCH_TOTAL_LIMIT);
}
