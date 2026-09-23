'use server';
import {revalidatePath} from 'next/cache';
import {redirect} from 'next/navigation';
import {currentUser} from '@/lib/current-user';
import {friendlyError,positiveId} from '@/lib/crm-validation';
import {parseContact} from '@/lib/contacts';
import {prisma} from '@/lib/prisma';
import {bulkCreateTradeShowContacts,createContactFromTradeShowLead,linkTradeShowLeadContact} from '@/lib/trade-show-contact-resolution';

export type ResolutionFormState={errors:Record<string,string>;message?:string;values?:Record<string,string>};
const returnParam=(value:string)=>/^\/marketing\/audiences\/\d+$/.test(value)?value:'';
const workflowUrl=(tradeShowId:number,notice:string,contactId?:number,returnTo='')=>`/trade-shows/${tradeShowId}/contact-resolution?notice=${notice}${contactId?`&contactId=${contactId}`:''}${returnParam(returnTo)?`&returnTo=${encodeURIComponent(returnTo)}`:''}`;
function retainedValues(form:FormData){const values=Object.fromEntries([...form.entries()].filter((entry):entry is [string,string]=>typeof entry[1]==='string'));values.isPrimary=form.has('isPrimary')?'true':'false';return values;}
function refresh(tradeShowId:number){revalidatePath(`/trade-shows/${tradeShowId}`);revalidatePath(`/trade-shows/${tradeShowId}/contact-resolution`);revalidatePath('/marketing/audiences');}

export async function linkContactAction(tradeShowId:number,leadId:number,returnTo:string,form:FormData){
  const actor=await currentUser(),contactId=positiveId(String(form.get('contactId')??''));
  if(!contactId)redirect(workflowUrl(tradeShowId,'invalid-link',undefined,returnTo));
  try{await linkTradeShowLeadContact(prisma,tradeShowId,leadId,contactId,actor);}catch(error){redirect(`${workflowUrl(tradeShowId,'link-error',undefined,returnTo)}&message=${encodeURIComponent(friendlyError(error,'Contact could not be linked.'))}`);}
  refresh(tradeShowId);redirect(workflowUrl(tradeShowId,'linked',contactId,returnTo));
}

export async function createResolutionContactAction(tradeShowId:number,leadId:number,returnTo:string,_state:ResolutionFormState,form:FormData):Promise<ResolutionFormState>{
  const actor=await currentUser(),values=retainedValues(form),parsed=parseContact(form);
  if(!parsed.value)return {errors:parsed.errors,message:'Please correct the highlighted fields.',values};
  let contactId:number;
  try{contactId=await createContactFromTradeShowLead(prisma,tradeShowId,leadId,parsed.value,actor);}catch(error){return {errors:{},message:friendlyError(error,'Contact could not be created.'),values};}
  refresh(tradeShowId);redirect(workflowUrl(tradeShowId,'created',contactId,returnTo));
}

export async function bulkCreateContactsAction(tradeShowId:number,returnTo:string,form:FormData){
  const actor=await currentUser(),leadIds=form.getAll('leadIds').map(String).map(positiveId).filter((id):id is number=>id!==null);
  try{const result=await bulkCreateTradeShowContacts(prisma,tradeShowId,leadIds,actor);refresh(tradeShowId);redirect(`${workflowUrl(tradeShowId,'bulk-created',undefined,returnTo)}&count=${result.created}`);}catch(error){
    if(error&&typeof error==='object'&&'digest' in error)throw error;
    redirect(`${workflowUrl(tradeShowId,'bulk-error',undefined,returnTo)}&message=${encodeURIComponent(friendlyError(error,'Contacts could not be created.'))}`);
  }
}
