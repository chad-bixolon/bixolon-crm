'use server';
import { revalidatePath } from 'next/cache';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { mutateInternalDomain } from '@/lib/internal-email-domains';

export async function internalEmailDomainAction(_state: { message: string }, form: FormData) {
  const actor = await requireMutation('deployment.manage');
  const action = String(form.get('action') ?? '');
  if (action !== 'add' && action !== 'activate' && action !== 'deactivate') return { message: 'Invalid action.' };
  try {
    await mutateInternalDomain(prisma, actor, { action, domain: String(form.get('domain') ?? '') });
    revalidatePath('/administration/internal-email-domains');
    return { message: `Domain ${action === 'add' ? 'added' : action === 'activate' ? 'activated' : 'deactivated'}.` };
  } catch (error) { return { message: error instanceof Error ? error.message : 'Could not update domain.' }; }
}
