import { Prisma, type PrismaClient, type TaskStatus } from '@prisma/client';
import { can, type Actor } from './authorization';
import { pageNumber, positiveId } from './crm-validation';
import { taskWhere } from './work';
import { actionableTradeShowLeadStatuses } from './trade-show-leads';

export type TradeShowQueueFilters = {
  view?: string; q?: string; status?: string; tradeShowId?: string; ownerId?: string;
  assignedToId?: string; mine?: string; taskStatus?: string; duePeriod?: string;
  dueFrom?: string; dueTo?: string; page?: string;
};
export function canViewTradeShowFollowUpQueue(actor: Actor) {
  return can(actor, 'trade-shows.read') && ['ADMIN', 'SALES_MANAGER', 'SALES', 'MARKETING_MANAGER'].includes(actor.role);
}

// The newest non-archived linked Task is the queue's current follow-up. Filtering
// happens AFTER that choice so an older completed Task cannot hide a newer one.
export function tradeShowQueueSql(actor: Actor, f: TradeShowQueueFilters, now = new Date()) {
  const conditions: Prisma.Sql[] = [Prisma.sql`s."archivedAt" IS NULL`];
  if (!canViewTradeShowFollowUpQueue(actor)) conditions.push(Prisma.sql`FALSE`);
  if (actor.role === 'SALES' || (actor.role !== 'MARKETING_MANAGER' && f.view !== 'all')) {
    conditions.push(Prisma.sql`l.routing = 'BIXOLON_SALES' AND l."assignedSalesRepUserId" = ${actor.id}`);
  } else if (actor.role !== 'MARKETING_MANAGER') {
    conditions.push(Prisma.sql`l.routing = 'BIXOLON_SALES' AND l."assignedSalesRepUserId" IS NOT NULL`);
  }
  const ownerId = positiveId(f.ownerId ?? ''), showId = positiveId(f.tradeShowId ?? '');
  if (ownerId) conditions.push(Prisma.sql`l."assignedSalesRepUserId" = ${ownerId}`);
  if (showId) conditions.push(Prisma.sql`l."tradeShowId" = ${showId}`);
  if (f.status !== 'all') {
    const statuses = ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'DISQUALIFIED'].includes(f.status ?? '') ? [f.status!] : actionableTradeShowLeadStatuses;
    conditions.push(Prisma.sql`l.status::text IN (${Prisma.join(statuses)})`);
  }
  if (f.q?.trim()) {
    // Literal substring search, consistent with Prisma's contains filters.
    const q = f.q.trim().slice(0, 120);
    conditions.push(Prisma.sql`(strpos(lower(concat_ws(' ', l."firstName", l."lastName", l."sourceCompany", l.email)), lower(${q})) > 0)`);
  }
  const assignee = f.mine === 'yes' ? actor.id : positiveId(f.assignedToId ?? '');
  if (assignee) conditions.push(Prisma.sql`t."assignedToId" = ${assignee}`);
  if (f.taskStatus === 'none') conditions.push(Prisma.sql`t.id IS NULL`);
  const status = f.taskStatus === 'completed' ? 'COMPLETED' : f.taskStatus === 'cancelled' ? 'CANCELLED' : undefined;
  // Reuse Task date parsing and rolling business-calendar boundaries.
  const task = taskWhere({ ...f, status }, now);
  if (f.taskStatus === 'open' || (task.dueDate && !status)) conditions.push(Prisma.sql`t.status IN ('OPEN', 'IN_PROGRESS')`);
  else if (status) conditions.push(Prisma.sql`t.status::text = ${status}`);
  const due = task.dueDate as { gte?: Date; lt?: Date } | undefined;
  if (due?.gte) conditions.push(Prisma.sql`t."dueDate" >= ${due.gte}`);
  if (due?.lt) conditions.push(Prisma.sql`t."dueDate" < ${due.lt}`);
  return Prisma.sql`FROM "TradeShowLead" l JOIN "TradeShow" s ON s.id = l."tradeShowId"
    LEFT JOIN LATERAL (SELECT id, status, "dueDate", "assignedToId" FROM "Task"
      WHERE "tradeShowLeadId" = l.id AND "archivedAt" IS NULL ORDER BY id DESC LIMIT 1) t ON TRUE
    WHERE ${Prisma.join(conditions, ' AND ')}`;
}

export const queueLeadSelect = {
  id: true, tradeShowId: true, firstName: true, lastName: true, sourceCompany: true,
  status: true, followUpAt: true, lastContactedAt: true,
  assignedSalesRep: { select: { firstName: true, lastName: true } },
  tradeShow: { select: { name: true } },
  account: { select: { id: true, name: true } }, contact: { select: { id: true, firstName: true, lastName: true } },
  convertedOpportunity: { select: { id: true, name: true } },
} satisfies Prisma.TradeShowLeadSelect;

export type QueueTask = { tradeShowLeadId: number; id: number; subject: string; status: TaskStatus; dueDate: Date | null; assignedTo: { firstName: string; lastName: string } | null };
export async function currentFollowUpTasks(db: Pick<Prisma.TransactionClient, '$queryRaw'>, leadIds: number[]) {
  if (!leadIds.length) return [];
  return db.$queryRaw<QueueTask[]>(Prisma.sql`SELECT l.id AS "tradeShowLeadId", t.id, t.subject, t.status, t."dueDate",
    CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object('firstName', u."firstName", 'lastName', u."lastName") END AS "assignedTo"
    FROM "TradeShowLead" l JOIN LATERAL (SELECT id, subject, status, "dueDate", "assignedToId" FROM "Task"
      WHERE "tradeShowLeadId" = l.id AND "archivedAt" IS NULL ORDER BY id DESC LIMIT 1) t ON TRUE
    LEFT JOIN "User" u ON u.id = t."assignedToId" WHERE l.id IN (${Prisma.join(leadIds)})`);
}

export async function loadTradeShowQueue(db: PrismaClient, actor: Actor, f: TradeShowQueueFilters, now = new Date()) {
  const sql = tradeShowQueueSql(actor, f, now);
  // Count, page IDs, and displayed Task share a snapshot under concurrent routing.
  return db.$transaction(async tx => {
    const [total] = await tx.$queryRaw<{ count: number }[]>(Prisma.sql`SELECT count(*)::int AS count ${sql}`);
    const { page, pages } = pageNumber(f.page, total.count);
    const ids = await tx.$queryRaw<{ id: number }[]>(Prisma.sql`SELECT l.id ${sql}
      ORDER BY l."followUpAt" ASC, l."updatedAt" DESC, l.id DESC LIMIT 20 OFFSET ${(page - 1) * 20}`);
    const rows = ids.length ? await tx.tradeShowLead.findMany({ where: { id: { in: ids.map(row => row.id) } }, select: queueLeadSelect }) : [];
    const tasks = await currentFollowUpTasks(tx, ids.map(row => row.id));
    return { count: total.count, page, pages, leads: ids.map(row => ({ ...rows.find(lead => lead.id === row.id)!, followUpTasks: tasks.filter(task => task.tradeShowLeadId === row.id) })) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
