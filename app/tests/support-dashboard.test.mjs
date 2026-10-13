import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const require=Module.createRequire(fileURLToPath(import.meta.url));
const {supportDashboard}=require(path.join(root,'lib/support-dashboard.ts'));
const actor={id:7,role:'SUPPORT',active:true};

test('Support additions use bounded queries, case visibility, personal task scope, and dates',async()=>{
  const seen={cases:[],tasks:[],activity:[],counts:[]};
  const db={supportCase:{groupBy:async()=>[],count:async args=>{seen.counts.push(args);return 0},findMany:async args=>{seen.cases.push(args);return []}},task:{findMany:async args=>{seen.tasks.push(args);return []}},activity:{findMany:async args=>{seen.activity.push(args);return []}}};
  const now=new Date('2026-10-13T15:00:00Z');
  const result=await supportDashboard(db,actor,now,{intake:true,tasks:true,activity:true});
  assert.equal(result.mine.total,0);assert.equal(result.intakeCount,0);
  assert.deepEqual(result.tasks,[]);assert.deepEqual(result.activity,[]);
  assert.equal(seen.tasks[0].where.assignedToId,7);
  assert.equal(seen.tasks[0].where.supportCase.is.archivedAt,null);
  assert.equal(seen.tasks[0].where.dueDate.lt.toISOString(),'2026-10-21T00:00:00.000Z');
  assert.deepEqual(seen.tasks[0].where.status.in,['OPEN','IN_PROGRESS']);
  assert.equal(seen.tasks[0].where.AND[0].archivedAt,null);
  assert.equal(seen.activity[0].where.supportCase.is.archivedAt,null);
  assert.equal(seen.activity[0].where.activityDate.gte.toISOString(),'2026-10-06T15:00:00.000Z');
  assert.equal(seen.cases.length,4);assert.ok(seen.cases.every(args=>args.take===5));
  assert.equal(seen.tasks[0].take,6);assert.equal(seen.activity[0].take,5);
  assert.deepEqual(seen.cases[3].where.OR,[{status:'NEW'},{assignedToId:null}]);
  assert.deepEqual(seen.cases[3].where.status.in,['NEW','OPEN','WAITING_ON_CUSTOMER','WAITING_ON_INTERNAL']);
});

test('hidden Support additions run no work queries and reject unauthorized actors before querying',async()=>{
  const db={supportCase:{groupBy:async()=>[],count:async()=>0,findMany:async()=>[]}};
  const result=await supportDashboard(db,actor);
  assert.deepEqual(result.tasks,[]);assert.deepEqual(result.intakeCases,[]);
  await assert.rejects(supportDashboard(db,{...actor,active:false}),/Access denied/);
  await assert.rejects(supportDashboard(db,{id:7,role:'SALES',active:false}),/Access denied/);
});
