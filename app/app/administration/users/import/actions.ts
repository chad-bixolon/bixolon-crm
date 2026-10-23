'use server';
import { revalidatePath } from 'next/cache';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { applyUserCsv, reviewUserCsv, signUserCsvPreview, userCsvLimits, type UserCsvPreview } from '@/lib/user-csv';
export type CsvState = { message?: string; preview?: UserCsvPreview; csv?: string; token?: string; done?: boolean };
export async function submitUserCsv(_state: CsvState, form: FormData): Promise<CsvState> {
  const actor = await requireMutation('users.import');
  try {
    if (form.get('step') === 'apply') {
      if (form.get('confirm') !== 'yes') return { message: 'Confirm that you reviewed all changes and active work warnings.' };
      const preview = await applyUserCsv(prisma, actor, String(form.get('csv') ?? ''), String(form.get('token') ?? ''));
      revalidatePath('/administration/users', 'layout');
      return { done: true, preview, message: 'Import completed. All reviewed changes were saved.' };
    }
    const file = form.get('file');
    if (!(file instanceof File) || !file.size || file.size > userCsvLimits.bytes || !file.name.toLowerCase().endsWith('.csv')) return { message: 'Choose a UTF-8 .csv file no larger than 500 KB.' };
    const csv = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    const preview = await reviewUserCsv(prisma, actor, csv);
    return { preview, csv, token: signUserCsvPreview(actor.id, preview.digest) };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return { message: /preview|Import|import|CSV|500|Correct|Access denied/.test(message) ? message : 'The import could not be completed. No changes were saved. Upload the file again to review a fresh preview.' };
  }
}
