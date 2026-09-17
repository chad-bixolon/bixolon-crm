import { Prisma, TaskPriority, TaskStatus, type PrismaClient } from '@prisma/client';
import { field, optional, positiveId, required, type Errors } from './crm-validation';
import { archivedWhere, recordVisibility } from './record-visibility';
export const taskStatuses = Object.values(TaskStatus);
export const taskPriorities = Object.values(TaskPriority);
export function dateField(raw: string, key: string, errors: Errors) {
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) { errors[key] = 'Choose a valid date.'; return null; }
  const date = new Date(`${raw}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) { errors[key] = 'Choose a valid date.'; return null; }
  return date;
}
function relation(form: FormData, key: string, errors: Errors) { const raw = field(form, key); const id = raw ? positiveId(raw) : null; if (raw && !id) errors[key] = 'Choose a valid record.'; return id; }
export function parseTask(form: FormData) {
  const errors: Errors = {}; const subject = required(form, 'subject', 'Subject', 200, errors);
  const description = optional(form, 'description', 5000, errors);
  const accountId = relation(form, 'accountId', errors), opportunityId = relation(form, 'opportunityId', errors), assignedToId = relation(form, 'assignedToId', errors);
  const status = field(form, 'status') as TaskStatus, priority = field(form, 'priority') as TaskPriority;
  if (!taskStatuses.includes(status)) errors.status = 'Choose a status.';
  if (!taskPriorities.includes(priority)) errors.priority = 'Choose a priority.';
  const dueDate = dateField(field(form, 'dueDate'), 'dueDate', errors);
  return { errors, value: Object.keys(errors).length ? undefined : { subject, description, accountId, opportunityId, assignedToId, status, priority, dueDate } };
}
export type TaskInput = NonNullable<ReturnType<typeof parseTask>['value']>;
export async function checkRelations(client: PrismaClient | Prisma.TransactionClient, accountId: number | null, opportunityId: number | null) {
  if (accountId && !(await client.account.findFirst({ where: { id: accountId, archivedAt: null } }))) throw new Error('Account not found or archived.');
  if (opportunityId && !(await client.opportunity.findFirst({ where: { id: opportunityId, archivedAt: null } }))) throw new Error('Opportunity not found or archived.');
  if (accountId && opportunityId && !(await client.opportunityAccount.findUnique({ where: { opportunityId_accountId: { opportunityId, accountId } } }))) throw new Error('Account is not a participant in this opportunity.');
}
export async function saveTask(
  client: PrismaClient,
  value: TaskInput,
  id?: number,
  createKey?: string,
  actorId?: number,
) {
  if (!id && createKey) {
    const existing = await client.task.findUnique({ where: { createKey } });
    if (existing) return existing;
  }
  try { return await client.$transaction(async tx => {
    await checkRelations(tx, value.accountId, value.opportunityId);
    if (value.assignedToId && !(await tx.user.findFirst({ where: { id: value.assignedToId, active: true, archivedAt: null } }))) throw new Error('Choose an active assignee.');
    const existing = id ? await tx.task.findUnique({ where: { id } }) : null;
    if (id && (!existing || existing.archivedAt)) throw new Error('Task not found or archived.');
    const completedAt = value.status === 'COMPLETED' ? existing?.completedAt ?? new Date() : null;
   const data = {
  ...value,
  completedAt,
  ...(!id && createKey ? { createKey } : {}),
  ...(actorId
    ? {
        updatedById: actorId,
        ...(!id ? { createdById: actorId } : {}),
      }
    : {}),
};
    return id ? tx.task.update({ where: { id }, data }) : tx.task.create({ data });
  }); } catch (error) {
    // A concurrent request may have won the unique-key race.
    if (!id && createKey && typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      const existing = await client.task.findUnique({ where: { createKey } });
      if (existing) return existing;
    }
    throw error;
  }
}
export type TaskFilters = { q?: string; status?: string; priority?: string; assignedToId?: string; accountId?: string; opportunityId?: string; dueFrom?: string; dueTo?: string; visibility?: string };
export function taskWhere(f: TaskFilters): Prisma.TaskWhereInput {
  const where: Prisma.TaskWhereInput = { ...archivedWhere(recordVisibility(f.visibility)) };
  if (f.q?.trim()) where.OR = [{ subject: { contains: f.q.trim().slice(0, 100), mode: 'insensitive' } }, { description: { contains: f.q.trim().slice(0, 100), mode: 'insensitive' } }];
  if (taskStatuses.includes(f.status as TaskStatus)) where.status = f.status as TaskStatus;
  if (taskPriorities.includes(f.priority as TaskPriority)) where.priority = f.priority as TaskPriority;
  for (const key of ['assignedToId', 'accountId', 'opportunityId'] as const) { const id = positiveId(f[key] ?? ''); if (id) where[key] = id; }
  const errors: Errors = {}; const from = dateField(f.dueFrom ?? '', 'dueFrom', errors), to = dateField(f.dueTo ?? '', 'dueTo', errors);
  if (from || to) where.dueDate = { ...(from ? { gte: new Date(`${f.dueFrom}T00:00:00Z`) } : {}), ...(to ? { lt: new Date(new Date(`${f.dueTo}T00:00:00Z`).getTime() + 86400000) } : {}) };
  return where;
}
export function dashboardOpenTaskWhere(): Prisma.TaskWhereInput {
  return { archivedAt: null, status: { in: ['OPEN', 'IN_PROGRESS'] } };
}
export function dayBounds(now = new Date()) { const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now); const read = (type: string) => Number(parts.find(p => p.type === type)?.value); const start = new Date(Date.UTC(read('year'), read('month') - 1, read('day'))); return { start, end: new Date(start.getTime() + 86400000) }; }
export function taskTiming(task: { status: TaskStatus; dueDate: Date | null }, now = new Date()) { if (!task.dueDate || !['OPEN','IN_PROGRESS'].includes(task.status)) return null; const { start, end } = dayBounds(now); return task.dueDate < start ? 'Overdue' : task.dueDate < end ? 'Due today' : null; }
export function parseActivity(form: FormData) {
  const errors: Errors = {}; const subject = required(form, 'subject', 'Subject', 200, errors), description = optional(form, 'description', 5000, errors);
  const accountId = relation(form, 'accountId', errors), opportunityId = relation(form, 'opportunityId', errors), userId = relation(form, 'userId', errors);
  if (!accountId && !opportunityId) errors.accountId = 'Choose an account or opportunity.';
  const type = required(form, 'type', 'Activity type', 100, errors);
  const activityDate = dateField(field(form, 'activityDate'), 'activityDate', errors);
  if (!activityDate) errors.activityDate = 'Choose an activity date.';
  return { errors, value: Object.keys(errors).length ? undefined : { subject, description, accountId, opportunityId, userId, type, activityDate: activityDate! } };
}
export async function saveActivity(client: PrismaClient, value: NonNullable<ReturnType<typeof parseActivity>['value']>, id?: number) {
  return client.$transaction(async tx => {
    await checkRelations(tx, value.accountId, value.opportunityId);
    if (!(await tx.activityType.findFirst({ where: { code: value.type, active: true } }))) throw new Error('Choose an active activity type.');
    if (value.userId && !(await tx.user.findFirst({ where: { id: value.userId, active: true, archivedAt: null } }))) throw new Error('Choose an active responsible user.');
    if (id && !(await tx.activity.findFirst({ where: { id, archivedAt: null } }))) throw new Error('Activity not found or archived.');
    return id ? tx.activity.update({ where: { id }, data: value }) : tx.activity.create({ data: value });
  });
}
export function parseNote(form: FormData) {
  const errors: Errors = {}; const body = required(form, 'body', 'Note', 10000, errors);
  const accountId = relation(form, 'accountId', errors), opportunityId = relation(form, 'opportunityId', errors);
  if (!accountId && !opportunityId) errors.accountId = 'Choose an account or opportunity.';
  const createdById = relation(form, 'createdById', errors);
  return { errors, value: Object.keys(errors).length ? undefined : { body, accountId, opportunityId, createdById } };
}
export async function saveNote(
  client: PrismaClient,
  value: NonNullable<ReturnType<typeof parseNote>['value']>,
  id?: number,
  actorId?: number,
) {
  return client.$transaction(async tx => {
    await checkRelations(tx, value.accountId, value.opportunityId);
    const createdById = actorId ?? value.createdById;

if (!id && !actorId && createdById && !(await tx.user.findFirst({
  where: { id: createdById, active: true, archivedAt: null }
}))) {
  throw new Error('Choose an active author.');
}
    if (id) { const existing = await tx.note.findFirst({ where: { id, archivedAt: null } }); if (!existing) throw new Error('Note not found or archived.'); return tx.note.update({ where: { id }, data: { body: value.body, accountId: value.accountId, opportunityId: value.opportunityId } }); }
    return tx.note.create({
  data: {
    ...value,
    createdById,
  },
});
  });
}
