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
const resolution=require(path.join(root,'lib/trade-show-contact-resolution.ts'));
const audiences=require(path.join(root,'lib/marketing-audiences.ts'));
const actor=(role,id=7)=>({id,role,active:true,archivedAt:null});
const input=(overrides={})=>({accountId:null,firstName:'Ada',lastName:'Lovelace',title:'Director',email:'ADA@EXAMPLE.COM',phone:'555-0100',mobile:null,active:true,isPrimary:false,marketingPreference:'OPTED_IN',addressLine1:null,addressLine2:null,city:null,stateProvince:null,postalCode:null,country:null,...overrides});
const lead=(overrides={})=>({id:2,tradeShowId:1,contactId:null,accountId:null,firstName:'Ada',lastName:'Lovelace',title:'Director',email:'ada@example.com',phone:'555-0100',tradeShow:{archivedAt:null},...overrides});

test('Contact Resolution administration is limited to Admin and Marketing Manager',()=>{
  assert.equal(resolution.canManageContactResolution(actor('ADMIN')),true);
  assert.equal(resolution.canManageContactResolution(actor('MARKETING_MANAGER')),true);
  for(const role of ['SALES_MANAGER','SALES','READ_ONLY'])assert.equal(resolution.canManageContactResolution(actor(role)),false);
});

test('individual creation preserves the lead, links the new Contact, and always defaults preference to UNKNOWN',async()=>{
  let created,leadPatch;
  const tx={tradeShowLead:{findFirst:async()=>lead(),update:async({data})=>{leadPatch=data;}},contact:{findMany:async()=>[],create:async({data})=>{created={id:31,...data};return created;}},account:{findUnique:async()=>null}};
  const client={$transaction:async fn=>fn(tx)};
  const id=await resolution.createContactFromTradeShowLead(client,1,2,input(),actor('MARKETING_MANAGER'));
  assert.equal(id,31);assert.equal(created.marketingPreference,'UNKNOWN');assert.equal(created.email,'ada@example.com');assert.deepEqual(leadPatch,{contactId:31});
  assert.equal(created.accountId,null);
});

test('exact and ambiguous email matches block creation and require explicit linking',async()=>{
  for(const matches of [[{id:10}],[{id:10},{id:11}]]){
    const tx={tradeShowLead:{findFirst:async()=>lead()},contact:{findMany:async()=>matches},account:{findUnique:async()=>null}};
    await assert.rejects(resolution.createContactFromTradeShowLead({$transaction:async fn=>fn(tx)},1,2,input(),actor('ADMIN')),matches.length===1?/already exists/:/Multiple Contacts/);
  }
});

test('linking changes only TradeShowLead.contactId and never overwrites Contact or Account data',async()=>{
  let leadPatch,contactWrites=0;
  const tx={tradeShowLead:{findFirst:async()=>lead({accountId:8}),update:async({data})=>{leadPatch=data;}},contact:{findFirst:async()=>({id:20,accountId:8}),update:async()=>contactWrites++}};
  assert.equal(await resolution.linkTradeShowLeadContact({$transaction:async fn=>fn(tx)},1,2,20,actor('ADMIN')),20);
  assert.deepEqual(leadPatch,{contactId:20});assert.equal(contactWrites,0);
});

test('bulk eligibility excludes placeholders, missing email, existing matches, ambiguity, and duplicate lead emails',()=>{
  const leads=[lead({id:1}),lead({id:2,email:'clean@example.com'}),lead({id:3,email:'existing@example.com'}),lead({id:4,email:'ambiguous@example.com'}),lead({id:5,email:'ambiguous@example.com'}),lead({id:6,firstName:'(First Name)',email:'placeholder@example.com'}),lead({id:7,email:null})];
  const contacts=[{id:30,firstName:'E',lastName:'One',email:'existing@example.com',accountId:null}];
  const assessed=resolution.assessContactResolution(leads,contacts);
  assert.equal(assessed.get(1).eligible,true);assert.equal(assessed.get(2).eligible,true);assert.equal(assessed.get(3).reason,'EXISTING_MATCH');assert.equal(assessed.get(4).reason,'DUPLICATE_LEAD_EMAIL');assert.equal(assessed.get(5).reason,'DUPLICATE_LEAD_EMAIL');assert.equal(assessed.get(6).reason,'MISSING_NAME');assert.equal(assessed.get(7).reason,'MISSING_EMAIL');
});

test('bulk creation accepts clean leads with unresolved Accounts and links each UNKNOWN Contact',async()=>{
  let next=40;const created=[],linked=[];const rows=[lead({id:2,email:'one@example.com'}),lead({id:3,email:'two@example.com',accountId:null})];
  const tx={tradeShow:{findUnique:async()=>({archivedAt:null})},tradeShowLead:{findMany:async()=>rows,update:async({where,data})=>linked.push([where.id,data.contactId])},contact:{findMany:async()=>[],create:async({data})=>{const row={id:next++,...data};created.push(row);return row;}},account:{findUnique:async()=>null}};
  const result=await resolution.bulkCreateTradeShowContacts({$transaction:async fn=>fn(tx)},1,[2,3],actor('MARKETING_MANAGER'));
  assert.equal(result.created,2);assert.equal(result.unresolvedAccounts,2);assert.ok(created.every(row=>row.marketingPreference==='UNKNOWN'));assert.deepEqual(linked,[[2,40],[3,41]]);
});

test('bulk creation rechecks unselected email peers and excludes unsafe duplicate rows',async()=>{
  const selected=lead({id:2,email:'shared@example.com'}),peer=lead({id:9,email:'SHARED@example.com'});let calls=0;
  const tx={tradeShow:{findUnique:async()=>({archivedAt:null})},tradeShowLead:{findMany:async()=>++calls===1?[selected]:[selected,peer]},contact:{findMany:async()=>[]}};
  await assert.rejects(resolution.bulkCreateTradeShowContacts({$transaction:async fn=>fn(tx)},1,[2],actor('ADMIN')),/no longer eligible/);
});

test('audience membership remains Contact-based and naturally changes after a lead link',async()=>{
  let matched=[];const client={contact:{findMany:async({where})=>where?.id?.in?[]:matched.map(id=>({id}))},marketingAudienceContactOverride:{findMany:async()=>[{contactId:9,kind:'EXCLUDE'}]}};
  let result=await audiences.resolveAudienceContactIds(client,{id:1,filterConfig:{tradeShowId:4}});assert.deepEqual(result.selected,[]);
  matched=[9,10];result=await audiences.resolveAudienceContactIds(client,{id:1,filterConfig:{tradeShowId:4}});assert.deepEqual(result.selected,[10]);
});

test('Audience and Contact Resolution UI use business wording and visible success feedback',()=>{
  const form=fs.readFileSync(path.join(root,'components/marketing-audience-form.tsx'),'utf8'),newPage=fs.readFileSync(path.join(root,'app/marketing/audiences/new/page.tsx'),'utf8'),detail=fs.readFileSync(path.join(root,'app/marketing/audiences/[id]/page.tsx'),'utf8'),workflow=fs.readFileSync(path.join(root,'app/trade-shows/[id]/contact-resolution/page.tsx'),'utf8');
  for(const copy of ['Contact Criteria','Account Criteria','Trade Show Criteria','Contact Name or Email','Job Title','Email Availability','Conversion Status','Product Interest','Competitor'])assert.match(form,new RegExp(copy));
  assert.match(newPage,/Build a reusable Contact audience using current SalesHub data/);assert.match(detail,/Audience membership updates automatically using current SalesHub data/);assert.match(detail,/Trade Show leads are not linked to Contacts and are not included in this audience/);assert.match(detail,/Review Leads/);assert.doesNotMatch(detail,/Filter-matched|filters rerun now/);
  assert.match(workflow,/Contact linked successfully/);assert.match(workflow,/Contact created successfully/);assert.match(workflow,/Open Contact/);assert.match(workflow,/Link Existing Contact/);assert.match(workflow,/Leave Unresolved/);
});
