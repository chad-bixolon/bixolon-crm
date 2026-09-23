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
const {routeAccess}=require(path.join(root,'lib/authorization.ts'));
const actor=(role,id=7)=>({id,role,active:true,archivedAt:null});
const product=(id,amount,archivedAt=null)=>({id,quantity:1,estimatedUnitPrice:new Prisma.Decimal(amount),archivedAt});
const opportunity=(id,amount,currency='USD',overrides={})=>({id,name:`Opportunity ${id}`,archivedAt:null,ownerId:7,owner:{firstName:'Sales',lastName:'Rep'},stageId:1,stage:{name:'Qualified',probability:25,isClosed:false,isWon:false},forecastCategory:'PIPELINE',probability:null,currencyCode:currency,products:[product(id,amount),product(id+100,'999',new Date())],...overrides});
const show=(id=1,name='MODEX 2026')=>({id,name,startDate:new Date('2026-03-01')});
const lead=(id,status='NEW',opportunity=null,overrides={})=>({id,tradeShowId:1,tradeShow:show(),firstName:`Lead${id}`,lastName:'Person',sourceCompany:`Company ${id}`,email:`lead${id}@example.com`,capturedAt:new Date('2026-03-02'),assignedSalesRepUserId:7,assignedSalesRep:{firstName:'Sales',lastName:'Rep'},status,followUpAt:null,lastContactedAt:null,accountId:null,account:null,contactId:null,contact:null,competitorId:null,competitor:null,competitorSourceText:null,productInterest:null,convertedOpportunityId:opportunity?.id??null,convertedOpportunity:opportunity,convertedAt:opportunity?new Date('2026-03-10'):null,...overrides});
const config=()=>reporting.defaultReportConfiguration('TRADE_SHOW');
const run=async(rows,cfg=config(),role='ADMIN',now=new Date('2026-09-23T12:00:00Z'))=>{let args;const result=await reporting.executeTradeShowReport({tradeShowLead:{findMany:async input=>{args=input;return rows;}}},actor(role),cfg,now);return {result,args};};

test('Trade Show lead metrics include every status, cumulative funnel counts, and a safe zero denominator',async()=>{
  const rows=[lead(1),lead(2,'CONTACTED'),lead(3,'QUALIFIED'),lead(4,'CONVERTED',opportunity(1,'100')),lead(5,'DISQUALIFIED',null,{assignedSalesRepUserId:null,assignedSalesRep:null})];
  const {result}=await run(rows);
  assert.deepEqual(result.summary.leads,{totalLeads:5,assignedLeads:4,newLeads:1,contactedLeads:3,qualifiedLeads:2,convertedLeads:1,disqualifiedLeads:1,conversionRate:20});
  const empty=(await run([])).result.summary.leads;
  assert.equal(empty.totalLeads,0);assert.equal(empty.conversionRate,null);
});

test('attributed Opportunity metrics deduplicate, use active products, effective probability, and separate currency',async()=>{
  const pipeline=opportunity(1,'100','USD',{probability:50});
  const commit=opportunity(2,'200','CAD',{forecastCategory:'COMMIT'});
  const won=opportunity(3,'300','USD',{stage:{name:'Won',probability:100,isClosed:true,isWon:true},forecastCategory:'CLOSED'});
  const omitted=opportunity(4,'400','USD',{forecastCategory:'OMITTED'});
  const archived=opportunity(5,'500','USD',{archivedAt:new Date()});
  const rows=[lead(1,'CONVERTED',pipeline),lead(2,'CONVERTED',pipeline),lead(3,'CONVERTED',commit),lead(4,'CONVERTED',won),lead(5,'CONVERTED',omitted),lead(6,'CONVERTED',archived)];
  const {result}=await run(rows);
  assert.deepEqual(result.summary.amounts,[
    {currency:'CAD',opportunityCount:1,pipeline:'200.00',weightedPipeline:'50.00',commit:'200.00',closedWonValue:'0.00',closedWonOpportunityCount:0},
    {currency:'USD',opportunityCount:3,pipeline:'100.00',weightedPipeline:'50.00',commit:'0.00',closedWonValue:'300.00',closedWonOpportunityCount:1},
  ]);
  assert.equal(result.rows.find(row=>row.id===1).opportunityValue,'100.00');
});

test('Trade Show attribution is queried only from originating leads and SALES scope is enforced at the lead query',async()=>{
  const {args}=await run([],config(),'SALES');
  assert.ok(args.where.AND.some(clause=>clause.assignedSalesRepUserId===7));
  assert.equal(JSON.stringify(args.where).includes('participants'),false);
  assert.equal(JSON.stringify(args.where).includes('accountId'),false);
  assert.equal(JSON.stringify(args.where).includes('contactId'),false);
  for(const role of ['ADMIN','SALES_MANAGER','MARKETING_MANAGER','READ_ONLY']){const scoped=await run([],config(),role);assert.deepEqual(scoped.args.where,{});}
});

test('grouping supports show, rep, status, resolved competitor, stage, forecast, and currency without duplicate overall value',async()=>{
  const deal=opportunity(1,'100'),row=lead(1,'CONVERTED',deal,{competitorId:8,competitor:{id:8,name:'Competitor A'}});
  for(const groupBy of ['tradeShow','assignedRep','leadStatus','competitor','opportunityStage','forecastCategory','currency']){
    const {result}=await run([row],{...config(),groupBy});
    assert.equal(result.groups.length,1,groupBy);assert.equal(result.groups[0].metrics.amounts[0].pipeline,'100.00');assert.equal(result.summary.amounts[0].pipeline,'100.00');
  }
});

test('follow-up filters cover overdue, missing, new not contacted, and qualified not converted',async()=>{
  for(const status of ['OVERDUE','MISSING','NEW_NOT_CONTACTED','QUALIFIED_NOT_CONVERTED']){
    const cfg=builder.tradeShowConfigFromParams({configured:'1',followUpStatus:status});
    const {args}=await run([],cfg);
    const json=JSON.stringify(args.where);
    if(status==='OVERDUE')assert.match(json,/followUpAt/);
    if(status==='MISSING')assert.match(json,/"followUpAt":null/);
    if(status==='NEW_NOT_CONTACTED'){assert.match(json,/"status":"NEW"/);assert.match(json,/"lastContactedAt":null/);}
    if(status==='QUALIFIED_NOT_CONVERTED'){assert.match(json,/"status":"QUALIFIED"/);assert.match(json,/"convertedOpportunityId":null/);}
  }
});

test('Marketing gets only Trade Show reporting while sales roles and read-only retain intended behavior',()=>{
  assert.equal(reporting.canRunReportType(actor('MARKETING_MANAGER'),'TRADE_SHOW'),true);
  assert.equal(reporting.canRunReportType(actor('MARKETING_MANAGER'),'PIPELINE'),false);
  assert.equal(routeAccess('/reports',actor('MARKETING_MANAGER')),'allowed');
  assert.equal(routeAccess('/reports/new',actor('MARKETING_MANAGER')),'allowed');
  assert.equal(routeAccess('/pipeline',actor('MARKETING_MANAGER')),'denied');
  for(const role of ['ADMIN','SALES_MANAGER','SALES','READ_ONLY'])assert.equal(reporting.canRunReportType(actor(role),'TRADE_SHOW'),true);
  assert.equal(reporting.getCreatableReportTypes(actor('READ_ONLY')).includes('TRADE_SHOW'),false);
  assert.equal(routeAccess('/reports/trade-shows',actor('READ_ONLY')),'allowed');
  assert.equal(routeAccess('/reports/new',actor('READ_ONLY')),'denied');
});

test('Trade Show report UI uses compact filters and shared scrolling without direct Marketing Opportunity links',()=>{
  const builderSource=fs.readFileSync(path.join(root,'app/reports/new/trade-show-builder.tsx'),'utf8');
  const resultSource=fs.readFileSync(path.join(root,'components/report-results.tsx'),'utf8');
  assert.match(builderSource,/report-filter-grid/);assert.match(builderSource,/report-builder/);
  assert.match(resultSource,/TableScroll label="Trade Show lead details"/);
  assert.match(resultSource,/even:bg-slate-50\/60[^"']*hover:bg-orange-50\/50/);
  assert.match(resultSource,/row\.canOpenOpportunity/);
});
