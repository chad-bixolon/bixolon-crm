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
const { caseHistoryView, classifySupportLifecycle }=require(path.join(root,'lib/support-case-timeline.ts'));
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
  const db={supportCaseLifecycleEvent:{findMany:async args=>(calls.push(args),[{id:1,supportCaseId:12,field:'CREATED',oldValue:null,newValue:null,oldLabel:null,newLabel:null,actorId:7,source:'CRM',createdAt:at('01'),actor:{firstName:'Sam',lastName:'Rep'}}])},activity:{findMany:async args=>(calls.push(args),[{id:2,activityDate:at('02'),subject:'Phone call',description:null,activityType:{name:'Call'},user:{firstName:'Sam',lastName:'Rep'},contacts:[]}])},task:{findMany:async args=>(calls.push(args),[{id:3,createdAt:at('03'),subject:'Send firmware',status:'COMPLETED',dueDate:at('04'),completedAt:at('04'),assignedTo:{firstName:'Sam',lastName:'Rep'}}])},note:{findMany:async args=>(calls.push(args),[{id:4,createdAt:at('05'),body:'Engineering reviewing logs',createdBy:{firstName:'Sam',lastName:'Rep'}}])},supportCaseAttachment:{findMany:async args=>(calls.push(args),[])}};
  const view=await caseHistoryView(db,12,at('01'),'UTC');
  const items=view.timeline;
  assert.deepEqual(items.map(item=>item.source),['Note','Task','Task','Activity','Case']);
  assert.equal(items[1].title,'Task completed');
  assert.match(items[2].detail,/Due.*Assigned to/);
  assert.equal(items[3].title,'Call logged');
  assert.equal(items[4].title,'Case created');
  assert.deepEqual(calls.map(call=>call.take),[81,40,40,40,40]);
  assert.ok(calls.every(call=>call.where.supportCaseId===12));
  assert.ok(calls.slice(1,4).every(call=>call.where.archivedAt===null));
  assert.doesNotMatch(JSON.stringify(items),/supportCaseId|contactId/);
});

test('lifecycle classification keeps one creation narrative and semantic operational changes',()=>{
  const createdAt=new Date('2026-10-08T13:46:00Z'), later=new Date('2026-10-08T14:00:00Z');
  const base={supportCaseId:12,oldValue:null,newValue:null,oldLabel:null,newLabel:null,actorId:7,source:'CRM',createdAt,actor:{firstName:'Sam',lastName:'Rep'}};
  const event=(id,field,oldValue,newValue,changes={})=>({...base,id,field,oldValue,newValue,...changes});
  const events=[
    event(1,'CREATED',null,null),
    event(2,'accountId',null,'42',{newLabel:'Acme'}),
    event(3,'subject',null,'Printer issue'),
    event(4,'description',null,'Customer called'),
    event(5,'status',null,'NEW'),
    event(6,'priority',null,'NORMAL'),
    event(7,'productSkuId',null,'102',{newLabel:'XD5-40'}),
    event(8,'status','NEW','OPEN',{createdAt:later}),
    event(9,'assignedToId',null,'23',{newLabel:'Nick Smith',createdAt:new Date('2026-10-08T14:01:00Z')}),
    event(10,'priority','NORMAL','CRITICAL',{createdAt:new Date('2026-10-08T14:02:00Z')}),
    event(11,'nextFollowUpAt',null,'2026-10-09T12:00:00Z',{createdAt:new Date('2026-10-08T14:03:00Z')}),
    event(12,'subject','Printer issue','Printer fixed',{createdAt:new Date('2026-10-08T14:04:00Z')}),
    event(13,'status','OPEN','RESOLVED',{createdAt:new Date('2026-10-08T14:05:00Z')}),
    event(14,'resolvedAt',null,'2026-10-08T14:05:00Z',{createdAt:new Date('2026-10-08T14:05:00Z')}),
    event(15,'resolutionSummary',null,'Replaced cable',{createdAt:new Date('2026-10-08T14:05:00Z')}),
    event(16,'status','RESOLVED','CLOSED',{createdAt:new Date('2026-10-08T14:06:00Z')}),
    event(17,'closedAt',null,'2026-10-08T14:06:00Z',{createdAt:new Date('2026-10-08T14:06:00Z')}),
    event(18,'status','CLOSED','OPEN',{createdAt:new Date('2026-10-08T14:07:00Z')}),
    event(19,'status','OPEN','RESOLVED',{createdAt:new Date('2026-10-08T14:08:00Z')}),
  ];
  const items=classifySupportLifecycle(events,createdAt,'UTC');
  assert.deepEqual(items.map(item=>item.title),['Case created','Status changed','Assigned to Nick Smith','Priority changed','Case resolved','Case closed','Case reopened','Case resolved']);
  assert.equal(items[0].summary.find(field=>field.label==='Linked CRM Account').value,'Acme');
  assert.equal(items[0].summary.find(field=>field.label==='Product / SKU').value,'XD5-40');
  assert.match(items[4].detail,/Resolution: Replaced cable/);
  assert.equal(items[6].detail,'Closed → Open');
  assert.match(items[7].detail,/Resolution: Replaced cable/);
  assert.doesNotMatch(JSON.stringify(items),/accountId|productSkuId|closedAt|resolvedAt|Account #42|Product #102|Next Follow-up/);
  assert.equal(events.length,19);
  const directClosed=[event(30,'CREATED',null,null),event(31,'status',null,'CLOSED'),event(32,'closedAt',null,'2026-10-08T13:46:00Z'),event(33,'resolutionSummary',null,'Resolved during intake')];
  assert.deepEqual(classifySupportLifecycle(directClosed,createdAt,'UTC').map(item=>item.title),['Case created']);
});

test('older cases keep one creation entry while audit history stays bounded',async()=>{
  const createdAt=new Date('2026-10-01T12:00:00Z'), actor={firstName:'Sam',lastName:'Rep'};
  const base={supportCaseId:12,oldValue:null,oldLabel:null,actorId:7,source:'CRM',actor};
  const initial=[
    {...base,id:1,field:'CREATED',newValue:null,newLabel:null,createdAt:new Date('2026-10-01T12:00:01Z')},
    {...base,id:2,field:'accountId',newValue:'42',newLabel:'Acme',createdAt:new Date('2026-10-01T12:00:01Z')},
    {...base,id:3,field:'subject',newValue:'Older case',newLabel:null,createdAt:new Date('2026-10-01T12:00:01Z')},
  ];
  const recent=Array.from({length:81},(_,index)=>({...base,id:200-index,field:'description',oldValue:'Before',newValue:'After',newLabel:null,createdAt:new Date(`2026-10-08T${String(23-Math.floor(index/60)).padStart(2,'0')}:${String(59-index%60).padStart(2,'0')}:00Z`)}));
  const calls=[];
  const db={supportCaseLifecycleEvent:{findMany:async args=>(calls.push(args),args.orderBy[0].createdAt==='asc'?initial:recent)},activity:{findMany:async()=>[]},task:{findMany:async()=>[]},note:{findMany:async()=>[]},supportCaseAttachment:{findMany:async()=>[]}};
  const view=await caseHistoryView(db,12,createdAt,'UTC');
  assert.equal(view.auditEvents.length,80);
  assert.equal(view.auditTruncated,true);
  assert.deepEqual(view.timeline.map(item=>item.title),['Case created']);
  assert.equal(view.timeline[0].summary.find(field=>field.label==='Linked CRM Account').value,'Acme');
  assert.deepEqual(calls.map(call=>call.take),[81,24]);
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
