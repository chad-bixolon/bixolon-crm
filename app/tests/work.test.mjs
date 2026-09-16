import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename);
const require=Module.createRequire(fileURLToPath(import.meta.url));
const work=require(path.join(root,'lib/work.ts'));
const analytics=require(path.join(root,'lib/analytics.ts'));
const { submitGate }=require(path.join(root,'lib/submit-gate.ts'));
function form(entries){const f=new FormData();for(const [k,v] of entries)f.append(k,v);return f;}
test('double submission claims the form once until a response releases it',()=>{
 const gate=submitGate();
 assert.equal(gate.claim(),true);
 assert.equal(gate.claim(),false);
 gate.release();
 assert.equal(gate.claim(),true);
});
test('task create key returns one record for a repeated request',async()=>{
 let row=null,creates=0;
 const task={findUnique:async({where})=>row?.createKey===where.createKey?row:null,create:async({data})=>{creates++;row={id:7,...data};return row;}};
 const client={task,$transaction:fn=>fn({task})};
 const value=work.parseTask(form([['subject','Follow up'],['status','OPEN'],['priority','NORMAL']])).value;
 const first=await work.saveTask(client,value,undefined,'d7054358-5d57-4398-8550-506157266184');
 const second=await work.saveTask(client,value,undefined,'d7054358-5d57-4398-8550-506157266184');
 assert.equal(first.id,second.id);assert.equal(creates,1);
});
test('concurrent task create resolves the unique-key race to the first record',async()=>{
 const key='d7054358-5d57-4398-8550-506157266184';
 let reads=0;
 const existing={id:8,createKey:key};
 const client={task:{findUnique:async()=>++reads===1?null:existing},$transaction:async(fn)=>fn({task:{create:async()=>{throw Object.assign(new Error('duplicate'),{code:'P2002'});}}})};
 const value=work.parseTask(form([['subject','Follow up'],['status','OPEN'],['priority','NORMAL']])).value;
 assert.equal((await work.saveTask(client,value,undefined,key)).id,8);
});
test('task lifecycle sets completion once and clears it on reopening',async()=>{
 let row=null; const tx={account:{findFirst:async()=>({id:1})},opportunity:{findFirst:async()=>({id:2})},opportunityAccount:{findUnique:async()=>({accountId:1})},user:{findFirst:async()=>({id:3})},task:{findUnique:async()=>row,create:async({data})=>(row={id:7,...data}),update:async({data})=>(row={...row,...data})}}; const client={$transaction:fn=>fn(tx)};
 const parsed=work.parseTask(form([['subject','Follow up'],['accountId','1'],['opportunityId','2'],['assignedToId','3'],['status','OPEN'],['priority','HIGH'],['dueDate','2026-09-16']]));assert.deepEqual(parsed.errors,{});
 await work.saveTask(client,parsed.value); assert.equal(row.completedAt,null);
 await work.saveTask(client,{...parsed.value,status:'COMPLETED'},7); const completed=row.completedAt; assert.ok(completed instanceof Date);
 await work.saveTask(client,{...parsed.value,status:'COMPLETED'},7);assert.equal(row.completedAt,completed);
 await work.saveTask(client,parsed.value,7);assert.equal(row.completedAt,null);
 assert.equal(work.taskTiming({...row,dueDate:new Date('2026-09-15T12:00:00Z')},new Date('2026-09-16T12:00:00Z')),'Overdue');
 assert.equal(work.taskTiming(row,new Date('2026-09-16T12:00:00Z')),'Due today');
});
test('activity and note require linked membership and valid references',async()=>{
 const activity=work.parseActivity(form([['subject','Demo'],['type','DEMO'],['accountId','1'],['opportunityId','2'],['activityDate','2026-09-16']]));assert.deepEqual(activity.errors,{});
 const note=work.parseNote(form([['body','Follow up'],['accountId','1'],['opportunityId','2']]));assert.deepEqual(note.errors,{});
 const tx={account:{findFirst:async()=>({id:1})},opportunity:{findFirst:async()=>({id:2})},opportunityAccount:{findUnique:async()=>null},activityType:{findFirst:async()=>({code:'DEMO'})},activity:{create:async({data})=>data},note:{create:async({data})=>data}};
 await assert.rejects(work.saveActivity({$transaction:fn=>fn(tx)},activity.value),/participant/);
 await assert.rejects(work.saveNote({$transaction:fn=>fn(tx)},note.value),/participant/);
 tx.opportunityAccount.findUnique=async()=>({accountId:1});
 assert.equal((await work.saveActivity({$transaction:fn=>fn(tx)},activity.value)).type,'DEMO');
 assert.equal((await work.saveNote({$transaction:fn=>fn(tx)},note.value)).body,'Follow up');
});
test('pipeline totals use only active product lines and stage or override probability',()=>{
 const rows=[{id:1,currencyCode:'USD',probability:null,expectedCloseDate:new Date('2026-09-15'),forecastCategory:'PIPELINE',stage:{id:1,name:'Qualified',probability:25},products:[{quantity:2,estimatedUnitPrice:'10.00',archivedAt:null},{quantity:1,estimatedUnitPrice:'999.00',archivedAt:new Date()}]},{id:2,currencyCode:'USD',probability:50,expectedCloseDate:new Date('2026-09-30'),forecastCategory:'COMMIT',stage:{id:1,name:'Qualified',probability:25},products:[{quantity:1,estimatedUnitPrice:'30.00',archivedAt:null}]}];
 const [group]=analytics.summarizePipeline(rows,r=>r.stage.name);assert.equal(group.count,2);assert.equal(group.estimated.toFixed(2),'50.00');assert.equal(group.weighted.toFixed(2),'20.00');assert.equal(analytics.closeMonth(rows[0]),'2026-09');
});
test('dashboard due bounds partition overdue and due today without double counting',()=>{
 const {start,end}=work.dayBounds(new Date('2026-09-16T20:00:00Z'));assert.equal(start.toISOString(),'2026-09-16T00:00:00.000Z');assert.equal(end.toISOString(),'2026-09-17T00:00:00.000Z');
 assert.equal(work.dayBounds(new Date('2026-09-17T02:00:00Z')).start.toISOString(),'2026-09-16T00:00:00.000Z'); const dates=[new Date('2026-09-15T23:59:59Z'),new Date('2026-09-16T00:00:00Z'),new Date('2026-09-17T00:00:00Z')];assert.equal(dates.filter(d=>d<start).length,1);assert.equal(dates.filter(d=>d>=start&&d<end).length,1);
});
test('note edit preserves original author and archive history fields',async()=>{
 let row={id:9,body:'Original',accountId:1,opportunityId:null,createdById:4,createdAt:new Date('2026-09-01'),archivedAt:null};
 const tx={account:{findFirst:async()=>({id:1})},note:{findFirst:async()=>row.archivedAt?null:row,update:async({data})=>(row={...row,...data})}};
 const value={body:'Revised',accountId:1,opportunityId:null,createdById:99};
 await work.saveNote({$transaction:fn=>fn(tx)},value,9);
 assert.equal(row.body,'Revised');assert.equal(row.createdById,4);assert.equal(row.createdAt.toISOString().slice(0,10),'2026-09-01');
 row.archivedAt=new Date();await assert.rejects(work.saveNote({$transaction:fn=>fn(tx)},value,9),/archived/);
});
test('task filters include status, priority, relationships, and inclusive due-through date',()=>{
 const where=work.taskWhere({q:'follow',status:'OPEN',priority:'URGENT',assignedToId:'3',accountId:'1',opportunityId:'2',dueFrom:'2026-09-01',dueTo:'2026-09-30'});
 assert.equal(where.status,'OPEN');assert.equal(where.priority,'URGENT');assert.equal(where.assignedToId,3);assert.equal(where.accountId,1);assert.equal(where.opportunityId,2);
 assert.equal(where.dueDate.gte.toISOString(),'2026-09-01T00:00:00.000Z');assert.equal(where.dueDate.lt.toISOString(),'2026-10-01T00:00:00.000Z');
 assert.equal(where.OR.length,2);
});
test('task visibility separates active, archived, and all while dashboard stays active',()=>{
 assert.deepEqual(work.taskWhere({}).archivedAt,null);
 assert.deepEqual(work.taskWhere({visibility:'archived'}).archivedAt,{not:null});
 assert.equal('archivedAt' in work.taskWhere({visibility:'all'}),false);
 assert.deepEqual(work.taskWhere({visibility:'unexpected'}).archivedAt,null);
 assert.deepEqual(work.dashboardOpenTaskWhere(),{archivedAt:null,status:{in:['OPEN','IN_PROGRESS']}});
});

test('dashboard pipeline aggregate keeps currencies separate and counts actual opportunities',()=>{
 const row=(id,currencyCode,price)=>({id,currencyCode,probability:50,expectedCloseDate:null,forecastCategory:null,stage:{id:1,name:'Open',probability:10},products:[{quantity:1,estimatedUnitPrice:price,archivedAt:null}]});
 const totals=analytics.pipelineTotalsByCurrency([row(1,'USD','10.00'),row(2,'USD','20.00'),row(3,'EUR','5.00')]);
 assert.deepEqual(totals.map(x=>[x.currency,x.count,x.estimated.toFixed(2),x.weighted.toFixed(2)]),[['EUR',1,'5.00','2.50'],['USD',2,'30.00','15.00']]);
});
