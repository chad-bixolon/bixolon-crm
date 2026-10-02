'use server';
import { revalidatePath } from 'next/cache';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { inspectSalesPlanWorkbook, previewSalesPlanImport, finalizeSalesPlanImport, salesPlanMappingTemplate, type ImportConfig, type ImportReview } from '@/lib/sales-plan-import';
import type { SheetMapping } from '@/lib/sales-plan-import';
function file(form:FormData){const item=form.get('file');if(!(item instanceof File)||!item.name.toLowerCase().endsWith('.xlsx')||!item.size||item.size>4_000_000)throw new Error('Choose an .xlsx workbook under 4 MB.');return item;}
const error=(e:unknown)=>e instanceof Error?e.message:'Import failed.';
export async function inspectAction(form:FormData){await requireMutation('sales-plan.manage');try{return {data:inspectSalesPlanWorkbook(Buffer.from(await file(form).arrayBuffer())),error:null};}catch(e){return {data:null,error:error(e)};}}
export async function previewAction(form:FormData,config:ImportConfig){const actor=await requireMutation('sales-plan.manage');try{return {data:await previewSalesPlanImport(prisma,actor,Buffer.from(await file(form).arrayBuffer()),config),error:null};}catch(e){return {data:null,error:error(e)};}}
export async function finalizeAction(form:FormData,review:ImportReview){const actor=await requireMutation('sales-plan.manage');try{const upload=file(form);const ids=await finalizeSalesPlanImport(prisma,actor,Buffer.from(await upload.arrayBuffer()),upload.name,review);revalidatePath('/sales-plan');revalidatePath('/reports/sales-plan');return {ids,error:null};}catch(e){return {ids:null,error:error(e)};}}
export async function saveMappingAction(name:string,mappings:SheetMapping[]){const actor=await requireMutation('sales-plan.manage');try{const label=name.trim();if(!label||label.length>255)throw new Error('Enter a mapping name under 256 characters.');const safe=salesPlanMappingTemplate(mappings);const saved=await prisma.salesPlanImportMapping.create({data:{name:label,mappings:JSON.parse(JSON.stringify(safe)),createdById:actor.id}});return {mapping:{id:saved.id,name:saved.name,mappings:safe},error:null};}catch(e){return {mapping:null,error:error(e)};}}
