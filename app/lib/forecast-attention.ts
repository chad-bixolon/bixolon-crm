import { Prisma, type PrismaClient, type SalesQuarter } from '@prisma/client';
import { can, opportunityScope, type Actor } from './authorization';
import { operationalOpportunityWhere } from './operational-where';
import { opportunityTotal } from './opportunities';
import { quarterBounds } from './forecast';

export const attentionIssues = ['MISSING_CLOSE_DATE','ZERO_VALUE','MISSING_OWNER','PAST_CLOSE_DATE','STALE_COMMIT'] as const;
export type AttentionIssue = typeof attentionIssues[number];
export const attentionLabels: Record<AttentionIssue,string> = {
  MISSING_CLOSE_DATE:'Missing close date', ZERO_VALUE:'No products / zero value', MISSING_OWNER:'Missing owner', PAST_CLOSE_DATE:'Past close date', STALE_COMMIT:'Commit without recent Activity',
};
export function easternToday(now:Date) {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const read=(key:string)=>Number(parts.find(part=>part.type===key)?.value);
  return new Date(Date.UTC(read('year'),read('month')-1,read('day')));
}
export function commitActivityCutoff(now:Date,days:number) {
  const today=easternToday(now);
  const localDate=new Date(today.getTime()-(days-1)*86400000);
  const zone=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',timeZoneName:'shortOffset'}).formatToParts(new Date(localDate.getTime()+43200000)).find(part=>part.type==='timeZoneName')?.value??'GMT-5';
  const match=/GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(zone);
  const offset=match?(match[1]==='+'?1:-1)*(Number(match[2])*60+Number(match[3]??0)):-300;
  return new Date(localDate.getTime()-offset*60000);
}
type Filters={currencyCode?:string;year?:number;quarter?:SalesQuarter;issue?:AttentionIssue;ownerId?:number;page?:number};
export function attentionPredicates(now:Date,days:number):Record<AttentionIssue,Prisma.OpportunityWhereInput> {
  const today=easternToday(now);
  return {
    MISSING_CLOSE_DATE:{expectedCloseDate:null},
    ZERO_VALUE:{products:{none:{archivedAt:null,estimatedUnitPrice:{gt:0}}}},
    MISSING_OWNER:{ownerId:null},
    PAST_CLOSE_DATE:{expectedCloseDate:{lt:today}},
    STALE_COMMIT:{forecastCategory:'COMMIT',activities:{none:{archivedAt:null,activityDate:{gte:commitActivityCutoff(now,days)}}}},
  };
}
export function attentionBaseWhere(actor:Actor,filters:Filters={}):Prisma.OpportunityWhereInput {
  if(!can(actor,'sales.read'))throw new Error('Access denied');
  const clauses:Prisma.OpportunityWhereInput[]=[operationalOpportunityWhere,opportunityScope(actor),{stage:{isClosed:false}}];
  if(filters.currencyCode)clauses.push({currencyCode:filters.currencyCode});
  if(filters.ownerId && actor.role!=='SALES')clauses.push({ownerId:filters.ownerId});
  if(filters.year&&filters.quarter){const {start,endExclusive}=quarterBounds(filters.year,filters.quarter);clauses.push({OR:[{expectedCloseDate:{gte:start,lt:endExclusive}},{expectedCloseDate:null}]});}
  return {AND:clauses};
}
export function attentionWhere(actor:Actor,now:Date,days:number,filters:Filters={}) {
  const predicates=attentionPredicates(now,days);
  return {AND:[attentionBaseWhere(actor,filters),filters.issue?predicates[filters.issue]:{OR:Object.values(predicates)}]} satisfies Prisma.OpportunityWhereInput;
}
const select={id:true,name:true,ownerId:true,forecastCategory:true,currencyCode:true,expectedCloseDate:true,createdAt:true,participants:{take:1,orderBy:{accountId:'asc'},select:{account:{select:{name:true}}}},products:{where:{archivedAt:null},select:{quantity:true,estimatedUnitPrice:true}},activities:{where:{archivedAt:null},orderBy:[{activityDate:'desc'},{id:'desc'}],take:1,select:{activityDate:true}}} satisfies Prisma.OpportunitySelect;
type AttentionRow=Prisma.OpportunityGetPayload<{select:typeof select}>;
export function classifyAttention(row:AttentionRow,now:Date,days:number) {
  const value=opportunityTotal(row.products);
  const today=easternToday(now);
  const issues:AttentionIssue[]=[];
  if(!row.expectedCloseDate)issues.push('MISSING_CLOSE_DATE');
  if(value.isZero())issues.push('ZERO_VALUE');
  if(row.ownerId===null)issues.push('MISSING_OWNER');
  if(row.expectedCloseDate&&row.expectedCloseDate<today)issues.push('PAST_CLOSE_DATE');
  const latest=row.activities[0]?.activityDate;
  if(row.forecastCategory==='COMMIT'&&(!latest||latest<commitActivityCutoff(now,days)))issues.push('STALE_COMMIT');
  const lastActivityDays=latest?Math.max(0,Math.floor((today.getTime()-easternToday(latest).getTime())/86400000)):null;
  return {id:row.id,name:row.name,account:row.participants[0]?.account.name??'—',ownerId:row.ownerId,forecastCategory:row.forecastCategory,currencyCode:row.currencyCode,closeDate:row.expectedCloseDate?.toISOString().slice(0,10)??null,value:value.toFixed(2),issues,lastActivityDays};
}
export async function getForecastAttention(client:PrismaClient,actor:Actor,input:{now?:Date;days:number;filters?:Filters;mode?:'DASHBOARD'|'DETAIL'}) {
  const now=input.now??new Date(),filters=input.filters??{},predicates=attentionPredicates(now,input.days),base=attentionBaseWhere(actor,filters);
  const counts=await Promise.all(attentionIssues.map(issue=>client.opportunity.count({where:{AND:[base,predicates[issue]]}})));
  const countByIssue=Object.fromEntries(attentionIssues.map((issue,index)=>[issue,counts[index]])) as Record<AttentionIssue,number>;
  const where=attentionWhere(actor,now,input.days,filters);
  const total=await client.opportunity.count({where});
  const page=Math.max(1,Math.min(10000,filters.page??1));
  // Dashboard reads at most 64 candidate rows, then ranks the short list. Detail is paged.
  const rows=await client.opportunity.findMany({where,select,orderBy:input.mode==='DETAIL'?[{expectedCloseDate:'asc'},{id:'asc'}]:[{forecastCategory:'desc'},{expectedCloseDate:'asc'},{id:'asc'}],take:input.mode==='DETAIL'?25:64,skip:input.mode==='DETAIL'?(page-1)*25:0});
  const mapped=rows.map(row=>classifyAttention(row,now,input.days));
  if(input.mode!=='DETAIL')mapped.sort((a,b)=>Number(b.issues.includes('STALE_COMMIT')||b.forecastCategory==='COMMIT')-Number(a.issues.includes('STALE_COMMIT')||a.forecastCategory==='COMMIT')||Number(new Prisma.Decimal(b.value).cmp(a.value))||Number(b.issues.includes('PAST_CLOSE_DATE'))-Number(a.issues.includes('PAST_CLOSE_DATE'))||b.issues.length-a.issues.length||a.id-b.id);
  return {total,countByIssue,rows:input.mode==='DETAIL'?mapped:mapped.slice(0,8),page,pages:Math.ceil(total/25),candidateLimit:input.mode==='DETAIL'?25:64};
}
