import type { Prisma } from '@prisma/client';
import { assertPermission, can, type Actor } from './authorization';

/** Responsibility restricts Sales edits, while read visibility remains shared.
 * Project work also requires authority over the Project or its primary Account.
 * Completed Tasks can be individually reopened; bulk operations intentionally
 * select only unfinished, operational work (see bulkTaskWhere).
 */
export function taskEditWhere(actor: Actor): Prisma.TaskWhereInput {
  assertPermission(actor, 'tasks.write');
  const project = !can(actor, 'projects.write') ? { projectId: null } : actor.role === 'SALES' ? {
    OR: [{ projectId: null }, { project: { OR: [{ ownerId: actor.id }, { primaryAccount: { ownerId: actor.id } }] } }],
  } : {};
  return { AND: [actor.role === 'SALES' ? { assignedToId: actor.id } : {}, project] };
}
export async function assertTaskEdit(db: Pick<Prisma.TransactionClient, 'task'>, actor: Actor, id: number) {
  const row = await db.task.findFirst({ where: { AND: [{ id }, taskEditWhere(actor)] } });
  if (!row) throw new Error('Task not found or unavailable for editing.');
  return row;
}
