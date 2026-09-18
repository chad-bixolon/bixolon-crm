'use server';
import { prisma } from '@/lib/prisma';
import { requireMutation } from '@/lib/current-user';
import { applyProductImport, planProductImport } from '@/lib/product-import';
import { readUpload } from '../actions';
import { mapProductWorkbookSheet } from '@/lib/product-workbook';
import { revalidatePath } from 'next/cache';

export async function previewProductUpload(form:FormData) {
  await requireMutation('users.manage');
  const upload=await readUpload(form,(sheet,rows)=>mapProductWorkbookSheet(sheet,rows,String(form.get('currency') ?? '')));
  if (!upload.csv) return {error:upload.error ?? 'Upload could not be read.',sheets:'sheets' in upload ? upload.sheets : []};
  try { return {plan:await planProductImport(prisma,upload.csv),sheets:'sheets' in upload ? upload.sheets : [],selectedSheet:'selectedSheet' in upload ? upload.selectedSheet : undefined}; }
  catch { return {error:'Could not prepare the catalog preview. Check the file and try again.',sheets:[]}; }
}
export async function confirmProductUpload(form:FormData,digest:string) {
  await requireMutation('users.manage');
  const upload=await readUpload(form,(sheet,rows)=>mapProductWorkbookSheet(sheet,rows,String(form.get('currency') ?? '')));
  if (!upload.csv) return {ok:false as const,message:upload.error ?? 'Upload could not be read.'};
  try {
    const counts=await applyProductImport(prisma,upload.csv,digest);
    revalidatePath('/products');
    return {ok:true as const,counts};
  } catch(error) {
    return {ok:false as const,message:error instanceof Error && error.message.startsWith('Preview changed') ? error.message : 'Import failed. No rows were applied. Preview again and check for changed records or constraints.'};
  }
}
