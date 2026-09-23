import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename);
const require=Module.createRequire(import.meta.url);
const conversion=require(path.join(root,'lib/trade-show-conversion.ts'));
const opportunities=require(path.join(root,'lib/opportunities.ts'));
const actor=(role,id=7)=>({id,role,active:true,archivedAt:null});
const form=entries=>{const value=new FormData();for(const [key,item] of entries)value.append(key,item);return value;};

test('Opportunity Contact schema is optional, many-to-many, and database-enforces one primary',()=>{
  const schema=fs.readFileSync(path.join(root,'prisma/schema.prisma'),'utf8');
  const migration=fs.readFileSync(path.join(root,'prisma/migrations/20260922210000_trade_show_crm_conversion/migration.sql'),'utf8');
  assert.match(schema,/model OpportunityContact[\s\S]*@@id\(\[opportunityId, contactId\]\)/);
  assert.match(schema,/convertedOpportunityId\s+Int\?\s+@unique/);
  assert.match(migration,/WHERE "isPrimary" = true/);
  assert.doesNotMatch(migration,/INSERT INTO "OpportunityContact"/);
});

test('Opportunity parser supports multiple optional Contacts and one reviewed primary',()=>{
  const parsed=opportunities.parseOpportunity(form([
    ['name','NRF lead'],['stageId','1'],['currencyCode','USD'],['accountId','10'],['participantRoles','END_USER'],
    ['contactId','20'],['contactId','21'],['primaryContactId','21'],
  ]));
  assert.deepEqual(parsed.errors,{});
  assert.deepEqual(parsed.value.contacts,[{contactId:20,isPrimary:false},{contactId:21,isPrimary:true}]);
  const bad=opportunities.parseOpportunity(form([['name','Bad'],['stageId','1'],['currencyCode','USD'],['accountId','10'],['participantRoles','END_USER'],['contactId','20'],['primaryContactId','99']]));
  assert.match(bad.errors.contacts,/Primary Contact/);
});

function fixture({convertedOpportunityId=null,contactAccountId=10,failCreate=false}={}){
  let converted=null,created=0,links=[];
  const lead={id:2,tradeShowId:1,assignedSalesRepUserId:7,convertedOpportunityId,accountId:10,contactId:20,tradeShow:{archivedAt:null},contact:{accountId:contactAccountId,active:true,archivedAt:null}};
  const tx={
    $queryRaw:async()=>[],tradeShowLead:{findFirst:async()=>lead,updateMany:async({data})=>{converted=data;return{count:1};}},
    salesStage:{findUnique:async()=>({id:1,active:true,isClosed:false,isWon:false})},currency:{findUnique:async()=>({code:'USD',active:true})},user:{findUnique:async()=>({id:7,active:true,archivedAt:null})},
    account:{findMany:async()=>[{id:10}]},contact:{findMany:async()=>[{id:20,accountId:10}]},product:{findMany:async()=>[]},project:{findMany:async()=>[]},
    opportunity:{create:async()=>{if(failCreate)throw new Error('write failed');created++;return{id:55};}},
    opportunityAccount:{findMany:async()=>[],upsert:async()=>({})},opportunityAccountRole:{create:async()=>({})},
    opportunityContact:{findMany:async()=>[],delete:async()=>({}),updateMany:async()=>({count:0}),upsert:async({create})=>{links.push(create);return create;}},
    opportunityProduct:{create:async()=>({}),update:async()=>({})},opportunityProject:{create:async()=>({}),delete:async()=>({})},
  };
  return {client:{$transaction:async callback=>callback(tx)},lead,get converted(){return converted},get created(){return created},get links(){return links}};
}
const input={name:'Acme - NRF',description:null,competitorId:null,currentProductBeingUsed:'Legacy printer',customerPainPoints:'Downtime',ownerId:7,projectIds:[],stageId:1,expectedCloseDate:null,probability:null,forecastCategory:'PIPELINE',currencyCode:'USD',participants:[{accountId:10,roles:['END_USER']}],contacts:[{contactId:20,isPrimary:true}],lines:[]};

test('conversion is atomic in one transaction, attributes the Opportunity, links Contact, and marks the durable Lead converted',async()=>{
  const db=fixture();
  assert.equal(await conversion.convertTradeShowLead(db.client,1,2,input,actor('SALES')),55);
  assert.equal(db.created,1);assert.deepEqual(db.links,[{opportunityId:55,contactId:20,isPrimary:true}]);
  assert.equal(db.converted.convertedOpportunityId,55);assert.equal(db.converted.status,'CONVERTED');assert.ok(db.converted.convertedAt instanceof Date);
});

test('conversion permissions, duplicate protection, Account/Contact consistency, and failure ordering are enforced server-side',async()=>{
  assert.equal(conversion.canConvertTradeShowLead(actor('SALES'),{assignedSalesRepUserId:7}),true);
  assert.equal(conversion.canConvertTradeShowLead(actor('SALES',8),{assignedSalesRepUserId:7}),false);
  assert.equal(conversion.canConvertTradeShowLead(actor('SALES_MANAGER'),{assignedSalesRepUserId:7}),true);
  assert.equal(conversion.canConvertTradeShowLead(actor('ADMIN'),{assignedSalesRepUserId:null}),true);
  assert.equal(conversion.canConvertTradeShowLead(actor('MARKETING_MANAGER'),{assignedSalesRepUserId:7}),false);
  assert.equal(conversion.canConvertTradeShowLead(actor('READ_ONLY'),{assignedSalesRepUserId:7}),false);
  const duplicate=fixture({convertedOpportunityId:44});await assert.rejects(conversion.convertTradeShowLead(duplicate.client,1,2,input,actor('SALES')),/already been converted/);assert.equal(duplicate.created,0);
  await assert.rejects(conversion.convertTradeShowLead(fixture({contactAccountId:11}).client,1,2,input,actor('SALES')),/different Account/);
  const failed=fixture({failCreate:true});await assert.rejects(conversion.convertTradeShowLead(failed.client,1,2,input,actor('SALES')),/write failed/);assert.equal(failed.converted,null);
});

test('conversion and detail UI preserve reviewed context, safe Marketing summary, and do not invent products or value',()=>{
  const page=fs.readFileSync(path.join(root,'app/trade-shows/[id]/leads/[leadId]/convert/page.tsx'),'utf8');
  const detail=fs.readFileSync(path.join(root,'app/trade-shows/[id]/leads/[leadId]/page.tsx'),'utf8');
  assert.match(page,/competitorId:lead\.competitorId/);assert.match(page,/currentProductBeingUsed:lead\.currentProductBeingUsed/);assert.match(page,/customerPainPoints:lead\.customerPainPoints/);
  assert.match(page,/lines:\[\]/);assert.doesNotMatch(page,/estimatedUnitPrice|amount|value:/);
  assert.match(detail,/canLinkOpportunity/);assert.match(detail,/lead\.convertedOpportunity\.name/);assert.match(detail,/lead\.account\?\.name/);
});

test('Stage 2 review polish uses five bounded columns and shared synchronized scroll controls',()=>{
  const workflow=fs.readFileSync(path.join(root,'app/trade-shows/[id]/import/workflow.tsx'),'utf8');
  assert.match(workflow,/\['Lead', 'Company', 'Contact Info', 'Review', 'Status'\]/);
  assert.match(workflow,/TableScroll label="Trade Show lead preview" topControl bounded/);
  assert.match(workflow,/Override rep/);assert.match(workflow,/label="rep override"/);assert.match(workflow,/expandedRow === index/);
  assert.match(workflow,/warnings\.filter\(warning => warning !== 'Trade Show timezone is missing\.'/);
  assert.doesNotMatch(workflow,/row \$\{row\.sourceRow\} rep override/);
});
