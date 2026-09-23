'use server';
import { revalidatePath } from 'next/cache';
import { requireMutation } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { prepareTradeShowImport, previewMappedTradeShowImport, confirmTradeShowImport, type CustomMappingSelection, type ImportChoice } from '@/lib/trade-show-import';
import { MAX_TRADE_SHOW_FILE_BYTES } from '@/lib/trade-show-import-parser';
import type { MappingDefinition } from '@/lib/trade-show-import-fields';
async function upload(form:FormData){const file=form.get('file');if(!(file instanceof File))throw new Error('Choose an .xls or .xlsx file.');if(!/\.(?:xls|xlsx)$/i.test(file.name)||!file.size||file.size>MAX_TRADE_SHOW_FILE_BYTES)throw new Error('Choose a nonempty .xls or .xlsx file no larger than 2 MB.');return {buffer:Buffer.from(await file.arrayBuffer()),filename:file.name};}
function message(error:unknown){return error instanceof Error?error.message:'Import failed.';}
export async function previewTradeShowAction(showId:number,form:FormData){const actor=await requireMutation('trade-shows.manage');try{const file=await upload(form);return {...await prepareTradeShowImport(prisma,showId,file.buffer,file.filename,actor),error:null};}catch(error){return {plan:null,mappingRequired:null,error:message(error)};}}
export async function previewMappedTradeShowAction(showId:number,form:FormData,definition:MappingDefinition,saveName:string|null){const actor=await requireMutation('trade-shows.manage');try{const file=await upload(form);return {plan:await previewMappedTradeShowImport(prisma,showId,file.buffer,file.filename,actor,definition,saveName),error:null};}catch(error){return {plan:null,error:message(error)};}}
export async function confirmTradeShowAction(showId:number,form:FormData,sha256:string,defaultRepId:number,choices:ImportChoice[],mapping:CustomMappingSelection|null){const actor=await requireMutation('trade-shows.manage');try{const file=await upload(form);const result=await confirmTradeShowImport(prisma,showId,file.buffer,file.filename,actor,sha256,defaultRepId,choices,mapping);revalidatePath(`/trade-shows/${showId}`);return {result,error:null};}catch(error){return {result:null,error:message(error)};}}
