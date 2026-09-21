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
const {formatCurrencyOrDash}=require(path.join(root,'lib/display-format.ts'));
const builder=require(path.join(root,'lib/report-builder.ts'));
const saved=require(path.join(root,'lib/saved-reports.ts'));
const actor=(role,id=7)=>({id,role,active:true,archivedAt:null});
const product=(id,name,amount)=>({quantity:1,estimatedUnitPrice:new Prisma.Decimal(amount),product:{categoryId:id,category:{name}},sku:null});
const deal=(id,amount='100000',currency='USD',overrides={})=>({id,name:`Deal ${id}`,ownerId:7,owner:{firstName:'Sales',lastName:'Rep'},stageId:1,stage:{name:'Qualified',probability:25,isClosed:false,isWon:false},forecastCategory:'PIPELINE',probability:null,currencyCode:currency,participants:[],products:[product(1,'Mobile',amount)],...overrides});
const project=(id,opportunities=[],overrides={})=>({id,name:`Project ${id}`,ownerId:7,owner:{firstName:'Project',lastName:'Owner'},status:'ACTIVE',primaryAccountId:null,primaryAccount:null,participants:[],startDate:null,targetEndDate:null,opportunities:opportunities.map(opportunity=>({opportunity})),...overrides});
const config=()=>reporting.defaultReportConfiguration('PROJECT_INITIATIVE');
const run=(rows,cfg=config(),role='ADMIN')=>reporting.executeProjectInitiativeReport({project:{findMany:async args=>{run.where=args.where;run.include=args.include;return rows;}}},actor(role),cfg,new Date('2026-09-21'));

test('Project sums two linked Opportunities once, with separate Project and Opportunity counts',async()=>{
  const result=await run([project(1,[deal(1,'100000'),deal(2,'250000')])]);
  assert.equal(result.rows.length,1);assert.equal(result.rows[0].opportunityCount,2);
  assert.deepEqual(result.summary,[{currency:'USD',projectCount:1,opportunityCount:2,pipeline:'350000.00',weightedPipeline:'87500.00',commit:'0.00',wonOpportunityValue:'0.00'}]);
  assert.equal(result.groups[0].metrics[0].pipeline,'350000.00');
});
test('account-less and Opportunity-less Projects remain visible with zero commercial metrics',async()=>{
  const result=await run([project(1),project(2,[],{participants:[{accountId:10,account:{name:'Participant'}}]})]);
  assert.equal(result.rows.length,2);assert.equal(result.rows[0].primaryAccount,null);
  assert.equal(result.rows[0].amounts[0].pipeline,'0.00');assert.equal(result.rows[0].opportunityCount,0);
  assert.equal(result.rows[0].amounts[0].currency,null);
  assert.equal(result.summary[0].currency,null);
  assert.equal(formatCurrencyOrDash(Number(result.rows[0].amounts[0].pipeline),result.rows[0].amounts[0].currency,true),'—');
  assert.equal(result.summary[0].projectCount,2);assert.equal(result.summary[0].opportunityCount,0);
});
test('USD-only and EUR-only Projects retain their actual currency codes',async()=>{
  for(const currency of ['USD','EUR']){
    const result=await run([project(1,[deal(1,'100000',currency)])]);
    assert.deepEqual(result.summary.map(item=>item.currency),[currency]);
    assert.deepEqual(result.rows[0].amounts.map(item=>item.currency),[currency]);
    assert.ok(formatCurrencyOrDash(100000,result.summary[0].currency,true).startsWith(currency));
  }
});
test('one Opportunity in two Projects appears in both groups but once overall',async()=>{
  const opportunity=deal(1),result=await run([project(1,[opportunity]),project(2,[opportunity])]);
  assert.equal(result.summary[0].pipeline,'100000.00');assert.equal(result.summary[0].opportunityCount,1);assert.equal(result.summary[0].projectCount,2);
  assert.deepEqual(result.groups.map(group=>group.metrics[0].pipeline),['100000.00','100000.00']);
});
test('participant Accounts do not multiply Projects and Product Categories overlap safely',async()=>{
  const opportunity=deal(1,'60000','USD',{products:[product(1,'Mobile','60000'),product(2,'POS','40000')]});
  const row=project(1,[opportunity],{participants:[{accountId:11,account:{name:'One'}},{accountId:12,account:{name:'Two'}}]});
  const result=await run([row],{...config(),groupBy:'productCategory'});
  assert.equal(result.rows.length,1);assert.equal(result.summary[0].pipeline,'100000.00');
  assert.deepEqual(result.groups.map(group=>group.label),['Mobile','POS']);
  assert.ok(result.groups.every(group=>group.metrics[0].pipeline==='100000.00'));
});
test('partner Accounts come only from authorized linked Opportunity participant roles',async()=>{
  const opportunity=deal(1,'100000','USD',{participants:[{accountId:3,account:{name:'Partner'},roles:[{role:'DISTRIBUTOR'}]},{accountId:4,account:{name:'Customer'},roles:[{role:'END_USER'}]}]});
  const result=await run([project(1,[opportunity])]);
  assert.deepEqual(result.rows[0].partnerAccounts,[{id:3,name:'Partner'}]);
});
test('Product Category drill-down shows only contributing linked Opportunities',async()=>{
  const result=await run([project(1,[deal(1,'100000'),deal(2,'250000','USD',{products:[product(2,'POS','250000')]})])],{...config(),groupBy:'productCategory'});
  assert.equal(result.summary[0].pipeline,'350000.00');
  assert.deepEqual(result.groups.map(group=>[group.label,group.metrics[0].pipeline,group.contributions[0].opportunityIds]),[['Mobile','100000.00',[1]],['POS','250000.00',[2]]]);
});
test('Commit uses explicit Forecast Category and currency stays separate',async()=>{
  const rows=[project(1,[deal(1,'100000','USD',{forecastCategory:'COMMIT'}),deal(2,'50000','EUR')])];
  const result=await run(rows);assert.deepEqual(result.summary.map(x=>[x.currency,x.pipeline,x.commit]),[['EUR','50000.00','0.00'],['USD','100000.00','100000.00']]);
  assert.deepEqual(result.rows[0].amounts.map(x=>x.currency),['EUR','USD']);
  assert.deepEqual(result.groups[0].metrics.map(x=>[x.currency,x.pipeline]),[['EUR','50000.00'],['USD','100000.00']]);
  assert.ok(result.summary.every(x=>['EUR','USD'].includes(x.currency)));
  assert.ok(result.rows[0].amounts.every(x=>['EUR','USD'].includes(x.currency)));
  assert.deepEqual(result.summary.map(x=>formatCurrencyOrDash(Number(x.pipeline),x.currency,true)),['EUR 50,000.00','USD 100,000.00']);
});
test('Closed Won value is distinct from open Pipeline and is never called revenue',async()=>{
  const won=deal(1,'100000','USD',{stage:{name:'Won',probability:100,isClosed:true,isWon:true},forecastCategory:'CLOSED'});
  const result=await run([project(1,[won])],{...config(),filters:[{field:'status',operator:'eq',value:'WON'}]});
  assert.equal(result.summary[0].pipeline,'0.00');assert.equal(result.summary[0].weightedPipeline,'0.00');assert.equal(result.summary[0].commit,'0.00');assert.equal(result.summary[0].wonOpportunityValue,'100000.00');
  assert.equal(reporting.reportRegistry.PROJECT_INITIATIVE.metrics.wonOpportunityValue,'Won Opportunity Value');
});
test('Project filters and Opportunity filters are applied on their respective sides',async()=>{
  const cfg=builder.projectInitiativeConfigFromParams({configured:'1',projectOwnerId:'7',projectStatus:'ACTIVE',projectId:'1',primaryAccountId:'2',participantAccountId:'3',hasAccount:'false',hasOpportunities:'false',ownerId:'7',stageId:'4',forecastCategory:'COMMIT',status:'OPEN',productCategoryId:'5',currency:'USD',targetEndDatePreset:'OVERDUE',groupBy:'project'});
  await run([],cfg);
  const clauses=run.where.AND,opportunity=run.include.opportunities.where.opportunity.AND;
  for(const key of ['ownerId','status','id','primaryAccountId','participants','primaryAccountId','opportunities','targetEndDate'])assert.ok(clauses.some(item=>key in item),key);
  for(const key of ['ownerId','stageId','forecastCategory','stage','products','currencyCode'])assert.ok(opportunity.some(item=>key in item),key);
  assert.ok(clauses.some(item=>item.status?.notIn?.includes('COMPLETED')));
});
test('Project start and target dates use Project fields and keep custom bounds',async()=>{
  const cfg=builder.projectInitiativeConfigFromParams({configured:'1',startDatePreset:'CUSTOM',startDateFrom:'2026-09-01',startDateTo:'2026-09-30',targetEndDatePreset:'THIS_QUARTER',status:'OPEN'});
  await run([],cfg);
  const clauses=run.where.AND;
  assert.ok(clauses.some(item=>item.startDate?.gte?.toISOString()==='2026-09-01T00:00:00.000Z'));
  assert.ok(clauses.some(item=>item.startDate?.lt?.toISOString()==='2026-10-01T00:00:00.000Z'));
  assert.ok(clauses.some(item=>item.targetEndDate?.gte?.toISOString()==='2026-07-01T00:00:00.000Z'));
});
test('Project and Opportunity scope are both applied for SALES, including shared reports',async()=>{
  await run([],config(),'SALES');assert.ok(run.where.AND.some(clause=>clause.OR?.some(part=>part.archivedAt===null)));
  assert.ok(run.include.opportunities.where.opportunity.AND.some(clause=>clause.ownerId===7));
  for(const role of ['ADMIN','SALES_MANAGER','READ_ONLY']){await run([],config(),role);assert.equal(run.include.opportunities.where.opportunity.AND.some(clause=>clause.ownerId===7),false);}
  assert.equal(reporting.canViewReportDefinition(actor('SALES'),{ownerId:99,visibility:'SHARED',reportType:'PROJECT_INITIATIVE',archivedAt:null}),true);
  assert.equal(reporting.canViewReportDefinition(actor('READ_ONLY'),{ownerId:99,visibility:'SHARED',reportType:'PROJECT_INITIATIVE',archivedAt:null}),true);
  await assert.rejects(run([],config(),'MARKETING_MANAGER'),/Access denied/);
});
test('SALES commercial totals use only authorized links while the Project remains visible',async()=>{
  const own=deal(1,'100000'),other=deal(2,'250000','USD',{ownerId:99});
  const client={project:{findMany:async args=>{const scoped=args.include.opportunities.where.opportunity.AND.some(clause=>clause.ownerId===7);return [project(1,scoped?[own]:[own,other])];}}};
  const sales=await reporting.executeProjectInitiativeReport(client,actor('SALES'),config());
  const manager=await reporting.executeProjectInitiativeReport(client,actor('SALES_MANAGER'),config());
  assert.equal(sales.rows.length,1);assert.equal(sales.summary[0].pipeline,'100000.00');assert.equal(sales.summary[0].opportunityCount,1);
  assert.equal(manager.summary[0].pipeline,'350000.00');assert.equal(manager.summary[0].opportunityCount,2);
});
test('Project filters and saved configuration round trip',async()=>{
  const cfg=builder.projectInitiativeConfigFromParams({configured:'1',projectOwnerId:'7',projectStatus:'ACTIVE',projectId:'1',primaryAccountId:'2',participantAccountId:'3',hasAccount:'false',hasOpportunities:'false',ownerId:'7',stageId:'4',forecastCategory:'COMMIT',status:'OPEN',productCategoryId:'5',currency:'USD',targetEndDatePreset:'NEXT_30_DAYS',groupBy:'project',sortField:'project',sortDirection:'asc',metrics:['projectCount','pipeline'],columns:['project','primaryAccount']});
  assert.equal(cfg.filters.length,14);
  let record;await saved.saveReportDefinition({reportDefinition:{create:async({data})=>(record={id:1,...data})}},actor('SALES_MANAGER'),{name:'Projects',description:null,reportType:'PROJECT_INITIATIVE',visibility:'SHARED',configuration:cfg});
  assert.deepEqual(record.configuration,cfg);
  assert.ok(reporting.getVisibleReportTypes(actor('ADMIN')).includes('PROJECT_INITIATIVE'));
  assert.ok(reporting.getVisibleReportTypes(actor('ADMIN')).includes('PRICE_EXCEPTION_USAGE'));
});
