import type { Prisma } from '@prisma/client';
import { assertPermission, type Actor } from './authorization';

export function assertAdmin(actor: Actor) { assertPermission(actor, 'users.manage'); }

/** Called inside the business transaction; failure rolls back the maintenance too. */
export async function recordMaintenance(tx: Prisma.TransactionClient, actorId: number, entityType: 'Task' | 'Support Case' | 'Account' | 'Contact' | 'Activity' | 'Price Exception' | 'CRM import' | 'History', action: 'Reassign' | 'Bulk complete' | 'Bulk due date' | 'Bulk priority' | 'Archive' | 'Restore' | 'Deactivate' | 'Activate' | 'Import' | 'Cleanup archive' | 'Cleanup expire' | 'Cleanup assignment' | 'Cleanup link', recordIds: number[], recordCount = recordIds.length) {
  if (!recordCount) return;
  await tx.adminMaintenanceEvent.create({ data: { actorId, entityType, action, recordIds: recordIds.slice(0, 20), recordCount } });
}
