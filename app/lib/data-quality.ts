import { Prisma, type PrismaClient } from '@prisma/client';
import { BULK_SELECTION_LIMIT } from './bulk-action-contract';
import { eligibleUserWhere } from './assignment-eligibility';

export const qualityIssues = [
  { key: 'account-owner', label: 'Accounts without a sales owner', entity: 'Accounts', explanation: 'Active Accounts with no owner.' },
  { key: 'account-owner-inactive', label: 'Accounts assigned to unavailable owners', entity: 'Accounts', explanation: 'These Accounts are still assigned to users who can no longer manage them.' },
  { key: 'contact-account', label: 'Contacts without an Account', entity: 'Contacts', explanation: 'Active Contacts that are not linked to an Account.' },
  { key: 'contact-account-inactive', label: 'Contacts linked to an inactive Account', entity: 'Contacts', explanation: 'Active Contacts linked to an inactive or archived Account.' },
  { key: 'opportunity-owner', label: 'Open Opportunities without an owner', entity: 'Opportunities', explanation: 'Open Opportunities with no owner, or an inactive or archived owner.' },
  { key: 'opportunity-account', label: 'Open Opportunities without an Account', entity: 'Opportunities', explanation: 'Open Opportunities with no Accounts in their participant list. An older Account link by itself does not count.' },
  { key: 'opportunity-account-inactive', label: 'Open Opportunities linked to an inactive Account', entity: 'Opportunities', explanation: 'Open Opportunities with a participating Account that is inactive or archived.' },
  { key: 'opportunity-close', label: 'Open Opportunities without an expected close date', entity: 'Opportunities', explanation: 'Open Opportunities with no expected close date.' },
  { key: 'project-account', label: 'Projects without a primary Account', entity: 'Projects', explanation: 'Active Projects without a primary Account.' },
  { key: 'project-account-inactive', label: 'Projects linked to an inactive Account', entity: 'Projects', explanation: 'Active Projects whose primary Account is inactive or archived.' },
  { key: 'task-archived-link', label: 'Open Tasks linked to archived records', entity: 'Tasks', explanation: 'Open Tasks linked to an archived Account, Opportunity, Project, or Contact.' },
  { key: 'activity-archived-link', label: 'Activities linked to archived records', entity: 'Activities', explanation: 'Unarchived Activities linked to an archived Account, Opportunity, or Project.' },
  { key: 'duplicate-account', label: 'Possible duplicate Accounts', entity: 'Accounts', explanation: 'Active Accounts with the same name, ignoring capitalization and extra spaces.' },
  { key: 'duplicate-contact', label: 'Possible duplicate Contacts', entity: 'Contacts', explanation: 'Active Contacts with the same email address, ignoring capitalization and spaces at either end. Contacts without an email are excluded.' },
] as const;
export type QualityIssueKey = typeof qualityIssues[number]['key'];
export const qualityPageSize = 25;
export function qualityBulkSupported(key: string): key is 'account-owner' | 'account-owner-inactive' | 'opportunity-owner' { return key === 'account-owner' || key === 'account-owner-inactive' || key === 'opportunity-owner'; }
export function qualityPageSizeFor(key: QualityIssueKey) { return qualityBulkSupported(key) ? BULK_SELECTION_LIMIT : qualityPageSize; }
export function qualityIssue(key: string | undefined) { return qualityIssues.find(issue => issue.key === key); }
export function qualityPage(value: string | undefined) { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? Math.min(n, 100000) : 1; }

const activeAccount = { status: 'ACTIVE', archivedAt: null } as const;
const activeContact = { active: true, archivedAt: null } as const;
const openOpportunity = { archivedAt: null, stage: { isClosed: false } } as const;
const activeProject: Prisma.ProjectWhereInput = { archivedAt: null, status: { in: ['PLANNING', 'ACTIVE', 'ON_HOLD'] } };
const openTask: Prisma.TaskWhereInput = { archivedAt: null, status: { in: ['OPEN', 'IN_PROGRESS'] } };
const unavailableAccount: Prisma.AccountWhereInput = { OR: [{ status: { not: 'ACTIVE' } }, { archivedAt: { not: null } }] };
const archivedLink = { archivedAt: { not: null } } as const;

export function qualityWhere(key: QualityIssueKey): Prisma.AccountWhereInput | Prisma.ContactWhereInput | Prisma.OpportunityWhereInput | Prisma.ProjectWhereInput | Prisma.TaskWhereInput | Prisma.ActivityWhereInput | null {
  switch (key) {
    case 'account-owner': return { ...activeAccount, ownerId: null };
    case 'account-owner-inactive': return { ...activeAccount, owner: { is: { NOT: eligibleUserWhere('accounts.write') } } };
    case 'contact-account': return { ...activeContact, accountId: null };
    case 'contact-account-inactive': return { ...activeContact, account: unavailableAccount };
    case 'opportunity-owner': return { ...openOpportunity, OR: [{ ownerId: null }, { owner: { OR: [{ active: false }, { archivedAt: { not: null } }] } }] };
    case 'opportunity-account': return { ...openOpportunity, participants: { none: {} } };
    case 'opportunity-account-inactive': return { ...openOpportunity, participants: { some: { account: unavailableAccount } } };
    case 'opportunity-close': return { ...openOpportunity, expectedCloseDate: null };
    case 'project-account': return { ...activeProject, primaryAccountId: null };
    case 'project-account-inactive': return { ...activeProject, primaryAccount: unavailableAccount };
    case 'task-archived-link': return { ...openTask, OR: [{ account: archivedLink }, { opportunity: archivedLink }, { project: archivedLink }, { contact: archivedLink }] };
    case 'activity-archived-link': return { archivedAt: null, OR: [{ account: archivedLink }, { opportunity: archivedLink }, { project: archivedLink }] };
    default: return null;
  }
}

// Identical predicates drive both counts and the paged rows. These are review signals only.
const accountDuplicates = Prisma.sql`WITH candidates AS (SELECT id, name, NULL::text AS detail, count(*) OVER (PARTITION BY lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))) AS matches FROM "Account" WHERE status = 'ACTIVE' AND "archivedAt" IS NULL AND btrim(name) <> '') SELECT id, name, detail FROM candidates WHERE matches > 1`;
const contactDuplicates = Prisma.sql`WITH candidates AS (SELECT id, "firstName" || ' ' || "lastName" AS name, email AS detail, count(*) OVER (PARTITION BY lower(btrim(email))) AS matches FROM "Contact" WHERE active = true AND "archivedAt" IS NULL AND nullif(btrim(email), '') IS NOT NULL) SELECT id, name, detail FROM candidates WHERE matches > 1`;
type CountRow = { count: bigint };
type DuplicateRow = { id: number; name: string; detail: string | null };
async function duplicateCount(db: PrismaClient, contact: boolean) {
  const query = contact ? contactDuplicates : accountDuplicates;
  const result = await db.$queryRaw<CountRow[]>(Prisma.sql`SELECT count(*)::bigint AS count FROM (${query}) matches`);
  return Number(result[0]?.count ?? 0);
}
async function duplicateRows(db: PrismaClient, contact: boolean, q: string, skip: number) {
  const query = contact ? contactDuplicates : accountDuplicates;
  const search = q ? Prisma.sql`WHERE (name ILIKE ${'%' + q + '%'} OR detail ILIKE ${'%' + q + '%'})` : Prisma.empty;
  const rows = await db.$queryRaw<DuplicateRow[]>(Prisma.sql`SELECT id, name, detail FROM (${query}) matches ${search} ORDER BY id DESC LIMIT ${qualityPageSize} OFFSET ${skip}`);
  const count = q ? Number((await db.$queryRaw<CountRow[]>(Prisma.sql`SELECT count(*)::bigint AS count FROM (${query}) matches ${search}`))[0]?.count ?? 0) : await duplicateCount(db, contact);
  return { count, rows: rows.map(row => ({ ...row, href: contact ? `/contacts/${row.id}` : `/accounts/${row.id}` })) };
}

export async function qualityCounts(db: PrismaClient) {
  const counts = await Promise.all(qualityIssues.map(async issue => {
    const key = issue.key;
    if (key === 'duplicate-account' || key === 'duplicate-contact') return duplicateCount(db, key === 'duplicate-contact');
    const where = qualityWhere(key)!;
    if (key.startsWith('account-')) return db.account.count({ where: where as Prisma.AccountWhereInput });
    if (key.startsWith('contact-')) return db.contact.count({ where: where as Prisma.ContactWhereInput });
    if (key.startsWith('opportunity-')) return db.opportunity.count({ where: where as Prisma.OpportunityWhereInput });
    if (key.startsWith('project-')) return db.project.count({ where: where as Prisma.ProjectWhereInput });
    if (key.startsWith('task-')) return db.task.count({ where: where as Prisma.TaskWhereInput });
    return db.activity.count({ where: where as Prisma.ActivityWhereInput });
  }));
  return Object.fromEntries(qualityIssues.map((issue, index) => [issue.key, counts[index]])) as Record<QualityIssueKey, number>;
}

export type QualityRow = { id: number; name: string; detail: string | null; href: string; updatedAt?: string };
export async function qualityRows(db: PrismaClient, key: QualityIssueKey, q: string, page: number): Promise<{ count: number; rows: QualityRow[] }> {
  const pageSize = qualityPageSizeFor(key);
  const skip = (page - 1) * pageSize;
  if (key === 'duplicate-account' || key === 'duplicate-contact') return duplicateRows(db, key === 'duplicate-contact', q, skip);
  if (key.startsWith('account-')) {
    const where: Prisma.AccountWhereInput = { ...(qualityWhere(key) as Prisma.AccountWhereInput), ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) };
    const [count, rows] = await Promise.all([db.account.count({ where }), db.account.findMany({ where, select: { id: true, name: true, updatedAt: true, owner: { select: { firstName: true, lastName: true } } }, orderBy: { id: 'desc' }, skip, take: pageSize })]);
    return { count, rows: rows.map(row => ({ id: row.id, name: row.name, updatedAt: row.updatedAt.toISOString(), detail: row.owner ? `Owner: ${row.owner.firstName} ${row.owner.lastName}` : 'Unassigned', href: `/accounts/${row.id}` })) };
  }
  if (key.startsWith('contact-')) {
    const where: Prisma.ContactWhereInput = { ...(qualityWhere(key) as Prisma.ContactWhereInput), ...(q ? { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } : {}) };
    const [count, rows] = await Promise.all([db.contact.count({ where }), db.contact.findMany({ where, select: { id: true, firstName: true, lastName: true, account: { select: { name: true } } }, orderBy: { id: 'desc' }, skip, take: pageSize })]);
    return { count, rows: rows.map(row => ({ id: row.id, name: `${row.firstName} ${row.lastName}`, detail: row.account?.name ?? 'No Account', href: `/contacts/${row.id}` })) };
  }
  if (key.startsWith('opportunity-')) {
    const where: Prisma.OpportunityWhereInput = { ...(qualityWhere(key) as Prisma.OpportunityWhereInput), ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) };
    const [count, rows] = await Promise.all([db.opportunity.count({ where }), db.opportunity.findMany({ where, select: { id: true, name: true, updatedAt: true, stage: { select: { name: true } } }, orderBy: { id: 'desc' }, skip, take: pageSize })]);
    return { count, rows: rows.map(row => ({ id: row.id, name: row.name, updatedAt: row.updatedAt.toISOString(), detail: row.stage.name, href: `/opportunities/${row.id}` })) };
  }
  if (key.startsWith('project-')) {
    const where: Prisma.ProjectWhereInput = { ...(qualityWhere(key) as Prisma.ProjectWhereInput), ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) };
    const [count, rows] = await Promise.all([db.project.count({ where }), db.project.findMany({ where, select: { id: true, name: true, primaryAccount: { select: { name: true } } }, orderBy: { id: 'desc' }, skip, take: pageSize })]);
    return { count, rows: rows.map(row => ({ id: row.id, name: row.name, detail: row.primaryAccount?.name ?? 'No primary Account', href: `/projects/${row.id}` })) };
  }
  if (key.startsWith('task-')) {
    const where: Prisma.TaskWhereInput = { ...(qualityWhere(key) as Prisma.TaskWhereInput), ...(q ? { subject: { contains: q, mode: 'insensitive' } } : {}) };
    const [count, rows] = await Promise.all([db.task.count({ where }), db.task.findMany({ where, select: { id: true, subject: true }, orderBy: { id: 'desc' }, skip, take: pageSize })]);
    return { count, rows: rows.map(row => ({ id: row.id, name: row.subject, detail: 'Open Task', href: `/tasks/${row.id}` })) };
  }
  const where: Prisma.ActivityWhereInput = { ...(qualityWhere(key) as Prisma.ActivityWhereInput), ...(q ? { subject: { contains: q, mode: 'insensitive' } } : {}) };
  const [count, rows] = await Promise.all([db.activity.count({ where }), db.activity.findMany({ where, select: { id: true, subject: true }, orderBy: { id: 'desc' }, skip, take: pageSize })]);
  return { count, rows: rows.map(row => ({ id: row.id, name: row.subject, detail: 'Activity', href: `/activities/${row.id}/edit` })) };
}
