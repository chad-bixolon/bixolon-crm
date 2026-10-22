import type { Prisma, PrismaClient, Task } from '@prisma/client';
import { assertPermission, can, type Actor } from './authorization';
import { supportCaseReadWhere } from './support-cases';
import { saveTaskInTransaction, type TaskInput } from './work';

type CaseTask = Pick<Task, 'supportCaseId' | 'archivedAt' | 'assignedToId' | 'createdById' | 'opportunityId' | 'projectId' | 'tradeShowLeadId'>;

/** Support may finish assigned work, or unassigned work they created. */
export function canEditCaseTask(actor: Actor, task: CaseTask) {
  return can(actor, 'support-work.write') && !!task.supportCaseId && !task.archivedAt &&
    !task.opportunityId && !task.projectId && !task.tradeShowLeadId &&
    (can(actor, 'support-oversight.manage') || task.assignedToId === actor.id || (!task.assignedToId && task.createdById === actor.id));
}

export async function assertTaskRead(db: PrismaClient | Prisma.TransactionClient, actor: Actor, task: CaseTask) {
  if (can(actor, 'tasks.read')) return;
  assertPermission(actor, 'support-work.write');
  if (!task.supportCaseId) throw new Error('Task not found or unavailable.');
  await caseWorkContext(db, actor, task.supportCaseId, undefined, [], true);
}

/** Uses the effective actor and persisted relationships; never grants rights from form fields. */
export async function saveSupportCaseTask(db: PrismaClient, actor: Actor, value: TaskInput, id: number, editToken?: string) {
  assertPermission(actor, 'support-work.write');
  return db.$transaction(async tx => {
    // Keep eligibility stable until the mutation and its history commit together.
    await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${id} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR SHARE`;
    const user = await tx.user.findUnique({ where: { id: actor.id }, select: { id: true, role: true, active: true, archivedAt: true } });
    if (!user || user.role !== actor.role) throw new Error('Access denied');
    assertPermission(user, 'support-work.write');
    const task = await tx.task.findUnique({ where: { id } });
    if (!task || !canEditCaseTask(user, task)) throw new Error('Task not found or unavailable for editing.');
    for (const key of ['supportCaseId', 'accountId', 'opportunityId', 'projectId', 'contactId', 'assignedToId', 'priority'] as const) {
      if (!(can(user, 'support-oversight.manage') && (key === 'assignedToId' || key === 'priority')) && (value[key] ?? null) !== task[key]) throw new Error('Case Task relationships, assignment, and priority cannot change here.');
    }
    await tx.$queryRaw`SELECT id FROM "SupportCase" WHERE id = ${task.supportCaseId} FOR SHARE`;
    await caseWorkContext(tx, user, task.supportCaseId!);
    return saveTaskInTransaction(tx, value, id, undefined, user.id, editToken);
  });
}

export function canCreateCaseWork(actor: Actor) {
  return can(actor, 'tasks.write') || can(actor, 'support-work.write');
}

export function assertWorkPermission(actor: Actor, supportCaseId: number | null) {
  if (can(actor, 'tasks.write')) return;
  if (supportCaseId && can(actor, 'support-work.write')) return;
  assertPermission(actor, 'tasks.write');
}

export async function caseWorkContext(db: PrismaClient | Prisma.TransactionClient, actor: Actor, supportCaseId: number, accountId?: number | null, contactIds: number[] = [], allowHistorical = false) {
  if (!Number.isSafeInteger(supportCaseId) || supportCaseId < 1) throw new Error('Choose a valid Support Case.');
  const row = await db.supportCase.findFirst({ where: { id: supportCaseId, ...supportCaseReadWhere(actor, allowHistorical) }, select: { id: true, caseNumber: true, subject: true, accountId: true, contactId: true, status: true, archivedAt: true, account: { select: { name: true } }, contact: { select: { firstName: true, lastName: true, email: true, active: true, archivedAt: true, accountId: true } } } });
  if (!row) throw new Error('Support Case not found or unavailable.');
  if (!allowHistorical && (row.archivedAt || row.status === 'CLOSED')) throw new Error('Reopen or restore the Support Case before adding work.');
  if (accountId !== undefined && row.accountId !== accountId) throw new Error('Support Case Account does not match the selected Account.');
  if (contactIds.length) {
    const contacts = await db.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, accountId: true } });
    if (contacts.length !== new Set(contactIds).size || contacts.some(contact => !contactIds.includes(contact.id) || (contact.accountId !== null && contact.accountId !== row.accountId))) throw new Error('Contact does not belong to the Support Case Account.');
  }
  return row;
}
