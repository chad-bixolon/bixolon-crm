'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireMutation } from '@/lib/current-user';
import { parsePriceExceptionAccountPatch, PriceExceptionAccountValidationError, updatePriceExceptionAccountLinks, type PriceExceptionAccountValues } from '@/lib/price-exception-resolution';

export type ResolvePriceExceptionState = { errors: Record<string, string>; values?: PriceExceptionAccountValues; saved?: boolean };

export async function resolvePriceExceptionAccounts(id:number,_state:ResolvePriceExceptionState,form:FormData):Promise<ResolvePriceExceptionState>{
  const actor=await requireMutation('users.manage');
  const parsed=parsePriceExceptionAccountPatch(form);
  if(Object.keys(parsed.errors).length)return {errors:parsed.errors,values:parsed.values};
  try{
    const result=await updatePriceExceptionAccountLinks(prisma,id,actor,parsed.patch);
    revalidatePath('/price-exceptions');revalidatePath(`/price-exceptions/${id}`);revalidatePath('/accounts');
    for(const accountId of new Set([...result.previousAccountIds,...result.currentAccountIds]))revalidatePath(`/accounts/${accountId}`);
    return {errors:{},values:parsed.values,saved:true};
  }catch(error){
    if(error instanceof PriceExceptionAccountValidationError)return {errors:error.errors,values:parsed.values};
    return {errors:{form:'Account links could not be saved. Please try again.'},values:parsed.values};
  }
}

export async function archivePriceException(form:FormData){
  const actor=await requireMutation('users.manage');
  const id=Number(form.get('id'));
  if(!Number.isSafeInteger(id)||id<=0)throw new Error('Invalid Price Exception.');
  await prisma.priceException.update({where:{id},data:{status:'ARCHIVED',archivedAt:new Date(),updatedById:actor.id}});
  revalidatePath('/price-exceptions');revalidatePath(`/price-exceptions/${id}`);revalidatePath('/accounts');
}
