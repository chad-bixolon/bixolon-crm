import { Prisma, type PrismaClient } from '@prisma/client';
import { businessToday } from './price-exception-expiration';
import { attentionPredicates } from './forecast-attention';
import { getSettings } from './configuration';
import { operationalOpportunityWhere, operationalTaskWhere } from './operational-where';
import { eligibleUserWhere } from './assignment-eligibility';

type Db = PrismaClient | Prisma.TransactionClient;
type Candidate = { type: string; title: string; message: string; sourceKey: string };
const taskTypes = ['TASK_DUE_TODAY', 'TASK_OVERDUE'];
const opportunityTypes = ['OPP_CLOSE_DATE_OVERDUE', 'OPP_COMMIT_NO_ACTIVITY'];
const stamp = (date: Date) => date.toISOString().slice(0, 10);

export function taskNotificationCandidates(task: { id: number; subject: string; assignedToId: number | null; dueDate: Date | null; status: string; archivedAt: Date | null }, today: Date): Candidate[] {
  if (!task.assignedToId || !task.dueDate || task.archivedAt || !['OPEN', 'IN_PROGRESS'].includes(task.status)) return [];
  const due = stamp(task.dueDate), date = stamp(today);
  if (due === date) return [{ type: 'TASK_DUE_TODAY', title: 'Task due today', message: task.subject, sourceKey: `TASK:${task.id}:${task.assignedToId}:DUE_TODAY:${due}` }];
  if (due < date) return [{ type: 'TASK_OVERDUE', title: 'Task is overdue', message: task.subject, sourceKey: `TASK:${task.id}:${task.assignedToId}:OVERDUE:${due}` }];
  return [];
}

export function opportunityNotificationCandidates(opp: { id: number; name: string; ownerId: number | null; expectedCloseDate: Date | null; forecastCategory: string; archivedAt: Date | null; stage: { isClosed: boolean }; activities: { id: number; activityDate: Date }[]; historyEvents?: { id: number }[] }, today: Date, staleCommit: boolean): Candidate[] {
  if (!opp.ownerId || opp.archivedAt || opp.stage.isClosed) return [];
  const candidates: Candidate[] = [];
  if (opp.expectedCloseDate && stamp(opp.expectedCloseDate) < stamp(today)) candidates.push({ type: 'OPP_CLOSE_DATE_OVERDUE', title: 'Opportunity is past its expected close date', message: opp.name, sourceKey: `OPP:${opp.id}:${opp.ownerId}:CLOSE_DATE_OVERDUE:${stamp(opp.expectedCloseDate)}` });
  if (opp.forecastCategory === 'COMMIT' && staleCommit) candidates.push({ type: 'OPP_COMMIT_NO_ACTIVITY', title: 'Commit opportunity needs follow-up', message: opp.name, sourceKey: `OPP:${opp.id}:${opp.ownerId}:COMMIT_NO_ACTIVITY:${opp.historyEvents?.[0]?.id ?? 'BASE'}:${opp.activities[0] ? `${opp.activities[0].id}:${opp.activities[0].activityDate.toISOString()}` : 'NONE'}` });
  return candidates;
}

async function reconcile(db: Db, entityType: 'TASK' | 'OPPORTUNITY', entityId: number, userId: number | null, candidates: Candidate[], types: string[], now: Date) {
  const current = await db.notification.findMany({ where: { entityType, entityId, type: { in: types }, resolvedAt: null }, select: { id: true, sourceKey: true } });
  const keys = new Set(candidates.map(row => row.sourceKey));
  const obsolete = current.filter(row => !keys.has(row.sourceKey)).map(row => row.id);
  const resolved = obsolete.length ? (await db.notification.updateMany({ where: { id: { in: obsolete } }, data: { resolvedAt: now } })).count : 0;
  let created = 0;
  for (const candidate of candidates) created += (await db.notification.createMany({ data: [{ userId: userId!, type: candidate.type, severity: 'WARNING', title: candidate.title, message: candidate.message, entityType, entityId, actionUrl: entityType === 'TASK' ? `/tasks/${entityId}` : `/opportunities/${entityId}`, sourceKey: candidate.sourceKey }], skipDuplicates: true })).count;
  return { created, resolved };
}

export async function syncTaskNotifications(db: Db, taskId: number, now = new Date()) {
  const task = await db.task.findUnique({ where: { id: taskId }, select: { id: true, subject: true, assignedToId: true, dueDate: true, status: true, archivedAt: true } });
  if (!task) return { created: 0, resolved: 0 };
  const eligible = task.assignedToId ? await db.user.findFirst({ where: { id: task.assignedToId, ...eligibleUserWhere('tasks.write') }, select: { id: true } }) : null;
  const operational = await db.task.findFirst({ where: { id: taskId, AND: [operationalTaskWhere] }, select: { id: true } });
  return reconcile(db, 'TASK', taskId, eligible?.id ?? null, eligible && operational ? taskNotificationCandidates(task, businessToday(now)) : [], taskTypes, now);
}

export async function syncOpportunityNotifications(db: Db, opportunityId: number, days: number, now = new Date()) {
  const opp = await db.opportunity.findUnique({ where: { id: opportunityId }, select: { id: true, name: true, ownerId: true, expectedCloseDate: true, forecastCategory: true, archivedAt: true, stage: { select: { isClosed: true } }, activities: { where: { archivedAt: null }, orderBy: [{ activityDate: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, activityDate: true } }, historyEvents: { where: { newCategory: 'COMMIT', eventType: { in: ['BASELINE', 'FORECAST_CATEGORY'] } }, orderBy: { id: 'desc' }, take: 1, select: { id: true } } } });
  if (!opp) return { created: 0, resolved: 0 };
  const eligible = opp.ownerId ? await db.user.findFirst({ where: { id: opp.ownerId, ...eligibleUserWhere('sales.write') }, select: { id: true } }) : null;
  const operational = await db.opportunity.findFirst({ where: { id: opportunityId, AND: [operationalOpportunityWhere] }, select: { id: true } });
  // Use the Forecast Attention predicate verbatim, including its configured New York cutoff.
  const staleCommit = !!(eligible && operational && !opp.stage.isClosed && await db.opportunity.findFirst({ where: { id: opportunityId, AND: [attentionPredicates(now, days).STALE_COMMIT] }, select: { id: true } }));
  return reconcile(db, 'OPPORTUNITY', opportunityId, eligible?.id ?? null, eligible && operational ? opportunityNotificationCandidates(opp, businessToday(now), staleCommit) : [], opportunityTypes, now);
}

export async function notifyTaskAssignment(db: Db, taskId: number, userId: number, eventId: number) {
  const user = await db.user.findFirst({ where: { id: userId, ...eligibleUserWhere('tasks.write') }, select: { id: true } });
  if (!user) return;
  await db.notification.createMany({ data: [{ userId, type: 'TASK_ASSIGNED', severity: 'INFO', title: 'Task assigned to you', message: 'A Task was assigned to you.', entityType: 'TASK', entityId: taskId, actionUrl: `/tasks/${taskId}`, sourceKey: `TASK:${taskId}:${userId}:ASSIGNED:${eventId}` }], skipDuplicates: true });
}

export async function notifyOpportunityAssignment(db: Db, opportunityId: number, userId: number, eventId: number) {
  const user = await db.user.findFirst({ where: { id: userId, ...eligibleUserWhere('sales.write') }, select: { id: true } });
  if (!user) return;
  await db.notification.createMany({ data: [{ userId, type: 'OPP_ASSIGNED', severity: 'INFO', title: 'Opportunity assigned to you', message: 'An Opportunity was assigned to you.', entityType: 'OPPORTUNITY', entityId: opportunityId, actionUrl: `/opportunities/${opportunityId}`, sourceKey: `OPP:${opportunityId}:${userId}:ASSIGNED:${eventId}` }], skipDuplicates: true });
}

export async function evaluateWorkNotifications(db: PrismaClient, now = new Date()) {
  const days = (await getSettings(db)).COMMIT_FOLLOW_UP_DAYS;
  const result = { evaluated: { tasks: 0, opportunities: 0 }, created: { tasks: 0, opportunities: 0 }, resolved: { tasks: 0, opportunities: 0 } };
  let cursor = 0;
  while (true) {
    const rows = await db.task.findMany({ where: { id: { gt: cursor } }, orderBy: { id: 'asc' }, take: 200, select: { id: true } });
    if (!rows.length) break;
    for (const row of rows) { const count = await syncTaskNotifications(db, row.id, now); result.evaluated.tasks++; result.created.tasks += count.created; result.resolved.tasks += count.resolved; }
    cursor = rows.at(-1)!.id;
  }
  cursor = 0;
  while (true) {
    const rows = await db.opportunity.findMany({ where: { id: { gt: cursor } }, orderBy: { id: 'asc' }, take: 200, select: { id: true } });
    if (!rows.length) break;
    for (const row of rows) { const count = await syncOpportunityNotifications(db, row.id, days, now); result.evaluated.opportunities++; result.created.opportunities += count.created; result.resolved.opportunities += count.resolved; }
    cursor = rows.at(-1)!.id;
  }
  return result;
}
