'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { archiveSalesTarget, saveSalesTarget } from '@/lib/sales-targets';

export async function saveTargetAction(form: FormData) {
  const actor = await requireMutation('users.manage');
  const rawId = String(form.get('id') ?? '');
  const id = rawId ? Number(rawId) : undefined;
  let error = '';
  try { await saveSalesTarget(prisma, actor, form, id); }
  catch (cause) { error = cause instanceof Error && cause.message.includes('Unique constraint') ? 'An active target already exists for this rep, quarter, and currency.' : cause instanceof Error ? cause.message : 'Target could not be saved.'; }
  revalidatePath('/administration/sales-targets'); revalidatePath('/reports/forecast');
  redirect(error ? `/administration/sales-targets?error=${encodeURIComponent(error)}` : '/administration/sales-targets');
}

export async function archiveTargetAction(form: FormData) {
  const actor = await requireMutation('users.manage');
  let error = '';
  try { await archiveSalesTarget(prisma, actor, Number(form.get('id'))); }
  catch (cause) { error = cause instanceof Error ? cause.message : 'Target could not be archived.'; }
  revalidatePath('/administration/sales-targets'); revalidatePath('/reports/forecast');
  redirect(error ? `/administration/sales-targets?error=${encodeURIComponent(error)}` : '/administration/sales-targets');
}
