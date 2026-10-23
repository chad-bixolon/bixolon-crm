'use server';
import { DeploymentModule } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireMutation } from '@/lib/current-user';
import { modules, setModuleVisibility } from '@/lib/module-availability';
import { prisma } from '@/lib/prisma';

export async function changeModuleVisibility(form: FormData) {
  const actor = await requireMutation('deployment.manage');
  const feature = String(form.get('module')) as DeploymentModule;
  const raw = form.get('enabled');
  if (!modules.includes(feature) || (raw !== 'true' && raw !== 'false')) throw new Error('Invalid module setting.');
  await setModuleVisibility(prisma, actor, feature, raw === 'true');
  revalidatePath('/', 'layout');
  redirect('/administration/modules?saved=1');
}
