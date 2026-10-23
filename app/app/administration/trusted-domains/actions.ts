'use server';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { emailDomain, mutateTrustedDomain } from '@/lib/trusted-domains';

export async function trustedDomainAction(_state: { message: string }, form: FormData) {
  const actor = await requireMutation('deployment.manage');
  const action = String(form.get('action') ?? '');
  if (action !== 'add' && action !== 'activate' && action !== 'deactivate') return { message: 'Invalid action.' };
  const session = await auth();
  try {
    await mutateTrustedDomain(prisma, actor, { action, domain: String(form.get('domain') ?? ''), confirmOwnDomain: form.get('confirmOwnDomain') === 'yes', currentIdentityDomain: session?.googleHostedDomain, currentIdentityEmailDomain: emailDomain(session?.googleEmail ?? '') });
    revalidatePath('/administration/trusted-domains');
    return { message: `Domain ${action === 'add' ? 'added' : action === 'activate' ? 'activated' : 'deactivated'}.` };
  } catch (error) { return { message: error instanceof Error ? error.message : 'Could not update domain.' }; }
}
