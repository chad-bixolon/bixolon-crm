'use server';
import { revalidatePath } from 'next/cache';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { bulkSupportCases } from '@/lib/bulk-actions';
import type { BulkRequest, BulkResult } from '@/lib/bulk-action-contract';

export async function changeCases(request: BulkRequest): Promise<BulkResult> {
  try {
    const count = await bulkSupportCases(prisma, await currentUser(), request);
    revalidatePath('/support/cases');
    for (const record of request.records) revalidatePath(`/support/cases/${record.id}`);
    revalidatePath('/');
    revalidatePath('/administration/ownership');
    revalidatePath('/administration/audit-history');
    revalidatePath('/administration/maintenance-history');
    return { ok: true, count };
  } catch (error) {
    return { ok: false, message: error instanceof Error && !('code' in error) ? error.message : 'No records changed. Refresh the list and try again.' };
  }
}
