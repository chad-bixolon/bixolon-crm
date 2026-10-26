"use server";
import { assertModuleEnabled, getModuleAvailability } from '@/lib/module-availability';
import { operationalContactWhere } from '@/lib/operational-where';
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/current-user";
import { audienceContactWhere, audienceRequiresTradeShows, audienceVisibilities, canManageAudience, canViewAudience, parseAudienceForm, validateAudienceConfig } from "@/lib/marketing-audiences";
import { saveFeedbackPath } from "@/lib/save-feedback";
import { requireEditToken, isRecordChanged, recordChangedMessage, nextUpdatedAt } from '@/lib/stale-edit';

export type AudienceFormState={message?:string;recordChanged?:boolean};
function positive(value:FormDataEntryValue|null){const id=Number(value);return Number.isSafeInteger(id)&&id>0?id:null;}
async function managed(id:number){const actor=await currentUser(),audience=await prisma.marketingAudience.findUnique({where:{id}});if(!audience||!canManageAudience(actor,audience))throw new Error("Audience not found or access denied.");if(audienceRequiresTradeShows(validateAudienceConfig(audience.filterConfig))&&!(await getModuleAvailability()).effective.has('TRADE_SHOWS'))throw new Error('Audience unavailable while Trade Shows is disabled.');return {actor,audience};}

export async function saveAudience(_state:AudienceFormState,form:FormData):Promise<AudienceFormState>{
  await assertModuleEnabled('MARKETING');
  const actor=await currentUser();if(!canManageAudience(actor))throw new Error("Access denied");
  const audienceId=positive(form.get("audienceId")),name=String(form.get("name")??"").trim(),description=String(form.get("description")??"").trim()||null,visibility=String(form.get("visibility")??"");
  if(!name||name.length>120)return {message:"Audience name is required and must be 120 characters or fewer."};
  if(description&&description.length>1000)return {message:"Description must be 1,000 characters or fewer."};
  if(!audienceVisibilities.includes(visibility as never))return {message:"Choose a valid visibility."};
  let config;try{config=parseAudienceForm(form);}catch(error){return {message:error instanceof Error?error.message:"Audience filters are invalid."};}
  if(audienceRequiresTradeShows(config)&&!(await getModuleAvailability()).effective.has('TRADE_SHOWS'))return {message:'Trade Show criteria are unavailable.'};
  let id:number;
  if(audienceId){const existing=await prisma.marketingAudience.findUnique({where:{id:audienceId}});if(!existing||!canManageAudience(actor,existing))throw new Error("Access denied");if(audienceRequiresTradeShows(validateAudienceConfig(existing.filterConfig))&&!(await getModuleAvailability()).effective.has('TRADE_SHOWS'))throw new Error('Audience unavailable while Trade Shows is disabled.');try{const token=requireEditToken(form);const updated=await prisma.marketingAudience.update({where:{id:audienceId,updatedAt:new Date(token),archivedAt:null},data:{name,description,visibility:visibility as never,filterConfig:config as Prisma.InputJsonValue,updatedById:actor.id,updatedAt:nextUpdatedAt(new Date(token))}});id=updated.id;}catch(error){if(isRecordChanged(error))return{message:recordChangedMessage,recordChanged:true};throw error;}}
  else{id=(await prisma.marketingAudience.create({data:{name,description,visibility:visibility as never,filterConfig:config as Prisma.InputJsonValue,ownerId:actor.id,createdById:actor.id,updatedById:actor.id}})).id;}
  revalidatePath("/marketing/audiences");redirect(saveFeedbackPath(`/marketing/audiences/${id}`,audienceId?"updated":"created"));
}

export async function duplicateAudience(form:FormData){
  await assertModuleEnabled('MARKETING');const sourceId=positive(form.get("audienceId"));if(!sourceId)throw new Error("Invalid audience.");const actor=await currentUser(),source=await prisma.marketingAudience.findUnique({where:{id:sourceId}});if(!source||!canViewAudience(actor,source)||!canManageAudience(actor))throw new Error("Access denied");if(audienceRequiresTradeShows(validateAudienceConfig(source.filterConfig))&&!(await getModuleAvailability()).effective.has('TRADE_SHOWS'))throw new Error('Audience unavailable while Trade Shows is disabled.');const copy=await prisma.$transaction(async tx=>{const created=await tx.marketingAudience.create({data:{name:`${source.name} (copy)`.slice(0,120),description:source.description,visibility:"PERSONAL",filterConfig:source.filterConfig as Prisma.InputJsonValue,ownerId:actor.id,createdById:actor.id,updatedById:actor.id}});const overrides=await tx.marketingAudienceContactOverride.findMany({where:{audienceId:source.id}});if(overrides.length)await tx.marketingAudienceContactOverride.createMany({data:overrides.map(x=>({audienceId:created.id,contactId:x.contactId,kind:x.kind}))});return created;});revalidatePath("/marketing/audiences");redirect(`/marketing/audiences/${copy.id}`);}
export async function setAudienceArchived(form:FormData){
  await assertModuleEnabled('MARKETING');const id=positive(form.get("audienceId"));if(!id)throw new Error("Invalid audience.");const {actor}=await managed(id);const archived=form.get("archived")==="true";try{const token=requireEditToken(form);await prisma.marketingAudience.update({where:{id,updatedAt:new Date(token)},data:{archivedAt:archived?new Date():null,updatedById:actor.id,updatedAt:nextUpdatedAt(new Date(token))}});}catch(error){if(isRecordChanged(error))return{error:recordChangedMessage};throw error;}revalidatePath("/marketing/audiences");redirect(archived?"/marketing/audiences":`/marketing/audiences/${id}`);}

async function changeSelection(id:number,form:FormData,mutate:(tx:Prisma.TransactionClient,audience:Awaited<ReturnType<typeof managed>>['audience'])=>Promise<void>){
  const {actor,audience}=await managed(id);
  if(audience.archivedAt)throw new Error('Archived audiences cannot be changed.');
  try{
    const token=requireEditToken(form);
    await prisma.$transaction(async tx=>{
      await tx.marketingAudience.update({where:{id,updatedAt:new Date(token),archivedAt:null},data:{updatedAt:nextUpdatedAt(new Date(token)),updatedById:actor.id}});
      await mutate(tx,audience);
    });
  }catch(error){if(isRecordChanged(error))return{error:recordChangedMessage};throw error;}
  revalidatePath(`/marketing/audiences/${id}`);
  return{success:'Selection updated.'};
}

export async function setContactSelection(form:FormData){
  await assertModuleEnabled('MARKETING');const audienceId=positive(form.get('audienceId')),contactId=positive(form.get('contactId'));if(!audienceId||!contactId)throw new Error('Invalid selection.');
  return changeSelection(audienceId,form,async(tx,audience)=>{
    const selected=form.get('selected')==='true',matches=await tx.contact.count({where:{AND:[audienceContactWhere(audience.filterConfig),{id:contactId}]}})>0;
    if(selected){if(matches)await tx.marketingAudienceContactOverride.deleteMany({where:{audienceId,contactId}});else{const contact=await tx.contact.findFirst({where:{id:contactId,AND:[operationalContactWhere]},select:{id:true}});if(!contact)throw new Error('Only active Contacts may be included.');await tx.marketingAudienceContactOverride.upsert({where:{audienceId_contactId:{audienceId,contactId}},create:{audienceId,contactId,kind:'INCLUDE'},update:{kind:'INCLUDE'}});}}
    else if(matches)await tx.marketingAudienceContactOverride.upsert({where:{audienceId_contactId:{audienceId,contactId}},create:{audienceId,contactId,kind:'EXCLUDE'},update:{kind:'EXCLUDE'}});
    else await tx.marketingAudienceContactOverride.deleteMany({where:{audienceId,contactId}});
  });
}

export async function selectAllMatching(form:FormData){
  await assertModuleEnabled('MARKETING');const id=positive(form.get('audienceId'));if(!id)throw new Error('Invalid audience.');
  return changeSelection(id,form,async(tx,audience)=>{const matched=(await tx.contact.findMany({where:audienceContactWhere(audience.filterConfig),select:{id:true}})).map(x=>x.id);if(matched.length)await tx.marketingAudienceContactOverride.deleteMany({where:{audienceId:id,contactId:{in:matched}}});});
}
export async function clearAudienceSelection(form:FormData){
  await assertModuleEnabled('MARKETING');const id=positive(form.get('audienceId'));if(!id)throw new Error('Invalid audience.');
  return changeSelection(id,form,async(tx,audience)=>{const matched=(await tx.contact.findMany({where:audienceContactWhere(audience.filterConfig),select:{id:true}})).map(x=>x.id);await tx.marketingAudienceContactOverride.deleteMany({where:{audienceId:id,kind:'INCLUDE'}});if(matched.length){await tx.marketingAudienceContactOverride.deleteMany({where:{audienceId:id,contactId:{in:matched}}});await tx.marketingAudienceContactOverride.createMany({data:matched.map(contactId=>({audienceId:id,contactId,kind:'EXCLUDE'}))});}});
}
export async function includeContact(form:FormData){
  await assertModuleEnabled('MARKETING');const id=positive(form.get('audienceId')),contactId=positive(form.get('contactId'));if(!id||!contactId)throw new Error('Choose a Contact.');
  return changeSelection(id,form,async(tx,audience)=>{const contact=await tx.contact.findFirst({where:{id:contactId,AND:[operationalContactWhere]},select:{id:true}});if(!contact)throw new Error('Active Contact not found.');const matches=await tx.contact.count({where:{AND:[audienceContactWhere(audience.filterConfig),{id:contactId}]}})>0;if(matches)await tx.marketingAudienceContactOverride.deleteMany({where:{audienceId:id,contactId}});else await tx.marketingAudienceContactOverride.upsert({where:{audienceId_contactId:{audienceId:id,contactId}},create:{audienceId:id,contactId,kind:'INCLUDE'},update:{kind:'INCLUDE'}});});
}
