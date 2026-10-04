import { Prisma, type PrismaClient, type SalesQuarter } from '@prisma/client';
import { can, type Actor } from './authorization';
import { activeSalesRepWhere } from './assignment-eligibility';
import { quarterBounds } from './forecast';
import { snapshotChange } from './opportunity-history';
import { annualTargetFromRows } from './sales-plan';
import { salesPlanPopulation, salesPlanReportTotals } from './sales-plan-queries';
import { targetSyncStatus } from './sales-target-sync';
import { audienceListWhere } from './marketing-audiences';

const zero = new Prisma.Decimal(0);
export async function dashboardForecastMovement(client:PrismaClient,actor:Actor,input:{year:number;quarter:SalesQuarter;currencyCode:string}) {
  if (!can(actor,'sales.read') || !['SALES','SALES_MANAGER','ADMIN'].includes(actor.role)) throw new Error('Access denied');
  const repIds=actor.role==='SALES'?[actor.id]:(await client.user.findMany({where:activeSalesRepWhere(),select:{id:true}})).map(row=>row.id);
  if (!repIds.length) return null;
  const where={...input,repId:{in:repIds}};
  const weeks=await client.$queryRaw<{snapshotWeek:Date}[]>(Prisma.sql`
    SELECT DISTINCT "snapshotWeek" FROM "ForecastSnapshot"
    WHERE year=${input.year} AND quarter=${input.quarter}::"SalesQuarter"
      AND "currencyCode"=${input.currencyCode} AND "repId" IN (${Prisma.join(repIds)})
    ORDER BY "snapshotWeek" DESC LIMIT 2`);
  if (weeks.length<2) return null;
  const [currentWeek,previousWeek]=weeks.map(row=>row.snapshotWeek.toISOString().slice(0,10));
  const rows=await client.forecastSnapshot.findMany({where:{...where,snapshotWeek:{in:weeks.map(row=>row.snapshotWeek)}},select:{snapshotWeek:true,pipeline:true,weightedPipeline:true,bestCase:true,commit:true,target:true}});
  const bounds=quarterBounds(input.year,input.quarter);
  const from=new Date(`${previousWeek}T00:00:00Z`),to=new Date(new Date(`${currentWeek}T00:00:00Z`).getTime()+7*86400000);
  // Count distinct Opportunities, not edits. Match the report's captured-week interval.
  const [slips]=await client.$queryRaw<{count:bigint}[]>(Prisma.sql`
    SELECT COUNT(DISTINCT e."opportunityId")::bigint AS count
    FROM "OpportunityHistoryEvent" e JOIN "Opportunity" o ON o.id=e."opportunityId"
    WHERE e."eventType"='EXPECTED_CLOSE_DATE' AND e."occurredAt">=${from} AND e."occurredAt"<${to}
      AND e."oldCloseDate">=${bounds.start} AND e."oldCloseDate"<${bounds.endExclusive}
      AND e."newCloseDate">=${bounds.endExclusive} AND o."ownerId" IN (${Prisma.join(repIds)})
      AND o."currencyCode"=${input.currencyCode}`);
  return {previousWeek,currentWeek,pipeline:snapshotChange(rows,previousWeek,currentWeek,'pipeline').change,
    bestCase:snapshotChange(rows,previousWeek,currentWeek,'bestCase').change,
    commit:snapshotChange(rows,previousWeek,currentWeek,'commit').change,slipped:Number(slips?.count??0)};
}

export async function dashboardSalesPlanStatus(client:PrismaClient,actor:Actor,input:{year:number;currencyCode:string}) {
  if (!can(actor,'sales-plan.read') || !['SALES','SALES_MANAGER','ADMIN'].includes(actor.role)) throw new Error('Access denied');
  const reps=actor.role==='SALES'?[{id:actor.id}]:await client.user.findMany({where:activeSalesRepWhere(),select:{id:true}});
  const repIds=reps.map(row=>row.id);
  const plans=await client.salesPlan.findMany({where:{planYear:input.year,currencyCode:input.currencyCode,status:'ACTIVE',ownerId:{in:repIds},owner:activeSalesRepWhere()},select:{ownerId:true}});
  const population=salesPlanPopulation(repIds,plans.map(row=>row.ownerId),actor.role==='SALES'?actor.id:null);
  const ownerIds=population.ownerIds;
  if (!ownerIds.length) return {population,annual:null,target:null,difference:null,allocationPercent:null,incomplete:0,outOfSync:0,syncStatus:null};
  const [totals,targets]=await Promise.all([
    salesPlanReportTotals(client,input.year,input.currencyCode,actor.role==='SALES'?actor.id:null),
    client.salesTarget.findMany({where:{userId:{in:ownerIds},year:input.year,currencyCode:input.currencyCode,archivedAt:null},select:{userId:true,quarter:true,targetAmount:true}}),
  ]);
  const hasRevenue=ownerIds.some(id=>(totals.get(id)?.revenueCount??0)>0);
  const annual=hasRevenue?ownerIds.reduce((sum,id)=>sum.add(totals.get(id)?.annual??zero),zero):null;
  const target=annualTargetFromRows(ownerIds,targets);
  const lineCount=ownerIds.reduce((sum,id)=>sum+(totals.get(id)?.count??0),0);
  const complete=ownerIds.reduce((sum,id)=>sum+(totals.get(id)?.complete??0),0);
  const statuses=ownerIds.map(id=>targetSyncStatus((totals.get(id)?.revenueCount??0)>0?totals.get(id)!.annual:null,targets.filter(row=>row.userId===id)));
  return {population,annual,target:target.amount,difference:target.amount&&annual?annual.sub(target.amount):null,
    allocationPercent:lineCount?Math.round(100*complete/lineCount):null,
    incomplete:ownerIds.filter(id=>(totals.get(id)?.complete??0)<(totals.get(id)?.count??0)).length,
    outOfSync:statuses.filter(status=>status!=='In Sync').length,
    syncStatus:actor.role==='SALES'?statuses[0]:null};
}

export async function dashboardMarketingActivity(client:PrismaClient,actor:Actor,now=new Date()) {
  if (!can(actor,'marketing.read') || !['ADMIN','MARKETING_MANAGER'].includes(actor.role)) throw new Error('Access denied');
  const recentStart=new Date(now.getTime()-7*86400000);
  const [campaigns,influences,leads,audiences]=await Promise.all([
    client.marketingCampaign.count({where:{status:'ACTIVE',archivedAt:null}}),
    client.campaignInfluence.count({where:{occurredAt:{gte:recentStart,lte:now},voidedAt:null,campaign:{archivedAt:null}}}),
    client.tradeShowLead.count({where:{tradeShow:{archivedAt:null},status:{in:['NEW','CONTACTED','QUALIFIED']},routing:{in:['UNREVIEWED','MARKETING_FOLLOW_UP']}}}),
    client.marketingAudience.count({where:audienceListWhere(actor)}),
  ]);
  return {campaigns,influences,leads,audiences};
}
