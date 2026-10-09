'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { backfillExistingRosaDemo, ExistingDemoError } from '@/lib/demo-backfill';

export async function saveRosaBackfill(form: FormData) {
  const actor = await requireMutation('users.manage');
  if (actor.role !== 'ADMIN') throw new Error('Administrator access required.');
  let destination: string;
  try {
    const request = await backfillExistingRosaDemo(prisma, actor, form);
    revalidatePath(`/accounts/${request.accountId}`);
    revalidatePath('/demos');
    revalidatePath('/reports/demo-inventory');
    destination = `/demos/${request.id}`;
  } catch (error) {
    if (!(error instanceof ExistingDemoError)) return { error: error instanceof Error ? error.message : 'Backfill failed.' };
    destination = `/demos/${error.id}`;
  }
  redirect(destination);
}
