import { operationalProjectWhere, operationalContactWhere, operationalAccountWhere } from './operational-where';
import { operationalOpportunityWhere, operationalTaskWhere } from './operational-where';
import { ActivityDirection, Prisma, TaskPriority, TaskStatus, type PrismaClient } from '@prisma/client';
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
  const accountId = relation(form, 'accountId', errors), opportunityId = relation(form, 'opportunityId', errors), projectId = relation(form, 'projectId', errors), assignedToId = relation(form, 'assignedToId', errors);
  const status = field(form, 'status') as TaskStatus, priority = field(form, 'priority') as TaskPriority;
  if (!taskStatuses.includes(status)) errors.status = 'Choose a status.';
  if (!taskPriorities.includes(priority)) errors.priority = 'Choose a priority.';
  const dueDate = dateField(field(form, 'dueDate'), 'dueDate', errors);
  return { errors, value: Object.keys(errors).length ? undefined : { subject, description, accountId, opportunityId, projectId, assignedToId, status, priority, dueDate } };
}
export type TaskInput = NonNullable<ReturnType<typeof parseTask>['value']>;
export async function checkRelations(client: PrismaClient | Prisma.TransactionClient, accountId: number | null, opportunityId: number | null, projectId: number | null = null) {
  if (accountId && !(await client.account.findFirst({ where: { id: accountId, AND: [operationalAccountWhere] } }))) throw new Error('Account not found or archived.');
  if (opportunityId && !(await client.opportunity.findFirst({ where: { AND: [operationalOpportunityWhere], id: opportunityId } }))) throw new Error('Opportunity not found or archived.');
  if (accountId && opportunityId && !(await client.opportunityAccount.findUnique({ where: { opportunityId_accountId: { opportunityId, accountId } } }))) throw new Error('Account is not a participant in this opportunity.');
  if (projectId && !(await client.project.findFirst({ where: { id: projectId, AND: [operationalProjectWhere] } }))) throw new Error('Project not found or archived.');
  if (projectId && opportunityId) {
    const link = await client.opportunityProject.findUnique({ where: { opportunityId_projectId: { opportunityId, projectId } } });
    if (!link) throw new Error('Opportunity is not linked to this Project.');
  }
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
    await checkRelations(tx, value.accountId, value.opportunityId, value.projectId);
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
  const where: Prisma.TaskWhereInput = { ...archivedWhere(recordVisibility(f.visibility)), ...(recordVisibility(f.visibility)==='active'?{AND:[operationalTaskWhere]}:{}) };
  if (f.q?.trim()) where.OR = [{ subject: { contains: f.q.trim().slice(0, 100), mode: 'insensitive' } }, { description: { contains: f.q.trim().slice(0, 100), mode: 'insensitive' } }];
  if (taskStatuses.includes(f.status as TaskStatus)) where.status = f.status as TaskStatus;
  if (taskPriorities.includes(f.priority as TaskPriority)) where.priority = f.priority as TaskPriority;
  for (const key of ['assignedToId', 'accountId', 'opportunityId'] as const) { const id = positiveId(f[key] ?? ''); if (id) where[key] = id; }
  const errors: Errors = {}; const from = dateField(f.dueFrom ?? '', 'dueFrom', errors), to = dateField(f.dueTo ?? '', 'dueTo', errors);
  if (from || to) where.dueDate = { ...(from ? { gte: new Date(`${f.dueFrom}T00:00:00Z`) } : {}), ...(to ? { lt: new Date(new Date(`${f.dueTo}T00:00:00Z`).getTime() + 86400000) } : {}) };
  return where;
}
export function dashboardOpenTaskWhere(): Prisma.TaskWhereInput {
  return { AND: [operationalTaskWhere], status: { in: ['OPEN', 'IN_PROGRESS'] } };
}
export function dayBounds(now = new Date()) { const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now); const read = (type: string) => Number(parts.find(p => p.type === type)?.value); const start = new Date(Date.UTC(read('year'), read('month') - 1, read('day'))); return { start, end: new Date(start.getTime() + 86400000) }; }
export function taskTiming(task: { status: TaskStatus; dueDate: Date | null }, now = new Date()) { if (!task.dueDate || !['OPEN','IN_PROGRESS'].includes(task.status)) return null; const { start, end } = dayBounds(now); return task.dueDate < start ? 'Overdue' : task.dueDate < end ? 'Due today' : null; }
export function parseActivity(form: FormData) {
  const errors: Errors = {}; const subject = required(form, 'subject', 'Subject', 200, errors), description = optional(form, 'description', 5000, errors);
  const accountId = relation(form, 'accountId', errors), opportunityId = relation(form, 'opportunityId', errors), projectId = relation(form, 'projectId', errors), userId = relation(form, 'userId', errors);
  if (!accountId) errors.accountId = 'Choose an Account.';
  const type = required(form, 'type', 'Activity type', 100, errors);
  const rawDate = field(form, 'activityDate');
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(rawDate);
  const activityDate = dateOnly ? dateField(rawDate, 'activityDate', errors) : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(rawDate) ? new Date(`${rawDate}:00.000Z`) : null;
  if (!activityDate || Number.isNaN(activityDate.getTime()) || (!dateOnly && activityDate.toISOString().slice(0,16) !== rawDate)) errors.activityDate = 'Choose a valid date and time (UTC).';
  const direction = (field(form, 'direction') || 'NA') as ActivityDirection;
  if (!Object.values(ActivityDirection).includes(direction)) errors.direction = 'Choose a direction.';
  const outcome = optional(form, 'outcome', 2000, errors), nextStep = optional(form, 'nextStep', 2000, errors);
  const followUpDate = dateField(field(form, 'followUpDate'), 'followUpDate', errors);
  const createFollowUpTask = form.has('createFollowUpTask');
  const followUpTaskCreateKey = field(form, 'createKey');
  if (createFollowUpTask && !followUpDate) errors.followUpDate = 'Choose a valid Follow-Up Date to create a Task.';
  if (createFollowUpTask && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(followUpTaskCreateKey)) errors.createFollowUpTask = 'Reload the form and try again.';
  const contactIds = [...new Set(form.getAll('contactIds').map(String).filter(Boolean).map(positiveId))];
  if (contactIds.includes(null)) errors.contactIds = 'Choose valid Contacts.';
  return { errors, value: Object.keys(errors).length ? undefined : { subject, description, accountId, opportunityId, projectId, userId, type, activityDate: activityDate!, direction, outcome, nextStep, followUpDate, contactIds: contactIds as number[], createFollowUpTask, followUpTaskCreateKey } };
}
const activityFields = ['subject','description','accountId','opportunityId','projectId','userId','type','activityDate','direction','outcome','nextStep','followUpDate','createKey'] as const;
export function activitySubmittedValues(form: FormData) {
  return { ...Object.fromEntries(activityFields.map(key => [key, String(form.get(key) ?? '')])), createFollowUpTask: form.has('createFollowUpTask') ? 'true' : '', contactIds: form.getAll('contactIds').map(String).join(',') };
}
export function activityFailureState(form: FormData, errors: Errors, message = 'Correct the highlighted fields.') {
  return { errors, message, values: activitySubmittedValues(form) };
}
export function activityErrorField(message: string) {
  if (message.includes('Account cannot change')) return 'accountId';
  if (message.includes('Project') || message.includes('project')) return 'projectId';
  if (message.includes('opportunity') || message.includes('Opportunity')) return 'opportunityId';
  if (message.includes('Contact')) return 'contactIds';
  if (message.includes('Account')) return 'accountId';
  if (message.includes('activity type')) return 'type';
  if (message.includes('responsible user')) return 'userId';
  return null;
}
export async function saveActivity(client: PrismaClient, value: NonNullable<ReturnType<typeof parseActivity>['value']>, id?: number, actorId?: number) {
  if (!id && value.createFollowUpTask && await client.task.findUnique({ where: { createKey: value.followUpTaskCreateKey } })) throw new Error('This follow-up Task has already been scheduled.');
  return client.$transaction(async tx => {
    const existing = id ? await tx.activity.findFirst({ where: { id, archivedAt: null } }) : null;
    if (id && !existing) throw new Error('Activity not found or archived.');
    if (!value.accountId) throw new Error('Choose an Account.');
    const accountChanged = !existing || existing.accountId !== value.accountId;
    const opportunityChanged = !existing || existing.opportunityId !== value.opportunityId;
    const projectChanged = !existing || existing.projectId !== value.projectId;
    if (accountChanged && !(await tx.account.findFirst({ where: { id: value.accountId, AND: [operationalAccountWhere] } }))) throw new Error('Account not found or archived.');
    if (value.opportunityId && (accountChanged || opportunityChanged || projectChanged)) {
      if (!(await tx.opportunity.findFirst({ where: { id: value.opportunityId, AND: [operationalOpportunityWhere] } }))) throw new Error('Opportunity not found or archived.');
      if (!(await tx.opportunityAccount.findUnique({ where: { opportunityId_accountId: { opportunityId: value.opportunityId, accountId: value.accountId } } }))) throw new Error('This Opportunity is not associated with the selected Account.');
    }
    if (value.projectId && (accountChanged || opportunityChanged || projectChanged)) {
      if (!(await tx.project.findFirst({ where: { id: value.projectId, AND: [operationalProjectWhere] } }))) throw new Error('Project not found or archived.');
      const project = await tx.project.findUnique({ where: { id: value.projectId }, select: { primaryAccountId: true, participants: { where: { accountId: value.accountId }, select: { accountId: true } } } });
      if (project?.primaryAccountId !== value.accountId && !project?.participants.length) throw new Error('This Project is not associated with the selected Account.');
    }
    if (value.opportunityId && value.projectId && (accountChanged || opportunityChanged || projectChanged)) {
      const link = await tx.opportunityProject.findUnique({ where: { opportunityId_projectId: { opportunityId: value.opportunityId, projectId: value.projectId } } });
      if (!link) throw new Error('This Project is not linked to the selected Opportunity.');
    }
    if (existing?.accountId != null && existing.accountId !== value.accountId && await tx.activityContact.count({ where: { activityId: id } })) throw new Error('Account cannot change while Contact history is linked.');
    if (!(await tx.activityType.findFirst({ where: { code: value.type, active: true } })) && existing?.type !== value.type) throw new Error('Choose an active activity type.');
    if (value.userId && !(await tx.user.findFirst({ where: { id: value.userId, active: true, archivedAt: null } }))) throw new Error('Choose an active responsible user.');
    const { contactIds: suppliedContactIds, createFollowUpTask, followUpTaskCreateKey, ...data } = value;
    const contactIds = suppliedContactIds ?? [];
    if (contactIds.length) {
      const contacts = await tx.contact.findMany({ where: { id: { in: contactIds }, AND: [operationalContactWhere] }, select: { id: true, accountId: true, active: true } });
      const linked = id ? await tx.activityContact.findMany({ where: { activityId: id }, select: { contactId: true } }) : [];
      if (contacts.length !== contactIds.length || contacts.some(c => {
        const alreadyLinked = linked.some(l => l.contactId === c.id);
        return (!alreadyLinked || accountChanged) && (!c.active || (c.accountId !== null && c.accountId !== value.accountId));
      })) throw new Error('This Contact is not associated with the selected Account. Choose an active Contact at this Account or an unassigned Contact.');
    }
    const row = id ? await tx.activity.update({ where: { id }, data }) : await tx.activity.create({ data });
    for (const contactId of contactIds) await tx.activityContact.createMany({ data: [{ activityId: row.id, contactId }], skipDuplicates: true });
    if (!id && createFollowUpTask) {
      if (!value.followUpDate) throw new Error('Choose a valid Follow-Up Date to create a Task.');
      if (!value.userId) throw new Error('Choose a responsible user to create a follow-up Task.');
      const contact = contactIds.length ? await tx.contact.findFirst({where:{id:{in:contactIds}},select:{firstName:true,lastName:true},orderBy:{id:'asc'}}) : null;
      const account = contact ? null : await tx.account.findUnique({where:{id:value.accountId},select:{name:true}});
      const subject = contact ? `Follow up with ${contact.firstName} ${contact.lastName}` : account ? `Follow up with ${account.name}` : 'Follow up on activity';
      await tx.task.create({data:{createKey:followUpTaskCreateKey,subject,dueDate:value.followUpDate,status:'OPEN',priority:'NORMAL',assignedToId:value.userId,accountId:value.accountId,opportunityId:value.opportunityId,projectId:value.projectId,createdById:actorId??value.userId,updatedById:actorId??value.userId}});
    }
    return { ...row, followUpTaskCreated: !id && createFollowUpTask };
  });
}
export function parseNote(form: FormData) {
  const errors: Errors = {}; const body = required(form, 'body', 'Note', 10000, errors);
  const accountId = relation(form, 'accountId', errors), opportunityId = relation(form, 'opportunityId', errors), projectId = relation(form, 'projectId', errors);
  if (!accountId && !opportunityId && !projectId) errors.accountId = 'Choose an Account, Opportunity, or Project.';
  const createdById = relation(form, 'createdById', errors);
  return { errors, value: Object.keys(errors).length ? undefined : { body, accountId, opportunityId, projectId, createdById } };
}
export async function saveNote(
  client: PrismaClient,
  value: NonNullable<ReturnType<typeof parseNote>['value']>,
  id?: number,
  actorId?: number,
) {
  return client.$transaction(async tx => {
    await checkRelations(tx, value.accountId, value.opportunityId, value.projectId);
    const createdById = actorId ?? value.createdById;

if (!id && !actorId && createdById && !(await tx.user.findFirst({
  where: { id: createdById, active: true, archivedAt: null }
}))) {
  throw new Error('Choose an active author.');
}
    if (id) { const existing = await tx.note.findFirst({ where: { id, archivedAt: null } }); if (!existing) throw new Error('Note not found or archived.'); return tx.note.update({ where: { id }, data: { body: value.body, accountId: value.accountId, opportunityId: value.opportunityId, projectId: value.projectId } }); }
    return tx.note.create({
  data: {
    ...value,
    createdById,
  },
});
  });
}
