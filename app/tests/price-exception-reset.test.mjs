import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertProductionIdentity, assertKnownDependencies, parseResetOptions, runPriceExceptionReset } from '../scripts/operations/reset-price-exceptions.mjs';
const env={NODE_ENV:'production',DATABASE_URL:'postgresql://user:secret@bixolon-crm-db-do-user-44410788-0.e.db.ondigitalocean.com:25060/bixolon_crm'};
const options={apply:false,showSystemId:false,expectHost:'bixolon-crm-db-do-user-44410788-0.e.db.ondigitalocean.com',expectSystemId:'1234567890123456789'};
const graph=[
  {name:'PriceExceptionLine_priceExceptionId_fkey',referencingTable:'PriceExceptionLine',referencedTable:'PriceException',deleteAction:'r'},
  {name:'OpportunityProduct_priceExceptionLineId_fkey',referencingTable:'OpportunityProduct',referencedTable:'PriceExceptionLine',deleteAction:'r'},
];
function fakeDb({headers=4,lines=7,links=0,snapshots=0,verifyFailure=false}={}){
  const state={headers,lines,links,snapshots,deleteCalls:0};
  const db={state,
    $queryRawUnsafe:async sql=>sql.includes('pg_control_system')?[{database:'bixolon_crm',systemId:options.expectSystemId}]:sql.includes('pg_constraint con')?graph:sql.includes('pg_trigger tg')?[]:[{count:12}],
    $executeRawUnsafe:async()=>0,
    priceException:{count:async()=>state.headers,deleteMany:async()=>{state.deleteCalls++;const count=state.headers;state.headers=verifyFailure?1:0;return {count}}},
    priceExceptionLine:{count:async()=>state.lines,deleteMany:async()=>{state.deleteCalls++;const count=state.lines;state.lines=0;return {count}}},
    opportunityProduct:{count:async({where})=>where.priceExceptionLineId?state.links:state.snapshots},
    $transaction:async callback=>{const snapshot={...state};try{return await callback(db)}catch(error){Object.assign(state,snapshot);throw error}},
  };
  return db;
}
test('production identity requires database, expected host, environment and server cluster identifier',()=>{
  const actual={database:'bixolon_crm',systemId:options.expectSystemId};
  assert.doesNotThrow(()=>assertProductionIdentity(env,actual,options));
  for(const changed of [{NODE_ENV:'development'},{DATABASE_URL:undefined},{DATABASE_URL:'postgresql://user:secret@other:5432/bixolon_crm'},{DATABASE_URL:'postgresql://user:secret@bixolon-crm-db-do-user-44410788-0.e.db.ondigitalocean.com:25060/other'}])assert.throws(()=>assertProductionIdentity({...env,...changed},actual,options),/Refusing reset/);
  assert.throws(()=>assertProductionIdentity(env,actual,{...options,expectHost:'other'}),/Refusing reset/);
  assert.throws(()=>assertProductionIdentity(env,actual,{...options,expectSystemId:'9999999999999999999'}),/Refusing reset/);
  assert.throws(()=>assertProductionIdentity(env,{...actual,database:'test'},options),/Refusing reset/);
});
test('unknown FK or trigger blocks reset',()=>{assert.doesNotThrow(()=>assertKnownDependencies(graph,[]));assert.throws(()=>assertKnownDependencies([...graph,{name:'other',referencingTable:'Other',referencedTable:'PriceException',deleteAction:'c'}],[]),/foreign-key graph/);assert.throws(()=>assertKnownDependencies(graph,[{name:'trigger'}]),/custom triggers/)});
test('options require host and system ID; apply requires explicit token',()=>{
  assert.deepEqual(parseResetOptions([`--expect-host=${options.expectHost}`,`--expect-system-id=${options.expectSystemId}`]),options);
  assert.deepEqual(parseResetOptions([`--expect-host=${options.expectHost}`,'--show-system-id']),{...options,showSystemId:true,expectSystemId:null});
  assert.throws(()=>parseResetOptions([]),/expect-host/);
  assert.throws(()=>parseResetOptions([`--expect-host=${options.expectHost}`]),/expect-system-id/);
  assert.throws(()=>parseResetOptions([`--expect-host=${options.expectHost}`,'--show-system-id',`--expect-system-id=${options.expectSystemId}`]),/cannot be combined/);
  assert.throws(()=>parseResetOptions([`--expect-host=${options.expectHost}`,`--expect-system-id=${options.expectSystemId}`,'--apply']),/requires/);
  assert.throws(()=>parseResetOptions([`--expect-host=${options.expectHost}`,`--expect-system-id=${options.expectSystemId}`,'--confirm=DELETE_ALL_PRICE_EXCEPTIONS']),/only valid/);
});
test('system ID display only reads server identity',async()=>{const db=fakeDb();const result=await runPriceExceptionReset(db,env,{...options,showSystemId:true,expectSystemId:null});assert.deepEqual(result,{systemId:options.expectSystemId});assert.equal(db.state.deleteCalls,0)});
test('target mismatch stops before querying the database',async()=>{const db=fakeDb();db.$queryRawUnsafe=async()=>{throw new Error('Unexpected query')};await assert.rejects(runPriceExceptionReset(db,{...env,NODE_ENV:'development'},options),/Refusing reset/)});
test('dry-run is read-only and reports linked Opportunity products',async()=>{const db=fakeDb({links:2}),result=await runPriceExceptionReset(db,env,options);assert.equal(result.blocked,true);assert.deepEqual(result.deleteOrder,['PriceExceptionLine','PriceException']);assert.equal(result.before.counts.PriceException,4);assert.equal(result.before.counts.PriceExceptionLine,7);assert.equal(db.state.deleteCalls,0)});
test('apply stops before deletes if Opportunity pricing references PE lines',async()=>{const db=fakeDb({links:1,snapshots:1});await assert.rejects(runPriceExceptionReset(db,env,{...options,apply:true}),/Reset blocked/);assert.equal(db.state.deleteCalls,0);assert.equal(db.state.snapshots,1)});
test('unreferenced lines delete before headers, protected counts and snapshots survive',async()=>{const db=fakeDb({snapshots:0}),result=await runPriceExceptionReset(db,env,{...options,apply:true});assert.deepEqual(result.deleted,{PriceExceptionLine:7,PriceException:4});assert.equal(result.after.counts.PriceExceptionLine,0);assert.equal(result.after.counts.PriceException,0);assert.equal(result.after.protected.OpportunityProduct,12);assert.equal(db.state.deleteCalls,2)});
test('verification failure rolls back transaction',async()=>{const db=fakeDb({verifyFailure:true});await assert.rejects(runPriceExceptionReset(db,env,{...options,apply:true}),/verification failed/);assert.equal(db.state.headers,4);assert.equal(db.state.lines,7)});
