'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/current-user';
import { can } from '@/lib/authorization';
import { canEditTradeShowLead } from '@/lib/trade-shows';
import { parseAccountForm } from '@/lib/account-validation';
import { checkAccountReferences, findAccountNameMatches, saveAccount } from '@/lib/accounts';
import { parseContact, saveContact } from '@/lib/contacts';
import { friendlyError } from '@/lib/crm-validation';

type State={errors:Record<string,string>;message?:string;values?:Record<string,string>};
function retainedValues(form:FormData){const values=Object.fromEntries([...form.entries()].filter((entry):entry is [string,string]=>typeof entry[1]==='string'));values.isPrimary=form.has('isPrimary')?'true':'false';return values;}
async function editableLead(tradeShowId:number,leadId:number) {
  const actor=await currentUser();
  const lead=await prisma.tradeShowLead.findFirst({where:{id:leadId,tradeShowId},include:{tradeShow:{select:{archivedAt:true}}}});
  if(!lead||lead.tradeShow.archivedAt) throw new Error('Trade Show Lead not found or archived.');
  if(!canEditTradeShowLead(actor,lead)||!can(actor,'trade-shows.resolve')) throw new Error('Access denied');
  if(lead.convertedOpportunityId) throw new Error('Converted lead CRM links cannot be changed.');
  return {actor,lead};
}
export async function createAccountForTradeShowLead(tradeShowId:number,leadId:number,_state:State,form:FormData):Promise<State> {
  const {actor}=await editableLead(tradeShowId,leadId);
  if(!can(actor,'accounts.write')) throw new Error('Access denied');
  const parsed=parseAccountForm(form); if(!parsed.value)return {errors:parsed.errors,message:'Please correct the highlighted fields.'};
  const refs=await checkAccountReferences(prisma,parsed.value); if(Object.keys(refs).length)return {errors:refs,message:'Please correct the highlighted fields.'};
  const matches=(await findAccountNameMatches(prisma,parsed.value.name)).filter(match=>!match.archivedAt);
  if(matches.length&&!form.has('confirmDuplicate')) return {errors:{name:'A likely duplicate exists. Review the matches above, link one from the Lead editor, or explicitly confirm a new Account.'},message:'Duplicate review is required.'};
  let accountId:number;
  try {
    accountId=await saveAccount(prisma,parsed.value,undefined,actor.id);
    await prisma.tradeShowLead.update({where:{id:leadId},data:{accountId}});
    revalidatePath(`/trade-shows/${tradeShowId}/leads/${leadId}`);
  } catch(error) { return {errors:{},message:friendlyError(error,'Account could not be created.')}; }
  redirect(`/trade-shows/${tradeShowId}/leads/${leadId}/edit?saved=account&savedId=${accountId}`);
}
export async function createContactForTradeShowLead(tradeShowId:number,leadId:number,_state:State,form:FormData):Promise<State> {
  const {actor,lead}=await editableLead(tradeShowId,leadId);
  if(!can(actor,'contacts.write')) throw new Error('Access denied');
  const values=retainedValues(form),parsed=parseContact(form); if(!parsed.value)return {errors:parsed.errors,message:'Please correct the highlighted fields.',values};
  if(lead.accountId&&parsed.value.accountId&&lead.accountId!==parsed.value.accountId)return {errors:{accountId:'Choose the resolved Lead Account, or return and resolve the Account first.'},message:'Account and Contact must be consistent.',values};
  const matches=parsed.value.email?await prisma.contact.findMany({where:{email:{equals:parsed.value.email,mode:'insensitive'},archivedAt:null},select:{id:true}}):[];
  if(matches.length&&!form.has('confirmDuplicate'))return {errors:{email:'An exact email match exists. Link the existing Contact from the Lead editor, or explicitly confirm a new Contact.'},message:'Duplicate review is required.',values};
  let contactId:number;
  try {
    // Trade Show resolution never infers consent; the new Contact remains UNKNOWN.
    contactId=await saveContact(prisma,{...parsed.value,marketingPreference:'UNKNOWN'},undefined,actor);
    await prisma.tradeShowLead.update({where:{id:leadId},data:{contactId}});
    revalidatePath(`/trade-shows/${tradeShowId}/leads/${leadId}`);
  } catch(error) { return {errors:{},message:friendlyError(error,'Contact could not be created.'),values}; }
  redirect(`/trade-shows/${tradeShowId}/leads/${leadId}/edit?saved=contact&savedId=${contactId}`);
}
