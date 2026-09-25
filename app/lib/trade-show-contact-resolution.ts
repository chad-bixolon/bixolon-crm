import { Prisma, type PrismaClient } from '@prisma/client';
import { can, type Actor } from './authorization';
import { saveContactRecord, type ContactInput } from './contacts';

export type ResolutionLead = {
  id:number; firstName:string; lastName:string; title:string|null; email:string|null; phone:string|null;
  accountId:number|null; sourceCompany?:string|null; addressLine1?:string|null; addressLine2?:string|null;
  city?:string|null; stateProvince?:string|null; postalCode?:string|null; country?:string|null;
};
export type ResolutionContact = {id:number;firstName:string;lastName:string;email:string|null;accountId:number|null};

export function canManageContactResolution(actor:Actor|null|undefined) {
  return !!actor && (actor.role==='ADMIN'||actor.role==='MARKETING_MANAGER') && can(actor,'trade-shows.resolve') && can(actor,'contacts.write');
}

export function normalizedEmail(value:string|null|undefined) {
  const email=(value??'').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null;
}

export function reviewedValue(value:string|null|undefined) {
  const text=(value??'').trim().replace(/\s+/g,' ');
  return text&&!/^(?:\([^()]+\)|n\/?a|none|null|unknown|not provided|-+)$/i.test(text)?text:null;
}

export type ResolutionAssessment={eligible:boolean;reason:'CLEAN'|'MISSING_NAME'|'MISSING_EMAIL'|'EXISTING_MATCH'|'AMBIGUOUS_MATCH'|'DUPLICATE_LEAD_EMAIL';matches:ResolutionContact[]};
export function assessContactResolution(leads:ResolutionLead[],contacts:ResolutionContact[]) {
  const leadEmailCounts=new Map<string,number>();
  for(const lead of leads){const email=normalizedEmail(lead.email);if(email)leadEmailCounts.set(email,(leadEmailCounts.get(email)??0)+1);}
  const contactsByEmail=new Map<string,ResolutionContact[]>();
  for(const contact of contacts){const email=normalizedEmail(contact.email);if(email)contactsByEmail.set(email,[...(contactsByEmail.get(email)??[]),contact]);}
  return new Map(leads.map(lead=>{
    const email=normalizedEmail(lead.email),matches=email?contactsByEmail.get(email)??[]:[];
    const reason:ResolutionAssessment['reason']=!reviewedValue(lead.firstName)||!reviewedValue(lead.lastName)?'MISSING_NAME':!email?'MISSING_EMAIL':matches.length>1?'AMBIGUOUS_MATCH':matches.length===1?'EXISTING_MATCH':(leadEmailCounts.get(email)??0)>1?'DUPLICATE_LEAD_EMAIL':'CLEAN';
    return [lead.id,{eligible:reason==='CLEAN',reason,matches}] as const;
  }));
}

type ResolutionClient=PrismaClient;
async function editableLead(tx:Prisma.TransactionClient,tradeShowId:number,leadId:number,actor:Actor){
  if(!canManageContactResolution(actor))throw new Error('Access denied');
  const lead=await tx.tradeShowLead.findFirst({where:{id:leadId,tradeShowId},include:{tradeShow:{select:{archivedAt:true}}}});
  if(!lead||lead.tradeShow.archivedAt)throw new Error('Trade Show Lead not found or archived.');
  if(lead.contactId)throw new Error('This Trade Show Lead is already linked to a Contact.');
  return lead;
}

export async function linkTradeShowLeadContact(client:ResolutionClient,tradeShowId:number,leadId:number,contactId:number,actor:Actor){
  return client.$transaction(async tx=>{
    const lead=await editableLead(tx,tradeShowId,leadId,actor);
    const contact=await tx.contact.findFirst({where:{id:contactId,active:true,archivedAt:null,OR:[{accountId:null},{account:{is:{archivedAt:null,status:'ACTIVE'}}}]},select:{id:true,accountId:true}});
    if(!contact)throw new Error('Choose an active Contact.');
    if(lead.accountId&&contact.accountId&&lead.accountId!==contact.accountId)throw new Error('The selected Contact belongs to a different Account. Neither record was changed.');
    await tx.tradeShowLead.update({where:{id:lead.id},data:{contactId:contact.id}});
    return contact.id;
  });
}

export async function createContactFromTradeShowLead(client:ResolutionClient,tradeShowId:number,leadId:number,input:ContactInput,actor:Actor){
  return client.$transaction(async tx=>{
    const lead=await editableLead(tx,tradeShowId,leadId,actor);
    if(lead.accountId!==null&&input.accountId!==lead.accountId)throw new Error('Use the resolved Lead Account for this Contact.');
    const email=normalizedEmail(input.email);
    const matches=email?await tx.contact.findMany({where:{email:{equals:email,mode:'insensitive'},archivedAt:null},select:{id:true}}):[];
    if(matches.length)throw new Error(matches.length>1?'Multiple Contacts use this email. Review and link the correct Contact.':'A Contact with this email already exists. Review and link the existing Contact.');
    const contactId=await saveContactRecord(tx,{...input,email,marketingPreference:'UNKNOWN'},undefined,actor);
    await tx.tradeShowLead.update({where:{id:lead.id},data:{contactId}});
    return contactId;
  });
}

export async function bulkCreateTradeShowContacts(client:ResolutionClient,tradeShowId:number,leadIds:number[],actor:Actor){
  if(!canManageContactResolution(actor))throw new Error('Access denied');
  const unique=[...new Set(leadIds)].filter(id=>Number.isSafeInteger(id)&&id>0);
  if(!unique.length)throw new Error('Select at least one eligible lead.');
  return client.$transaction(async tx=>{
    const show=await tx.tradeShow.findUnique({where:{id:tradeShowId},select:{archivedAt:true}});
    if(!show||show.archivedAt)throw new Error('Trade Show not found or archived.');
    const leads=await tx.tradeShowLead.findMany({where:{id:{in:unique},tradeShowId,contactId:null}});
    if(leads.length!==unique.length)throw new Error('One or more selected leads no longer need Contact resolution. Refresh and try again.');
    const emails=[...new Set(leads.map(lead=>normalizedEmail(lead.email)).filter((value):value is string=>!!value))];
    const [contacts,emailPeers]=await Promise.all([
      emails.length?tx.contact.findMany({where:{archivedAt:null,OR:emails.map(email=>({email:{equals:email,mode:'insensitive' as const}}))},select:{id:true,firstName:true,lastName:true,email:true,accountId:true}}):Promise.resolve([]),
      emails.length?tx.tradeShowLead.findMany({where:{tradeShowId,contactId:null,OR:emails.map(email=>({email:{equals:email,mode:'insensitive' as const}}))}}):Promise.resolve(leads),
    ]);
    const assessment=assessContactResolution(emailPeers,contacts),unsafe=leads.filter(lead=>!assessment.get(lead.id)?.eligible);
    if(unsafe.length)throw new Error(`${unsafe.length} selected lead${unsafe.length===1?' is':'s are'} no longer eligible for bulk creation. Refresh and review the excluded rows.`);
    const created:number[]=[];
    for(const lead of leads){
      const input:ContactInput={accountId:lead.accountId,firstName:reviewedValue(lead.firstName)!,lastName:reviewedValue(lead.lastName)!,title:reviewedValue(lead.title),email:normalizedEmail(lead.email),phone:reviewedValue(lead.phone),mobile:null,active:true,isPrimary:false,marketingPreference:'UNKNOWN',addressLine1:null,addressLine2:null,city:null,stateProvince:null,postalCode:null,country:null};
      const contactId=await saveContactRecord(tx,input,undefined,actor);
      await tx.tradeShowLead.update({where:{id:lead.id},data:{contactId}});created.push(contactId);
    }
    return {created:created.length,contactIds:created,unresolvedAccounts:leads.filter(lead=>lead.accountId===null).length};
  });
}
