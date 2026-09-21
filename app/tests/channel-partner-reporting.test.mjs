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
const {partyLabels,opportunityPartyLabels}=require(path.join(root,'lib/crm-validation.ts'));
const {defaultLabels}=require(path.join(root,'lib/configuration.ts'));
const opportunities=require(path.join(root,'lib/opportunities.ts'));
const actor=(role,id=7)=>({id,role,active:true,archivedAt:null});
const participant=(id,name,roles,businessRoles=[])=>({accountId:id,account:{id,name,industry:'RETAIL',territory:'EAST',strategicAccount:false,industryCategory:{name:'Retail'},territoryCategory:{name:'East'},businessRoles,owner:null},roles:roles.map(role=>({role}))});
const product=(id,category,price)=>({id,quantity:1,estimatedUnitPrice:new Prisma.Decimal(price),archivedAt:null,product:{categoryId:id,category:{name:category}},sku:null});
const deal=(id,participants,currency='USD',overrides={})=>({id,name:`Deal ${id}`,ownerId:7,owner:{firstName:'Sales',lastName:'Rep'},stageId:1,stage:{name:'Qualified',probability:25,isClosed:false,isWon:false},forecastCategory:'PIPELINE',expectedCloseDate:new Date('2026-09-30'),probability:null,currencyCode:currency,participants,products:[product(1,'Mobile','60000'),product(2,'POS','40000')],projects:[],...overrides});
const config=()=>reporting.defaultReportConfiguration('CHANNEL_PARTNER');
const run=(rows,cfg=config(),role='ADMIN')=>reporting.executeChannelPartnerReport({opportunity:{findMany:async args=>{run.where=args.where;return rows;}}},actor(role),cfg,new Date('2026-09-21'));

test('Service Partner is a distinct selectable Opportunity role and Account business role does not assign it',()=>{
  assert.equal(partyLabels.SERVICE_PARTNER,'Service Partner');assert.equal(partyLabels.OTHER,'Other');assert.equal(partyLabels.MEDIA_PARTNER,'Media Partner');
  assert.equal(defaultLabels.PARTNER,'Service Partner');
  assert.equal(opportunityPartyLabels({...defaultLabels,PARTNER:'General Services'}).SERVICE_PARTNER,'Service Partner');
  const form=new FormData();form.append('name','Service deal');form.append('stageId','1');form.append('currencyCode','USD');form.append('accountId','11');form.append('participantRoles','SERVICE_PARTNER');
  assert.deepEqual(opportunities.parseOpportunity(form).value.participants,[{accountId:11,roles:['SERVICE_PARTNER']}]);
  form.set('participantRoles','OTHER');assert.deepEqual(opportunities.parseOpportunity(form).value.participants,[{accountId:11,roles:['OTHER']}]);
});
test('one Opportunity with three partners counts once overall and once per partner group',async()=>{
  const result=await run([deal(1,[participant(1,'Distributor',['DISTRIBUTOR']),participant(2,'Reseller',['VAR_RESELLER']),participant(3,'Media',['MEDIA_PARTNER'])])]);
  assert.deepEqual(result.summary,[{currency:'USD',pipeline:'100000.00',weightedPipeline:'25000.00',opportunityCount:1,partnerCount:3}]);
  assert.equal(result.rows.length,3);assert.equal(result.groups.length,3);
  for(const group of result.groups)assert.deepEqual(group.metrics,[{currency:'USD',pipeline:'100000.00',weightedPipeline:'25000.00',opportunityCount:1,partnerCount:1}]);
  assert.ok(result.rows.every(row=>result.groups.some(group=>row.groupKeys.includes(group.key))));
});
test('multiple roles preserve one relationship row; role groups overlap without changing overall value',async()=>{
  const row=deal(1,[participant(1,'Specialty',['MEDIA_PARTNER','VAR_RESELLER'])]);
  const result=await run([row],{...config(),groupBy:'participantRole'});
  assert.equal(result.rows.length,1);assert.equal(result.rows[0].participantRoles,'Media Partner, VAR / Reseller');
  assert.deepEqual(result.groups.map(group=>group.label),['Media Partner','VAR / Reseller']);
  assert.equal(result.summary[0].pipeline,'100000.00');assert.equal(result.summary[0].partnerCount,1);
  assert.ok(result.groups.every(group=>group.metrics[0].pipeline==='100000.00'));
});
test('two partners with the same role have two detail rows but one Opportunity value in that role group',async()=>{
  const result=await run([deal(1,[participant(1,'Media A',['MEDIA_PARTNER']),participant(2,'Media B',['MEDIA_PARTNER'])])],{...config(),groupBy:'participantRole'});
  assert.equal(result.rows.length,2);assert.equal(result.groups.length,1);
  assert.equal(result.groups[0].metrics[0].pipeline,'100000.00');assert.equal(result.groups[0].metrics[0].opportunityCount,1);assert.equal(result.groups[0].metrics[0].partnerCount,2);
});
test('End User and OTHER are excluded by default; explicit role filters can select them',async()=>{
  const rows=[deal(1,[participant(1,'Customer',['END_USER']),participant(2,'Unspecified',['OTHER']),participant(3,'Partner',['SERVICE_PARTNER'])])];
  const result=await run(rows);assert.deepEqual(result.rows.map(row=>row.partner),['Partner']);
  for(const role of ['END_USER','OTHER']){const filtered=await run(rows,{...config(),filters:[{field:'participantRole',operator:'eq',value:role}]});assert.equal(filtered.rows.length,1);assert.equal(filtered.rows[0].participantRoles,role==='OTHER'?'Other':'End User');}
});
test('Service Partner and Media Partner filter and group independently, regardless of Account business role',async()=>{
  const rows=[deal(1,[participant(1,'Service',['SERVICE_PARTNER']),participant(2,'Media',['MEDIA_PARTNER']),participant(3,'General service company',['END_USER'],['PARTNER'])])];
  const result=await run(rows,{...config(),groupBy:'participantRole'});
  assert.deepEqual(result.groups.map(group=>group.label),['Media Partner','Service Partner']);assert.equal(result.rows.length,2);
  for(const role of ['SERVICE_PARTNER','MEDIA_PARTNER']){const filtered=await run(rows,{...config(),filters:[{field:'participantRole',operator:'eq',value:role}]});assert.equal(filtered.rows.length,1);assert.equal(filtered.rows[0].participantRoles,role==='SERVICE_PARTNER'?'Service Partner':'Media Partner');}
});
test('Product Category membership overlaps while overall Opportunity value stays once',async()=>{
  const result=await run([deal(1,[participant(1,'Service',['SERVICE_PARTNER'])])],{...config(),groupBy:'productCategory'});
  assert.equal(result.summary[0].pipeline,'100000.00');assert.deepEqual(result.groups.map(group=>group.label),['Mobile','POS']);assert.ok(result.groups.every(group=>group.metrics[0].pipeline==='100000.00'));
});
test('currency stays separate and probability override is reused',async()=>{
  const result=await run([deal(1,[participant(1,'Service',['SERVICE_PARTNER'])]),deal(2,[participant(1,'Service',['SERVICE_PARTNER'])],'EUR',{probability:50})]);
  assert.deepEqual(result.summary.map(row=>[row.currency,row.pipeline,row.weightedPipeline]),[['EUR','100000.00','50000.00'],['USD','100000.00','25000.00']]);
});
test('report scope applies to SALES even for shared definitions; manager and admin are broad',async()=>{
  const cfg={...config(),filters:[{field:'ownerId',operator:'eq',value:99},{field:'participantRole',operator:'eq',value:'SERVICE_PARTNER'}]};
  await run([],cfg,'SALES');assert.ok(run.where.AND.some(clause=>clause.ownerId===7));assert.ok(run.where.AND.some(clause=>clause.ownerId===99));
  for(const role of ['ADMIN','SALES_MANAGER']){await run([],config(),role);assert.equal(run.where.AND.some(clause=>clause.ownerId===7),false);}
  assert.equal(reporting.canViewReportDefinition(actor('SALES'),{ownerId:99,visibility:'SHARED',reportType:'CHANNEL_PARTNER',archivedAt:null}),true);
  assert.equal(reporting.canViewReportDefinition(actor('READ_ONLY'),{ownerId:99,visibility:'SHARED',reportType:'CHANNEL_PARTNER',archivedAt:null}),true);
  await assert.rejects(run([],config(),'MARKETING_MANAGER'),/Access denied/);
});
test('saved Channel config round trips with role, grouping, metrics, columns and sorting',async()=>{
  const cfg=builder.channelPartnerConfigFromParams({configured:'1',participantRole:'SERVICE_PARTNER',status:'WON',groupBy:'participantRole',sortField:'partner',sortDirection:'asc',metrics:['pipeline','partnerCount'],columns:['opportunity','partner','participantRoles']});
  let record;await saved.saveReportDefinition({reportDefinition:{create:async({data})=>(record={id:1,...data})}},actor('SALES_MANAGER'),{name:'Service partners',description:null,reportType:'CHANNEL_PARTNER',visibility:'SHARED',configuration:cfg});
  assert.deepEqual(record.configuration,cfg);assert.equal(record.configuration.groupBy,'participantRole');
});
