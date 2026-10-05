import { Prisma, type PriceExceptionFollowUpStatus, type PrismaClient } from '@prisma/client';
import { can, type Actor } from './authorization';
import { scopedPriceExceptionWhere } from './price-exception-visibility';
import { businessToday } from './price-exception-expiration';

export const followUpStatuses = ['NOT_STARTED','IN_PROGRESS','RENEWAL_REQUESTED','REPLACEMENT_SUBMITTED','NO_RENEWAL_NEEDED','COMPLETED'] as const;
export const followUpLabels: Record<PriceExceptionFollowUpStatus,string> = {
  NOT_STARTED:'Not Started',IN_PROGRESS:'In Progress',RENEWAL_REQUESTED:'Renewal Requested',
  REPLACEMENT_SUBMITTED:'Replacement Submitted',NO_RENEWAL_NEEDED:'No Renewal Needed',COMPLETED:'Completed',
};
export const closedFollowUpStatuses: PriceExceptionFollowUpStatus[] = ['COMPLETED','NO_RENEWAL_NEEDED'];
export function followUpOverdue(next:Date|null|undefined,status:PriceExceptionFollowUpStatus,today=businessToday()) {
  return !!next && next<today && !closedFollowUpStatuses.includes(status);
}
export function canUpdateFollowUp(actor:Actor) {
  return can(actor,'pricing.read') && can(actor,'sales.write') && ['ADMIN','SALES_MANAGER','SALES'].includes(actor.role);
}
export type FollowUpPatch={status:PriceExceptionFollowUpStatus;ownerId:number|null;nextFollowUpAt:Date|null;note:string|null;replacementPriceExceptionId:number|null;replacementPeNumber:string|null};
export function parseFollowUpForm(form:FormData):FollowUpPatch {
  const status=form.get('actionStatus')??form.get('status');
  if(typeof status!=='string'||!followUpStatuses.includes(status as PriceExceptionFollowUpStatus))throw new Error('Invalid follow-up status.');
  const number=(name:string)=>{const value=String(form.get(name)??'').trim();if(!value)return null;const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed<=0)throw new Error(`Invalid ${name}.`);return parsed;};
  const rawDate=String(form.get('nextFollowUpAt')??'').trim();
  if(rawDate&&!/^\d{4}-\d{2}-\d{2}$/.test(rawDate))throw new Error('Invalid next follow-up date.');
  const nextFollowUpAt=rawDate?new Date(`${rawDate}T00:00:00.000Z`):null;
  if(nextFollowUpAt&&nextFollowUpAt.toISOString().slice(0,10)!==rawDate)throw new Error('Invalid next follow-up date.');
  const note=String(form.get('note')??'').trim();
  const replacementPeNumber=String(form.get('replacementPeNumber')??'').trim();
  if(note.length>2000||replacementPeNumber.length>100)throw new Error('Follow-up text is too long.');
  return {status:status as PriceExceptionFollowUpStatus,ownerId:number('ownerId'),nextFollowUpAt,note:note||null,replacementPriceExceptionId:number('replacementPriceExceptionId'),replacementPeNumber:replacementPeNumber||null};
}
type Client=Pick<PrismaClient,'$transaction'>;
export async function updatePriceExceptionFollowUp(db:Client,id:number,actor:Actor,patch:FollowUpPatch,now=new Date()) {
  if(!canUpdateFollowUp(actor))throw new Error('Access denied');
  if(!Number.isSafeInteger(id)||id<=0)throw new Error('Invalid Price Exception.');
  return db.$transaction(async tx=>{
    const pe=await tx.priceException.findFirst({where:scopedPriceExceptionWhere(actor,{id}),select:{id:true,assignedSalesRepUserId:true,followUp:true}});
    if(!pe)throw new Error('Price Exception not found.');
    const old=pe.followUp;
    const previous={status:old?.status??'NOT_STARTED',ownerId:old?.ownerId??pe.assignedSalesRepUserId,nextFollowUpAt:old?.nextFollowUpAt?.toISOString().slice(0,10)??null,replacementPriceExceptionId:old?.replacementPriceExceptionId??null,replacementPeNumber:old?.replacementPeNumber??null,summary:old?.summary??null};
    if(actor.role==='SALES'&&patch.ownerId!==previous.ownerId)throw new Error('Sales cannot reassign follow-up ownership.');
    if(patch.ownerId!==null&&patch.ownerId!==previous.ownerId){
      const owner=await tx.user.findFirst({where:{id:patch.ownerId,active:true,archivedAt:null,role:{in:['SALES','SALES_MANAGER']}},select:{id:true}});
      if(!owner)throw new Error('Follow-up owner must be an active Sales user.');
    }
    if(patch.replacementPriceExceptionId!==null){
      if(patch.replacementPriceExceptionId===id)throw new Error('A PE cannot replace itself.');
      const replacement=await tx.priceException.findFirst({where:scopedPriceExceptionWhere(actor,{id:patch.replacementPriceExceptionId}),select:{id:true}});
      if(!replacement)throw new Error('Replacement PE not found or not permitted.');
    }
    const next={status:patch.status,ownerId:patch.ownerId,nextFollowUpAt:patch.nextFollowUpAt?.toISOString().slice(0,10)??null,replacementPriceExceptionId:patch.replacementPriceExceptionId,replacementPeNumber:patch.replacementPeNumber,summary:patch.note??previous.summary};
    if(JSON.stringify(previous)===JSON.stringify(next))return {changed:false};
    const completed=patch.status==='COMPLETED'||patch.status==='NO_RENEWAL_NEEDED';
    await tx.priceExceptionFollowUp.upsert({where:{priceExceptionId:id},create:{priceExceptionId:id,status:patch.status,ownerId:patch.ownerId,lastFollowUpAt:now,nextFollowUpAt:patch.nextFollowUpAt,summary:next.summary,completedAt:completed?now:null,completedById:completed?actor.id:null,replacementPriceExceptionId:patch.replacementPriceExceptionId,replacementPeNumber:patch.replacementPeNumber},update:{status:patch.status,ownerId:patch.ownerId,lastFollowUpAt:now,nextFollowUpAt:patch.nextFollowUpAt,summary:next.summary,completedAt:completed?(old?.completedAt??now):null,completedById:completed?(old?.completedById??actor.id):null,replacementPriceExceptionId:patch.replacementPriceExceptionId,replacementPeNumber:patch.replacementPeNumber}});
    await tx.priceExceptionFollowUpEvent.create({data:{priceExceptionId:id,previousValues:previous as Prisma.InputJsonValue,newValues:next as Prisma.InputJsonValue,note:patch.note,actorId:actor.id,createdAt:now}});
    return {changed:true};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
