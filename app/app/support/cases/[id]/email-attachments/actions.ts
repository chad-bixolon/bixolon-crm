'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { documentStorage } from '@/lib/document-storage';
import { importSelectedEmailFiles, recordEmailFileImport } from '@/lib/support-email-file-import';
export type EmailFilesState = { message?: string; failures?: { name: string; reason: string }[] };
export async function saveEmailFiles(caseId: number, _state: EmailFilesState, form: FormData): Promise<EmailFilesState> {
  const actor = await requireMutation('support-cases.write');
  const tokens = form.getAll('emailFiles').map(String);
  if (!tokens.length) return { message: 'Select at least one email file.' };
  let partial = false;
  try {
    const result = await importSelectedEmailFiles(prisma, documentStorage, actor, caseId, String(form.get('emailSource') ?? ''), tokens);
    partial = result.failures.length > 0;
    try { await recordEmailFileImport(prisma, actor, caseId, result); }
    catch { return { message: 'File import report could not be saved. Existing Case and email links are unchanged; review Case attachments before retrying.', failures: result.failures }; }
    if (partial) { revalidatePath(`/support/cases/${caseId}`); return { message: 'Some selected files could not be copied. Other imported files, the Case, and its email links are saved. Retry failed files or return to the Case.', failures: result.failures }; }
  } catch { return { message: 'Email file selection is invalid, expired, or unavailable. Reload this review page and try again.' }; }
  revalidatePath(`/support/cases/${caseId}`);
  redirect(`/support/cases/${caseId}?emailFiles=complete`);
}
