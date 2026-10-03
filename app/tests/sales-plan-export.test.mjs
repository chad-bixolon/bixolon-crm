import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import XLSX from 'xlsx';
import { unzipSync, strFromU8 } from 'fflate';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
const req=Module.createRequire(import.meta.url);
const {Prisma}=req('@prisma/client');
const {buildSalesPlanManagementExport,exportAccess,exportSelection,exportFilename,writeSalesPlanWorkbook}=req(path.join(root,'lib/sales-plan-export.ts'));
const D=n=>new Prisma.Decimal(n);
const actor=role=>({id:90,role,active:true,archivedAt:null,name:'Export Manager'});
const users=[{id:1,firstName:'Ryan',lastName:'Persaud',role:'SALES',active:true,archivedAt:null},{id:2,firstName:'Sam',lastName:'Manager',role:'SALES_MANAGER',active:true,archivedAt:null},{id:3,firstName:'No',lastName:'Plan',role:'SALES',active:true,archivedAt:null}];
const line=(id,accountId,skuId,revenue,extra={})=>({id,accountId,originalAccountText:accountId?'UPS':'Source Account',account:accountId?{name:'UPS'}:null,productSkuId:skuId,originalSkuText:skuId?'XD5-40':'Source SKU',productSku:skuId?{partNumber:'XD5-40',product:{name:'Printer'}}:null,planItem:'Baseline',annualPlannedUnits:D(10),annualPlannedRevenue:D(revenue),priorYearRevenue:D(80),comments:'Quarter note',allocations:['Q1','Q2','Q3','Q4'].map(quarter=>({quarter,plannedUnits:D(2.5),plannedRevenue:D(Number(revenue)/4)})),...extra});
const plans=[{id:11,ownerId:1,revision:2,lines:[line(100,10,20,100),line(101,null,null,50)]},{id:12,ownerId:2,revision:1,lines:[line(102,10,20,60)]}];
const product=(id,skuId,price)=>({id,skuId,sku:skuId?{partNumber:skuId===20?'XD5-40':'XL5-40'}:null,product:{name:'Printer',sku:'Fallback'},quantity:1,estimatedUnitPrice:D(price)});
const opp=(id,ownerId,category,accounts,products,month=1)=>({id,ownerId,name:`Deal ${id}`,stage:{name:'Discovery',probability:40},forecastCategory:category,expectedCloseDate:new Date(Date.UTC(2027,month-1,15,12)),probability:null,currencyCode:'USD',participants:accounts.map(([accountId,name])=>({accountId,account:{name}})),products});
const opportunities=[opp(1,1,'PIPELINE',[[10,'UPS']],[product(1,20,70),product(2,30,600)]),opp(2,1,'BEST_CASE',[[10,'UPS']],[product(3,20,40)],4),opp(3,1,'COMMIT',[[10,'UPS']],[product(4,20,30)],7),opp(4,2,'PIPELINE',[[10,'UPS'],[11,'Distributor']],[product(5,20,25)],10)];
function client(){const calls={plans:[],opportunities:[],targets:[],writes:0};const db={user:{findMany:async()=>users},salesPlan:{findMany:async args=>{calls.plans.push(args);return plans.filter(p=>!args.where.ownerId||p.ownerId===args.where.ownerId);}},salesTarget:{findMany:async args=>{calls.targets.push(args);return [1,2].flatMap(userId=>['Q1','Q2','Q3','Q4'].map(quarter=>({userId,quarter,targetAmount:D(userId===1?25:15)})));}},opportunity:{findMany:async args=>{calls.opportunities.push(args);const filter=args.where.AND.find(x=>x.expectedCloseDate);return opportunities.filter(o=>filter.ownerId.in.includes(o.ownerId)&&o.expectedCloseDate>=filter.expectedCloseDate.gte&&o.expectedCloseDate<filter.expectedCloseDate.lt).map(o=>({...o,products:o.products.map(p=>({...p}))}));}}};return {db,calls};}

test('export is restricted to effective management roles and validates scope',async()=>{
  assert.equal(exportAccess(actor('ADMIN')),true);assert.equal(exportAccess(actor('SALES_MANAGER')),true);
  for(const role of ['SALES','READ_ONLY','MARKETING_MANAGER'])assert.equal(exportAccess(actor(role)),false);
  const {db}=client();await assert.rejects(buildSalesPlanManagementExport(db,actor('READ_ONLY'),{year:2027,currencyCode:'USD',userId:null}),/Access denied/);
  assert.throws(()=>exportSelection({year:'2027',currencyCode:'USD',userId:'1x'}));
  assert.equal(exportFilename(2027,'USD','Ryan / Persaud'),'SalesHub_Sales_Plan_Status_2027_Ryan_Persaud_USD.xlsx');
});

test('management workbook uses active plans, live quarterly forecast, exact matches and one Account per product',async()=>{
  const {db,calls}=client();const result=await buildSalesPlanManagementExport(db,actor('ADMIN'),{year:2027,currencyCode:'USD',userId:null},new Date('2026-10-03T12:00:00Z'));
  assert.equal(calls.plans[0].where.status,'ACTIVE');assert.equal(calls.plans[0].where.planYear,2027);assert.equal(calls.plans[0].where.currencyCode,'USD');
  assert.equal(calls.opportunities.length,5);assert.equal(calls.targets[0].where.archivedAt,null);
  assert.deepEqual(result.data.summary.map(x=>x.rep),['Ryan Persaud','Sam Manager']);
  assert.deepEqual(result.data.summary.map(x=>[x.target,x.plan,x.pipeline,x.bestCase,x.commit]),[[100,150,740,40,30],[60,60,25,0,0]]);
  assert.deepEqual(result.data.summary[0].qPlan,[37.5,37.5,37.5,37.5]);
  assert.deepEqual(result.data.summary[0].qTarget,[25,25,25,25]);
  assert.equal(result.data.approved[1].account,'Source Account');assert.equal(result.data.approved[1].sku,'Source SKU');assert.equal(result.data.approved[0].comments,'Quarter note');
  assert.equal(result.data.pipeline.length,5);assert.equal(result.data.pipeline.find(x=>x.sku==='XL5-40').matchStatus,'Unplanned Upside');
  assert.equal(result.data.pipeline.find(x=>x.opportunity==='Deal 4').matchStatus,'Ambiguous: multiple Accounts');
  assert.equal(result.data.pipeline.filter(x=>x.productLineId===5).length,1);
  assert.equal(result.data.comparison.find(x=>x.rep==='Ryan Persaud'&&x.sku==='XD5-40').classification,'Pipeline Supports Plan');
  assert.equal(result.data.comparison.find(x=>x.sku==='XL5-40').classification,'Unplanned Upside');
  assert.equal(result.data.comparison.find(x=>x.sku==='Source SKU').classification,'Unresolved Plan Match');
  assert.equal(result.data.comparison.find(x=>x.rep==='Sam Manager'&&x.sku==='XD5-40'&&x.account==='UPS').classification,'No Current Pipeline');
  assert.equal(result.data.comparison.find(x=>x.rep==='Sam Manager'&&x.matchStatus==='Ambiguous: multiple Accounts').pipeline,25);
  assert.equal(result.data.pipeline.reduce((n,x)=>n+x.value,0),result.data.summary.reduce((n,x)=>n+x.pipeline,0));
  const output=writeSalesPlanWorkbook(result.workbook);const book=XLSX.read(output,{type:'buffer',cellDates:true,cellStyles:true});
  assert.deepEqual(book.SheetNames,['Executive Summary','Approved Sales Plan','Current Opportunity Pipeline','Plan vs Pipeline Detail']);
  assert.equal(book.Sheets['Executive Summary'].A13.v,'Team Total');assert.equal(book.Sheets['Executive Summary'].N13.v,765);
  assert.equal(book.Sheets['Executive Summary'].B11.t,'n');assert.equal(book.Sheets['Approved Sales Plan'].G2.t,'n');
  assert.match(book.Sheets['Approved Sales Plan'].G2.z,/#,##0/);assert.match(book.Sheets['Current Opportunity Pipeline'].F2.z,/mmm d, yyyy/);
  assert.equal(book.Sheets['Current Opportunity Pipeline']['!autofilter'].ref,'A1:Q6');
  const zipped=unzipSync(output);assert.match(strFromU8(zipped['xl/worksheets/sheet1.xml']),/state="frozen"/);assert.match(strFromU8(zipped['xl/styles.xml']),/<b\/>/);
  assert.ok(!output.includes(Buffer.from('ownerId')));assert.equal(calls.writes,0);
});

test('selected rep, forecast filtering, and plan gap preserve scope',async()=>{
  const {db,calls}=client();const result=await buildSalesPlanManagementExport(db,actor('SALES_MANAGER'),{year:2027,currencyCode:'USD',userId:2});
  assert.equal(result.filename,'SalesHub_Sales_Plan_Status_2027_Sam_Manager_USD.xlsx');assert.equal(result.data.summary.length,1);assert.equal(result.data.pipeline.length,1);
  assert.deepEqual(calls.plans[0].where.ownerId,2);
  assert.deepEqual(calls.opportunities.at(-1).where.AND.find(x=>x.expectedCloseDate).ownerId.in,[2]);
  assert.equal(result.data.comparison.find(x=>x.account==='UPS').classification,'No Current Pipeline');
  const noPipeline=client();noPipeline.db.opportunity.findMany=async()=>[];
  const empty=await buildSalesPlanManagementExport(noPipeline.db,actor('ADMIN'),{year:2027,currencyCode:'USD',userId:1});
  assert.ok(empty.data.comparison.some(x=>x.classification==='No Current Pipeline'));
  const gap=client();gap.db.opportunity.findMany=async args=>{const filter=args.where.AND.find(x=>x.expectedCloseDate);return filter.ownerId.in.includes(1)&&filter.expectedCloseDate.gte.getUTCMonth()===0?[{...opportunities[0],products:[opportunities[0].products[0]]}]:[];};
  const below=await buildSalesPlanManagementExport(gap.db,actor('ADMIN'),{year:2027,currencyCode:'USD',userId:1});
  assert.equal(below.data.comparison.find(x=>x.sku==='XD5-40').classification,'Plan Gap');
});
