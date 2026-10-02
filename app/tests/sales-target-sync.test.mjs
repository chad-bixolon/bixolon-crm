import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
const req=Module.createRequire(import.meta.url);
const {Prisma}=req('@prisma/client');
const {previewTargetSync,confirmTargetSync,splitAnnualTarget,targetSyncStatus}=req(path.join(root,'lib/sales-target-sync.ts'));
const dec=s=>new Prisma.Decimal(s);
const actor=(role='ADMIN')=>({id:1,role,active:true,archivedAt:null});
const input={userId:7,year:2027,currencyCode:'USD'};
function fixture({amount='12000000.00',targets=[],planId=5,failQuarter=null}={}) {
  const state={planId,amount,targets:targets.map((value,i)=>({id:i+1,quarter:`Q${i+1}`,targetAmount:dec(value),updatedAt:new Date('2026-10-01T00:00:00Z')})),audits:[],writes:0};
  const tx={
    salesPlan:{findMany:async({where})=>where.ownerId===7&&where.planYear===2027&&where.currencyCode==='USD'&&where.status==='ACTIVE'?[{id:state.planId,revision:state.planId,lines:[{annualPlannedRevenue:state.amount===null?null:dec(state.amount)},{annualPlannedRevenue:null}]}]:[]},
    salesTarget:{findMany:async({where})=>where.userId===7&&where.year===2027&&where.currencyCode==='USD'?state.targets:[],
      update:async({where,data})=>{const row=state.targets.find(r=>r.id===where.id);if(row.quarter===failQuarter)throw new Error('quarter failed');row.targetAmount=data.targetAmount;row.updatedAt=new Date('2026-10-02T00:00:00Z');state.writes++;return row;},
      create:async({data})=>{if(data.quarter===failQuarter)throw new Error('quarter failed');const row={id:state.targets.length+1,...data,updatedAt:new Date('2026-10-02T00:00:00Z')};state.targets.push(row);state.writes++;return row;}},
    user:{findUnique:async()=>({id:7,firstName:'Pat',lastName:'Rep',role:'SALES',active:true,archivedAt:null})},
    salesTargetSync:{create:async({data})=>{state.audits.push(data);}},
  };
  const client={...tx,$transaction:async(fn,options)=>{assert.equal(options.isolationLevel,'Serializable');const before={...state,targets:state.targets.map(row=>({...row})),audits:[...state.audits]};try{return await fn(tx);}catch(e){Object.assign(state,before);throw e;}}};
  return {client,state};
}
async function sync(f,role='ADMIN'){const p=await previewTargetSync(f.client,actor(role),input);await confirmTargetSync(f.client,actor(role),{...input,planId:p.planId,snapshot:p.snapshot});return p;}
test('creates four exact targets and writes a source-linked audit',async()=>{const f=fixture();const p=await sync(f);assert.equal(p.status,'No Target');assert.deepEqual(f.state.targets.map(x=>x.targetAmount.toFixed(2)),Array(4).fill('3000000.00'));assert.equal(f.state.audits[0].planId,5);assert.equal(f.state.audits[0].actorId,1);assert.equal(f.state.audits[0].sourceAnnualAmount.toFixed(2),'12000000.00');assert.deepEqual(f.state.audits[0].priorTargets,[]);assert.equal(f.state.audits[0].resultingTargets.length,4);});
test('updates existing and fills partial targets without archiving',async()=>{for(const targets of [['1','2','3','4'],['1','2']]){const f=fixture({targets});const p=await sync(f);assert.equal(p.status,targets.length===4?'Out of Sync':'Target Incomplete');assert.equal(f.state.targets.length,4);assert.equal(f.state.audits[0].priorTargets.length,targets.length);assert.equal(f.state.targets.reduce((v,r)=>v.add(r.targetAmount),dec(0)).toFixed(2),'12000000.00');}});
test('blocks duplicate quarter, absent revenue, and superseded revision',async()=>{const f=fixture({targets:['1','2','3','4']});f.state.targets.push({...f.state.targets[0],id:9});const p=await previewTargetSync(f.client,actor(),input);assert.equal(p.status,'Conflict');await assert.rejects(confirmTargetSync(f.client,actor(),{...input,planId:p.planId,snapshot:p.snapshot}),/Duplicate active targets/);assert.equal(f.state.writes,0);const no=fixture({amount:null});assert.equal((await previewTargetSync(no.client,actor(),input)).status,'Cannot sync — no planned revenue');await assert.rejects(sync(no),/no Annual Planned Revenue/);const stale=fixture();const before=await previewTargetSync(stale.client,actor(),input);stale.state.planId=6;await assert.rejects(confirmTargetSync(stale.client,actor(),{...input,planId:before.planId,snapshot:before.snapshot}),/changed since preview/);});
test('allocates cents deterministically and derives status from exact quarters',()=>{assert.deepEqual(splitAnnualTarget(dec('100.03')).map(x=>x.toFixed(2)),['25.01','25.01','25.01','25.00']);assert.equal(splitAnnualTarget(dec('100.03')).reduce((v,x)=>v.add(x),dec(0)).toFixed(2),'100.03');assert.equal(targetSyncStatus(dec('4'),['Q1','Q2','Q3','Q4'].map(quarter=>({quarter,targetAmount:dec('1')}))),'In Sync');assert.equal(targetSyncStatus(dec('5'),['Q1','Q2','Q3','Q4'].map(quarter=>({quarter,targetAmount:dec('1')}))),'Out of Sync');});
test('only management roles may preview or confirm',async()=>{const f=fixture();for(const role of ['SALES','READ_ONLY','MARKETING_MANAGER']){await assert.rejects(previewTargetSync(f.client,actor(role),input),/Access denied/);await assert.rejects(confirmTargetSync(f.client,actor(role),{...input,planId:5,snapshot:'a'.repeat(64)}),/Access denied/);}await sync(f,'SALES_MANAGER');assert.equal(f.state.targets.length,4);});
test('snapshot catches target changes and transaction rolls back a failed quarter',async()=>{const f=fixture({targets:['1','2','3','4']});const p=await previewTargetSync(f.client,actor(),input);f.state.targets[0].targetAmount=dec('99');await assert.rejects(confirmTargetSync(f.client,actor(),{...input,planId:p.planId,snapshot:p.snapshot}),/changed since preview/);const failure=fixture({targets:['1','2','3','4'],failQuarter:'Q3'});await assert.rejects(sync(failure),/quarter failed/);assert.deepEqual(failure.state.targets.map(x=>x.targetAmount.toFixed(2)),['1.00','2.00','3.00','4.00']);assert.equal(failure.state.audits.length,0);});
test('queries isolate rep, year and currency and ignore quarterly allocations',async()=>{const f=fixture();const calls=[];const orig=f.client.salesPlan.findMany;f.client.salesPlan.findMany=async x=>{calls.push(x.where);return orig(x);};await previewTargetSync(f.client,actor(),input);assert.deepEqual(calls[0],{ownerId:7,planYear:2027,currencyCode:'USD',status:'ACTIVE'});for(const override of [{userId:8},{year:2028},{currencyCode:'EUR'}])await assert.rejects(previewTargetSync(f.client,actor(),{...input,...override}),/active official Sales Plan/);assert.equal(f.state.targets.length,0);});
test('a newer official revision is out of sync until management confirms again',async()=>{const f=fixture();await sync(f);f.state.planId=6;f.state.amount='13000000.00';const p=await previewTargetSync(f.client,actor(),input);assert.equal(p.status,'Out of Sync');assert.equal(p.currentAnnual.toFixed(2),'12000000.00');assert.equal(p.difference.toFixed(2),'1000000.00');assert.equal(p.proposed.reduce((v,x)=>v.add(x),dec(0)).toFixed(2),'13000000.00');});
