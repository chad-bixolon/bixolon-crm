'use server';
import { Prisma } from '@prisma/client';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { configureCurrency } from '@/lib/currency-configuration';

export async function currencyAction(form: FormData) {
  const actor = await requireMutation('users.manage');
  let error: string | undefined;
  try { await configureCurrency(prisma, actor, String(form.get('action')), String(form.get('code'))); }
  catch (cause) { error = cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientValidationError ? 'Currency could not be saved. Refresh and try again.' : cause instanceof Error ? cause.message : 'Currency could not be saved.'; }
  if (error) redirect(`/administration/currencies?error=${encodeURIComponent(error)}`);
  revalidatePath('/', 'layout');
  redirect('/administration/currencies?saved=1');
}
