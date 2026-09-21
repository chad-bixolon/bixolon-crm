import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename);
const require=Module.createRequire(fileURLToPath(import.meta.url));
const {Prisma}=require('@prisma/client');
const reporting=require(path.join(root,'lib/reporting.ts'));
const builder=require(path.join(root,'lib/report-builder.ts'));
const saved=require(path.join(root,'lib/saved-reports.ts'));
const actor=(role,id=7)=>({id,role,active:true,archivedAt:null});
const config=()=>reporting.defaultReportConfiguration('PRICE_EXCEPTION_USAGE');
const line=(id,quantity,actual,approved='10',moq='2',currency='USD',overrides={})=>({id,opportunityId:1,productId:id,skuId:id,quantity,estimatedUnitPrice:new Prisma.Decimal(actual),priceSource:'PRICE_EXCEPTION',priceExceptionLineId:id,priceExceptionCode:`PE-${id}`,priceExceptionUnitPrice:approved===null?null:new Prisma.Decimal(approved),priceExceptionSourceQty:moq,archivedAt:null,product:{id,name:`Product ${id}`,sku:`LEGACY-${id}`,categoryId:1,category:{name:'POS'}},sku:{partNumber:`SKU-${id}`,priceUnit:'EACH'},priceExceptionLine:{priceExceptionId:id,priceException:{peCode:`LIVE-${id}`,assignedSalesRepUserId:99,sourceType:'EXTERNAL_EXPORT',assignedSalesRepUser:{firstName:'Other',lastName:'Rep'},sourceSalesRepName:'Old Rep'}},opportunity:{name:'Deal',ownerId:7,owner:{firstName:'Sales',lastName:'Rep'},stageId:1,stage:{name:'Open'},forecastCategory:'PIPELINE',expectedCloseDate:new Date('2026-09-30'),currencyCode:currency,participants:[{accountId:5,account:{name:'Customer'}}],projects:[]},...overrides});
const run=async (rows,cfg=config(),role='ADMIN')=>{let calls=[];const result=await reporting.executePriceExceptionUsageReport({opportunityProduct:{findMany:async args=>{calls.push(args);return args.include?rows.filter(x=>x.priceSource==='PRICE_EXCEPTION'):rows.map(x=>({quantity:x.quantity,estimatedUnitPrice:x.estimatedUnitPrice,opportunity:{currencyCode:x.opportunity.currencyCode},sku:x.sku}));}}},actor(role),cfg,new Date('2026-09-21'));return {result,calls};};
test('PE lines use actual line value, deduplicate opportunities and PEs, and preserve snapshot price',async()=>{
 const rows=[line(1,3,'12','10','2'),line(2,1,'20','15','2'),line(3,2,'10','10','2','EUR')];rows[1].priceExceptionLine.priceExceptionId=1;
 const {result}=await run(rows);assert.deepEqual(result.summary.map(x=>[x.currency,x.lineValue,x.opportunityCount,x.priceExceptionCount]),[['EUR','20.00',1,1],['USD','56.00',1,1]]);
 assert.equal(result.summary[1].productLineCount,2);assert.equal(result.summary[1].quantity,4);assert.equal(result.summary[1].averageApprovedUnitPrice,'11.25');assert.equal(result.summary[1].averageActualUnitPrice,'14.00');
 assert.deepEqual(result.overall,{opportunityCount:1,productLineCount:3,priceExceptionCount:2});
 assert.equal(result.rows.find(x=>x.id===1).approvedUnitPrice,'10.00');assert.equal(result.rows.find(x=>x.id===1).peCode,'PE-1');assert.equal(result.rows.find(x=>x.id===1).overrideAmount,'2.00');assert.equal(result.rows.find(x=>x.id===1).overridePercent,'20.00');
 rows[0].priceExceptionLine.priceException.peCode='CHANGED';assert.equal((await run(rows)).result.rows.find(x=>x.id===1).approvedUnitPrice,'10.00');
 rows[0].priceExceptionCode=null;assert.equal((await run(rows)).result.groups.find(x=>x.key==='id:1').label,'Unnumbered Price Exception');
});
test('overall Opportunity count stays distinct across SKU price units',async()=>{
 const rows=[line(1,2,'10'),line(2,1,'20','20','1','USD',{sku:{partNumber:'BOX',priceUnit:'BOX'}})];
 const {result}=await run(rows);assert.equal(result.summary.length,2);assert.equal(result.overall.opportunityCount,1);assert.equal(result.overall.productLineCount,2);
});
test('a population with product lines and no PE usage reports zero utilization',async()=>{
 const {result}=await run([line(1,2,'10','10','2','USD',{priceSource:'MANUAL',priceExceptionLineId:null})]);
 assert.equal(result.rows.length,0);assert.equal(result.overall.opportunityCount,0);assert.equal(result.summary[0].utilizationPercent,'0.00');
});
test('MOQ and override semantics use snapshots, and presets select only matching lines',async()=>{
 const rows=[line(1,2,'10','10','2'),line(2,1,'12','10','2'),line(3,1,'10','10',null),line(4,1,'10',null,null)];
 const {result}=await run(rows);assert.deepEqual(result.rows.map(x=>[x.moqStatus,x.overrideApplied]),[['MOQ Met',false],['MOQ Not Met',true],['Unknown',false],['Unknown',null]]);
 const overrideCfg=builder.priceExceptionUsageConfigFromParams({configured:'1',overrideStatus:'APPLIED'});assert.deepEqual((await run(rows,overrideCfg)).result.rows.map(x=>x.id),[2]);
 const belowCfg=builder.priceExceptionUsageConfigFromParams({configured:'1',moqStatus:'NOT_MET'});assert.deepEqual((await run(rows,belowCfg)).result.rows.map(x=>x.id),[2]);
});
test('grouping uses PE identity and product; utilization uses all product lines in same currency and unit',async()=>{
 const rows=[line(1,2,'10'),line(2,1,'20'),line(3,2,'30','30','2','EUR'),line(4,2,'10','10','2','USD',{priceSource:'MANUAL',priceExceptionLineId:null})];rows[1].priceExceptionLine.priceExceptionId=1;
 const byPe=await run(rows,{...config(),groupBy:'priceException'});assert.equal(byPe.result.groups.find(x=>x.key==='id:1').metrics[0].productLineCount,2);
 const byProduct=await run(rows,{...config(),groupBy:'product'});assert.equal(byProduct.result.groups.length,3);assert.equal(byPe.result.summary.find(x=>x.currency==='USD').utilizationPercent,'66.67');assert.equal(byPe.result.rows.length,3);
 rows[0].priceExceptionLine.priceException.assignedSalesRepUserId=null;rows[0].priceExceptionLine.priceException.assignedSalesRepUser=null;rows[0].priceExceptionLine.priceException.sourceSalesRepName='Source A';
 rows[1].priceExceptionLine.priceException.assignedSalesRepUserId=null;rows[1].priceExceptionLine.priceException.assignedSalesRepUser=null;rows[1].priceExceptionLine.priceException.sourceSalesRepName='Source B';
 const bySalesperson=await run(rows,{...config(),groupBy:'peSalesperson'});assert.equal(bySalesperson.result.groups.length,2);assert.equal(bySalesperson.result.groups.find(x=>x.key==='none').label,'Unassigned');assert.deepEqual(bySalesperson.result.rows.filter(x=>x.id===1||x.id===2).map(x=>x.peSalesperson),['Unassigned','Unassigned']);
 assert.ok(byPe.calls[0].where.AND.some(x=>x.OR));assert.ok(!byPe.calls[1].where.AND.some(x=>x.OR));
});
test('Opportunity scope is authoritative even for differently assigned or unassigned PE, and saved config round trips',async()=>{
 const {result,calls}=await run([line(1,2,'10')],config(),'SALES');assert.equal(result.rows.length,1);assert.equal(result.rows[0].peSalesperson,'Other Rep');
 assert.ok(calls[0].where.AND.find(x=>x.opportunity).opportunity.AND[0].AND.some(x=>x.ownerId===7));
 for(const role of ['SALES_MANAGER','ADMIN']){const scoped=await run([],config(),role);assert.equal(JSON.stringify(scoped.calls[0].where).includes('ownerId'),false);}
 const cfg=builder.priceExceptionUsageConfigFromParams({configured:'1',priceExceptionId:'3',ownerId:'7',moqStatus:'NOT_MET',groupBy:'product',closeDatePreset:'THIS_QUARTER'});
 let record;const db={reportDefinition:{create:async({data})=>(record={id:1,...data}),findUnique:async()=>record}};
 await saved.saveReportDefinition(db,actor('SALES_MANAGER'),{name:'Usage',description:null,reportType:'PRICE_EXCEPTION_USAGE',visibility:'SHARED',configuration:cfg});
 assert.deepEqual(reporting.validateReportConfiguration(record.reportType,(await db.reportDefinition.findUnique()).configuration),cfg);
 assert.equal(reporting.canViewReportDefinition(actor('SALES'),{...record,archivedAt:null}),true);
 assert.equal(reporting.canRunReportType(actor('MARKETING_MANAGER'),'PRICE_EXCEPTION_USAGE'),false);
});
