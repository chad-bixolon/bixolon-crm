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
const {businessToday}=require(path.join(root,'lib/price-exception-expiration.ts'));
const {canManagePriceExceptionLifecycle,canMarkPriceExceptionExpired,markPriceExceptionExpired}=require(path.join(root,'lib/price-exception-lifecycle.ts'));
const now=new Date('2026-10-06T02:30:00Z'); // October 5 in New York.
const actor=role=>({id:7,role,active:true,archivedAt:null});
const date=value=>new Date(`${value}T00:00:00Z`);
function fakeDb(overrides={}) {
  const row={id:2,status:'ACTIVE',archivedAt:null,expirationDate:date('2026-10-04'),updatedAt:date('2026-10-01'),followUp:{status:'IN_PROGRESS',ownerId:9,replacementPeNumber:'PE-3'},sourceMetadata:{raw:'unchanged'},...overrides};
  const events=[];
  const tx={priceException:{findFirst:async()=>row,updateMany:async({where,data})=>{if(row.status!==where.status||row.updatedAt!==where.updatedAt||row.expirationDate>=where.expirationDate.lt)return {count:0};Object.assign(row,data);return {count:1}}},priceExceptionLifecycleEvent:{create:async({data})=>events.push(data)}};
  return {row,events,$transaction:async callback=>callback(tx)};
}
test('New York boundary and lifecycle permissions',()=>{
  assert.equal(businessToday(now).toISOString(),'2026-10-05T00:00:00.000Z');
  for(const role of ['ADMIN','SALES_MANAGER'])assert.equal(canManagePriceExceptionLifecycle(actor(role)),true);
  for(const role of ['SALES','READ_ONLY','MARKETING_MANAGER'])assert.equal(canManagePriceExceptionLifecycle(actor(role)),false);
  assert.equal(canMarkPriceExceptionExpired({status:'ACTIVE',archivedAt:null,expirationDate:date('2026-10-04')},businessToday(now)),true);
  for(const expirationDate of [date('2026-10-05'),date('2026-10-06'),null])assert.equal(canMarkPriceExceptionExpired({status:'ACTIVE',archivedAt:null,expirationDate},businessToday(now)),false);
  assert.equal(canMarkPriceExceptionExpired({status:'EXPIRED',archivedAt:null,expirationDate:date('2026-10-04')},businessToday(now)),false);
});
test('manual expiration records one effective actor event and preserves follow-up and source data',async()=>{
  const db=fakeDb(),before=structuredClone(db.row.followUp);
  await markPriceExceptionExpired(db,actor('SALES_MANAGER'),2,now);
  assert.equal(db.row.status,'EXPIRED');assert.deepEqual(db.row.followUp,before);assert.deepEqual(db.row.sourceMetadata,{raw:'unchanged'});
  assert.deepEqual(db.events,[{priceExceptionId:2,oldStatus:'ACTIVE',newStatus:'EXPIRED',actorId:7,source:'Manual detail action',createdAt:now}]);
  await assert.rejects(markPriceExceptionExpired(db,actor('ADMIN'),2,now),/no longer eligible/);assert.equal(db.events.length,1);
});
test('ineligible rows and unauthorized roles cannot mutate',async()=>{
  for(const overrides of [{expirationDate:null},{expirationDate:date('2026-10-05')},{expirationDate:date('2026-10-06')},{status:'EXPIRED'}]){const db=fakeDb(overrides);await assert.rejects(markPriceExceptionExpired(db,actor('ADMIN'),2,now),/no longer eligible/);assert.equal(db.events.length,0);}
  for(const role of ['SALES','READ_ONLY','MARKETING_MANAGER']){const db=fakeDb();await assert.rejects(markPriceExceptionExpired(db,actor(role),2,now),/Access denied/);assert.equal(db.row.status,'ACTIVE');}
});
