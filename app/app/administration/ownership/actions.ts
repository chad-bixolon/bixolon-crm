'use server';
import { revalidatePath } from 'next/cache';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { reassignUnavailable, recoverableOwnershipTypes, type RecoverableOwnershipType } from '@/lib/unavailable-reassignment';

export async function recoverUnavailableOwner(form: FormData) {
  const actor = await requireMutation('maintenance.manage');
  const type = form.get('type');
  if (typeof type !== 'string' || !recoverableOwnershipTypes.includes(type as RecoverableOwnershipType)) return { error: 'Invalid work type.' };
  try {
    const id = Number(form.get('id')), replacement = Number(form.get('replacement'));
    const token = String(form.get('editToken') ?? '');
    const result = await reassignUnavailable(prisma, actor, type as RecoverableOwnershipType, id, replacement, token);
    revalidatePath('/administration/ownership');
    return result;
  } catch (error) { return { error: error instanceof Error ? error.message : 'Could not reassign this work.' }; }
}
