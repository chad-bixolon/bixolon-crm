import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
Module._extensions['.tsx']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
const resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...args){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...args);};
const require=Module.createRequire(fileURLToPath(import.meta.url));
const { caseWorkContext, assertWorkPermission, canCreateCaseWork }=require(path.join(root,'lib/support-work.ts'));
const { accountSupportSummary, contactSupportSummary }=require(path.join(root,'lib/related-support-cases.ts'));
const { caseTimeline }=require(path.join(root,'lib/support-case-timeline.ts'));
const work=require(path.join(root,'lib/work.ts'));
const { routeAccess }=require(path.join(root,'lib/authorization.ts'));
const actor=role=>({id:7,role,active:true,archivedAt:null});
const form=entries=>{const f=new FormData();for(const [key,value] of entries)f.append(key,value);return f;};

test('case link validation checks visibility, account, contact, archive, closure, and permissions',async()=>{
  const row={id:12,caseNumber:'BXS-2026-000012',subject:'Printer',accountId:3,contactId:5,status:'OPEN',archivedAt:null,account:{name:'Acme'},contact:{firstName:'Jane',lastName:'Smith'}};
  const db={supportCase:{findFirst:async({where})=>where.id===12&&(!('archivedAt' in where)||!row.archivedAt)?row:null},contact:{findMany:async()=>[{id:5,accountId:3}]}};
  assert.equal((await caseWorkContext(db,actor('SUPPORT'),12,3,[5])).caseNumber,row.caseNumber);
  await assert.rejects(caseWorkContext(db,actor('SUPPORT'),99,3),/unavailable/);
  await assert.rejects(caseWorkContext(db,actor('SUPPORT'),12,4),/does not match/);
  await assert.rejects(caseWorkContext(db,actor('SUPPORT'),12,3,[6]),/Contact/);
  row.status='CLOSED';await assert.rejects(caseWorkContext(db,actor('SUPPORT'),12,3),/Reopen/);
  row.status='RESOLVED';assert.ok(await caseWorkContext(db,actor('SUPPORT'),12,3));
  row.archivedAt=new Date();await assert.rejects(caseWorkContext(db,actor('SUPPORT'),12,3),/unavailable|restore/);
  assert.equal(canCreateCaseWork(actor('SUPPORT')),true);
  assert.equal(canCreateCaseWork(actor('READ_ONLY')),false);
  assert.throws(()=>assertWorkPermission(actor('SUPPORT'),null),/Access denied/);
  assert.throws(()=>assertWorkPermission(actor('READ_ONLY'),12),/Access denied/);
  assert.doesNotThrow(()=>assertWorkPermission(actor('SUPPORT'),12));
  assert.equal(routeAccess('/activities/new',actor('SUPPORT')),'allowed');
  assert.equal(routeAccess('/tasks/42',actor('SUPPORT')),'allowed');
  assert.equal(routeAccess('/tasks',actor('SUPPORT')),'denied');
  assert.equal(routeAccess('/notes/new',actor('READ_ONLY')),'denied');
});

test('existing work save paths retain optional case foreign keys and Note author provenance',async()=>{
  const made={};
  const tx={account:{findFirst:async()=>({id:3})},supportCase:{findUnique:async()=>({accountId:3,archivedAt:null,status:'OPEN'})},activityType:{findFirst:async()=>({code:'CALL'})},task:{create:async({data})=>(made.task=data,{id:1,...data})},activity:{create:async({data})=>(made.activity=data,{id:2,...data})},note:{create:async({data})=>(made.note=data,{id:3,...data})}};
  const db={$transaction:async fn=>fn(tx)};
  const task=work.parseTask(form([['subject','Follow up'],['accountId','3'],['supportCaseId','12'],['contactId','5'],['status','OPEN'],['priority','NORMAL']])).value;
  const activity=work.parseActivity(form([['subject','Call Jane'],['accountId','3'],['supportCaseId','12'],['type','CALL'],['activityDate','2026-10-08']])).value;
  const note=work.parseNote(form([['body','Reviewing logs'],['accountId','3'],['supportCaseId','12'],['createdById','99']])).value;
  await work.saveTask(db,task,undefined,undefined,7);
  await work.saveActivity(db,activity,undefined,7);
  await work.saveNote(db,note,undefined,7);
  assert.equal(made.task.supportCaseId,12);assert.equal(made.task.contactId,5);
  assert.equal(made.activity.supportCaseId,12);assert.equal(made.note.supportCaseId,12);
  assert.equal(made.note.createdById,7);
  assert.equal(work.parseTask(form([['subject','Normal'],['status','OPEN'],['priority','NORMAL']])).value.supportCaseId,null);
  assert.equal(work.parseNote(form([['body','Normal'],['accountId','3']])).value.supportCaseId,null);
  assert.equal(work.parseActivity(form([['subject','Normal'],['accountId','3'],['type','CALL'],['activityDate','2026-10-08']])).value.supportCaseId,null);
  assert.equal(work.parseNote(form([['body','Bad'],['accountId','3'],['supportCaseId','abc']])).errors.supportCaseId,'Choose a valid record.');
});

test('Account and Contact case queries are scoped and bounded',async()=>{
  const calls=[];
  const db={supportCase:{findMany:async args=>(calls.push(args),[]),count:async args=>(calls.push(args),2)}};
  assert.equal((await accountSupportSummary(db,actor('SALES'),3)).openCount,2);
  assert.ok(calls.every(call=>call.where.accountId===3&&call.where.archivedAt===null));
  assert.ok(calls.filter(call=>call.take).every(call=>call.take===10));
  calls.length=0;
  assert.equal((await contactSupportSummary(db,actor('SUPPORT'),5)).openCount,2);
  assert.ok(calls.every(call=>call.where.contactId===5&&call.where.archivedAt===null));
});

test('timeline merges business labeled sources in time order and caps source queries',async()=>{
  const at=day=>new Date(`2026-10-${day}T12:00:00Z`), calls=[];
  const db={supportCaseLifecycleEvent:{findMany:async args=>(calls.push(args),[{id:1,supportCaseId:12,field:'CREATED',oldValue:null,newValue:null,oldLabel:null,newLabel:null,actorId:7,source:'CRM',createdAt:at('01'),actor:{firstName:'Sam',lastName:'Rep'}}])},activity:{findMany:async args=>(calls.push(args),[{id:2,activityDate:at('02'),subject:'Phone call',description:null,activityType:{name:'Call'},user:{firstName:'Sam',lastName:'Rep'},contacts:[]}])},task:{findMany:async args=>(calls.push(args),[{id:3,createdAt:at('03'),subject:'Send firmware',status:'COMPLETED',dueDate:at('04'),completedAt:at('04'),assignedTo:{firstName:'Sam',lastName:'Rep'}}])},note:{findMany:async args=>(calls.push(args),[{id:4,createdAt:at('05'),body:'Engineering reviewing logs',createdBy:{firstName:'Sam',lastName:'Rep'}}])}};
  const items=await caseTimeline(db,12,at('01'),'UTC');
  assert.deepEqual(items.map(item=>item.source),['Note','Task','Activity','Case History']);
  assert.match(items[1].detail,/COMPLETED.*Due.*Assigned to/);
  assert.match(items[2].title,/Call: Phone call/);
  assert.equal(items[3].title,'Case created');
  assert.ok(calls.every(call=>call.take===40&&call.where.supportCaseId===12));
  assert.ok(calls.slice(1).every(call=>call.where.archivedAt===null));
  assert.doesNotMatch(JSON.stringify(items),/supportCaseId|contactId/);
});

test('case quick actions open existing create flows with case, Account, and Contact prefilled',async()=>{
  const row={id:12,caseNumber:'BXS-2026-000012',accountId:3,contactId:5,contact:{firstName:'Jane',lastName:'Smith'}};
  const WorkForm=()=>null, shell=()=>null;
  const original=Module._load;
  Module._load=function(name,parent,isMain){
    if(name==='@/components/work-form')return {WorkForm};
    if(name==='@/components/shell')return {Content:shell,PageHeader:shell};
    if(name==='@/lib/current-user')return {currentUser:async()=>actor('SUPPORT')};
    if(name==='@/lib/support-work')return {caseWorkContext:async()=>row};
    if(name==='@/lib/work-options')return {workOptions:async()=>({accounts:[],opportunities:[],projects:[],users:[{id:7,name:'Sam Rep'}],contacts:[],activityTypes:[]})};
    if(name==='@/lib/prisma')return {prisma:{}};
    if(name==='next/navigation')return {notFound:()=>{throw new Error('Not found');}};
    return original.call(this,name,parent,isMain);
  };
  try {
    for(const [kind,file] of [['activity','activities'],['task','tasks'],['note','notes']]){
      const page=require(path.join(root,`app/${file}/new/page.tsx`)).default;
      const tree=await page({searchParams:Promise.resolve({supportCaseId:'12'})});
      const child=tree.props.children.find(item=>item?.type===WorkForm);
      assert.equal(child.props.kind,kind);
      assert.equal(child.props.supportCase.caseNumber,row.caseNumber);
      assert.equal(child.props.lockAccountId,3);
      assert.equal(child.props.initial.accountId,3);
      if(kind==='activity')assert.deepEqual(child.props.linkedContactIds,[5]);
      if(kind==='task')assert.equal(child.props.initial.contactId,5);
      if(kind==='note')assert.equal(child.props.supportCase.contactName,'Jane Smith');
    }
  } finally {Module._load=original;}
});
