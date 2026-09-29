'use server';
import { revalidatePath } from 'next/cache';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { parseDemoCsv, planDemoImport, applyDemoImport, mapDemoSourceAccount, mapDemoSourceSku, type DemoChoices } from '@/lib/demo-import';
import { createPeReviewAccount } from '@/lib/price-exception-account-create';
import { createDemoCatalogSku, inspectDemoCatalog } from '@/lib/demo-catalog-create';

async function upload(form:FormData){const file=form.get('file');if(!(file instanceof File)||!file.name.toLowerCase().endsWith('.csv')||file.size>2_000_000)return {error:'Choose a UTF-8 Demo CSV smaller than 2 MB.'};return {file,parsed:parseDemoCsv(await file.text())};}
async function admin(){const actor=await requireMutation('users.manage');if(actor.role!=='ADMIN')throw new Error('Administrator access required.');return actor;}
export async function previewDemo(form:FormData,choices:DemoChoices={}){await admin();const input=await upload(form);if(!input.file||!input.parsed)return {error:input.error};try{return {plan:await planDemoImport(prisma,input.parsed,input.file.name,choices)};}catch(error){return {error:error instanceof Error?error.message:'Preview failed.'};}}
export async function reviewDemo(form:FormData,prior:DemoChoices,next:DemoChoices,digest:string){await admin();const input=await upload(form);if(!input.file||!input.parsed)return {error:input.error};try{const old=await planDemoImport(prisma,input.parsed,input.file.name,prior);if(old.digest!==digest)throw new Error('Preview changed. Preview again.');const changed=Object.keys(next).find(id=>next[id]?.accountId!==prior[id]?.accountId&&next[id]?.accountId!==undefined);let expanded=changed?mapDemoSourceAccount(old,next,changed,next[changed].accountId!):next;for(const [requestId,groupChoices] of Object.entries(next))for(const [line,id] of Object.entries(groupChoices.skuIds??{}))if(id!==prior[requestId]?.skuIds?.[line])expanded=mapDemoSourceSku(old,expanded,requestId,Number(line),id??null);return {plan:await planDemoImport(prisma,input.parsed,input.file.name,expanded),choices:expanded};}catch(error){return {error:error instanceof Error?error.message:'Review failed.'};}}
export async function applyDemo(form:FormData,digest:string,confirmed:boolean,choices:DemoChoices,updates:string[]){const actor=await admin();const input=await upload(form);if(!input.file||!input.parsed)return {error:input.error};try{const result=await applyDemoImport(prisma,input.parsed,input.file.name,digest,confirmed,actor.id,choices,updates);revalidatePath('/demos');return {result};}catch(error){return {error:error instanceof Error?error.message:'Apply failed.'};}}
export async function createDemoAccount(fileForm:FormData,accountForm:FormData,requestId:string,choices:DemoChoices,digest:string,confirmed:boolean,acknowledgeDuplicate:boolean,reviewedToken?:string){const actor=await admin();await requireMutation('accounts.write');const input=await upload(fileForm);if(!input.file||!input.parsed)return {kind:'error' as const,message:input.error};try{const old=await planDemoImport(prisma,input.parsed,input.file.name,choices);if(old.digest!==digest)throw new Error('Preview changed. Preview again.');const group=old.groups.find(item=>item.requestId===requestId);if(!group||!group.account.issue||!group.header.VAR.trim())throw new Error('This Account no longer needs creation.');if(confirmed&&!reviewedToken)throw new Error('Review Account creation first.');const response=await createPeReviewAccount(prisma,actor,accountForm,confirmed,acknowledgeDuplicate,reviewedToken);if(response.kind!=='created')return response;const refreshed=await planDemoImport(prisma,input.parsed,input.file.name,choices);const next=mapDemoSourceAccount(refreshed,choices,requestId,response.account.id);revalidatePath('/accounts');return {kind:'created' as const,account:response.account,choices:next,plan:await planDemoImport(prisma,input.parsed,input.file.name,next)};}catch(error){return {kind:'error' as const,message:error instanceof Error?error.message:'Account creation failed.'};}}

async function skuReviewContext(fileForm:FormData,requestId:string,line:number,choices:DemoChoices,digest:string){
  const input=await upload(fileForm);if(!input.file||!input.parsed)throw new Error(input.error);
  const plan=await planDemoImport(prisma,input.parsed,input.file.name,choices);
  if(plan.digest!==digest)throw new Error('Preview changed. Preview again.');
  const item=plan.groups.find(group=>group.requestId===requestId)?.items.find(item=>item.line===line);
  if(!item?.sku.issue||!item.sourceSku.trim())throw new Error('This SKU no longer needs review.');
  return {input,plan,item};
}
export async function inspectDemoSku(fileForm:FormData,requestId:string,line:number,choices:DemoChoices,digest:string,modelName='',proposedSku?:string){
  await admin();await requireMutation('products.write');
  try{const {item}=await skuReviewContext(fileForm,requestId,line,choices,digest);return {kind:'review' as const,sourceSku:item.sourceSku,options:await inspectDemoCatalog(prisma,item.sourceSku,modelName,proposedSku??item.sourceSku)};}
  catch(error){return {kind:'error' as const,message:error instanceof Error?error.message:'SKU review failed.'};}
}
export async function createDemoSku(fileForm:FormData,skuForm:FormData,requestId:string,line:number,choices:DemoChoices,digest:string,reviewToken:string,acknowledgeCandidates:boolean){
  const actor=await admin();await requireMutation('products.write');
  try{
    const {input,item}=await skuReviewContext(fileForm,requestId,line,choices,digest);
    const created=await createDemoCatalogSku(prisma,actor,item.sourceSku,skuForm,reviewToken,acknowledgeCandidates);
    const refreshed=await planDemoImport(prisma,input.parsed,input.file.name,choices);
    const next=mapDemoSourceSku(refreshed,choices,requestId,line,created.skuId);
    revalidatePath('/products');
    return {kind:'created' as const,skuId:created.skuId,choices:next,plan:await planDemoImport(prisma,input.parsed,input.file.name,next)};
  }catch(error){return {kind:'error' as const,message:error instanceof Error?error.message:'SKU creation failed.'};}
}
