import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename);
const require=Module.createRequire(fileURLToPath(import.meta.url));
const {Prisma}=require('@prisma/client');
const reporting=require(path.join(root,'lib/reporting.ts'));
const reportBuilder=require(path.join(root,'lib/report-builder.ts'));
const saved=require(path.join(root,'lib/saved-reports.ts'));
const actor=(role,id=7)=>({id,role,active:true,archivedAt:null});
const base=()=>reporting.defaultReportConfiguration('PIPELINE');
const account=(id,name)=>({accountId:id,account:{id,name,industry:null,industryCategory:null,territory:null,territoryCategory:null,owner:null},roles:[]});
const row=(id,currency='USD',overrides={})=>({id,name:`Deal ${id}`,currencyCode:currency,probability:null,expectedCloseDate:new Date('2026-09-30T00:00:00Z'),createdAt:new Date('2026-09-01T00:00:00Z'),ownerId:7,stageId:1,stage:{id:1,name:'Qualified',probability:25,sortOrder:1,isClosed:false,isWon:false,active:true,createdAt:new Date(),updatedAt:new Date()},owner:{id:7,firstName:'Sales',lastName:'Rep'},participants:[account(1,'End User')],products:[{id:id*10,quantity:2,estimatedUnitPrice:new Prisma.Decimal('50.00'),archivedAt:null,productId:3,skuId:9,product:{id:3,name:'Printer',categoryId:4,category:{id:4,name:'POS'}},sku:{id:9,partNumber:'SKU-9'}}],projects:[],...overrides});

test('report discovery follows runnable type and built-in authorization',()=>{
 const salesBuiltIns=['MY_OPEN_PIPELINE','PIPELINE_THIS_QUARTER','PIPELINE_BY_SALES_REP','ACCOUNT_ENGAGEMENT'];
 for(const role of ['ADMIN','SALES_MANAGER','SALES']){
  assert.deepEqual(reporting.getVisibleBuiltInReports(actor(role)),salesBuiltIns);
  assert.deepEqual(reporting.getVisibleReportTypes(actor(role)),['PIPELINE']);
  assert.deepEqual(reporting.getCreatableReportTypes(actor(role)),['PIPELINE']);
  assert.equal(reporting.canAccessReports(actor(role)),true);
 }
 assert.deepEqual(reporting.getVisibleBuiltInReports(actor('MARKETING_MANAGER')),[]);
 assert.deepEqual(reporting.getVisibleReportTypes(actor('MARKETING_MANAGER')),[]);
 assert.deepEqual(reporting.getCreatableReportTypes(actor('MARKETING_MANAGER')),[]);
 assert.equal(reporting.canAccessReports(actor('MARKETING_MANAGER')),false);
 assert.deepEqual(reporting.getVisibleBuiltInReports(actor('READ_ONLY')),[]);
 assert.deepEqual(reporting.getVisibleReportTypes(actor('READ_ONLY')),['PIPELINE']);
 assert.deepEqual(reporting.getCreatableReportTypes(actor('READ_ONLY')),[]);
 assert.equal(reporting.canAccessReports(actor('READ_ONLY')),true);
 for(const reportType of reporting.reportTypes.filter(type=>type!=='PIPELINE'))assert.equal(reporting.canRunReportType(actor('ADMIN'),reportType),false);
});

test('Engagement discovery and direct route authorization preserve the existing role matrix',()=>{
 for(const role of ['ADMIN','SALES_MANAGER','SALES'])assert.equal(reporting.canViewBuiltInReport(actor(role),'ACCOUNT_ENGAGEMENT'),true);
 for(const role of ['MARKETING_MANAGER','READ_ONLY'])assert.equal(reporting.canViewBuiltInReport(actor(role),'ACCOUNT_ENGAGEMENT'),false);
});

test('curated report configuration accepts known values and rejects arbitrary browser fields',()=>{
 const valid=reporting.validateReportConfiguration('PIPELINE',base());assert.equal(valid.metrics.includes('pipeline'),true);
 assert.throws(()=>reporting.validateReportConfiguration('ANY_TABLE',base()),/Unknown report type/);
 assert.throws(()=>reporting.validateReportConfiguration('PIPELINE',{...base(),filters:[{field:'passwordHash',operator:'eq',value:'x'}]}),/Unsupported report filter/);
 assert.throws(()=>reporting.validateReportConfiguration('PIPELINE',{...base(),metrics:['revenueFormula']}),/Unsupported report metric/);
 assert.throws(()=>reporting.validateReportConfiguration('PIPELINE',{...base(),groupBy:'databaseColumn'}),/Unsupported report grouping/);
 assert.throws(()=>reporting.validateReportConfiguration('PIPELINE',{...base(),rawSql:'select 1'}),/unsupported fields/);
 assert.throws(()=>reporting.validateReportConfiguration('PRODUCT_PERFORMANCE',{filters:[],groupBy:null,sort:[],columns:[],metrics:[]}),/not available/);
});

test('Pipeline uses authoritative active line totals, probability override, and separates currency',async()=>{
 const rows=[row(1),row(2,'USD',{probability:50,products:[{...row(2).products[0],quantity:1,estimatedUnitPrice:new Prisma.Decimal('40.00')},{...row(2).products[0],id:99,quantity:1,estimatedUnitPrice:new Prisma.Decimal('999.00'),archivedAt:new Date()}]}),row(3,'EUR')];
 const result=await reporting.executePipelineReport({opportunity:{findMany:async()=>rows}},actor('SALES_MANAGER'),base());
 assert.deepEqual(result.summary.map(x=>[x.currency,x.opportunityCount,x.pipeline,x.weightedPipeline]),[['EUR',1,'100.00','25.00'],['USD',2,'140.00','45.00']]);
 assert.equal(result.rows.find(x=>x.id===2).value,'40.00');assert.equal(result.rows.find(x=>x.id===2).weightedValue,'20.00');
});

test('Opportunity totals deduplicate many Projects while each Project group can drill into the Opportunity',async()=>{
 const deal=row(1,'USD',{projects:[{projectId:10,project:{id:10,name:'Project X',owner:null}},{projectId:11,project:{id:11,name:'Project Y',owner:null}}]});
 const config={...base(),groupBy:'project'};const result=await reporting.executePipelineReport({opportunity:{findMany:async()=>[deal]}},actor('ADMIN'),config);
 assert.equal(result.summary[0].opportunityCount,1);assert.equal(result.summary[0].pipeline,'100.00');assert.equal(result.groups.length,2);
 for(const group of result.groups){assert.deepEqual(group.opportunityIds,[1]);assert.equal(group.metrics[0].pipeline,'100.00');}
});

test('Product Category grouping repeats membership but never multiplies Opportunity-level summary',async()=>{
 const products=[row(1).products[0],{...row(1).products[0],id:12,quantity:1,estimatedUnitPrice:new Prisma.Decimal('20.00'),product:{id:4,name:'Label',categoryId:5,category:{id:5,name:'Labels'}}}];
 const result=await reporting.executePipelineReport({opportunity:{findMany:async()=>[row(1,'USD',{products})]}},actor('ADMIN'),{...base(),groupBy:'productCategory'});
 assert.equal(result.summary[0].pipeline,'120.00');assert.equal(result.summary[0].opportunityCount,1);assert.equal(result.groups.length,2);
});

test('Sales scope is always applied even when a shared report requests another owner',async()=>{
 assert.equal(reporting.canViewReportDefinition(actor('SALES',7),{ownerId:99,visibility:'SHARED',reportType:'PIPELINE',archivedAt:null}),true);
 let where;const config={...base(),filters:[...base().filters,{field:'ownerId',operator:'eq',value:99}]};await reporting.executePipelineReport({opportunity:{findMany:async args=>{where=args.where;return[];}}},actor('SALES',7),config);
 assert.ok(where.AND.some(clause=>clause.ownerId===7));assert.ok(where.AND.some(clause=>clause.ownerId===99));
 assert.deepEqual(reporting.savedReportWhere(actor('SALES',7)),{archivedAt:null,reportType:{in:['PIPELINE']},OR:[{ownerId:7},{visibility:'SHARED'}]});
});

test('shared saved reports remain subject to report-type authorization',async()=>{
 const sharedPipeline={ownerId:99,visibility:'SHARED',reportType:'PIPELINE',archivedAt:null};
 const sharedFuture={...sharedPipeline,reportType:'PRODUCT_PERFORMANCE'};
 assert.equal(reporting.canViewReportDefinition(actor('SALES'),sharedPipeline),true);
 assert.equal(reporting.canViewReportDefinition(actor('READ_ONLY'),sharedPipeline),true);
 assert.equal(reporting.canViewReportDefinition(actor('MARKETING_MANAGER'),sharedPipeline),false);
 assert.equal(reporting.canViewReportDefinition(actor('ADMIN'),sharedFuture),false);
 assert.deepEqual(reporting.savedReportWhere(actor('MARKETING_MANAGER')).reportType,{in:[]});
 await assert.rejects(reporting.executePipelineReport({opportunity:{findMany:async()=>[]}},actor('MARKETING_MANAGER'),base()),/Access denied/);
});

test('saved report create, shared authorization, edit ownership, archive, and config round-trip',async()=>{
 let record=null;const client={reportDefinition:{findUnique:async()=>record,create:async({data})=>(record={id:1,archivedAt:null,...data}),update:async({data})=>(record={...record,...data})}};
 const input={name:' My Pipeline ',description:' Current deals ',reportType:'PIPELINE',visibility:'PERSONAL',configuration:base()};
 assert.equal(await saved.saveReportDefinition(client,actor('SALES'),input),1);assert.equal(record.name,'My Pipeline');assert.deepEqual(record.configuration,base());
 await assert.rejects(saved.saveReportDefinition(client,actor('SALES'),{...input,visibility:'SHARED'}),/Only Sales Managers/);
 record.ownerId=7;await saved.saveReportDefinition(client,actor('SALES'),{...input,name:'Renamed'},1);assert.equal(record.name,'Renamed');
 await assert.rejects(saved.saveReportDefinition(client,actor('SALES',8),input,1),/Access denied/);
 await saved.archiveReportDefinition(client,actor('ADMIN'),1);assert.ok(record.archivedAt instanceof Date);assert.equal(reporting.canViewReportDefinition(actor('SALES'),record),false);
 await assert.rejects(saved.saveReportDefinition(client,actor('READ_ONLY'),input),/cannot create/);
});

test('date presets use stable quarter boundaries in the application timezone',()=>{
 const now=new Date('2026-12-31T23:00:00Z');assert.deepEqual(reporting.reportDatePreset('THIS_QUARTER',now),{gte:new Date('2026-10-01T00:00:00Z'),lt:new Date('2027-01-01T00:00:00Z')});assert.deepEqual(reporting.reportDatePreset('NEXT_QUARTER',now),{gte:new Date('2027-01-01T00:00:00Z'),lt:new Date('2027-04-01T00:00:00Z')});
});

test('Pipeline close date controls preserve Any, preset, and custom date behavior',()=>{
 const any=reportBuilder.pipelineConfigFromParams({configured:'1',closeDatePreset:'ANY',closeFrom:'2026-09-01',closeTo:'2026-09-30'});
 assert.equal(any.filters.some(filter=>filter.field==='closeDate'),false);
 const preset=reportBuilder.pipelineConfigFromParams({configured:'1',closeDatePreset:'THIS_QUARTER'});
 assert.deepEqual(preset.filters.find(filter=>filter.field==='closeDate'),{field:'closeDate',operator:'preset',value:'THIS_QUARTER'});
 const custom=reportBuilder.pipelineConfigFromParams({configured:'1',closeDatePreset:'CUSTOM',closeFrom:'2026-09-01',closeTo:'2026-09-30'});
 assert.deepEqual(custom.filters.find(filter=>filter.field==='closeDate'),{field:'closeDate',operator:'between',value:{from:'2026-09-01',to:'2026-09-30'}});
 const legacyCustom=reportBuilder.pipelineConfigFromParams({configured:'1',closeFrom:'2026-09-01',closeTo:'2026-09-30'});
 assert.deepEqual(legacyCustom.filters.find(filter=>filter.field==='closeDate'),custom.filters.find(filter=>filter.field==='closeDate'));
});
