'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireMutation } from '@/lib/current-user';
import { parseAssignedSalesRepUserId, parsePriceExceptionAccountPatch, PriceExceptionAccountValidationError, updatePriceExceptionAccountLinks, updatePriceExceptionSalesRep, type PriceExceptionAccountValues } from '@/lib/price-exception-resolution';
import { parseFollowUpForm, updatePriceExceptionFollowUp } from '@/lib/price-exception-follow-up';
import { currentUser } from '@/lib/current-user';
import { markPriceExceptionExpired } from '@/lib/price-exception-lifecycle';

export async function markExpiredPriceException(id:number) {
  const actor=await currentUser();
  try {
    await markPriceExceptionExpired(prisma,actor,id);
    revalidatePath('/price-exceptions');revalidatePath(`/price-exceptions/${id}`);
    revalidatePath('/administration/price-exceptions');revalidatePath('/reports/price-exceptions-expiring');revalidatePath('/');
    return {ok:true as const};
  } catch(error) {return {ok:false as const,message:error instanceof Error?error.message:'Status could not be updated.'};}
}

export type ResolvePriceExceptionState = { errors: Record<string, string>; values?: PriceExceptionAccountValues; saved?: boolean };
export type AssignPriceExceptionSalesRepState = { error?: string; value?: string; saved?: boolean };
export async function savePriceExceptionFollowUp(id:number,_state:{error?:string;saved?:boolean},form:FormData):Promise<{error?:string;saved?:boolean}> {
  const actor=await currentUser();
  try {
    const patch=parseFollowUpForm(form);
    const result=await updatePriceExceptionFollowUp(prisma,id,actor,patch);
    if(result.changed){revalidatePath(`/price-exceptions/${id}`);revalidatePath('/reports/price-exceptions-expiring');revalidatePath('/');}
    return {saved:true};
  } catch(error) {return {error:error instanceof Error?error.message:'Follow-up could not be saved.'};}
}

export async function assignPriceExceptionSalesRep(id:number,_state:AssignPriceExceptionSalesRepState,form:FormData):Promise<AssignPriceExceptionSalesRepState>{
  const actor=await requireMutation('users.manage');
  const parsed=parseAssignedSalesRepUserId(form);
  if(parsed.error)return {error:parsed.error,value:parsed.value};
  try{
    await updatePriceExceptionSalesRep(prisma,id,actor,parsed.assignedSalesRepUserId!);
    revalidatePath('/price-exceptions');revalidatePath(`/price-exceptions/${id}`);revalidatePath('/accounts');revalidatePath('/opportunities');
    return {saved:true,value:parsed.value};
  }catch(error){
    if(error instanceof PriceExceptionAccountValidationError)return {error:error.errors.assignedSalesRepUserId??error.errors.form,value:parsed.value};
    return {error:'BIXOLON Sales Rep could not be saved. Please try again.',value:parsed.value};
  }
}

export async function resolvePriceExceptionAccounts(id:number,_state:ResolvePriceExceptionState,form:FormData):Promise<ResolvePriceExceptionState>{
  const actor=await requireMutation('users.manage');
  for(const field of ['distributorAccountId','varAccountId','endUserAccountId']){
    if(form.get(`${field}Searching`)==='true')return {errors:{[field]:'Select an Account from the suggestions or cancel the search.'}};
  }
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
export async function restorePriceException(form:FormData){
  const actor=await requireMutation('users.manage');
  const id=Number(form.get('id'));
  if(!Number.isSafeInteger(id)||id<=0)throw new Error('Invalid Price Exception.');
  const row=await prisma.priceException.findFirst({where:{id,archivedAt:{not:null}},select:{expirationDate:true}});
  if(!row)throw new Error('Archived Price Exception not found.');
  await prisma.priceException.update({where:{id},data:{status:row.expirationDate&&row.expirationDate<new Date()?'EXPIRED':'ACTIVE',archivedAt:null,updatedById:actor.id}});
  revalidatePath('/price-exceptions');revalidatePath(`/price-exceptions/${id}`);revalidatePath('/accounts');
}
