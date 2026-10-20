import type { Prisma } from '@prisma/client';
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
  return Promise.all(rows.map(async row => ({ id: row.id, name: row.name, isDefault: row.isDefault, ...await visibleSavedQuery(route, row.queryState, actor) })));
}

export async function setSavedViewDefault(userId: number, route: SavedViewRoute, id: number | null) {
  await prisma.$transaction(async tx => {
    await tx.savedView.updateMany({ where: { userId, routeKey: route, isDefault: true }, data: { isDefault: false } });
    if (id !== null) await tx.savedView.update({ where: { id, userId, routeKey: route }, data: { isDefault: true } });
  }, { isolationLevel: 'Serializable' });
}

export function savedStateForDb(query: SavedQuery): Prisma.InputJsonValue { return query; }
