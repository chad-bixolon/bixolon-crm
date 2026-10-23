'use server';
import { revalidatePath } from 'next/cache';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { saveBrandingNames } from '@/lib/branding-admin';

export async function saveBrandingAction(_state: { message: string }, form: FormData) {
  const actor = await requireMutation('deployment.manage');
  try {
    await saveBrandingNames(prisma, actor, String(form.get('companyName') ?? ''), String(form.get('productName') ?? ''));
    revalidatePath('/', 'layout');
    return { message: 'Branding saved.' };
  } catch (error) { return { message: error instanceof Error ? error.message : 'Could not save branding.' }; }
}
