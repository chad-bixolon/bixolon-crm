'use server';
import { revalidatePath } from 'next/cache';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { parseRosaCsv, planRosaPriceExceptions, applyRosaPriceExceptions } from '@/lib/rosa-price-exception-import';
async function upload(form:FormData){const value=form.get('file');if(!(value instanceof File)||!value.name.toLowerCase().endsWith('.csv')||value.size>2_000_000)return {error:'Choose a UTF-8 Rosa CSV smaller than 2 MB.'};return {file:value,parsed:parseRosaCsv(await value.text())};}
export async function previewRosa(form:FormData){const actor=await requireMutation('users.manage');if(actor.role!=='ADMIN')throw new Error('Administrator access required.');const input=await upload(form);if(!input.file||!input.parsed)return {error:input.error};return {plan:await planRosaPriceExceptions(prisma,input.parsed,input.file.name)};}
export async function applyRosa(form:FormData,digest:string,confirmed:boolean){const actor=await requireMutation('users.manage');if(actor.role!=='ADMIN')throw new Error('Administrator access required.');const input=await upload(form);if(!input.file||!input.parsed)return {ok:false as const,message:input.error??'Invalid CSV.'};try{const result=await applyRosaPriceExceptions(prisma,input.parsed,input.file.name,digest,confirmed,actor.id);revalidatePath('/price-exceptions');revalidatePath('/accounts');return {ok:true as const,result};}catch(error){return {ok:false as const,message:error instanceof Error?error.message:'Import failed. Run the dry-run again.'};}}
