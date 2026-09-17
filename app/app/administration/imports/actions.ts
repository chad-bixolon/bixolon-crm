'use server';
import { prisma } from '@/lib/prisma';
import { requireMutation } from '@/lib/current-user';
import { applyImport, planImport } from '@/lib/import-plan';
import { parseImportXlsx, maxXlsxBytes } from '@/lib/import-xlsx';
import { revalidatePath } from 'next/cache';

async function readUpload(form: FormData) {
  const upload = form.get('file');
  if (!upload || typeof upload === 'string' || typeof upload.arrayBuffer !== 'function') return {error:'Choose a CSV or XLSX file.'};
  const file = upload as File;
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) {
    if (file.size > 2_000_000) return {error:'Choose a UTF-8 CSV file smaller than 2 MB.'};
    try { return {csv:new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer())}; }
    catch { return {error:'CSV file must be valid UTF-8 text.'}; }
  }
  if (name.endsWith('.xlsx')) {
    if (file.size > maxXlsxBytes) return {error:'Choose an .xlsx file smaller than 4 MB.'};
    return parseImportXlsx(Buffer.from(await file.arrayBuffer()), String(form.get('sheet') ?? '') || undefined);
  }
  return {error:'Choose a .csv or .xlsx file.'};
}

export async function previewUpload(form:FormData) {
  await requireMutation('users.manage');
  const upload = await readUpload(form);
  if (!upload.csv) return {error:upload.error ?? 'Upload could not be read.',sheets:'sheets' in upload ? upload.sheets : []};
  try { return {plan:await planImport(prisma,upload.csv),sheets:'sheets' in upload ? upload.sheets : [],selectedSheet:'selectedSheet' in upload ? upload.selectedSheet : undefined}; }
  catch { return {error:'Could not prepare the import preview. Check the file and try again.',sheets:[]}; }
}
export async function confirmUpload(form:FormData,digest:string) {
  const actor = await requireMutation('users.manage');
  const upload = await readUpload(form);
  if (!upload.csv) return {ok:false as const,message:upload.error ?? 'Upload could not be read.'};
  try {
    const counts = await applyImport(prisma,upload.csv,digest,actor.id);
    revalidatePath('/accounts'); revalidatePath('/contacts');
    return {ok:true as const,counts};
  } catch(error) {
    return {ok:false as const,message:error instanceof Error && error.message.startsWith('Preview changed') ? error.message : 'Import failed. No rows were applied. Preview again and check for changed records or constraints.'};
  }
}
