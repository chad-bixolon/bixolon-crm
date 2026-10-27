import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from './prisma';
import { projectReadWhere } from './projects';
import { opportunityReadWhere } from './authorization';
import type { Actor } from './authorization';
import { normalizeSavedQuery, type SavedQuery, type SavedViewRoute } from './saved-views';

export async function visibleSavedQuery(route: SavedViewRoute, state: unknown, actor: Actor) {
  const query = normalizeSavedQuery(route, state);
  const omitted: string[] = [];
  if (query.accountId && /^\d+$/.test(query.accountId)) {
    const account = await prisma.account.findFirst({ where: { id: Number(query.accountId), archivedAt: null }, select: { id: true } });
    if (!account) { delete query.accountId; omitted.push('Account'); }
  }
  if (query.tradeShowId) {
    const show = await prisma.tradeShow.findFirst({ where: { id: Number(query.tradeShowId), archivedAt: null }, select: { id: true } });
    if (!show) { delete query.tradeShowId; omitted.push('Trade Show'); }
  }
  if (query.projectId && /^\d+$/.test(query.projectId)) {
    const project = await prisma.project.findFirst({ where: { AND: [{ id: Number(query.projectId) }, projectReadWhere(actor)] }, select: { id: true } });
    if (!project) { delete query.projectId; omitted.push('Project'); }
  }
  for (const key of ['ownerId', 'assignedToId', 'salesRepId'] as const) {
    if (!query[key]) continue;
    const user = await prisma.user.findFirst({ where: { id: Number(query[key]), active: true, archivedAt: null }, select: { id: true } });
    if (!user) { delete query[key]; omitted.push('Owner'); }
  }
  if (query.stageId) {
    const stage = await prisma.salesStage.findFirst({ where: { id: Number(query.stageId), active: true }, select: { id: true } });
    if (!stage) { delete query.stageId; omitted.push('Stage'); }
  }
  if (query.competitorId) {
    const competitor = await prisma.competitorOption.findFirst({ where: { id: Number(query.competitorId), active: true }, select: { id: true } });
    if (!competitor) { delete query.competitorId; omitted.push('Competitor'); }
  }
  if (query.categoryId) {
    const category = await prisma.supportCaseCategory.findFirst({ where: { id: Number(query.categoryId), active: true }, select: { id: true } });
    if (!category) { delete query.categoryId; omitted.push('Category'); }
  }
  if (query.opportunityId && /^\d+$/.test(query.opportunityId)) {
    const opportunity = await prisma.opportunity.findFirst({ where: { id: Number(query.opportunityId), archivedAt: null, ...opportunityReadWhere(actor) }, select: { id: true } });
    if (!opportunity) { delete query.opportunityId; omitted.push('Opportunity'); }
  }
  return { query, omitted };
}

export async function listSavedViews(route: SavedViewRoute, actor: Actor) {
  const rows = await prisma.savedView.findMany({ where: { userId: actor.id, routeKey: route }, orderBy: [{ name: 'asc' }], select: { id: true, name: true, queryState: true, isDefault: true } });
  return validateSavedViewRows(prisma, route, actor, rows);
}

type ViewRow = { id: number; name: string; isDefault: boolean; queryState: unknown };

/** Validate all references under the same read policy as visibleSavedQuery, with at most one read per referenced model. */
export async function validateSavedViewRows(client: PrismaClient, route: SavedViewRoute, actor: Actor, rows: ViewRow[]) {
  const queries = rows.map(row => normalizeSavedQuery(route, row.queryState));
  const ids = (key: keyof SavedQuery) => [...new Set(queries.map(query => Number(query[key])).filter(id => Number.isSafeInteger(id) && id > 0))];
  const [accounts, shows, projects, users, stages, competitors, categories, opportunities] = await Promise.all([
    ids('accountId').length ? client.account.findMany({ where: { id: { in: ids('accountId') }, archivedAt: null }, select: { id: true } }) : [],
    ids('tradeShowId').length ? client.tradeShow.findMany({ where: { id: { in: ids('tradeShowId') }, archivedAt: null }, select: { id: true } }) : [],
    ids('projectId').length ? client.project.findMany({ where: { AND: [{ id: { in: ids('projectId') } }, projectReadWhere(actor)] }, select: { id: true } }) : [],
    [...ids('ownerId'), ...ids('assignedToId'), ...ids('salesRepId')].length ? client.user.findMany({ where: { id: { in: [...new Set([...ids('ownerId'), ...ids('assignedToId'), ...ids('salesRepId')])] }, active: true, archivedAt: null }, select: { id: true } }) : [],
    ids('stageId').length ? client.salesStage.findMany({ where: { id: { in: ids('stageId') }, active: true }, select: { id: true } }) : [],
    ids('competitorId').length ? client.competitorOption.findMany({ where: { id: { in: ids('competitorId') }, active: true }, select: { id: true } }) : [],
    ids('categoryId').length ? client.supportCaseCategory.findMany({ where: { id: { in: ids('categoryId') }, active: true }, select: { id: true } }) : [],
    ids('opportunityId').length ? client.opportunity.findMany({ where: { id: { in: ids('opportunityId') }, archivedAt: null, ...opportunityReadWhere(actor) }, select: { id: true } }) : [],
  ]);
  const available = {
    accountId: new Set(accounts.map(row => row.id)), tradeShowId: new Set(shows.map(row => row.id)),
    projectId: new Set(projects.map(row => row.id)), ownerId: new Set(users.map(row => row.id)),
    assignedToId: new Set(users.map(row => row.id)), salesRepId: new Set(users.map(row => row.id)),
    stageId: new Set(stages.map(row => row.id)), competitorId: new Set(competitors.map(row => row.id)),
    categoryId: new Set(categories.map(row => row.id)), opportunityId: new Set(opportunities.map(row => row.id)),
  };
  const labels = { accountId: 'Account', tradeShowId: 'Trade Show', projectId: 'Project', ownerId: 'Owner', assignedToId: 'Owner', salesRepId: 'Owner', stageId: 'Stage', competitorId: 'Competitor', categoryId: 'Category', opportunityId: 'Opportunity' } as const;
  return rows.map((row, index) => {
    const query = queries[index], omitted: string[] = [];
    for (const key of Object.keys(labels) as (keyof typeof labels)[]) {
      if (!query[key]) continue;
      // These two documented sentinel filters are meaningful without a linked record.
      if ((key === 'accountId' || key === 'projectId') && !/^\d+$/.test(query[key])) continue;
      if (!available[key].has(Number(query[key]))) { delete query[key]; omitted.push(labels[key]); }
    }
    return { id: row.id, name: row.name, isDefault: row.isDefault, query, omitted };
  });
}

export async function setSavedViewDefault(userId: number, route: SavedViewRoute, id: number | null) {
  await prisma.$transaction(async tx => {
    await tx.savedView.updateMany({ where: { userId, routeKey: route, isDefault: true }, data: { isDefault: false } });
    if (id !== null) await tx.savedView.update({ where: { id, userId, routeKey: route }, data: { isDefault: true } });
  }, { isolationLevel: 'Serializable' });
}

export function savedStateForDb(query: SavedQuery): Prisma.InputJsonValue { return query; }
