import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021,esModuleInterop:true}}).outputText,filename);
const require=Module.createRequire(import.meta.url),audiences=require(path.join(root,'lib/marketing-audiences.ts')),contacts=require(path.join(root,'lib/contacts.ts')),{can,routeAccess}=require(path.join(root,'lib/authorization.ts'));
const actor=(role,id=7)=>({id,role,active:true,archivedAt:null});
const contact=(id,preference,email)=>({id,firstName:`First${id}`,lastName:`Last${id}`,email,phone:'555',title:'Buyer',accountId:3,marketingPreference:preference,account:{name:'Acme',industry:'MFG',industryCategory:{name:'Manufacturing'},territory:'EAST',territoryCategory:{name:'East'},businessRoles:[{role:'END_USER'}],owner:{firstName:'Alex',lastName:'Rep'}},tradeShowLeads:[]});

test('migration gives existing and future Contacts UNKNOWN without inferring source consent',()=>{
  const schema=fs.readFileSync(path.join(root,'prisma/schema.prisma'),'utf8'),migration=fs.readFileSync(path.join(root,'prisma/migrations/20260923210000_marketing_audiences/migration.sql'),'utf8'),resolve=fs.readFileSync(path.join(root,'app/trade-shows/[id]/leads/[leadId]/resolve/actions.ts'),'utf8');
  assert.match(schema,/marketingPreference\s+MarketingPreference @default\(UNKNOWN\)/);
  assert.match(migration,/ADD COLUMN "marketingPreference" "MarketingPreference" NOT NULL DEFAULT 'UNKNOWN'/);
  assert.match(resolve,/marketingPreference:'UNKNOWN'/);
  assert.doesNotMatch(resolve,/routing.*OPTED_IN|OPTED_IN.*routing/s);
});

test('explicit preference changes stamp actor/time and require marketing.write',async()=>{
  let row={id:4,accountId:null,archivedAt:null,marketingPreference:'UNKNOWN'};
  const tx={account:{findUnique:async()=>null},contact:{findUnique:async()=>row,updateMany:async()=>{},update:async({data})=>(row={...row,...data}),create:async({data})=>(row={id:4,...data})}};
  const client={$transaction:async fn=>fn(tx)},base={accountId:null,firstName:'Ada',lastName:'L',title:null,email:'ada@example.com',phone:null,mobile:null,active:true,isPrimary:false,addressLine1:null,addressLine2:null,city:null,stateProvince:null,postalCode:null,country:null};
  await assert.rejects(contacts.saveContact(client,{...base,marketingPreference:'OPTED_IN'},4,actor('SALES_MANAGER')),/Marketing Managers/);
  await contacts.saveContact(client,{...base,marketingPreference:'OPTED_IN'},4,actor('MARKETING_MANAGER'));
  assert.equal(row.marketingPreference,'OPTED_IN');assert.equal(row.marketingPreferenceUpdatedByUserId,7);assert.ok(row.marketingPreferenceUpdatedAt instanceof Date);
  const stamped=row.marketingPreferenceUpdatedAt;await contacts.saveContact(client,{...base,marketingPreference:'OPTED_IN'},4,actor('ADMIN',9));assert.equal(row.marketingPreferenceUpdatedAt,stamped);
  await contacts.saveContact(client,{...base,marketingPreference:'OPTED_OUT'},4,actor('ADMIN',9));assert.equal(row.marketingPreferenceUpdatedByUserId,9);
});

test('audience config validates curated fields and rejects executable or obsolete filters',()=>{
  const valid=audiences.validateAudienceConfig({preference:'OPTED_IN',emailPresence:'PRESENT',accountId:3,industry:'MFG',businessRole:'END_USER',territory:'EAST',accountOwnerId:7,activeAccount:true,tradeShowId:2,showDateFrom:'2026-01-01',showDateTo:'2026-12-31',leadStatus:'QUALIFIED',routing:'MARKETING_FOLLOW_UP',assignedSalesRepId:7,referralPartnerId:9,converted:true,productInterest:'linerless',competitorId:4});
  assert.equal(valid.routing,'MARKETING_FOLLOW_UP');assert.equal(valid.preference,'OPTED_IN');
  assert.throws(()=>audiences.validateAudienceConfig({rawSql:'DROP TABLE Contact'}),/no longer supported/);
  assert.throws(()=>audiences.validateAudienceConfig({preference:'YES'}),/Preference/);
});

test('Contact, Account, and Trade Show filters compile to Contact-grain relational constraints',()=>{
  const where=audiences.audienceContactWhere({search:'ada',title:'buyer',preference:'UNKNOWN',emailPresence:'MISSING',accountId:3,industry:'MFG',businessRole:'DISTRIBUTOR',territory:'EAST',accountOwnerId:7,activeAccount:true,tradeShowId:2,showDateFrom:'2026-01-01',showDateTo:'2026-12-31',leadStatus:'QUALIFIED',routing:'MARKETING_FOLLOW_UP',assignedSalesRepId:7,referralPartnerId:9,converted:true,productInterest:'linerless',competitorId:4});
  const text=JSON.stringify(where);
  for(const token of ['marketingPreference','businessRoles','tradeShowLeads','MARKETING_FOLLOW_UP','convertedOpportunityId','productInterest','competitorId','assignedSalesRepUserId','routedPartnerAccountId'])assert.match(text,new RegExp(token));
  assert.match(text,/"active":true/);assert.match(text,/"archivedAt":null/);
});

test('dynamic membership reruns filters and applies INCLUDE then EXCLUDE while archived Contacts stay out',async()=>{
  let matched=[1,2];
  const client={contact:{findMany:async({where})=>where?.id?.in?where.id.in.filter(id=>id!==4).map(id=>({id})):matched.map(id=>({id}))},marketingAudienceContactOverride:{findMany:async()=>[{contactId:2,kind:'EXCLUDE'},{contactId:3,kind:'INCLUDE'},{contactId:4,kind:'INCLUDE'}]}};
  let result=await audiences.resolveAudienceContactIds(client,{id:1,filterConfig:{}});assert.deepEqual(result.selected,[1,3]);
  matched=[2,5];result=await audiences.resolveAudienceContactIds(client,{id:1,filterConfig:{}});assert.deepEqual(result.selected,[5,3]);
});

test('summary distinguishes matched, preference, missing email, and Marketing Ready',async()=>{
  const rows=[contact(1,'OPTED_IN','one@example.com'),contact(2,'OPTED_IN',null),contact(3,'UNKNOWN','three@example.com'),contact(4,'OPTED_OUT','four@example.com')];
  const client={contact:{findMany:async()=>rows.map(({marketingPreference,email})=>({marketingPreference,email}))}};
  assert.deepEqual(await audiences.audienceSummary(client,[1,2,3,4],5),{matched:5,selected:4,optedIn:2,unknown:1,optedOut:1,missingEmail:1,marketingReady:1});
});

test('general CSV includes preference and Account context but excludes raw and narrative data; ready rule is strict',()=>{
  const rows=[contact(1,'OPTED_IN','one@example.com'),contact(2,'UNKNOWN','two@example.com'),contact(3,'OPTED_OUT','three@example.com'),contact(4,'OPTED_IN',null)];
  const csv=audiences.contactsCsv(rows);assert.match(csv,/Account Business Roles,Industry,Territory,Account Owner,Marketing Preference/);assert.match(csv,/Acme/);assert.doesNotMatch(csv,/rawSourceData|Customer Pain Points/);
  assert.deepEqual(rows.filter(x=>x.marketingPreference==='OPTED_IN'&&audiences.validEmail(x.email)).map(x=>x.id),[1]);
});

test('audience permissions reuse marketing read/write and PERSONAL/SHARED ownership',()=>{
  const personal={ownerId:7,visibility:'PERSONAL'},shared={ownerId:8,visibility:'SHARED'};
  assert.equal(audiences.canManageAudience(actor('ADMIN'),shared),true);assert.equal(audiences.canManageAudience(actor('MARKETING_MANAGER'),personal),true);assert.equal(audiences.canManageAudience(actor('SALES_MANAGER'),personal),false);assert.equal(audiences.canManageAudience(actor('SALES'),personal),false);assert.equal(audiences.canManageAudience(actor('READ_ONLY'),personal),false);
  assert.equal(audiences.canViewAudience(actor('SALES_MANAGER'),shared),true);assert.equal(audiences.canViewAudience(actor('READ_ONLY'),shared),true);assert.equal(audiences.canViewAudience(actor('READ_ONLY',9),personal),false);
  assert.equal(audiences.canExportAudience(actor('MARKETING_MANAGER'),shared),true);assert.equal(audiences.canExportAudience(actor('SALES_MANAGER'),shared),false);
  assert.equal(routeAccess('/marketing/audiences/new',actor('READ_ONLY')),'denied');assert.equal(can(actor('MARKETING_MANAGER'),'marketing.write'),true);
});

test('audience UI is compact, responsive, paginated, and offers both safe exports',()=>{
  const form=fs.readFileSync(path.join(root,'components/marketing-audience-form.tsx'),'utf8'),detail=fs.readFileSync(path.join(root,'app/marketing/audiences/[id]/page.tsx'),'utf8');
  assert.match(form,/report-primary-filters/);assert.match(form,/report-filter-grid/);assert.match(detail,/PAGE_SIZE=50/);assert.match(detail,/Select All Matching/);assert.match(detail,/Clear Selection/);assert.match(detail,/Export Selected/);assert.match(detail,/Export Marketing-Ready/);assert.match(detail,/TableScroll/);
});
