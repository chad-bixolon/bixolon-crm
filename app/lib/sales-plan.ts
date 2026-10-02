import { Prisma, SalesQuarter, type PrismaClient, type SalesPlanLine, type SalesPlanQuarterAllocation } from '@prisma/client';
import { can, type Actor } from './authorization';
import { forecastForRep, forecastForTeam, quarters } from './forecast';
import { activeSalesRepWhere } from './assignment-eligibility';

const zero = new Prisma.Decimal(0);
export function allocationSummary(line: Pick<SalesPlanLine,'annualPlannedUnits'|'annualPlannedRevenue'> & { allocations: Pick<SalesPlanQuarterAllocation,'plannedUnits'|'plannedRevenue'>[] }) {
  const measures = [
    { annual: line.annualPlannedUnits, key: 'plannedUnits' as const },
    { annual: line.annualPlannedRevenue, key: 'plannedRevenue' as const },
  ].filter(m => m.annual !== null);
  const results = measures.map(m => { const allocated = line.allocations.reduce((sum, a) => sum.add(a[m.key] ?? zero), zero); return { measure: m.key, annual: m.annual!, allocated, remaining: m.annual!.sub(allocated), percentage: m.annual!.isZero() ? (allocated.isZero() ? 100 : 0) : allocated.div(m.annual!).mul(100).toNumber() }; });
  const status = !results.length ? 'Not allocated' : results.some(r => r.allocated.gt(r.annual)) ? 'Overallocated' : results.every(r => r.allocated.equals(r.annual)) ? 'Fully allocated' : results.every(r => r.allocated.isZero()) ? 'Not allocated' : 'Partially allocated';
  return { status, results };
}
export async function saveAllocation(client: PrismaClient, actor: Actor, input: {lineId:number; quarter:SalesQuarter; units:string; revenue:string}) {
  if (!can(actor,'sales-plan.allocate') || !Number.isSafeInteger(input.lineId) || input.lineId <= 0 || !quarters.includes(input.quarter)) throw new Error('Access denied');
  return client.$transaction(async tx => {
  const line = await tx.salesPlanLine.findUnique({ where: { id: input.lineId }, include: {plan:{include:{owner:true}}} });
  if (!line || line.plan.status !== 'ACTIVE' || (actor.role === 'SALES' && line.plan.ownerId !== actor.id) || !line.plan.owner.active || line.plan.owner.archivedAt || !['SALES','SALES_MANAGER'].includes(line.plan.owner.role)) throw new Error('This plan is not eligible for allocation.');
  function amount(raw:string, precision:number, enabled:boolean) { if (!enabled && raw.trim()) throw new Error('This annual measure is not present.'); if (!raw.trim()) return null; if (!new RegExp(`^\\d{1,15}(?:\\.\\d{1,${precision}})?$`).test(raw.trim())) throw new Error('Enter a nonnegative amount.'); return new Prisma.Decimal(raw.trim()); }
  const plannedUnits=amount(input.units,3,line.annualPlannedUnits!==null),plannedRevenue=amount(input.revenue,2,line.annualPlannedRevenue!==null);
  await tx.salesPlanQuarterAllocation.upsert({where:{salesPlanLineId_quarter:{salesPlanLineId:line.id,quarter:input.quarter}},create:{salesPlanLineId:line.id,quarter:input.quarter,plannedUnits,plannedRevenue,updatedById:actor.id},update:{plannedUnits,plannedRevenue,updatedById:actor.id}});
  }, {isolationLevel:'Serializable'});
}
export async function saveLineAllocation(client: PrismaClient, actor: Actor, input: {lineId:number; quarters:Record<SalesQuarter,{units:string;revenue:string}>}) {
  if (!can(actor,'sales-plan.allocate') || !Number.isSafeInteger(input.lineId) || input.lineId <= 0) throw new Error('Access denied');
  return client.$transaction(async tx => {
    const line=await tx.salesPlanLine.findUnique({where:{id:input.lineId},include:{plan:{include:{owner:true}}}});
    if (!line || line.plan.status!=='ACTIVE' || (actor.role==='SALES'&&line.plan.ownerId!==actor.id) || !line.plan.owner.active || line.plan.owner.archivedAt || !['SALES','SALES_MANAGER'].includes(line.plan.owner.role)) throw new Error('This plan is not eligible for allocation.');
    const parse=(raw:string,precision:number,enabled:boolean)=>{
      if (!enabled&&raw.trim()) throw new Error('This annual measure is not present.');
      if (!raw.trim()) return null;
      if (!new RegExp(`^\\d{1,15}(?:\\.\\d{1,${precision}})?$`).test(raw.trim())) throw new Error('Enter a nonnegative amount.');
      return new Prisma.Decimal(raw.trim());
    };
    const values=quarters.map(quarter=>{
      const entry=input.quarters[quarter];
      if (!entry) throw new Error('Enter all four quarters.');
      return {quarter,plannedUnits:parse(entry.units,3,line.annualPlannedUnits!==null),plannedRevenue:parse(entry.revenue,2,line.annualPlannedRevenue!==null)};
    });
    for (const value of values) await tx.salesPlanQuarterAllocation.upsert({where:{salesPlanLineId_quarter:{salesPlanLineId:line.id,quarter:value.quarter}},create:{salesPlanLineId:line.id,...value,updatedById:actor.id},update:{plannedUnits:value.plannedUnits,plannedRevenue:value.plannedRevenue,updatedById:actor.id}});
  },{isolationLevel:'Serializable'});
}
export function annualTargetFromRows(userIds:number[],rows:{userId:number;quarter:SalesQuarter;targetAmount:Prisma.Decimal}[]){
  if (!userIds.length) return {amount:null,status:'Unavailable'};
  const ids=[...new Set(userIds)];
  const complete=ids.every(id=>quarters.every(q=>rows.filter(r=>r.userId===id&&r.quarter===q).length===1));
  return {amount:complete?rows.filter(r=>ids.includes(r.userId)).reduce((sum,r)=>sum.add(r.targetAmount),zero):null,status:complete?'Complete':'Incomplete'};
}
export async function annualTarget(client:PrismaClient,userIds:number[],year:number,currencyCode:string){
  if (!userIds.length) return {amount:null,status:'Unavailable'};
  const rows=await client.salesTarget.findMany({where:{userId:{in:userIds},year,currencyCode,archivedAt:null},select:{userId:true,quarter:true,targetAmount:true}});
  return annualTargetFromRows(userIds,rows);
}
export async function planForecast(client:PrismaClient,actor:Actor,input:{userId:number|null;year:number;currencyCode:string;ownerIds?:number[]}){
  const users=input.userId===null?await client.user.findMany({where:{...activeSalesRepWhere(),...(input.ownerIds?{id:{in:input.ownerIds}}:{})},select:{id:true,role:true,active:true,archivedAt:true}}):[];
  const periods=await Promise.all(quarters.map(async quarter=>input.userId!==null?forecastForRep(client,actor,{userId:input.userId,year:input.year,quarter,currencyCode:input.currencyCode}):forecastForTeam(client,actor,{users,year:input.year,quarter,currencyCode:input.currencyCode})));
  return periods.map((metrics,index)=>({quarter:quarters[index],pipeline:metrics.pipeline,bestCase:metrics.bestCase,commit:metrics.commit}));
}
