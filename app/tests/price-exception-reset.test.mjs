import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertProductionIdentity, assertKnownDependencies, parseResetOptions, runPriceExceptionReset } from '../scripts/operations/reset-price-exceptions.mjs';
const env={NODE_ENV:'production',DATABASE_URL:'postgresql://user:secret@db:5432/bixolon_crm',BIXOLON_PRODUCTION_SYSTEM_ID:'1234567890123456789'};
const graph=[
  {name:'PriceExceptionLine_priceExceptionId_fkey',referencingTable:'PriceExceptionLine',referencedTable:'PriceException',deleteAction:'r'},
  {name:'OpportunityProduct_priceExceptionLineId_fkey',referencingTable:'OpportunityProduct',referencedTable:'PriceExceptionLine',deleteAction:'r'},
];
function fakeDb({headers=4,lines=7,links=0,snapshots=0,verifyFailure=false}={}){
  const state={headers,lines,links,snapshots,deleteCalls:0};
  const db={state,
    $queryRawUnsafe:async sql=>sql.includes('pg_control_system')?[{database:'bixolon_crm',systemId:env.BIXOLON_PRODUCTION_SYSTEM_ID}]:sql.includes('pg_constraint con')?graph:sql.includes('pg_trigger tg')?[]:[{count:12}],
    $executeRawUnsafe:async()=>0,
    priceException:{count:async()=>state.headers,deleteMany:async()=>{state.deleteCalls++;const count=state.headers;state.headers=verifyFailure?1:0;return {count}}},
    priceExceptionLine:{count:async()=>state.lines,deleteMany:async()=>{state.deleteCalls++;const count=state.lines;state.lines=0;return {count}}},
    opportunityProduct:{count:async({where})=>where.priceExceptionLineId?state.links:state.snapshots},
    $transaction:async callback=>{const snapshot={...state};try{return await callback(db)}catch(error){Object.assign(state,snapshot);throw error}},
  };
  return db;
}
test('production identity requires database, network host, environment and fixed cluster identifier',()=>{
  assert.doesNotThrow(()=>assertProductionIdentity(env,{database:'bixolon_crm',systemId:env.BIXOLON_PRODUCTION_SYSTEM_ID}));
  for(const changed of [{NODE_ENV:'development'},{DATABASE_URL:'postgresql://user:secret@other:5432/bixolon_crm'},{BIXOLON_PRODUCTION_SYSTEM_ID:'9999999999999999999'}])assert.throws(()=>assertProductionIdentity({...env,...changed},{database:'bixolon_crm',systemId:env.BIXOLON_PRODUCTION_SYSTEM_ID}),/Refusing reset/);
  assert.throws(()=>assertProductionIdentity(env,{database:'test',systemId:env.BIXOLON_PRODUCTION_SYSTEM_ID}),/Refusing reset/);
});
test('unknown FK or trigger blocks reset',()=>{assert.doesNotThrow(()=>assertKnownDependencies(graph,[]));assert.throws(()=>assertKnownDependencies([...graph,{name:'other',referencingTable:'Other',referencedTable:'PriceException',deleteAction:'c'}],[]),/foreign-key graph/);assert.throws(()=>assertKnownDependencies(graph,[{name:'trigger'}]),/custom triggers/)});
test('dry-run is default and performs no deletes; apply requires explicit token',async()=>{assert.deepEqual(parseResetOptions([]),{apply:false});assert.throws(()=>parseResetOptions(['--apply']),/requires/);const db=fakeDb({links:2}),result=await runPriceExceptionReset(db,env,{apply:false});assert.equal(result.blocked,true);assert.deepEqual(result.deleteOrder,['PriceExceptionLine','PriceException']);assert.equal(result.before.counts.PriceException,4);assert.equal(result.before.counts.PriceExceptionLine,7);assert.equal(db.state.deleteCalls,0)});
test('apply stops before deletes if Opportunity pricing references PE lines',async()=>{const db=fakeDb({links:1,snapshots:1});await assert.rejects(runPriceExceptionReset(db,env,{apply:true}),/Reset blocked/);assert.equal(db.state.deleteCalls,0);assert.equal(db.state.snapshots,1)});
test('unreferenced lines delete before headers, protected counts and snapshots survive',async()=>{const db=fakeDb({snapshots:0}),result=await runPriceExceptionReset(db,env,{apply:true});assert.deepEqual(result.deleted,{PriceExceptionLine:7,PriceException:4});assert.equal(result.after.counts.PriceExceptionLine,0);assert.equal(result.after.counts.PriceException,0);assert.equal(result.after.protected.OpportunityProduct,12);assert.equal(db.state.deleteCalls,2)});
test('verification failure rolls back transaction',async()=>{const db=fakeDb({verifyFailure:true});await assert.rejects(runPriceExceptionReset(db,env,{apply:true}),/verification failed/);assert.equal(db.state.headers,4);assert.equal(db.state.lines,7)});
