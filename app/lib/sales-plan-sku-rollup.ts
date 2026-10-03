import { Prisma, type PrismaClient } from '@prisma/client';
import { activeSalesRepWhere } from './assignment-eligibility';
import { can, type Actor } from './authorization';
import { allocationSummary } from './sales-plan';
import { quarters } from './forecast';
import { exportSelection } from './sales-plan-export';

export type SkuSelection = ReturnType<typeof exportSelection> & { productId?:number|null; skuId?:number|null; accountId?:number|null; search?:string };
const zero = new Prisma.Decimal(0);
type Amount = Prisma.Decimal | null;
type Measures = { units:Amount; revenue:Amount };
export type RollupRow = Measures & { quarters:Measures[]; allocated:Measures; lineCount:number; accountKeys:Set<string>; repIds:Set<number>; skuId:number; sku:string; product:string };
export type DetailRow = Measures & {quarters:Measures[]; id:number; skuId:number|null; sku:string; product:string; rep:string; ownerId:number; account:string; accountKey:string; planItem:string; comments:string; allocationStatus:string };
const emptyMeasures = ():Measures => ({units:null,revenue:null});
const emptyQuarters = () => quarters.map(emptyMeasures);
const add = (a:Amount,b:Amount):Amount => b===null?a:(a??zero).add(b);
function addMeasures(target:Measures, source:Measures) { target.units=add(target.units,source.units); target.revenue=add(target.revenue,source.revenue); }
export function rollupAccess(actor:Actor) { return can(actor,'sales-plan.manage') && (actor.role==='ADMIN'||actor.role==='SALES_MANAGER'); }
export function skuRollupFilename(year:number,currencyCode:string,rep?:string) {
  const suffix=rep?`_${rep.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,70)}`:'';
  return `SalesHub_Sales_Plan_SKU_Rollup_${year}${suffix}_${currencyCode}.xlsx`;
}
export function aggregateSkuLines(lines:DetailRow[]) {
  const grouped=new Map<number,RollupRow>();
  const unresolved:DetailRow[]=[];
  for(const line of lines) {
    if(line.skuId===null){unresolved.push(line);continue;}
    let row=grouped.get(line.skuId);
    if(!row){row={skuId:line.skuId,sku:line.sku,product:line.product,...emptyMeasures(),quarters:emptyQuarters(),allocated:emptyMeasures(),lineCount:0,accountKeys:new Set(),repIds:new Set()};grouped.set(line.skuId,row);}
    addMeasures(row,line);row.lineCount++;row.accountKeys.add(line.accountKey);row.repIds.add(line.ownerId);
    line.quarters.forEach((q,i)=>{addMeasures(row!.quarters[i],q);addMeasures(row!.allocated,q);});
  }
  const rows=[...grouped.values()].sort((a,b)=>a.product.localeCompare(b.product)||a.sku.localeCompare(b.sku));
  const summary={skuCount:rows.length,exactLines:rows.reduce((n,r)=>n+r.lineCount,0),unresolvedLines:unresolved.length,accountCount:new Set(lines.filter(l=>l.skuId!==null).map(l=>l.accountKey)).size,units:rows.reduce<Amount>((n,r)=>add(n,r.units),null),revenue:rows.reduce<Amount>((n,r)=>add(n,r.revenue),null),allocated:rows.reduce<Measures>((n,r)=>{addMeasures(n,r.allocated);return n;},emptyMeasures())};
  return {rows,unresolved,summary};
}
export function skuContributions(lines:DetailRow[],skuId:number) {
  const groups=new Map<string,DetailRow & {lineCount:number}>();
  for(const line of lines.filter(l=>l.skuId===skuId)) {
    const key=`${line.accountKey}:${line.ownerId}`;
    const current=groups.get(key);
    if(!current){groups.set(key,{...line,quarters:line.quarters.map(q=>({...q})),lineCount:1});continue;}
    addMeasures(current,line);line.quarters.forEach((q,i)=>addMeasures(current.quarters[i],q));current.lineCount++;
    if(line.planItem&&!current.planItem.split(' / ').includes(line.planItem))current.planItem+=`${current.planItem?' / ':''}${line.planItem}`;
  }
  return [...groups.values()].sort((a,b)=>a.account.localeCompare(b.account)||a.rep.localeCompare(b.rep));
}
export function allocationPercent(annual:Amount,allocated:Amount) { return annual===null?null:annual.isZero()?(allocated===null||allocated.isZero()?100:0):(allocated??zero).div(annual).mul(100).toNumber(); }
export async function salesPlanSkuRollup(client:PrismaClient,actor:Actor,selection:SkuSelection) {
  if(!rollupAccess(actor))throw new Error('Access denied');
  const {year,currencyCode,userId}=exportSelection({year:String(selection.year),currencyCode:selection.currencyCode,userId:selection.userId===null?null:String(selection.userId)});
  const where:Prisma.SalesPlanLineWhereInput={plan:{planYear:year,currencyCode,status:'ACTIVE',owner:activeSalesRepWhere(),...(userId!==null?{ownerId:userId}:{})},...(selection.accountId?{accountId:selection.accountId}:{})};
  // Keep unresolved lines visible even when a resolved product/SKU filter is selected.
  if(selection.productId||selection.skuId)where.OR=[{productSkuId:null},{productSku:{...(selection.productId?{productId:selection.productId}:{}),...(selection.skuId?{id:selection.skuId}:{})}}];
  if(selection.search?.trim())where.AND=[{OR:[{productSku:{partNumber:{contains:selection.search,mode:'insensitive'}}},{productSku:{product:{name:{contains:selection.search,mode:'insensitive'}}}},{originalSkuText:{contains:selection.search,mode:'insensitive'}},{originalAccountText:{contains:selection.search,mode:'insensitive'}},{account:{name:{contains:selection.search,mode:'insensitive'}}},{planItem:{contains:selection.search,mode:'insensitive'}}]}];
  const records=await client.salesPlanLine.findMany({where,select:{id:true,accountId:true,originalAccountText:true,account:{select:{name:true}},productSkuId:true,originalSkuText:true,productSku:{select:{partNumber:true,product:{select:{name:true}}}},planItem:true,annualPlannedUnits:true,annualPlannedRevenue:true,comments:true,plan:{select:{ownerId:true,owner:{select:{firstName:true,lastName:true}}}},allocations:{select:{quarter:true,plannedUnits:true,plannedRevenue:true}}},orderBy:[{id:'asc'}]});
  const lines:DetailRow[]=records.map(line=>({id:line.id,skuId:line.productSkuId,sku:line.productSku?.partNumber??line.originalSkuText??'Unspecified',product:line.productSku?.product.name??'',rep:`${line.plan.owner.firstName} ${line.plan.owner.lastName}`,ownerId:line.plan.ownerId,account:line.account?.name??line.originalAccountText??'Unresolved Account',accountKey:line.accountId!==null?`id:${line.accountId}`:`source:${line.originalAccountText??''}`,planItem:line.planItem??'',comments:line.comments??'',units:line.annualPlannedUnits,revenue:line.annualPlannedRevenue,quarters:quarters.map(q=>{const a=line.allocations.find(x=>x.quarter===q);return {units:a?.plannedUnits??null,revenue:a?.plannedRevenue??null};}),allocationStatus:allocationSummary(line).status}));
  return {...aggregateSkuLines(lines),lines};
}
