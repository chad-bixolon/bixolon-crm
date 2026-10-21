import type { Prisma } from '@prisma/client';
import { nextUpdatedAt } from './stale-edit';

/** Relationship writers invalidate open Project forms in the same transaction. */
export async function advanceProjectRelationships(tx: Prisma.TransactionClient, projectIds: number[]) {
  for (const id of [...new Set(projectIds)].sort((a, b) => a - b)) {
    const project = await tx.project.findUniqueOrThrow({ where: { id }, select: { updatedAt: true } });
    await tx.project.update({ where: { id, updatedAt: project.updatedAt }, data: { updatedAt: nextUpdatedAt(project.updatedAt) } });
  }
}
