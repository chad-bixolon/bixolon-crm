'use server';
import { revalidatePath } from 'next/cache';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { bulkQualityOwners, type QualityBulkScope } from '@/lib/data-quality-bulk';
import type { BulkRequest, BulkResult } from '@/lib/bulk-action-contract';

export async function assignQualityOwner(scope: QualityBulkScope, request: BulkRequest): Promise<BulkResult> {
  try {
    const count = await bulkQualityOwners(prisma, await currentUser(), scope, request);
    for (const path of ['/administration/data-quality', '/administration/ownership', '/administration/maintenance-history', '/administration/audit-history', '/accounts', '/contacts', '/opportunities', '/pipeline', '/', '/notifications']) revalidatePath(path);
    for (const path of ['/accounts/[id]', '/accounts/[id]/edit', '/contacts/[id]', '/opportunities/[id]', '/opportunities/[id]/edit']) revalidatePath(path, 'page');
    return { ok: true, count };
  } catch (error) {
    return { ok: false, message: error instanceof Error && !('code' in error) ? error.message : 'No records changed. Refresh the list and try again.' };
  }
}
