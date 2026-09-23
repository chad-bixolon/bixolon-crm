import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename);
const require=Module.createRequire(import.meta.url);
const routing=require(path.join(root,'lib/trade-show-routing.ts'));
const leads=require(path.join(root,'lib/trade-show-leads.ts'));
const {can}=require(path.join(root,'lib/authorization.ts'));
const actor=(role,id=7)=>({id,role,active:true,archivedAt:null});
const form=entries=>{const value=new FormData();for(const [key,item] of entries)value.set(key,item);return value};

test('routing validation applies route-specific rep and eligible partner requirements',async()=>{
  const client={
    user:{findFirst:async({where})=>where.id===9?{id:9}:null},
    account:{findFirst:async({where})=>where.id===20?{id:20}:null},
  };
  await assert.doesNotReject(routing.validateTradeShowRouting(client,'UNREVIEWED',null,null));
  await assert.doesNotReject(routing.validateTradeShowRouting(client,'MARKETING_FOLLOW_UP',null,null));
  await assert.rejects(routing.validateTradeShowRouting(client,'BIXOLON_SALES',null,null),/Sales rep/);
  await assert.doesNotReject(routing.validateTradeShowRouting(client,'BIXOLON_SALES',9,null));
  await assert.rejects(routing.validateTradeShowRouting(client,'REFERRED_TO_PARTNER',null,null),/Partner Account/);
  await assert.doesNotReject(routing.validateTradeShowRouting(client,'REFERRED_TO_PARTNER',null,20));
  await assert.rejects(routing.validateTradeShowRouting(client,'REFERRED_TO_PARTNER',null,21),/eligible partner Business Role/);
  const inactive={...client,account:{findFirst:async()=>null}};await assert.rejects(routing.validateTradeShowRouting(inactive,'REFERRED_TO_PARTNER',null,20),/eligible partner Business Role/);
});

test('partner eligibility is based on active Account Business Roles, including approved channel roles only',()=>{
  assert.deepEqual(routing.PARTNER_ACCOUNT_ROLES,['DISTRIBUTOR','VAR','ISV','OEM','PARTNER']);
  assert.equal(routing.eligiblePartnerAccountWhere.status,'ACTIVE');
  assert.equal(routing.eligiblePartnerAccountWhere.archivedAt,null);
  assert.deepEqual(routing.eligiblePartnerAccountWhere.businessRoles.some.role.in,routing.PARTNER_ACCOUNT_ROLES);
});

test('role authorization permits managers and own-lead Sales routing but keeps Read Only and unrelated Sales out',()=>{
  for(const role of ['ADMIN','MARKETING_MANAGER','SALES_MANAGER'])assert.equal(can(actor(role),'trade-shows.route'),true);
  assert.equal(routing.canRouteTradeShowLead(actor('SALES'),{assignedSalesRepUserId:7}),true);
  assert.equal(routing.canRouteTradeShowLead(actor('SALES'),{assignedSalesRepUserId:8}),false);
  assert.equal(routing.canRouteTradeShowLead(actor('READ_ONLY'),{assignedSalesRepUserId:7}),false);
});

test('individual partner referral records actor/time and later rerouting preserves referral audit fields',async()=>{
  let stored={id:2,tradeShowId:1,routing:'UNREVIEWED',routedPartnerAccountId:null,referredAt:null,referredByUserId:null,referralNotes:null,assignedSalesRepUserId:null,convertedOpportunityId:null,accountId:null,contactId:null,competitorId:null,tradeShow:{archivedAt:null}};
  const tx={tradeShowLead:{findFirst:async()=>stored,update:async({data})=>(stored={...stored,...data})},user:{findFirst:async()=>null},account:{findFirst:async({where})=>where.id===20?{id:20}:null},contact:{findFirst:async()=>null},competitorOption:{findFirst:async()=>null}};
  const client={$transaction:async callback=>callback(tx)};
  await leads.saveTradeShowLeadUpdate(client,1,2,form([['status','NEW'],['routing','REFERRED_TO_PARTNER'],['routedPartnerAccountId','20'],['referralNotes','Warm handoff']]),actor('MARKETING_MANAGER'));
  assert.equal(stored.routing,'REFERRED_TO_PARTNER');assert.equal(stored.routedPartnerAccountId,20);assert.equal(stored.referredByUserId,7);assert.ok(stored.referredAt instanceof Date);assert.equal(stored.referralNotes,'Warm handoff');
  const audit={partner:stored.routedPartnerAccountId,at:stored.referredAt,by:stored.referredByUserId,notes:stored.referralNotes};
  await leads.saveTradeShowLeadUpdate(client,1,2,form([['status','NEW'],['routing','MARKETING_FOLLOW_UP'],['routedPartnerAccountId',''],['referralNotes','']]),actor('MARKETING_MANAGER'));
  assert.equal(stored.routing,'MARKETING_FOLLOW_UP');assert.deepEqual({partner:stored.routedPartnerAccountId,at:stored.referredAt,by:stored.referredByUserId,notes:stored.referralNotes},audit);
  await leads.saveTradeShowLeadUpdate(client,1,2,form([['status','NEW'],['routing','REFERRED_TO_PARTNER'],['routedPartnerAccountId','20'],['referralNotes','Replacement text']]),actor('ADMIN',99));
  assert.deepEqual({partner:stored.routedPartnerAccountId,at:stored.referredAt,by:stored.referredByUserId,notes:stored.referralNotes},audit);
});

test('bulk routing validates once, updates every selected lead, and enforces manager-level access',async()=>{
  const rows=[{id:1,routing:'UNREVIEWED'},{id:2,routing:'UNREVIEWED'}],updates=[];
  const tx={tradeShow:{findUnique:async()=>({archivedAt:null})},tradeShowLead:{findMany:async()=>rows.map(row=>({...row,referredAt:null})),update:async({where,data})=>updates.push({id:where.id,...data})},user:{findFirst:async({where})=>where.id===9?{id:9}:null},account:{findFirst:async({where})=>where.id===20?{id:20}:null}};
  const client={$transaction:async callback=>callback(tx)};
  assert.equal(await routing.bulkRouteTradeShowLeads(client,1,[1,2],'REFERRED_TO_PARTNER',null,20,'BlueStar',actor('SALES_MANAGER')),2);
  assert.equal(updates.length,2);assert.ok(updates.every(item=>item.routing==='REFERRED_TO_PARTNER'&&item.routedPartnerAccountId===20&&item.referredByUserId===7));
  await assert.rejects(routing.bulkRouteTradeShowLeads(client,1,[1],'UNREVIEWED',null,null,null,actor('SALES')),/Access denied/);
  await assert.rejects(routing.bulkRouteTradeShowLeads(client,1,[1],'UNREVIEWED',null,null,null,actor('READ_ONLY')),/Access denied/);
});

test('migration defaults existing leads to Unreviewed and enforces required current-route references',()=>{
  const schema=fs.readFileSync(path.join(root,'prisma/schema.prisma'),'utf8');
  const migration=fs.readFileSync(path.join(root,'prisma/migrations/20260923190000_trade_show_lead_routing/migration.sql'),'utf8');
  assert.match(schema,/enum TradeShowLeadRouting[\s\S]*UNREVIEWED[\s\S]*BIXOLON_SALES[\s\S]*REFERRED_TO_PARTNER[\s\S]*MARKETING_FOLLOW_UP/);
  assert.match(schema,/routing\s+TradeShowLeadRouting @default\(UNREVIEWED\)/);
  assert.match(migration,/NOT NULL DEFAULT 'UNREVIEWED'/);
  assert.match(migration,/TradeShowLead_routing_requirements_check/);
});
