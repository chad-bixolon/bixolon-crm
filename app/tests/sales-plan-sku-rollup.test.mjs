import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import XLSX from 'xlsx';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
const req=Module.createRequire(import.meta.url),{Prisma}=req('@prisma/client');
const {salesPlanSkuRollup,rollupAccess,skuRollupFilename,allocationPercent,skuContributions}=req(path.join(root,'lib/sales-plan-sku-rollup.ts'));
const {salesPlanSkuWorkbook}=req(path.join(root,'lib/sales-plan-sku-workbook.ts'));
const D=n=>new Prisma.Decimal(n),actor=role=>({id:90,role,active:true,archivedAt:null});
const record=(id,skuId,ownerId,accountId,units,revenue,allocations=[])=>({id,productSkuId:skuId,productSku:skuId?{partNumber:'XD5-40',product:{name:'Printer'}}:null,originalSkuText:skuId?'Source Variant':'Unknown part',accountId,account:accountId?{name:accountId===10?'UPS':'Customer B'}:null,originalAccountText:'Source Account',planItem:'Baseline',annualPlannedUnits:units===null?null:D(units),annualPlannedRevenue:revenue===null?null:D(revenue),comments:'review',plan:{ownerId,owner:{firstName:ownerId===1?'Ryan':'Mark',lastName:ownerId===1?'Persaud':'Smith'}},allocations:allocations.map(([quarter,u,r])=>({quarter,plannedUnits:u===null?null:D(u),plannedRevenue:r===null?null:D(r)}))});
const records=[record(1,20,1,10,100,1000,[['Q1',25,250],['Q2',25,250],['Q3',25,250],['Q4',25,250]]),record(2,20,1,11,50,null,[]),record(3,20,2,10,null,500,[['Q1',null,100]]),record(4,null,1,10,10,100,[])];
function db(){const calls=[];return {calls,salesPlanLine:{findMany:async q=>{calls.push(q);return records;}}};}
const selection={year:2027,currencyCode:'USD',userId:null};
test('management scope is enforced and query uses active year, currency, rep, and owner population',async()=>{
  assert.equal(rollupAccess(actor('ADMIN')),true);assert.equal(rollupAccess(actor('SALES_MANAGER')),true);
  for(const role of ['SALES','READ_ONLY','MARKETING_MANAGER']){assert.equal(rollupAccess(actor(role)),false);await assert.rejects(salesPlanSkuRollup(db(),actor(role),selection),/Access denied/);}
  const client=db();await salesPlanSkuRollup(client,actor('ADMIN'),{...selection,userId:1,productId:7,skuId:20,accountId:10,search:'UPS'});
  const where=client.calls[0].where;assert.equal(where.plan.status,'ACTIVE');assert.equal(where.plan.planYear,2027);assert.equal(where.plan.currencyCode,'USD');assert.equal(where.plan.ownerId,1);assert.equal(where.plan.owner.active,true);assert.equal(where.plan.owner.archivedAt,null);assert.equal(where.accountId,10);assert.equal(where.OR[0].productSkuId,null);assert.equal(where.OR[1].productSku.id,20);assert.equal(where.OR[1].productSku.productId,7);assert.ok(where.AND);
});
test('SKU identity, independent measures, null quarters, partial allocation, and unresolved are preserved',async()=>{
  const report=await salesPlanSkuRollup(db(),actor('SALES_MANAGER'),selection);
  assert.equal(report.rows.length,1);assert.equal(report.summary.exactLines,3);assert.equal(report.summary.unresolvedLines,1);
  const row=report.rows[0];assert.equal(row.lineCount,3);assert.equal(row.accountKeys.size,2);assert.equal(row.repIds.size,2);
  assert.equal(row.units.toString(),'150');assert.equal(row.revenue.toString(),'1500');assert.equal(row.quarters[0].units.toString(),'25');assert.equal(row.quarters[0].revenue.toString(),'350');assert.equal(row.quarters[1].units.toString(),'25');assert.equal(row.quarters[1].revenue.toString(),'250');assert.equal(row.allocated.units.toString(),'100');assert.equal(row.allocated.revenue.toString(),'1100');assert.equal(report.unresolved[0].sku,'Unknown part');assert.equal(report.summary.units.toString(),'150');assert.equal(report.summary.revenue.toString(),'1500');assert.equal(allocationPercent(D(100),D(25)),25);assert.equal(allocationPercent(null,null),null);
  assert.equal(report.lines[1].quarters[0].units,null);assert.equal(report.lines[1].quarters[0].revenue,null);assert.equal(report.lines[2].units,null);assert.equal(report.lines[2].quarters[0].units,null);
  const repeated=skuContributions([...report.lines, {...report.lines[0],id:9,units:D(5),revenue:D(50)}],20);assert.equal(repeated.length,3);assert.equal(repeated.find(x=>x.account==='UPS'&&x.ownerId===1).units.toString(),'105');assert.equal(repeated.find(x=>x.account==='UPS'&&x.ownerId===1).lineCount,2);
});
test('workbook has three numeric sheets and predictable filenames',async()=>{
  const report=await salesPlanSkuRollup(db(),actor('ADMIN'),selection);
  const workbook=salesPlanSkuWorkbook(report.rows,report.lines.filter(x=>x.skuId!==null),report.unresolved,'USD',{year:2027,rep:'All planned reps',generatedAt:new Date('2026-10-03T12:00:00Z'),summary:report.summary});
  const read=XLSX.read(XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
  assert.deepEqual(read.SheetNames,['SKU Rollup','Account Rep Detail','Unresolved SKU Lines']);
  assert.equal(read.Sheets['SKU Rollup'].B1.v,2027);assert.equal(read.Sheets['SKU Rollup'].B3.v,'All planned reps');
  assert.equal(read.Sheets['SKU Rollup'].B4.v,1);assert.equal(read.Sheets['SKU Rollup'].B5.v,150);assert.equal(read.Sheets['SKU Rollup'].B6.v,1500);assert.equal(read.Sheets['SKU Rollup'].B7.v,1);
  assert.equal(read.Sheets['SKU Rollup'].B8.v,'Oct 3, 2026 at 8:00 AM ET');
  assert.equal(read.Sheets['SKU Rollup'].C12.t,'n');assert.equal(read.Sheets['SKU Rollup'].C12.v,150);assert.equal(read.Sheets['SKU Rollup'].F12.v,350);
  assert.equal(read.Sheets['Account Rep Detail'].F2.t,'n');assert.equal(read.Sheets['Unresolved SKU Lines'].E4.v,10);
  assert.match(read.Sheets['Unresolved SKU Lines'].A1.v,/excluded from exact SKU rollup totals/);
  assert.equal(skuRollupFilename(2027,'USD'),'SalesHub_Sales_Plan_SKU_Rollup_2027_USD.xlsx');assert.equal(skuRollupFilename(2027,'USD','Ryan Persaud'),'SalesHub_Sales_Plan_SKU_Rollup_2027_Ryan_Persaud_USD.xlsx');
  assert.ok(!JSON.stringify(XLSX.utils.sheet_to_json(read.Sheets['SKU Rollup'])).includes('skuId'));
});
