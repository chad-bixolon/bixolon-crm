'use server';
import { revalidatePath } from 'next/cache';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { parseRosaCsv, planRosaPriceExceptions, applyRosaPriceExceptions, type RosaManualChoices } from '@/lib/rosa-price-exception-import';
import { createPeReviewAccount, peAccountFields, type PeAccountField } from '@/lib/price-exception-account-create';
async function upload(form:FormData){const value=form.get('file');if(!(value instanceof File)||!value.name.toLowerCase().endsWith('.csv')||value.size>2_000_000)return {error:'Choose a UTF-8 Price Exception CSV smaller than 2 MB.'};return {file:value,parsed:parseRosaCsv(await value.text())};}
export async function previewRosa(form:FormData){const actor=await requireMutation('users.manage');if(actor.role!=='ADMIN')throw new Error('Administrator access required.');const input=await upload(form);if(!input.file||!input.parsed)return {error:input.error};return {plan:await planRosaPriceExceptions(prisma,input.parsed,input.file.name)};}
export async function reviewRosa(form:FormData,priorChoices:RosaManualChoices,nextChoices:RosaManualChoices,expectedDigest:string){const actor=await requireMutation('users.manage');if(actor.role!=='ADMIN')throw new Error('Administrator access required.');const input=await upload(form);if(!input.file||!input.parsed)return {plan:null,error:input.error??'Invalid CSV.'};try{const prior=await planRosaPriceExceptions(prisma,input.parsed,input.file.name,priorChoices);if(!expectedDigest||prior.digest!==expectedDigest)throw new Error('Preview changed. Preview the file again.');return {plan:await planRosaPriceExceptions(prisma,input.parsed,input.file.name,nextChoices),error:null};}catch(error){return {plan:null,error:error instanceof Error?error.message:'Resolution could not be reviewed.'};}}
export async function applyRosa(form:FormData,digest:string,confirmed:boolean,choices:RosaManualChoices={}){const actor=await requireMutation('users.manage');if(actor.role!=='ADMIN')throw new Error('Administrator access required.');const input=await upload(form);if(!input.file||!input.parsed)return {ok:false as const,message:input.error??'Invalid CSV.'};try{const result=await applyRosaPriceExceptions(prisma,input.parsed,input.file.name,digest,confirmed,actor.id,choices);revalidatePath('/price-exceptions');revalidatePath('/accounts');return {ok:true as const,result};}catch(error){return {ok:false as const,message:error instanceof Error?error.message:'Import failed. Preview the file again.'};}}
export async function createRosaAccount(fileForm:FormData, accountForm:FormData, groupKey:string, field:PeAccountField, choices:RosaManualChoices, digest:string, confirmed:boolean, acknowledgeDuplicate:boolean){
  const actor=await requireMutation('accounts.write');
  if(actor.role!=='ADMIN')throw new Error('Administrator access required.');
  if(!peAccountFields.includes(field))throw new Error('Invalid Account field.');
  const input=await upload(fileForm);
  if(!input.file||!input.parsed)return {kind:'error' as const,message:input.error??'Invalid CSV.'};
  try{
    const prior=await planRosaPriceExceptions(prisma,input.parsed,input.file.name,choices);
    if(!digest||prior.digest!==digest)throw new Error('Preview changed. Preview the file again.');
    const group=prior.groups.find(item=>item.groupKey===groupKey);
    if(!group)throw new Error('PE group was not found. Preview the file again.');
    const party=field==='Customer'?group.customer:field==='VAR'?group.varAccount:group.endUser;
    if(!party.issue||!party.source.trim())throw new Error('This source party does not need Account creation.');
    const result=await createPeReviewAccount(prisma,actor,accountForm,confirmed,acknowledgeDuplicate);
    if(result.kind!=='created')return result;
    const nextChoices:RosaManualChoices={...choices,[groupKey]:{...choices[groupKey],accountIds:{...choices[groupKey]?.accountIds,[field]:result.account.id}}};
    const plan=await planRosaPriceExceptions(prisma,input.parsed,input.file.name,nextChoices);
    revalidatePath('/accounts');
    return {kind:'created' as const,account:result.account,plan,choices:nextChoices};
  }catch(error){return {kind:'error' as const,message:error instanceof Error?error.message:'Account could not be created.'};}
}
