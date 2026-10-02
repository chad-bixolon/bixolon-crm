import { Prisma, type PrismaClient } from '@prisma/client';
import type { Actor } from './authorization';
import { pageNumber } from './crm-validation';

export type PlanLineFilters = {year:number; currencyCode:string; userId:number|null; history:boolean; account?:string; sku?:string; status?:string; search?:string; page?:string};

// The allocation expression follows allocationSummary: absent annual measures do not
// participate, zero annual measures are complete, and excess takes precedence.
const lineBase = Prisma.sql`
  FROM "SalesPlanLine" l
  JOIN "SalesPlan" p ON p.id = l."planId"
  JOIN "User" u ON u.id = p."ownerId"
  LEFT JOIN "Account" a ON a.id = l."accountId"
  LEFT JOIN "ProductSku" sku ON sku.id = l."productSkuId"
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(q."plannedUnits"),0) AS units,
           COALESCE(SUM(q."plannedRevenue"),0) AS revenue,
           COALESCE(SUM(q."plannedRevenue") FILTER (WHERE q.quarter = 'Q1'),0) AS q1,
           COALESCE(SUM(q."plannedRevenue") FILTER (WHERE q.quarter = 'Q2'),0) AS q2,
           COALESCE(SUM(q."plannedRevenue") FILTER (WHERE q.quarter = 'Q3'),0) AS q3,
           COALESCE(SUM(q."plannedRevenue") FILTER (WHERE q.quarter = 'Q4'),0) AS q4
    FROM "SalesPlanQuarterAllocation" q WHERE q."salesPlanLineId" = l.id
  ) allocation ON true`;

function scope(f:PlanLineFilters, actor:Actor) {
  return Prisma.sql`p."planYear" = ${f.year} AND p."currencyCode" = ${f.currencyCode}
    AND p.status IN ('ACTIVE'::"SalesPlanStatus"${f.history?Prisma.sql`, 'SUPERSEDED'::"SalesPlanStatus"`:Prisma.empty})
    ${f.userId!==null?Prisma.sql`AND p."ownerId" = ${f.userId}`:Prisma.empty}
    ${actor.role==='SALES'?Prisma.sql`AND p."ownerId" = ${actor.id}`:Prisma.empty}
    ${f.history?Prisma.empty:Prisma.sql`AND u.active = true AND u."archivedAt" IS NULL AND u.role IN ('SALES'::"UserRole", 'SALES_MANAGER'::"UserRole")`}`;
}

function base(f:PlanLineFilters, actor:Actor) {
  return Prisma.sql`WITH lines AS (
    SELECT l.id, l."accountId", l."originalAccountText", l."annualPlannedUnits", l."annualPlannedRevenue",
           p."ownerId", p.status AS plan_status, p.revision, u."lastName", u."firstName", l."sourceWorksheet", l."sourceRow",
           allocation.q1, allocation.q2, allocation.q3, allocation.q4,
           CASE WHEN (l."annualPlannedUnits" IS NOT NULL AND allocation.units > l."annualPlannedUnits")
                  OR (l."annualPlannedRevenue" IS NOT NULL AND allocation.revenue > l."annualPlannedRevenue") THEN 'Overallocated'
                WHEN (l."annualPlannedUnits" IS NOT NULL OR l."annualPlannedRevenue" IS NOT NULL)
                  AND (l."annualPlannedUnits" IS NULL OR allocation.units = l."annualPlannedUnits")
                  AND (l."annualPlannedRevenue" IS NULL OR allocation.revenue = l."annualPlannedRevenue") THEN 'Fully allocated'
                WHEN (l."annualPlannedUnits" IS NULL OR allocation.units = 0)
                  AND (l."annualPlannedRevenue" IS NULL OR allocation.revenue = 0) THEN 'Not allocated'
                ELSE 'Partially allocated' END AS allocation_status
    ${lineBase}
    WHERE ${scope(f,actor)}
      ${f.account?Prisma.sql`AND strpos(lower(concat(COALESCE(a.name,''),' ',COALESCE(l."originalAccountText",''))), lower(${f.account})) > 0`:Prisma.empty}
      ${f.sku?Prisma.sql`AND strpos(lower(concat(COALESCE(sku."partNumber",''),' ',COALESCE(l."originalSkuText",''))), lower(${f.sku})) > 0`:Prisma.empty}
      ${f.search?Prisma.sql`AND strpos(lower(concat(COALESCE(l."planItem",''),' ',COALESCE(l.comments,''),' ',COALESCE(l."originalAccountText",''))), lower(${f.search})) > 0`:Prisma.empty}
  ), filtered AS (SELECT * FROM lines ${f.status?Prisma.sql`WHERE allocation_status = ${f.status}`:Prisma.empty})`;
}

type Totals = {count:bigint; annual:Prisma.Decimal; units:Prisma.Decimal; revenueCount:bigint; unitsCount:bigint; complete:bigint; accounts:bigint; q1:Prisma.Decimal; q2:Prisma.Decimal; q3:Prisma.Decimal; q4:Prisma.Decimal};
const totalsSql = Prisma.sql`COUNT(*)::bigint AS count, COALESCE(SUM("annualPlannedRevenue"),0) AS annual,
  COALESCE(SUM("annualPlannedUnits"),0) AS units, COUNT("annualPlannedRevenue")::bigint AS "revenueCount",
  COUNT("annualPlannedUnits")::bigint AS "unitsCount", COUNT(*) FILTER (WHERE allocation_status = 'Fully allocated')::bigint AS complete,
  COUNT(DISTINCT CASE WHEN "accountId" IS NOT NULL THEN jsonb_build_array('id',"accountId") ELSE jsonb_build_array('text',"originalAccountText") END)::bigint AS accounts,
  COALESCE(SUM(q1),0) AS q1, COALESCE(SUM(q2),0) AS q2, COALESCE(SUM(q3),0) AS q3, COALESCE(SUM(q4),0) AS q4`;
const numberTotals = (t:Totals) => ({...t,count:Number(t.count),revenueCount:Number(t.revenueCount),unitsCount:Number(t.unitsCount),complete:Number(t.complete),accounts:Number(t.accounts)});

export async function salesPlanLinePage(client:PrismaClient, actor:Actor, f:PlanLineFilters) {
  const query=base(f,actor);
  const [countRow]=await client.$queryRaw<{count:bigint}[]>(Prisma.sql`${query} SELECT COUNT(*)::bigint AS count FROM filtered`);
  const {page,pages}=pageNumber(f.page,Number(countRow.count),50);
  const [ids,summaryRows,owners]=await Promise.all([
    client.$queryRaw<{id:number}[]>(Prisma.sql`${query} SELECT id FROM filtered ORDER BY "lastName" ASC, "firstName" ASC, "ownerId" ASC, revision DESC, "sourceWorksheet" ASC, "sourceRow" ASC, id ASC LIMIT 50 OFFSET ${(page-1)*50}`),
    client.$queryRaw<Totals[]>(Prisma.sql`${query} SELECT ${totalsSql} FROM filtered WHERE plan_status = 'ACTIVE'`),
    client.salesPlan.findMany({where:{planYear:f.year,currencyCode:f.currencyCode,status:'ACTIVE',...(f.userId?{ownerId:f.userId}:{}),...(actor.role==='SALES'?{ownerId:actor.id}:{}),owner:{active:true,archivedAt:null,role:{in:['SALES','SALES_MANAGER']}}},select:{ownerId:true}}),
  ]);
  const records=ids.length?await client.salesPlanLine.findMany({where:{id:{in:ids.map(x=>x.id)},plan:{planYear:f.year,currencyCode:f.currencyCode,status:f.history?{in:['ACTIVE','SUPERSEDED']}:'ACTIVE',...(f.userId!==null?{ownerId:f.userId}:{}),...(actor.role==='SALES'?{ownerId:actor.id}:{}),...(f.history?{}:{owner:{active:true,archivedAt:null,role:{in:['SALES','SALES_MANAGER']}}})}},include:{plan:{include:{owner:{select:{id:true,firstName:true,lastName:true,active:true,archivedAt:true,role:true}}}},account:{select:{name:true}},productSku:{include:{product:{select:{name:true}}}},allocations:true}}):[];
  const byId=new Map(records.map(row=>[row.id,row]));
  return {lines:ids.map(x=>byId.get(x.id)!).filter(Boolean),count:Number(countRow.count),page,pages,summary:numberTotals(summaryRows[0]),activeOwnerIds:[...new Set(owners.map(x=>x.ownerId))]};
}

export async function salesPlanReportTotals(client:PrismaClient, year:number, currencyCode:string, userId:number|null) {
  const f:PlanLineFilters={year,currencyCode,userId,history:false};
  const query=base(f,{id:0,role:'READ_ONLY',active:true,archivedAt:null});
  const rows=await client.$queryRaw<(Totals & {ownerId:number})[]>(Prisma.sql`${query} SELECT "ownerId", ${totalsSql} FROM filtered GROUP BY "ownerId"`);
  return new Map(rows.map(row=>[row.ownerId,numberTotals(row)]));
}

export async function salesPlanReportLinePage(client:PrismaClient, year:number, currencyCode:string, userId:number, rawPage?:string) {
  const where:Prisma.SalesPlanLineWhereInput={plan:{planYear:year,currencyCode,status:'ACTIVE',ownerId:userId,owner:{active:true,archivedAt:null,role:{in:['SALES','SALES_MANAGER']}}}};
  const count=await client.salesPlanLine.count({where});
  const {page,pages}=pageNumber(rawPage,count,50);
  const lines=await client.salesPlanLine.findMany({where,include:{account:{select:{name:true}},productSku:{select:{partNumber:true}},allocations:true},orderBy:[{sourceWorksheet:'asc'},{sourceRow:'asc'},{id:'asc'}],skip:(page-1)*50,take:50});
  return {lines,count,page,pages};
}
