import { Prisma, SupportCasePriority, SupportCaseStatus, type PrismaClient } from '@prisma/client';
import { assertPermission, can, type Actor } from './authorization';
import { supportCaseReadWhere, supportCaseListOrder } from './support-cases';
import { calendarLocalToUtc } from './calendar-time';
import { DEFAULT_USER_TIME_ZONE } from './user-time-zone';

const day = 86400000;
export const activeSupportStatuses: SupportCaseStatus[] = ['NEW','OPEN','WAITING_ON_CUSTOMER','WAITING_ON_INTERNAL'];
export type SupportReportFilters = { rep?: string; status?: string; priority?: string; account?: string; contact?: string; category?: string; product?: string; purchasedFrom?: string; openedFrom?: string; openedTo?: string; resolvedFrom?: string; resolvedTo?: string; followUp?: string; q?: string; sort?: string; page?: string; archive?: string };
const numeric = (value?: string) => value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value)>0 ? Number(value) : undefined;
const date = (value?: string, end = false) => { if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined; const parsed = new Date(`${value}T00:00:00.000Z`); if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10)!==value) return undefined; return end ? new Date(parsed.getTime()+day) : parsed; };
const todayCache=new WeakMap<Date,{start:Date;end:Date}>();
export function supportToday(now = new Date()) { const cached=todayCache.get(now);if(cached)return cached;const parts=new Intl.DateTimeFormat('en-US',{timeZone:DEFAULT_USER_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);const get=(type:string)=>parts.find(part=>part.type===type)!.value;const iso=`${get('year')}-${get('month')}-${get('day')}`;const start=calendarLocalToUtc(`${iso}T00:00`,DEFAULT_USER_TIME_ZONE)!;const next=new Date(Date.UTC(Number(get('year')),Number(get('month'))-1,Number(get('day'))+1)).toISOString().slice(0,10);const bounds={start,end:calendarLocalToUtc(`${next}T00:00`,DEFAULT_USER_TIME_ZONE)!};todayCache.set(now,bounds);return bounds; }
export function supportReportWhere(actor: Actor, filters: SupportReportFilters, now = new Date()): Prisma.SupportCaseWhereInput {
  const clauses: Prisma.SupportCaseWhereInput[] = [supportCaseReadWhere(actor,filters.archive==='all'||filters.archive==='archived')];
  if (filters.archive==='archived') clauses.push({archivedAt:{not:null}});
  if (numeric(filters.rep)) clauses.push({assignedToId:numeric(filters.rep)});
  if (Object.values(SupportCaseStatus).includes(filters.status as SupportCaseStatus)) clauses.push({status:filters.status as SupportCaseStatus});
  if (Object.values(SupportCasePriority).includes(filters.priority as SupportCasePriority)) clauses.push({priority:filters.priority as SupportCasePriority});
  if(numeric(filters.category)) clauses.push({categoryId:numeric(filters.category)});
  if(filters.account?.trim()) clauses.push({account:{name:{contains:filters.account.trim().slice(0,100),mode:'insensitive'}}});
  if(filters.contact?.trim()) { const name=filters.contact.trim().slice(0,100),parts=name.split(/\s+/); clauses.push({contact:{OR:[{firstName:{contains:name,mode:'insensitive'}},{lastName:{contains:name,mode:'insensitive'}},...(parts.length>1?[{AND:[{firstName:{contains:parts[0],mode:'insensitive' as const}},{lastName:{contains:parts.slice(1).join(' '),mode:'insensitive' as const}}]}]:[])]}}); }
  if(filters.product?.trim()) { const value=filters.product.trim().slice(0,100);clauses.push({productSku:{OR:[{partNumber:{contains:value,mode:'insensitive'}},{product:{name:{contains:value,mode:'insensitive'}}}]}}); }
  if(filters.purchasedFrom?.trim()) clauses.push({purchasedFromAccount:{name:{contains:filters.purchasedFrom.trim().slice(0,100),mode:'insensitive'}}});
  const openedFrom=date(filters.openedFrom),openedTo=date(filters.openedTo,true),resolvedFrom=date(filters.resolvedFrom),resolvedTo=date(filters.resolvedTo,true);
  if(openedFrom||openedTo) clauses.push({openedAt:{...(openedFrom?{gte:openedFrom}:{}),...(openedTo?{lt:openedTo}:{})}});
  if(resolvedFrom||resolvedTo) clauses.push({resolvedAt:{...(resolvedFrom?{gte:resolvedFrom}:{}),...(resolvedTo?{lt:resolvedTo}:{})}});
  const {start,end}=supportToday(now);
  if(filters.followUp==='overdue') clauses.push({status:{in:activeSupportStatuses},nextFollowUpAt:{lt:start}});
  if(filters.followUp==='today') clauses.push({status:{in:activeSupportStatuses},nextFollowUpAt:{gte:start,lt:end}});
  if(filters.followUp==='upcoming') clauses.push({status:{in:activeSupportStatuses},nextFollowUpAt:{gte:end}});
  if(filters.followUp==='none') clauses.push({nextFollowUpAt:null});
  const q=filters.q?.trim().slice(0,100);
  if(q) { const parts=q.split(/\s+/); clauses.push({OR:[{caseNumber:{contains:q,mode:'insensitive'}},{subject:{contains:q,mode:'insensitive'}},{serialNumber:{contains:q,mode:'insensitive'}},{customerNameText:{contains:q,mode:'insensitive'}},{purchaseSourceText:{contains:q,mode:'insensitive'}},{account:{name:{contains:q,mode:'insensitive'}}},{contact:{OR:[{firstName:{contains:q,mode:'insensitive'}},{lastName:{contains:q,mode:'insensitive'}},...(parts.length>1?[{AND:[{firstName:{contains:parts[0],mode:'insensitive' as const}},{lastName:{contains:parts.slice(1).join(' '),mode:'insensitive' as const}}]}]:[])]}}]}); }
  return {AND:clauses};
}
const rowInclude = {account:{select:{name:true}},contact:{select:{firstName:true,lastName:true}},category:{select:{name:true}},assignedTo:{select:{firstName:true,lastName:true}},productSku:{select:{partNumber:true}},purchasedFromAccount:{select:{name:true}}} as const;
// PostgreSQL computes duration averages over the same filtered set; no case rows
// are transferred merely to calculate management KPIs.
function supportAverageWhere(filters:SupportReportFilters,now:Date,actor:Actor) {
  const parts:Prisma.Sql[]=[];
  if(!can(actor,'support-cases.write'))parts.push(Prisma.sql`c."accountId" IS NOT NULL`);
  if(filters.archive!=='all'&&filters.archive!=='archived')parts.push(Prisma.sql`c."archivedAt" IS NULL`);
  if(filters.archive==='archived')parts.push(Prisma.sql`c."archivedAt" IS NOT NULL`);
  if(numeric(filters.rep))parts.push(Prisma.sql`c."assignedToId" = ${numeric(filters.rep)}`);
  if(Object.values(SupportCaseStatus).includes(filters.status as SupportCaseStatus))parts.push(Prisma.sql`c.status = ${filters.status}::"SupportCaseStatus"`);
  if(Object.values(SupportCasePriority).includes(filters.priority as SupportCasePriority))parts.push(Prisma.sql`c.priority = ${filters.priority}::"SupportCasePriority"`);
  if(numeric(filters.category))parts.push(Prisma.sql`c."categoryId" = ${numeric(filters.category)}`);
  const text=(value:string|undefined)=>value?.trim().slice(0,100);
  if(text(filters.account))parts.push(Prisma.sql`EXISTS (SELECT 1 FROM "Account" a WHERE a.id=c."accountId" AND a.name ILIKE ${`%${text(filters.account)}%`})`);
  if(text(filters.contact)){const name=text(filters.contact)!,words=name.split(/\s+/);parts.push(Prisma.sql`EXISTS (SELECT 1 FROM "Contact" t WHERE t.id=c."contactId" AND (t."firstName" ILIKE ${`%${name}%`} OR t."lastName" ILIKE ${`%${name}%`} ${words.length>1?Prisma.sql`OR (t."firstName" ILIKE ${`%${words[0]}%`} AND t."lastName" ILIKE ${`%${words.slice(1).join(' ')}%`})`:Prisma.empty}))`);}
  if(text(filters.product))parts.push(Prisma.sql`EXISTS (SELECT 1 FROM "ProductSku" p LEFT JOIN "Product" pd ON pd.id=p."productId" WHERE p.id=c."productSkuId" AND (p."partNumber" ILIKE ${`%${text(filters.product)}%`} OR pd.name ILIKE ${`%${text(filters.product)}%`}))`);
  if(text(filters.purchasedFrom))parts.push(Prisma.sql`EXISTS (SELECT 1 FROM "Account" a WHERE a.id=c."purchasedFromAccountId" AND a.name ILIKE ${`%${text(filters.purchasedFrom)}%`})`);
  const openedFrom=date(filters.openedFrom),openedTo=date(filters.openedTo,true),resolvedFrom=date(filters.resolvedFrom),resolvedTo=date(filters.resolvedTo,true);
  if(openedFrom)parts.push(Prisma.sql`c."openedAt" >= ${openedFrom}`);if(openedTo)parts.push(Prisma.sql`c."openedAt" < ${openedTo}`);
  if(resolvedFrom)parts.push(Prisma.sql`c."resolvedAt" >= ${resolvedFrom}`);if(resolvedTo)parts.push(Prisma.sql`c."resolvedAt" < ${resolvedTo}`);
  const {start,end}=supportToday(now);
  if(['overdue','today','upcoming'].includes(filters.followUp??''))parts.push(Prisma.sql`c.status IN ('NEW','OPEN','WAITING_ON_CUSTOMER','WAITING_ON_INTERNAL')`);
  if(filters.followUp==='overdue')parts.push(Prisma.sql`c."nextFollowUpAt" < ${start}`);
  if(filters.followUp==='today')parts.push(Prisma.sql`c."nextFollowUpAt" >= ${start} AND c."nextFollowUpAt" < ${end}`);
  if(filters.followUp==='upcoming')parts.push(Prisma.sql`c."nextFollowUpAt" >= ${end}`);
  if(filters.followUp==='none')parts.push(Prisma.sql`c."nextFollowUpAt" IS NULL`);
  const q=text(filters.q);if(q){const like=`%${q}%`,words=q.split(/\s+/);parts.push(Prisma.sql`(c."caseNumber" ILIKE ${like} OR c.subject ILIKE ${like} OR c."serialNumber" ILIKE ${like} OR c."customerNameText" ILIKE ${like} OR c."purchaseSourceText" ILIKE ${like} OR EXISTS (SELECT 1 FROM "Account" a WHERE a.id=c."accountId" AND a.name ILIKE ${like}) OR EXISTS (SELECT 1 FROM "Contact" t WHERE t.id=c."contactId" AND (t."firstName" ILIKE ${like} OR t."lastName" ILIKE ${like} ${words.length>1?Prisma.sql`OR (t."firstName" ILIKE ${`%${words[0]}%`} AND t."lastName" ILIKE ${`%${words.slice(1).join(' ')}%`})`:Prisma.empty})))`);}
  return parts.length?Prisma.sql`WHERE ${Prisma.join(parts,' AND ')}`:Prisma.empty;
}
export const supportAgeDays=(opened:Date,end:Date)=>Math.max(0,Math.floor((end.getTime()-opened.getTime())/day));
export function supportCaseAge(row:{openedAt:Date;status:SupportCaseStatus;resolvedAt?:Date|null;closedAt?:Date|null},now=new Date()) {return supportAgeDays(row.openedAt,row.status==='RESOLVED'?row.resolvedAt??now:row.status==='CLOSED'?row.closedAt??now:now);}
export function supportReportOrder(sort?:string):Prisma.SupportCaseOrderByWithRelationInput[] { if(sort==='oldest') return supportCaseListOrder('oldest'); if(sort==='priority') return supportCaseListOrder('priority'); if(sort==='follow-up') return supportCaseListOrder('follow-up'); if(sort==='number') return supportCaseListOrder('number'); if(sort==='resolved') return [{resolvedAt:'desc'},{id:'desc'}]; return supportCaseListOrder('newest'); }
export async function supportReport(db:PrismaClient,actor:Actor,filters:SupportReportFilters,options:{all?:boolean;now?:Date}={}) {
  assertPermission(actor,'support-cases.read');
  // The SQL duration aggregate applies the same linked-case scope as case reads.
  const now=options.now??new Date(),where=supportReportWhere(actor,filters,now),{start}=supportToday(now);
  const period=(from?:string,to?:string)=>({...(date(from)?{gte:date(from)}:{}),...(date(to,true)?{lt:date(to,true)}:{}),...(!date(from)&&!date(to,true)?{gte:new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)),lt:new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1))}:{})});
  const active={AND:[where,{archivedAt:null,status:{in:activeSupportStatuses}}]} as Prisma.SupportCaseWhereInput;
  const [count,status,priority,category,product,rep,purchasedFrom,open,highCritical,overdue,opened, resolved, oldest, averages] = await Promise.all([
    db.supportCase.count({where}),db.supportCase.groupBy({by:['status'],where,_count:{_all:true}}),db.supportCase.groupBy({by:['priority'],where,_count:{_all:true}}),db.supportCase.groupBy({by:['categoryId'],where,_count:{_all:true}}),db.supportCase.groupBy({by:['productSkuId'],where,_count:{_all:true}}),db.supportCase.groupBy({by:['assignedToId'],where,_count:{_all:true}}),db.supportCase.groupBy({by:['purchasedFromAccountId'],where,_count:{_all:true}}),
    db.supportCase.count({where:active}),db.supportCase.count({where:{AND:[active,{priority:{in:['HIGH','CRITICAL']}}]}}),db.supportCase.count({where:{AND:[active,{nextFollowUpAt:{lt:start}}]}}),db.supportCase.count({where:{AND:[where,{openedAt:period(filters.openedFrom,filters.openedTo)}]}}),db.supportCase.count({where:{AND:[where,{resolvedAt:period(filters.resolvedFrom,filters.resolvedTo)}]}}),db.supportCase.findFirst({where:active,orderBy:{openedAt:'asc'},select:{openedAt:true}}),db.$queryRaw<{openAge:unknown;resolutionAge:unknown}[]>`SELECT AVG(EXTRACT(EPOCH FROM (${now}::timestamptz - c."openedAt"))/86400) FILTER (WHERE c."archivedAt" IS NULL AND c.status IN ('NEW','OPEN','WAITING_ON_CUSTOMER','WAITING_ON_INTERNAL')) AS "openAge", AVG(EXTRACT(EPOCH FROM (c."resolvedAt" - c."openedAt"))/86400) FILTER (WHERE c."resolvedAt" IS NOT NULL) AS "resolutionAge" FROM "SupportCase" c ${supportAverageWhere(filters,now,actor)}`
  ]);
  const pages=Math.max(1,Math.ceil(count/25)),page=Math.min(Math.max(Number(filters.page)||1,1),pages);
  const rows=await db.supportCase.findMany({where,include:rowInclude,orderBy:supportReportOrder(filters.sort),...(options.all?{}:{skip:(page-1)*25,take:25})});
  const ids={category:category.map(x=>x.categoryId).filter((x):x is number=>x!==null),product:product.map(x=>x.productSkuId).filter((x):x is number=>x!==null),rep:rep.map(x=>x.assignedToId).filter((x):x is number=>x!==null),purchasedFrom:purchasedFrom.map(x=>x.purchasedFromAccountId).filter((x):x is number=>x!==null)};
  const [categories,products,reps,accounts]=await Promise.all([db.supportCaseCategory.findMany({where:{id:{in:ids.category}},select:{id:true,name:true}}),db.productSku.findMany({where:{id:{in:ids.product}},select:{id:true,partNumber:true}}),db.user.findMany({where:{id:{in:ids.rep}},select:{id:true,firstName:true,lastName:true}}),db.account.findMany({where:{id:{in:ids.purchasedFrom}},select:{id:true,name:true}})]);
  const named=(groups:{[key:string]:unknown;_count:{_all:number}}[],key:string,lookup:{id:number;name:string}[],empty:string)=>groups.map(g=>({label:lookup.find(x=>x.id===g[key])?.name??empty,count:g._count._all})).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label));
  const ageWhere=(from:number,to?:number):Prisma.SupportCaseWhereInput=>({AND:[active,{openedAt:{lte:new Date(now.getTime()-from*day),...(to===undefined?{}:{gt:new Date(now.getTime()-(to+1)*day)})}}]});
  const aging=await Promise.all([[0,2],[3,7],[8,14],[15,30],[31,undefined]].map(async ([from,to])=>({label:to===undefined?'31+ days':`${from}–${to} days`,count:await db.supportCase.count({where:ageWhere(from!,to)})})));
  const rounded=(value:unknown)=>value==null?null:Math.round(Number(value)*10)/10;
  return {rows,count,page,pages,now,summary:{open,highCritical,overdue,opened,resolved,averageOpenDays:rounded(averages[0]?.openAge),averageResolutionDays:rounded(averages[0]?.resolutionAge),oldestOpenDays:oldest?supportAgeDays(oldest.openedAt,now):null},groups:{status:status.map(g=>({label:g.status,count:g._count._all})),priority:priority.map(g=>({label:g.priority,count:g._count._all})),category:named(category,'categoryId',categories,'Uncategorized'),product:named(product,'productSkuId',products.map(p=>({id:p.id,name:p.partNumber})),'No Product / SKU'),rep:named(rep,'assignedToId',reps.map(r=>({id:r.id,name:`${r.firstName} ${r.lastName}`})),'Unassigned'),purchasedFrom:named(purchasedFrom,'purchasedFromAccountId',accounts,'Unresolved Purchased From')},aging};
}
