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
const config=()=>reporting.defaultReportConfiguration('PRODUCT_PERFORMANCE');
const line=(id,category,name,qty,price,currency='USD',overrides={})=>({id,opportunityId:1,productId:id,skuId:id,quantity:qty,estimatedUnitPrice:new Prisma.Decimal(price),priceSource:'MANUAL',priceExceptionCode:null,archivedAt:null,product:{id,name,sku:`LEGACY-${id}`,categoryId:id,category:{id, name:category}},sku:{id,partNumber:`SKU-${id}`},opportunity:{id:1,name:'Deal A',ownerId:7,owner:{firstName:'Sales',lastName:'Rep'},stageId:1,stage:{name:'Open'},forecastCategory:'PIPELINE',expectedCloseDate:new Date('2026-09-30'),currencyCode:currency,participants:[{accountId:8,account:{name:'Customer'}}],projects:[{projectId:9,project:{name:'Launch'}}]},...overrides});
const run=(rows,cfg=config(),role='ADMIN')=>reporting.executeProductPerformanceReport({opportunityProduct:{findMany:async args=>{run.where=args.where;return rows;}}},actor(role),cfg,new Date('2026-09-21'));

test('Product lines split a 100K Opportunity into additive 40K, 35K and 25K categories',async()=>{
 const rows=[line(1,'Mobile','M',4,'10000'),line(2,'POS','P',7,'5000'),line(3,'Label','L',10,'2500')];
 const result=await run(rows);
 assert.equal(result.rows.length,3);assert.equal(result.summary[0].lineValue,'100000.00');assert.equal(result.summary[0].quantity,21);
 assert.equal(result.summary[0].opportunityCount,1);assert.equal(result.summary[0].productLineCount,3);
 assert.deepEqual(Object.fromEntries(result.groups.map(x=>[x.label,x.metrics[0].lineValue])),{Mobile:'40000.00',POS:'35000.00',Label:'25000.00'});
 for(const group of result.groups)assert.equal(group.metrics[0].opportunityCount,1);
 assert.deepEqual(result.groups.find(x=>x.label==='Mobile').lineIds,[1]);
});
test('weighted unit price uses actual line snapshots, not PE approved price',async()=>{
 const rows=[line(1,'POS','P',1,'10','USD',{priceSource:'PRICE_EXCEPTION'}),line(2,'POS','P',9,'20','USD',{priceSource:'PRICE_EXCEPTION',priceExceptionCode:'PE-4',priceExceptionUnitPrice:new Prisma.Decimal('1')})];
 const result=await run(rows,{...config(),groupBy:'priceSource'});
 assert.equal(result.summary[0].lineValue,'190.00');assert.equal(result.summary[0].averageUnitPrice,'19.00');
 assert.equal(result.groups[0].label,'Price Exception');assert.equal(result.rows.find(x=>x.id===2).peCode,'PE-4');
});
test('Manual, Catalog and Price Exception groups use the same snapshot calculation',async()=>{
 const rows=[line(1,'POS','M',2,'10'),line(2,'POS','C',3,'20','USD',{priceSource:'CATALOG'}),line(3,'POS','E',4,'30','USD',{priceSource:'PRICE_EXCEPTION',priceExceptionUnitPrice:new Prisma.Decimal('1')})];
 const result=await run(rows,{...config(),groupBy:'priceSource'});
 assert.deepEqual(Object.fromEntries(result.groups.map(group=>[group.label,group.metrics[0].lineValue])),{'Manual':'20.00','Catalog':'60.00','Price Exception':'120.00'});
 assert.equal(result.summary[0].lineValue,'200.00');
});
test('currency totals remain partitioned, and archived lines and Opportunities are excluded in query',async()=>{
 const result=await run([line(1,'POS','P',1,'10'),line(2,'POS','P',2,'10','EUR')]);
 assert.deepEqual(result.summary.map(x=>[x.currency,x.lineValue]),[['EUR','20.00'],['USD','10.00']]);
 assert.ok(run.where.AND.some(x=>x.archivedAt===null));assert.ok(run.where.AND.some(x=>x.opportunity?.AND?.some(y=>y.archivedAt===null)));
});
test('different SKU price units have separate quantity and weighted price totals',async()=>{
 const each=line(1,'POS','P',2,'10');const box=line(2,'POS','P',3,'100','USD',{sku:{id:2,partNumber:'BOX-2',priceUnit:'BOX'}});
 const result=await run([each,box]);
 assert.deepEqual(result.summary.map(x=>[x.unit,x.quantity,x.lineValue,x.averageUnitPrice]),[['BOX',3,'300.00','100.00'],['EACH',2,'20.00','10.00']]);
});
test('quantity is additive when grouping by product and SKU',async()=>{
 const rows=[line(1,'POS','P',2,'10'),line(2,'POS','P',3,'10','USD',{productId:1,product:{id:1,name:'P',sku:'LEGACY-1',categoryId:1,category:{id:1,name:'POS'}},skuId:1,sku:{id:1,partNumber:'SKU-1',priceUnit:'EACH'}})];
 for(const groupBy of ['product','sku']){const result=await run(rows,{...config(),groupBy});assert.equal(result.groups.length,1);assert.equal(result.groups[0].metrics[0].quantity,5);assert.equal(result.groups[0].metrics[0].productLineCount,2);}
});
test('filters scope lines and Opportunities, including sales ownership',async()=>{
 const fields={ownerId:99,stageId:2,forecastCategory:'COMMIT',status:'WON',accountId:8,industry:'RETAIL',territory:'EAST',strategicAccount:true,productCategoryId:3,productId:4,skuId:5,priceSource:'CATALOG',projectId:9,currency:'USD'};
 const cfg={...config(),filters:Object.entries(fields).map(([field,value])=>({field,operator:'eq',value})).concat([{field:'closeDate',operator:'preset',value:'THIS_QUARTER'}])};
 await run([],cfg,'SALES');
 const clauses=run.where.AND;assert.ok(clauses.some(x=>x.productId===4));assert.ok(clauses.some(x=>x.skuId===5));assert.ok(clauses.some(x=>x.priceSource==='CATALOG'));
 assert.ok(clauses.some(x=>x.product?.categoryId===3));
 const opp=clauses.find(x=>x.opportunity).opportunity.AND;assert.ok(opp.some(x=>x.ownerId===7));assert.ok(opp.some(x=>x.ownerId===99));assert.ok(opp.some(x=>x.stageId===2));assert.ok(opp.some(x=>x.forecastCategory==='COMMIT'));assert.ok(opp.some(x=>x.expectedCloseDate?.gte));assert.ok(opp.some(x=>x.stage?.isWon===true));assert.ok(opp.some(x=>x.participants?.some?.accountId===8));assert.ok(opp.some(x=>x.participants?.some?.account?.industry==='RETAIL'));assert.ok(opp.some(x=>x.participants?.some?.account?.territory==='EAST'));assert.ok(opp.some(x=>x.participants?.some?.account?.strategicAccount===true));assert.ok(opp.some(x=>x.projects?.some?.projectId===9));assert.ok(opp.some(x=>x.currencyCode==='USD'));
 for(const role of ['ADMIN','SALES_MANAGER']){await run([],config(),role);assert.equal(run.where.AND.find(x=>x.opportunity).opportunity.AND.some(x=>x.ownerId===7),false);}
});
test('saved config, discovery, and read only report consumption follow current policy',async()=>{
 const cfg=builder.productPerformanceConfigFromParams({configured:'1',status:'OPEN',groupBy:'sku',priceSource:'CATALOG',closeDatePreset:'THIS_QUARTER'});
 let record;const client={reportDefinition:{create:async({data})=>(record={id:1,...data})}};
 await saved.saveReportDefinition(client,actor('SALES_MANAGER'),{name:'Products',description:null,reportType:'PRODUCT_PERFORMANCE',visibility:'SHARED',configuration:cfg});assert.deepEqual(record.configuration,cfg);
 assert.equal(reporting.canViewReportDefinition(actor('READ_ONLY'),{...record,archivedAt:null}),true);
 assert.equal(reporting.canRunReportType(actor('MARKETING_MANAGER'),'PRODUCT_PERFORMANCE'),false);
 assert.deepEqual(reporting.getVisibleReportTypes(actor('READ_ONLY')),['PIPELINE','PRODUCT_PERFORMANCE','CHANNEL_PARTNER','PROJECT_INITIATIVE','PRICE_EXCEPTION_USAGE']);
 await assert.rejects(run([],config(),'MARKETING_MANAGER'),/Access denied/);
});
