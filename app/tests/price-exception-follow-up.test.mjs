import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const require=Module.createRequire(fileURLToPath(import.meta.url));
const workflow=require(path.join(root,'lib/price-exception-follow-up.ts'));
const expiration=require(path.join(root,'lib/price-exception-expiration.ts'));
const actor=role=>({id:7,role,active:true,archivedAt:null});
const patch=(status,overrides={})=>({status,ownerId:7,nextFollowUpAt:null,note:null,replacementPriceExceptionId:null,replacementPeNumber:null,...overrides});
function fakeDb({assigned=7,sourceType='EXTERNAL_EXPORT',visible=true}={}) {
  const state={row:null,events:[],where:[]};
  const tx={priceException:{findFirst:async({where})=>{state.where.push(where);return visible?{id:2,assignedSalesRepUserId:assigned,sourceType,followUp:state.row}:null;}},user:{findFirst:async({where})=>where.id===7||where.id===8?{id:where.id}:null},priceExceptionFollowUp:{upsert:async({create,update})=>{state.row={...(state.row??{}),...(state.row?update:create)};return state.row;}},priceExceptionFollowUpEvent:{create:async({data})=>{state.events.push(data);}}};
  return {state,$transaction:async fn=>fn(tx)};
}
test('untouched PE defaults in the report query without backfill and respects existing visibility',()=>{
  const where=expiration.expiringWhere(actor('SALES'),{followUpStatus:'NOT_STARTED'},new Date('2026-10-05T00:00:00Z'));
  assert.match(JSON.stringify(where),/"followUp":null/);
  assert.match(JSON.stringify(where),/LEGACY_WORKBOOK/);
  assert.equal(workflow.followUpLabels.NOT_STARTED,'Not Started');
  const migration=fs.readFileSync(path.join(root,'prisma/migrations/20261005010000_price_exception_follow_up/migration.sql'),'utf8');
  assert.doesNotMatch(migration,/^\s*(INSERT|UPDATE)\s/mi);
});
test('an untouched PE displays Not Started and inherits its assigned Sales Rep without writing',async()=>{
  const row={id:2,peCode:'PE-2',sourceType:'EXTERNAL_EXPORT',assignedSalesRepUser:{firstName:'A',lastName:'Rep'},followUp:null,distributorAccount:null,varAccount:null,endUserAccount:null,distributorSourceName:null,varSourceName:null,endUserSourceName:null,status:'ACTIVE',expirationDate:new Date('2026-10-10T00:00:00Z'),lines:[]};
  const db={priceException:{count:async()=>1,findMany:async()=>[row]}};
  const result=await expiration.expiringReport(db,actor('SALES'),{}, {now:new Date('2026-10-05T18:00:00Z')});
  assert.equal(result.rows[0].followUpStatus,'NOT_STARTED');
  assert.equal(result.rows[0].followUpOwner,'A Rep');
  row.assignedSalesRepUser=null;row.sourceType='LEGACY_WORKBOOK';
  const unassigned=await expiration.expiringReport(db,actor('SALES'),{}, {now:new Date('2026-10-05T18:00:00Z')});
  assert.equal(unassigned.rows[0].followUpOwner,'Unassigned');
});
test('transitions capture actor, timestamp, prior and new values; no-op creates no event',async()=>{
  const db=fakeDb(),now=new Date('2026-10-05T18:00:00Z');
  for(const status of ['IN_PROGRESS','RENEWAL_REQUESTED','REPLACEMENT_SUBMITTED','NO_RENEWAL_NEEDED','COMPLETED'])await workflow.updatePriceExceptionFollowUp(db,2,actor('SALES'),patch(status),now);
  assert.equal(db.state.events.length,5);
  assert.equal(db.state.events[0].previousValues.status,'NOT_STARTED');
  assert.equal(db.state.events[0].newValues.status,'IN_PROGRESS');
  assert.equal(db.state.events[2].newValues.status,'REPLACEMENT_SUBMITTED');
  assert.equal(db.state.events[4].actorId,7);
  assert.equal(db.state.events[4].createdAt,now);
  assert.equal(db.state.row.completedById,7);
  assert.deepEqual(await workflow.updatePriceExceptionFollowUp(db,2,actor('SALES'),patch('COMPLETED'),now),{changed:false});
  assert.equal(db.state.events.length,5);
});
test('role, row scope, owner and replacement checks reject tampering',async()=>{
  for(const role of ['READ_ONLY','MARKETING_MANAGER'])await assert.rejects(workflow.updatePriceExceptionFollowUp(fakeDb(),2,actor(role),patch('IN_PROGRESS')), /Access denied/);
  await assert.rejects(workflow.updatePriceExceptionFollowUp(fakeDb({visible:false}),2,actor('SALES'),patch('IN_PROGRESS')), /not found/);
  await assert.rejects(workflow.updatePriceExceptionFollowUp(fakeDb(),2,actor('SALES'),patch('IN_PROGRESS',{ownerId:8})), /cannot reassign/);
  const manager=fakeDb({assigned:null});
  await workflow.updatePriceExceptionFollowUp(manager,2,actor('SALES_MANAGER'),patch('IN_PROGRESS',{ownerId:8}));
  assert.equal(manager.state.row.ownerId,8);
  assert.equal(manager.state.events[0].previousValues.ownerId,null);
  const admin=fakeDb();await workflow.updatePriceExceptionFollowUp(admin,2,actor('ADMIN'),patch('IN_PROGRESS'));assert.equal(admin.state.events.length,1);
  await assert.rejects(workflow.updatePriceExceptionFollowUp(fakeDb(),2,actor('SALES'),patch('IN_PROGRESS',{replacementPriceExceptionId:2})),/cannot replace itself/);
});
test('overdue is based on action date and excludes completed or no-renewal',()=>{
  const today=new Date('2026-10-05T00:00:00Z'),yesterday=new Date('2026-10-04T00:00:00Z');
  assert.equal(workflow.followUpOverdue(yesterday,'IN_PROGRESS',today),true);
  assert.equal(workflow.followUpOverdue(yesterday,'COMPLETED',today),false);
  assert.equal(workflow.followUpOverdue(yesterday,'NO_RENEWAL_NEEDED',today),false);
  assert.equal(workflow.followUpOverdue(today,'IN_PROGRESS',today),false);
  assert.match(JSON.stringify(expiration.expiringWhere(actor('SALES'),{needsFollowUp:'1'},today)),/"notIn":\["COMPLETED","NO_RENEWAL_NEEDED"\]/);
  assert.match(JSON.stringify(expiration.expiringWhere(actor('SALES'),{overdueFollowUp:'1'},today)),/"nextFollowUpAt"/);
});
