import { isCaseOnlyWorker } from './authorization';
import { RecentEntityType, type Prisma, type PrismaClient } from '@prisma/client';
import { can, opportunityReadWhere, taskScope, type Actor } from './authorization';
import { operationalAccountWhere, operationalContactWhere, operationalOpportunityWhere, operationalProjectWhere, operationalTaskWhere, operationalActivityWhere } from './operational-where';
import { projectReadWhere } from './projects';
import { supportCaseReadWhere } from './support-cases';
import { scopedPriceExceptionWhere } from './price-exception-visibility';
import { formatEasternDateTime } from './display-format';

export const RECENT_HISTORY_LIMIT = 50;
export const RECENT_DISPLAY_LIMIT = 8;
export type RecentItemView = { key: string; entityLabel: string; label: string; href: string; lastViewedAt: string; viewedLabel: string };
type Db = PrismaClient | Prisma.TransactionClient;
export const recentEntityRoutes = {
  ACCOUNT: ['Account', '/accounts'], CONTACT: ['Contact', '/contacts'],
  OPPORTUNITY: ['Opportunity', '/opportunities'], PROJECT: ['Project', '/projects'],
  SUPPORT_CASE: ['Support Case', '/support/cases'], PRICE_EXCEPTION: ['Price Exception', '/price-exceptions'],
  TASK: ['Task', '/tasks'], ACTIVITY: ['Activity', '/activities'],
} as const;

export function isRecentEntityType(value: unknown): value is RecentEntityType {
  return typeof value === 'string' && Object.values(RecentEntityType).includes(value as RecentEntityType);
}

/** One bounded projection per populated type, with the destination's access and live-record filters. */
export async function resolveRecentTargets(db: Db, actor: Actor, type: RecentEntityType, ids: number[]): Promise<{ id: number; label: string }[]> {
  if (!ids.length || !actor.active || actor.archivedAt) return [];
  const id = { in: ids.slice(0, RECENT_HISTORY_LIMIT) };
  switch (type) {
    case 'ACCOUNT': return can(actor, 'accounts.read') ? (await db.account.findMany({ where: { AND: [{ id }, operationalAccountWhere] }, select: { id: true, name: true }, take: RECENT_HISTORY_LIMIT })).map(row => ({ id: row.id, label: row.name })) : [];
    case 'CONTACT': return can(actor, 'contacts.read') ? (await db.contact.findMany({ where: { AND: [{ id }, operationalContactWhere] }, select: { id: true, firstName: true, lastName: true }, take: RECENT_HISTORY_LIMIT })).map(row => ({ id: row.id, label: `${row.firstName} ${row.lastName}` })) : [];
    case 'OPPORTUNITY': return can(actor, 'opportunities.read') ? (await db.opportunity.findMany({ where: { AND: [{ id }, operationalOpportunityWhere, opportunityReadWhere(actor)] }, select: { id: true, name: true }, take: RECENT_HISTORY_LIMIT })).map(row => ({ id: row.id, label: row.name })) : [];
    case 'PROJECT': return can(actor, 'projects.read') ? (await db.project.findMany({ where: { AND: [{ id }, operationalProjectWhere, projectReadWhere(actor)] }, select: { id: true, name: true }, take: RECENT_HISTORY_LIMIT })).map(row => ({ id: row.id, label: row.name })) : [];
    case 'SUPPORT_CASE': return can(actor, 'support-cases.read') && can(actor, 'accounts.read') ? (await db.supportCase.findMany({ where: { AND: [{ id }, supportCaseReadWhere(actor)] }, select: { id: true, caseNumber: true, subject: true }, take: RECENT_HISTORY_LIMIT })).map(row => ({ id: row.id, label: `${row.caseNumber} · ${row.subject}` })) : [];
    case 'PRICE_EXCEPTION': return can(actor, 'pricing.read') ? (await db.priceException.findMany({ where: scopedPriceExceptionWhere(actor, { id, archivedAt: null }), select: { id: true, peCode: true }, take: RECENT_HISTORY_LIMIT })).map(row => ({ id: row.id, label: row.peCode ?? 'Unnumbered Price Exception' })) : [];
    case 'TASK': {
      const scope: Prisma.TaskWhereInput = isCaseOnlyWorker(actor) ? { supportCase: { is: supportCaseReadWhere(actor) } } : taskScope(actor);
      return can(actor, 'tasks.read') || isCaseOnlyWorker(actor) ? (await db.task.findMany({ where: { AND: [{ id }, operationalTaskWhere, scope] }, select: { id: true, subject: true }, take: RECENT_HISTORY_LIMIT })).map(row => ({ id: row.id, label: row.subject })) : [];
    }
    case 'ACTIVITY': return can(actor, 'tasks.read') ? (await db.activity.findMany({ where: { AND: [{ id }, operationalActivityWhere] }, select: { id: true, subject: true }, take: RECENT_HISTORY_LIMIT })).map(row => ({ id: row.id, label: row.subject })) : [];
  }
}

export async function recordRecentView(db: PrismaClient, actor: Actor, entityType: unknown, recordId: number) {
  if (!isRecentEntityType(entityType) || !Number.isSafeInteger(recordId) || recordId < 1 || !actor.active || actor.archivedAt) return;
  await db.$transaction(async tx => {
    // Serialize a user's touches across devices; the unique key and cap stay correct under concurrent requests.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.id} FOR UPDATE`;
    if (!(await resolveRecentTargets(tx, actor, entityType, [recordId])).length) return;
    const latest = await tx.recentItem.findFirst({ where: { userId: actor.id }, orderBy: [{ lastViewedAt: 'desc' }, { id: 'desc' }], select: { lastViewedAt: true } });
    // Keep a revisit first even when requests share a millisecond or an app host's clock drifts.
    const lastViewedAt = new Date(Math.max(Date.now(), (latest?.lastViewedAt.getTime() ?? 0) + 1));
    await tx.recentItem.upsert({
      where: { userId_entityType_recordId: { userId: actor.id, entityType, recordId } },
      create: { userId: actor.id, entityType, recordId, lastViewedAt },
      update: { lastViewedAt },
    });
    await tx.$executeRaw`DELETE FROM "RecentItem" WHERE "userId" = ${actor.id} AND "id" NOT IN
      (SELECT "id" FROM "RecentItem" WHERE "userId" = ${actor.id} ORDER BY "lastViewedAt" DESC, "id" DESC LIMIT ${RECENT_HISTORY_LIMIT})`;
  });
}

export async function listRecentItems(db: PrismaClient, actor: Actor): Promise<RecentItemView[]> {
  if (!actor.active || actor.archivedAt) return [];
  const history = await db.recentItem.findMany({ where: { userId: actor.id }, orderBy: [{ lastViewedAt: 'desc' }, { id: 'desc' }], take: RECENT_HISTORY_LIMIT, select: { entityType: true, recordId: true, lastViewedAt: true } });
  const types = [...new Set(history.map(row => row.entityType))];
  const labels = new Map<string, string>((await Promise.all(types.map(async type => (await resolveRecentTargets(db, actor, type, history.filter(row => row.entityType === type).map(row => row.recordId))).map(row => [`${type}:${row.id}`, row.label] as const)))).flat());
  return history.flatMap(row => {
    const key = `${row.entityType}:${row.recordId}`, label = labels.get(key);
    if (!label) return [];
    const [entityLabel, path] = recentEntityRoutes[row.entityType];
    return [{ key, entityLabel, label, href: `${path}/${row.recordId}`, lastViewedAt: row.lastViewedAt.toISOString(), viewedLabel: formatEasternDateTime(row.lastViewedAt) }];
  }).slice(0, RECENT_DISPLAY_LIMIT);
}
