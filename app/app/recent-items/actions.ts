'use server';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { recordRecentView } from '@/lib/recent-items';
import { getModuleAvailability } from '@/lib/module-availability';

export async function recordView(entityType: string, recordId: number) {
  const actor = await currentUser();
  await recordRecentView(prisma, actor, entityType, recordId, await getModuleAvailability());
}
