'use server';
import { prisma } from '@/lib/prisma';
import { requireMutation } from '@/lib/current-user';
import { applyProductImport, planProductImport, type ProductImportReview } from '@/lib/product-import';
import { readUpload } from '../actions';
import { parseProductWorkbookXlsx } from '@/lib/odm-product-workbook';
import { maxXlsxBytes } from '@/lib/import-xlsx';
import { revalidatePath } from 'next/cache';
import { ProductCatalogSource, OdmCustomizationSubtype } from '@prisma/client';
import { createAccountFromImport } from '@/lib/accounts';

export async function createAccountForProductImport(form:FormData) {
  const actor=await requireMutation('users.manage');
  try {
    const result=await createAccountFromImport(prisma,actor,form);
    if(result.kind==='created') revalidatePath('/accounts');
    return result;
  } catch {
    return {kind:'validation' as const,errors:{},message:'Account could not be saved. Check the name and try again.'};
  }
}

function selectedSource(form:FormData) {
  const value=String(form.get('catalogSource') ?? '');
  return value !== 'SPECIAL_SKU_LIST' && Object.values(ProductCatalogSource).includes(value as ProductCatalogSource) ? value as ProductCatalogSource : undefined;
}
function reviewChoices(form:FormData):ProductImportReview {
  const raw=String(form.get('review') ?? '');
  if (!raw || raw.length>100_000) return {};
  try {
    const data=JSON.parse(raw) as ProductImportReview;
    if (!data || typeof data!=='object') return {};
    const numbers=(value:unknown)=>Object.fromEntries(Object.entries(value && typeof value==='object' ? value : {}).filter(([key,id])=>key.length<=100 && Number.isSafeInteger(id) && Number(id)>0));
    const strings=(value:unknown,allowed?:string[])=>Object.fromEntries(Object.entries(value && typeof value==='object' ? value : {}).filter(([key,item])=>key.length<=100 && typeof item==='string' && item.length<=100 && (!allowed || allowed.includes(item))));
    return {customerMappings:numbers(data.customerMappings),rowAccountIds:numbers(data.rowAccountIds),subtypes:strings(data.subtypes,Object.values(OdmCustomizationSubtype).filter(value=>value!=='LEGACY_SPECIAL_SKU')) as ProductImportReview['subtypes'],baseSkus:strings(data.baseSkus)};
  } catch { return {}; }
}
async function readProductUpload(form:FormData) {
  const file=form.get('file');
  if(file && typeof file!=='string' && file.name.toLowerCase().endsWith('.xlsx')) {
    if(file.size>maxXlsxBytes) return {error:'Choose an .xlsx file smaller than 4 MB.',sheets:[]};
    return parseProductWorkbookXlsx(Buffer.from(await file.arrayBuffer()),String(form.get('sheet') ?? '') || undefined,String(form.get('currency') ?? ''));
  }
  return readUpload(form);
}

export async function previewProductUpload(form:FormData) {
  await requireMutation('users.manage');
  if (form.get('catalogSource') === 'SPECIAL_SKU_LIST') return {error:'Use ODM with a subtype for custom SKUs.',sheets:[]};
  const upload=await readProductUpload(form);
  if (!upload.csv) return {error:upload.error ?? 'Upload could not be read.',sheets:'sheets' in upload ? upload.sheets : []};
  try { return {plan:await planProductImport(prisma,upload.csv,selectedSource(form),reviewChoices(form)),accounts:await prisma.account.findMany({where:{archivedAt:null},select:{id:true,name:true},orderBy:{name:'asc'}}),sheets:'sheets' in upload ? upload.sheets : [],selectedSheet:'selectedSheet' in upload ? upload.selectedSheet : undefined,ignoredSheets:'ignoredSheets' in upload ? upload.ignoredSheets : []}; }
  catch { return {error:'Could not prepare the catalog preview. Check the file and try again.',sheets:[]}; }
}
export async function confirmProductUpload(form:FormData,digest:string) {
  await requireMutation('users.manage');
  if (form.get('catalogSource') === 'SPECIAL_SKU_LIST') return {ok:false as const,message:'Use ODM with a subtype for custom SKUs.'};
  const upload=await readProductUpload(form);
  if (!upload.csv) return {ok:false as const,message:upload.error ?? 'Upload could not be read.'};
  try {
    const counts=await applyProductImport(prisma,upload.csv,digest,selectedSource(form),reviewChoices(form));
    revalidatePath('/products');
    return {ok:true as const,counts};
  } catch(error) {
    return {ok:false as const,message:error instanceof Error && error.message.startsWith('Preview changed') ? error.message : 'Import failed. No rows were applied. Preview again and check for changed records or constraints.'};
  }
}
