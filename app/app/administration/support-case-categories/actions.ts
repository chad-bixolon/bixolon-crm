'use server';
import { revalidatePath } from 'next/cache';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { saveSupportCaseCategory } from '@/lib/support-case-categories';
export type CategoryState = { message?: string; success?: boolean };
export async function saveCategory(id: number | null, _state: CategoryState, form: FormData): Promise<CategoryState> {
  const actor = await requireMutation('support-categories.manage');
  const name = String(form.get('name') ?? '').trim(); const sortOrder = Number(form.get('sortOrder')); const active = form.get('active') === 'on';
  try { await saveSupportCaseCategory(prisma, actor, { name, sortOrder, active }, id ?? undefined); }
  catch (error) { return { message: error instanceof Error ? error.message : 'Could not save category.' }; }
  revalidatePath('/administration/support-case-categories'); revalidatePath('/support/cases');
  return { message: id ? 'Category updated.' : 'Category added.', success: true };
}
