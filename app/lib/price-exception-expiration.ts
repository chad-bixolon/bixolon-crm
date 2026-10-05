import { Prisma, PriceExceptionStatus, type PrismaClient } from '@prisma/client';
import { can, type Actor } from './authorization';
import { scopedPriceExceptionWhere } from './price-exception-visibility';
import { priceExceptionListSummary } from './price-exception-list-summary';

export type ExpirationWindow = 'all'|'follow-up'|'expired'|'next30'|'next60'|'next90'|'none'|'future'|'activeExpired';
export const expirationOptions = [
  ['all','All expiration dates'],['expired','Expired'],['next30','Expires in next 30 days'],
  ['next60','Expires in next 60 days'],['next90','Expires in next 90 days'],['none','No expiration date'],
] as const;
const dayMs=86400000;
export function businessToday(now=new Date()) {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const value=(type:string)=>parts.find(part=>part.type===type)!.value;
  return new Date(`${value('year')}-${value('month')}-${value('day')}T00:00:00.000Z`);
}
export const addDays=(date:Date,days:number)=>new Date(date.getTime()+days*dayMs);
export function daysUntilExpiration(date:Date|null,today:Date) { return date===null?null:Math.round((date.getTime()-today.getTime())/dayMs); }
export function expirationState(date:Date|null,today:Date) {
  const days=daysUntilExpiration(date,today);
  return days===null?'No expiration':days<0?'Expired':days<=30?'0–30 Days':days<=60?'31–60 Days':days<=90?'61–90 Days':'Future expiration';
}
export function expirationWhere(window:ExpirationWindow,today:Date):Prisma.PriceExceptionWhereInput {
  const after=(days:number)=>addDays(today,days+1);
  switch(window) {
    case 'expired': case 'activeExpired': return {expirationDate:{lt:today}};
    case 'next30':return {expirationDate:{gte:today,lt:after(30)}};
    case 'next60':return {expirationDate:{gte:today,lt:after(60)}};
    case 'next90':return {expirationDate:{gte:today,lt:after(90)}};
    case 'follow-up':return {expirationDate:{lt:after(90)}};
    case 'none':return {expirationDate:null};
    case 'future':return {expirationDate:{gte:today}};
    default:return {};
  }
}
export function expirationBucketWhere(bucket:'expired'|'0-30'|'31-60'|'61-90',today:Date):Prisma.PriceExceptionWhereInput {
  if(bucket==='expired')return expirationWhere('expired',today);
  const start=bucket==='0-30'?0:bucket==='31-60'?31:61;
  const end=bucket==='0-30'?30:bucket==='31-60'?60:90;
  return {expirationDate:{gte:addDays(today,start),lt:addDays(today,end+1)}};
}
export function canViewExpirationReport(actor:Actor) {return ['ADMIN','SALES_MANAGER','SALES','READ_ONLY'].includes(actor.role)&&can(actor,'pricing.read')&&can(actor,'sales.read');}
export type ExpiringFilters={expiration?:string;status?:string;salesRep?:string;account?:string;sku?:string;q?:string;page?:string};
export function normalizeExpiration(value:string|undefined,defaultWindow:ExpirationWindow='follow-up'):ExpirationWindow {
  return value&&['all','follow-up','expired','next30','next60','next90','none','future','activeExpired'].includes(value)?value as ExpirationWindow:defaultWindow;
}
export function expiringWhere(actor:Actor,filters:ExpiringFilters,today:Date):Prisma.PriceExceptionWhereInput {
  const window=normalizeExpiration(filters.expiration);
  const status=filters.status===undefined?(window==='follow-up'||window==='activeExpired'?'ACTIVE':'ALL'):filters.status;
  const clauses:Prisma.PriceExceptionWhereInput[]=[expirationWhere(window,today)];
  if(status==='ARCHIVED')clauses.push({OR:[{archivedAt:{not:null}},{status:'ARCHIVED'}]});
  else {clauses.push({archivedAt:null});if(status&&status!=='ALL'&&Object.values(PriceExceptionStatus).includes(status as PriceExceptionStatus))clauses.push({status:status as PriceExceptionStatus});}
  if(window==='activeExpired')clauses.push({status:'ACTIVE'});
  if(filters.salesRep&&/^\d+$/.test(filters.salesRep))clauses.push({assignedSalesRepUserId:Number(filters.salesRep)});
  if(filters.account?.trim()){const q=filters.account.trim().slice(0,100);clauses.push({OR:[{distributorAccount:{name:{contains:q,mode:'insensitive'}}},{varAccount:{name:{contains:q,mode:'insensitive'}}},{endUserAccount:{name:{contains:q,mode:'insensitive'}}},{distributorSourceName:{contains:q,mode:'insensitive'}},{varSourceName:{contains:q,mode:'insensitive'}},{endUserSourceName:{contains:q,mode:'insensitive'}}]});}
  if(filters.sku?.trim())clauses.push({lines:{some:{retiredAt:null,OR:[{sourceSku:{contains:filters.sku.trim().slice(0,100),mode:'insensitive'}},{productSku:{partNumber:{contains:filters.sku.trim().slice(0,100),mode:'insensitive'}}},{productSku:{product:{name:{contains:filters.sku.trim().slice(0,100),mode:'insensitive'}}}}]}}});
  if(filters.q?.trim()){const q=filters.q.trim().slice(0,100);clauses.push({OR:[{peCode:{contains:q,mode:'insensitive'}},{distributorSourceName:{contains:q,mode:'insensitive'}},{varSourceName:{contains:q,mode:'insensitive'}},{endUserSourceName:{contains:q,mode:'insensitive'}},{lines:{some:{retiredAt:null,sourceSku:{contains:q,mode:'insensitive'}}}}]});}
  return scopedPriceExceptionWhere(actor,{AND:clauses});
}
const include={assignedSalesRepUser:{select:{firstName:true,lastName:true}},distributorAccount:{select:{name:true}},varAccount:{select:{name:true}},endUserAccount:{select:{name:true}},lines:{where:{retiredAt:null},orderBy:{sortOrder:'asc'},select:{sourceSku:true,sourceQuantity:true,sourceQuantityRaw:true,productSku:{select:{partNumber:true,product:{select:{name:true}}}}}}} as const;
export async function expiringReport(db:PrismaClient,actor:Actor,filters:ExpiringFilters,options:{all?:boolean;now?:Date}={}) {
  if(!canViewExpirationReport(actor))throw new Error('Access denied');
  const today=businessToday(options.now),where=expiringWhere(actor,filters,today);
  const count=await db.priceException.count({where});
  const page=Math.min(Math.max(Number(filters.page)||1,1),Math.max(1,Math.ceil(count/25)));
  const records=await db.priceException.findMany({where,include,orderBy:[{expirationDate:'asc'},{id:'asc'}],...(options.all?{}:{skip:(page-1)*25,take:25})});
  return {today,count,page,pages:Math.max(1,Math.ceil(count/25)),rows:records.map(row=>({id:row.id,code:row.peCode??`PE #${row.id}`,rep:row.assignedSalesRepUser?`${row.assignedSalesRepUser.firstName} ${row.assignedSalesRepUser.lastName}`:row.sourceType==='LEGACY_WORKBOOK'?'Legacy / Unassigned':'Unassigned',account:row.distributorAccount?.name??row.varAccount?.name??row.endUserAccount?.name??row.distributorSourceName??row.varSourceName??row.endUserSourceName??'—',product:priceExceptionListSummary(row.lines).product,tiers:priceExceptionListSummary(row.lines).tierText,status:row.status,expirationDate:row.expirationDate,days:daysUntilExpiration(row.expirationDate,today),state:expirationState(row.expirationDate,today)}))};
}
export async function expiringDashboardCounts(db:PrismaClient,actor:Actor,now=new Date()) {
  if(!canViewExpirationReport(actor))throw new Error('Access denied');
  const today=businessToday(now),base=expiringWhere(actor,{expiration:'all',status:'ACTIVE'},today);
  const buckets=['expired','0-30','31-60','61-90'] as const;
  const counts=await Promise.all(buckets.map(bucket=>db.priceException.count({where:{AND:[base,expirationBucketWhere(bucket,today)]}})));
  return Object.fromEntries(buckets.map((bucket,index)=>[bucket,counts[index]])) as Record<typeof buckets[number],number>;
}
