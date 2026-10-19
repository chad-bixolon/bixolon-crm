import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=Module.createRequire(import.meta.url);
for(const ext of ['.ts','.tsx']) Module._extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText,file);
const resolve=Module._resolveFilename;
Module._resolveFilename=function(name,parent,...args){return resolve.call(this,name.startsWith('@/')?path.join(root,name.slice(2)):name,parent,...args);};
const baseLoad=Module._load;
Module._load=function(name,parent,isMain){
  if(name==='./work-notification-evaluator'||name==='@/lib/work-notification-evaluator') return {notifyTaskAssignment:async()=>{},syncTaskNotifications:async()=>{}};
  return baseLoad.call(this,name,parent,isMain);
};
const work=require(path.join(root,'lib/work.ts'));
const policy=require(path.join(root,'lib/support-work.ts'));
const {routeAccess,can}=require(path.join(root,'lib/authorization.ts'));
const {resolveUserContext}=require(path.join(root,'lib/dev-impersonation.ts'));
const actor=role=>({id:7,role,active:true,archivedAt:null});
const form=values=>{const f=new FormData();f.set('editToken',activeFixture?.row.updatedAt?.toISOString()??'2026-10-19T12:00:00.000Z');for(const [k,v] of Object.entries(values))f.set(k,v==null?'':String(v));return f;};
function fixture(overrides={}) {
  let row={updatedAt:new Date('2026-10-19T12:00:00.000Z'),id:12,supportCaseId:3,accountId:null,opportunityId:null,projectId:null,tradeShowLeadId:null,contactId:null,assignedToId:7,createdById:8,archivedAt:null,subject:'Check logs',description:'Review diagnostics',priority:'NORMAL',status:'OPEN',dueDate:null,completedAt:null,...overrides};
  let user=actor('SUPPORT');
  const caseRow={id:3,accountId:null,archivedAt:null,status:'OPEN'};
  const events=[],locks=[];
  const tx={
    $queryRaw:async(strings,...values)=>{locks.push([strings.join('?'),values]);return [];},
    user:{findUnique:async()=>user},
    task:{findUnique:async()=>row,update:async({data})=>(row={...row,...data})},
    supportCase:{findFirst:async({where})=>caseRow && where.id===caseRow.id&&(!('archivedAt' in where)||!caseRow.archivedAt)?caseRow:null,findUnique:async()=>caseRow},
    supportCaseLifecycleEvent:{create:async({data})=>(events.push(data),data)},
    account:{findFirst:async()=>({id:5})},
    note:{create:async({data})=>({id:1,...data}),findFirst:async()=>row,update:async({data})=>(row={...row,...data})},
  };
  return {db:{$transaction:async fn=>fn(tx),...tx},tx,get row(){return row;},set row(value){row=value;},caseRow,events,locks,set user(value){user=value;}};
}
const input=f=>Object.fromEntries(['subject','description','priority','status','dueDate','supportCaseId','accountId','opportunityId','projectId','contactId','assignedToId'].map(k=>[k,f.row[k]]));

test('Note parser/service accept Case-only, Account, Opportunity and Project context, reject orphans and mismatches',async()=>{
  const f=fixture();
  for(const values of [{supportCaseId:3},{accountId:5},{projectId:2},{opportunityId:4}]) {
    const parsed=work.parseNote(form({body:'Troubleshooting',...values}));
    assert.deepEqual(parsed.errors,{});
    f.tx.project={findFirst:async()=>({id:2})};f.tx.opportunity={findFirst:async()=>({id:4})};
    const saved=await work.saveNote(f.db,parsed.value,undefined,7);
    assert.equal(saved.body,'Troubleshooting');
    assert.equal(saved.accountId,values.accountId??null);
  }
  assert.ok(work.parseNote(form({body:'Orphan'})).errors.accountId);
  await assert.rejects(work.saveNote(f.db,{body:'Orphan',accountId:null,opportunityId:null,projectId:null,supportCaseId:null,createdById:null},undefined,7),/Choose an Account/);
  const value=work.parseNote(form({body:'Linked case',supportCaseId:3,accountId:5})).value;
  await assert.rejects(work.saveNote(f.db,value,undefined,7),/does not match/);
  f.caseRow.accountId=5;
  assert.equal((await work.saveNote(f.db,value,undefined,7)).accountId,5);
  f.row={...work.parseNote(form({body:'Earlier',supportCaseId:3})).value,id:12,archivedAt:null};
  assert.equal((await work.saveNote(f.db,{...f.row,body:'Still readable and editable'},12,7)).accountId,null);
});

test('eligible Support Task can edit, complete, reopen and preserve one event per real save',async()=>{
  const f=fixture();
  let value={...input(f),subject:'Read printer logs',description:'New details',dueDate:new Date('2026-11-01T12:00:00Z')};
  await policy.saveSupportCaseTask(f.db,actor('SUPPORT'),value,12);
  assert.equal(f.row.subject,value.subject);assert.equal(f.row.updatedById,7);
  assert.equal(f.events[0].field,'TASK_UPDATED');assert.equal(f.events[0].source,'TASK:12');
  assert.equal(JSON.parse(f.events[0].oldValue).subject,'Check logs');
  assert.equal(JSON.parse(f.events[0].newValue).description,'New details');
  value={...value,status:'COMPLETED'};
  await policy.saveSupportCaseTask(f.db,actor('SUPPORT'),value,12);
  const completedAt=f.row.completedAt;
  assert.ok(completedAt instanceof Date);assert.equal(f.events[1].field,'TASK_COMPLETED');
  assert.equal(f.events[1].createdAt,completedAt);
  await policy.saveSupportCaseTask(f.db,actor('SUPPORT'),value,12);
  assert.equal(f.events.length,2);assert.equal(f.row.completedAt,completedAt);
  await policy.saveSupportCaseTask(f.db,actor('SUPPORT'),{...value,status:'OPEN'},12);
  assert.equal(f.row.completedAt,null);assert.equal(f.events[2].field,'TASK_REOPENED');
  assert.ok(f.locks.some(([sql])=>sql.includes('"Task"')&&sql.includes('FOR UPDATE')));
  assert.ok(f.locks.some(([sql])=>sql.includes('"SupportCase"')&&sql.includes('FOR SHARE')));
  assert.ok(f.locks.some(([sql])=>sql.includes('"User"')&&sql.includes('FOR SHARE')));
});

test('eligibility is based on persisted Case, assignment, active actor and accessible open Case',async()=>{
  for(const override of [{supportCaseId:null},{archivedAt:new Date()},{assignedToId:8},{opportunityId:9},{projectId:9},{tradeShowLeadId:9}]) {
    const f=fixture(override);
    await assert.rejects(policy.saveSupportCaseTask(f.db,actor('SUPPORT'),{...input(f),supportCaseId:3,status:'COMPLETED'},12),/unavailable/);
    assert.equal(f.events.length,0);
  }
  const f=fixture({assignedToId:null,createdById:7});
  await policy.saveSupportCaseTask(f.db,actor('SUPPORT'),{...input(f),status:'COMPLETED'},12);
  for(const patch of [{status:'CLOSED'},{status:'OPEN',archivedAt:new Date()},{id:99,archivedAt:null}]) {
    Object.assign(f.caseRow,patch);
    await assert.rejects(policy.saveSupportCaseTask(f.db,actor('SUPPORT'),input(f),12),/Reopen|unavailable/);
  }
  Object.assign(f.caseRow,{id:3,status:'OPEN',archivedAt:null});
  for(const user of [{...actor('SUPPORT'),active:false},{...actor('SUPPORT'),archivedAt:new Date()},actor('SALES')]) {
    f.user=user;
    await assert.rejects(policy.saveSupportCaseTask(f.db,actor('SUPPORT'),input(f),12),/Access denied/);
  }
  f.user=actor('SUPPORT');f.row=null;
  await assert.rejects(policy.saveSupportCaseTask(f.db,actor('SUPPORT'),{},12),/unavailable/);
});

test('Support cannot change assignment, priority or any parent through a forged submit',async()=>{
  for(const key of ['supportCaseId','accountId','opportunityId','projectId','contactId','assignedToId','priority']) {
    const f=fixture();
    await assert.rejects(policy.saveSupportCaseTask(f.db,actor('SUPPORT'),{...input(f),[key]:key==='priority'?'HIGH':99},12),/cannot change/);
    assert.equal(f.events.length,0);assert.equal(f.row.status,'OPEN');
  }
});

test('Task read and route policy keep unrelated Tasks, general lists, bulk and inactive users protected',async()=>{
  const f=fixture();
  await policy.assertTaskRead(f.db,actor('SUPPORT'),f.row);
  await assert.rejects(policy.assertTaskRead(f.db,actor('SUPPORT'),{...f.row,supportCaseId:null}),/unavailable/);
  f.caseRow.id=99;
  await assert.rejects(policy.assertTaskRead(f.db,actor('SUPPORT'),f.row),/unavailable/);
  await policy.assertTaskRead(f.db,actor('ADMIN'),{...f.row,supportCaseId:null});
  assert.equal(routeAccess('/tasks/12/edit',actor('SUPPORT')),'allowed');
  for(const url of ['/tasks','/tasks/bulk','/notes/12/edit']) assert.equal(routeAccess(url,actor('SUPPORT')),'denied');
  assert.equal(routeAccess('/tasks/12/edit',{...actor('SUPPORT'),active:false}),'denied');
  assert.equal(can(actor('SUPPORT'),'tasks.write'),false);
});

let activeFixture, effectiveActor;
const mockLoad=Module._load;
Module._load=function(name,parent,isMain){
  if(name==='next/navigation')return {redirect:destination=>{throw Object.assign(new Error('redirect'),{destination});},notFound:()=>{throw new Error('not found');}};
  if(name==='next/cache')return {revalidatePath:()=>{}};
  if(name==='@/lib/prisma')return {prisma:new Proxy({}, {get:(_,key)=>activeFixture.db[key]})};
  if(name==='@/lib/current-user')return {currentUser:async()=>effectiveActor};
  if(name==='@/components/recent-view')return {RecentView:()=>null};
  if(name==='next/link')return {__esModule:true,default:({href,children,...props})=>React.createElement('a',{href,...props},children)};
  if(name==='@/components/shell')return {Content:({children})=>React.createElement('main',null,children),PageHeader:({title,action})=>React.createElement('header',null,title,action)};
  if(name==='@/components/work-form')return {WorkForm:props=>React.createElement('form',{'data-scoped':props.caseTaskOnly}),ReactivateTask:()=>null};
  if(name==='@/lib/work-options')return {workOptions:async()=>({accounts:[],users:[],opportunities:[],projects:[]})};
  return mockLoad.call(this,name,parent,isMain);
};
const actions=require(path.join(root,'app/tasks/actions.ts'));
const detail=require(path.join(root,'app/tasks/[id]/page.tsx')).default;
const edit=require(path.join(root,'app/tasks/[id]/edit/page.tsx')).default;
const params={params:Promise.resolve({id:'12'}),searchParams:Promise.resolve({})};

test('direct pages and real submit action enforce Case eligibility, while Admin retains normal edit rights',async()=>{
  activeFixture=fixture();effectiveActor=actor('SUPPORT');
  activeFixture.row={...activeFixture.row,supportCase:activeFixture.caseRow};
  assert.match(renderToStaticMarkup(await detail(params)),/Edit \/ complete task/);
  assert.match(renderToStaticMarkup(await edit(params)),/data-scoped="true"/);
  await assert.rejects(actions.submitTask(12,{errors:{}},form({...input(activeFixture),status:'COMPLETED'})),e=>e.destination==='/tasks/12/edit?saved=updated');
  await assert.rejects(actions.archiveTask(12,{errors:{}}),/Access denied/);
  await assert.rejects(actions.reactivateTask(12,{errors:{}}),/Access denied/);
  activeFixture.row={...activeFixture.row,supportCaseId:null,supportCase:null};
  await assert.rejects(detail(params),/not found/);await assert.rejects(edit(params),/not found/);
  const denied=await actions.submitTask(12,{errors:{}},form({...input(activeFixture),supportCaseId:3,status:'OPEN'}));
  assert.match(denied.message,/unavailable/);
  effectiveActor=actor('ADMIN');
  assert.match(renderToStaticMarkup(await detail(params)),/Edit task/);
  await edit(params);
  await assert.rejects(actions.submitTask(12,{errors:{}},form({...input(activeFixture),subject:'Admin edit'})),e=>e.destination==='/tasks/12/edit?saved=updated');
  assert.equal(activeFixture.row.subject,'Admin edit');
});

test('impersonated Admin uses effective Support permissions for pages, mutations and attribution',async()=>{
  activeFixture=fixture();
  const context=await resolveUserContext({...actor('ADMIN'),id:99,name:'Admin',email:'admin@example.test'},'7',{user:{findUnique:async()=>({...actor('SUPPORT'),firstName:'Sam',lastName:'Support',email:'support@example.test'})}},{NODE_ENV:'development',ENABLE_DEV_IMPERSONATION:'true'});
  effectiveActor=context.effective;assert.equal(context.impersonating,true);assert.equal(context.real.id,99);assert.equal(effectiveActor.id,7);
  await assert.rejects(actions.submitTask(12,{errors:{}},form({...input(activeFixture),status:'COMPLETED'})),e=>e.destination?.includes('saved=updated'));
  assert.equal(activeFixture.events[0].actorId,7);
  activeFixture.row={...activeFixture.row,supportCaseId:null};
  await assert.rejects(edit(params),/not found/);
  assert.match((await actions.submitTask(12,{errors:{}},form({...input(activeFixture),supportCaseId:3}))).message,/unavailable/);
});

test('Support Case Task protects entered work and records no lifecycle event after another editor saves',async()=>{
  const f=fixture(); const token=f.row.updatedAt.toISOString(); const entered={...input(f),subject:'My entered subject'};
  await policy.saveSupportCaseTask(f.db,actor('SUPPORT'),{...input(f),status:'IN_PROGRESS',dueDate:new Date('2026-12-01T12:00:00Z')},12,token);
  const count=f.events.length;
  for(let n=0;n<2;n++) await assert.rejects(policy.saveSupportCaseTask(f.db,actor('SUPPORT'),entered,12,token),/This record changed after you opened it/);
  assert.equal(f.row.status,'IN_PROGRESS');assert.equal(f.row.dueDate.toISOString().slice(0,10),'2026-12-01');assert.equal(f.events.length,count);assert.equal(entered.subject,'My entered subject');
});
