import { recordMaintenance } from './admin-maintenance';
import { Prisma, SupportCasePriority, type PrismaClient } from '@prisma/client';
import { assertPermission, can, taskScope, type Actor } from './authorization';
import { eligibleUserWhere } from './assignment-eligibility';
import { operationalTaskWhere } from './operational-where';
import { dateField, parseTask, saveTaskInTransaction, type TaskInput } from './work';
import { supportCaseReadWhere, updateSupportCaseInTransaction } from './support-cases';
import { caseWorkContext } from './support-work';
import { validateBulkRequest, type BulkRequest } from './bulk-action-contract';

/** Bulk work is intentionally limited to live, unfinished Tasks in the actor's scope. */
export function bulkTaskWhere(actor: Actor): Prisma.TaskWhereInput {
  assertPermission(actor, 'tasks.write');
  const project = !can(actor, 'projects.write') ? { projectId: null } : actor.role === 'SALES' ? {
    OR: [{ projectId: null }, { project: { OR: [{ ownerId: actor.id }, { primaryAccount: { ownerId: actor.id } }] } }],
  } : {};
  return { AND: [operationalTaskWhere, taskScope(actor), project, { status: { in: ['OPEN', 'IN_PROGRESS'] } }] };
}

function assertVersions(rows: { id: number; updatedAt: Date }[], request: BulkRequest) {
  if (rows.length !== request.records.length || rows.some(row => request.records.find(record => record.id === row.id)?.updatedAt !== row.updatedAt.toISOString())) {
    throw new Error('Some selected records changed or are unavailable. No records changed. Refresh the list and select again.');
  }
}
function targetId(value: string) {
  const id = /^\d+$/.test(value) ? Number(value) : 0;
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Choose an eligible assignee.');
  return id;
}

export async function bulkTasks(db: PrismaClient, actor: Actor, request: BulkRequest) {
  const where = bulkTaskWhere(actor);
  const ids = validateBulkRequest(request);
  if (!['complete', 'assign', 'dueDate'].includes(request.action)) throw new Error('Invalid Task bulk action.');
  const assignedToId = request.action === 'assign' ? targetId(request.value) : undefined;
  const errors: Record<string, string> = {};
  const dueDate = request.action === 'dueDate' ? dateField(request.value, 'dueDate', errors) : undefined;
  if (request.action === 'dueDate' && (!dueDate || errors.dueDate)) throw new Error('Choose a valid due date.');
  return db.$transaction(async tx => {
    // Stable lock ordering and version checks prevent stale writes and duplicate retries.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "Task" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
    const rows = await tx.task.findMany({ where: { AND: [where, { id: { in: ids } }] }, orderBy: { id: 'asc' } });
    assertVersions(rows, request);
    if (assignedToId && !await tx.user.findFirst({ where: { id: assignedToId, ...eligibleUserWhere('tasks.write') }, select: { id: true } })) throw new Error('Choose an eligible assignee.');
    for (const row of rows) {
      if (row.supportCaseId) await caseWorkContext(tx, actor, row.supportCaseId, row.accountId, row.contactId ? [row.contactId] : [], true);
      const value: TaskInput = { subject: row.subject, description: row.description, accountId: row.accountId, opportunityId: row.opportunityId, projectId: row.projectId, supportCaseId: row.supportCaseId, contactId: row.contactId, assignedToId: assignedToId ?? row.assignedToId, dueDate: dueDate === undefined ? row.dueDate : dueDate, status: request.action === 'complete' ? 'COMPLETED' : row.status, priority: row.priority };
      // Legacy records must also pass the ordinary form rules before bulk saves.
      const form = new FormData();
      for (const [key, field] of Object.entries(value)) form.set(key, field instanceof Date ? field.toISOString().slice(0, 10) : field == null ? '' : String(field));
      const parsed = parseTask(form);
      if (!parsed.value) throw new Error(`A selected Task needs individual review: ${Object.values(parsed.errors)[0]}`);
      await saveTaskInTransaction(tx, value, row.id, undefined, actor.id);
    }
    await recordMaintenance(tx, actor.id, 'Task', request.action === 'assign' ? 'Reassign' : request.action === 'complete' ? 'Bulk complete' : 'Bulk due date', ids);
    return rows.length;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}

export async function bulkSupportCases(db: PrismaClient, actor: Actor, request: BulkRequest) {
  assertPermission(actor, 'support-cases.write');
  const scope = supportCaseReadWhere(actor);
  const ids = validateBulkRequest(request);
  if (!['assign', 'priority'].includes(request.action)) throw new Error('Invalid Support Case bulk action.');
  const assignedToId = request.action === 'assign' ? targetId(request.value) : undefined;
  const priority = request.value as SupportCasePriority;
  if (request.action === 'priority' && !Object.values(SupportCasePriority).includes(priority)) throw new Error('Choose a valid priority.');
  return db.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "SupportCase" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
    const rows = await tx.supportCase.findMany({ where: { AND: [scope, { id: { in: ids } }] }, orderBy: { id: 'asc' } });
    assertVersions(rows, request);
    if (assignedToId && !await tx.user.findFirst({ where: { id: assignedToId, ...eligibleUserWhere('support-cases.write') }, select: { id: true } })) throw new Error('Select an eligible Support Rep.');
    for (const row of rows) await updateSupportCaseInTransaction(tx, actor, row.id, assignedToId ? { assignedToId } : { priority });
    await recordMaintenance(tx, actor.id, 'Support Case', request.action === 'assign' ? 'Reassign' : 'Bulk priority', ids);
    return rows.length;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}
