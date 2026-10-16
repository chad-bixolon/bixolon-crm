'use server';
import { revalidatePath } from 'next/cache';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { bulkTasks } from '@/lib/bulk-actions';
import type { BulkRequest, BulkResult } from '@/lib/bulk-action-contract';

export async function changeTasks(request: BulkRequest): Promise<BulkResult> {
  try {
    const count = await bulkTasks(prisma, await currentUser(), request);
    for (const path of ['/tasks', '/', '/accounts', '/opportunities', '/projects', '/support/cases']) revalidatePath(path);
    for (const record of request.records) {
      revalidatePath(`/tasks/${record.id}`);
      revalidatePath(`/tasks/${record.id}/edit`);
    }
    for (const path of ['/accounts/[id]', '/opportunities/[id]', '/projects/[id]', '/support/cases/[id]']) revalidatePath(path, 'page');
    revalidatePath('/administration/ownership');
    revalidatePath('/administration/audit-history');
    revalidatePath('/administration/maintenance-history');
    return { ok: true, count };
  } catch (error) {
    return { ok: false, message: error instanceof Error && !('code' in error) ? error.message : 'No records changed. Refresh the list and try again.' };
  }
}
