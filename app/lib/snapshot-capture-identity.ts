import type { Prisma } from '@prisma/client';
import { can, type Actor } from './authorization';

// An in-process capability, never constructed from a session or request body.
export const weeklySnapshotService = Object.freeze({ service: 'weekly-snapshots' as const });
export type SnapshotActor = Actor | typeof weeklySnapshotService;
export function assertSnapshotCaptureActor(actor: SnapshotActor) {
  if (actor === weeklySnapshotService) return;
  if (!('role' in actor) || actor.role !== 'ADMIN' || !can(actor, 'configuration.manage')) throw new Error('Access denied');
}
export async function snapshotCreator(tx: Prisma.TransactionClient, actor: SnapshotActor) {
  assertSnapshotCaptureActor(actor);
  if (actor === weeklySnapshotService) return { createdById: null, createdByName: 'Automated weekly capture', source: 'SCHEDULED' };
  if (!('id' in actor)) throw new Error('Access denied');
  const user = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { firstName: true, lastName: true } });
  return { createdById: actor.id, createdByName: `${user.firstName} ${user.lastName}`, source: 'MANUAL' };
}
export function snapshotAttribution(run: { source: string; createdByName: string }) {
  return run.source === 'SCHEDULED' ? 'Automated weekly capture' : `Manual capture by ${run.createdByName}`;
}
