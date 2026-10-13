'use server';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { recordRecentView } from '@/lib/recent-items';

export async function recordView(entityType: string, recordId: number) {
  const actor = await currentUser();
  await recordRecentView(prisma, actor, entityType, recordId);
}
