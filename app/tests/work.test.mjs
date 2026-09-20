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
const activityRelations=require(path.join(root,'lib/activity-relations.ts'));
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
 await assert.rejects(work.saveActivity({$transaction:fn=>fn(tx)},activity.value),/Opportunity is not associated/);
 await assert.rejects(work.saveNote({$transaction:fn=>fn(tx)},note.value),/participant/);
 tx.opportunityAccount.findUnique=async()=>({accountId:1});
 assert.equal((await work.saveActivity({$transaction:fn=>fn(tx)},activity.value)).type,'DEMO');
 assert.equal((await work.saveNote({$transaction:fn=>fn(tx)},note.value)).body,'Follow up');
});
test('Activity choices follow Account opportunity, Project, and Contact relationships',()=>{
 const opportunities=[{id:10,name:'A',accountIds:[1,2]},{id:11,name:'B',accountIds:[2]}];
 const projects=[{id:20,name:'Primary',accountIds:[1]},{id:21,name:'Participant',accountIds:[2,1]},{id:22,name:'Other',accountIds:[2]}];
 const contacts=[{id:30,name:'Assigned',accountId:1,active:true},{id:31,name:'Other',accountId:2,active:true},{id:32,name:'Unassigned',accountId:null,active:true},{id:33,name:'Inactive',accountId:1,active:false}];
 const history={contactIds:[]};
 const choices=activityRelations.activityChoices(1,0,opportunities,projects,contacts,history);
 assert.deepEqual(choices.opportunities.map(x=>x.id),[10]);
 assert.deepEqual(choices.projects.map(x=>x.id),[20,21]);
 assert.deepEqual(choices.contacts.map(x=>x.id),[30,32]);
 const kept=activityRelations.retainedActivitySelections(2,0,opportunities,projects,contacts,history,{opportunityId:10,projectId:20,contactIds:[30,32]});
 assert.deepEqual(kept,{opportunityId:10,projectId:0,contactIds:[32]});
 const historical=activityRelations.activityChoices(1,1,[...opportunities,{id:12,name:'Archived',accountIds:[]}],[...projects,{id:23,name:'Archived',accountIds:[]}],contacts,{opportunityId:12,projectId:23,contactIds:[33]});
 assert.ok(historical.opportunities.some(x=>x.id===12));
 assert.ok(historical.projects.some(x=>x.id===23));
 assert.ok(historical.contacts.some(x=>x.id===33));
 assert.ok(!activityRelations.activityChoices(2,1,opportunities,projects,contacts,{contactIds:[33]}).contacts.some(x=>x.id===33));
});
test('Activity choices narrow in both directions and keep only compatible selections',()=>{
 const opportunities=[{id:10,name:'One',accountIds:[1,2],projectIds:[20]},{id:11,name:'Two',accountIds:[1],projectIds:[21]},{id:12,name:'Other account',accountIds:[2],projectIds:[20]}];
 const projects=[{id:20,name:'First',accountIds:[1,2],opportunityIds:[10,12]},{id:21,name:'Second',accountIds:[1],opportunityIds:[11]}];
 const contacts=[{id:30,name:'Assigned',accountId:1,active:true},{id:31,name:'Unassigned',accountId:null,active:true},{id:32,name:'Wrong',accountId:2,active:true}];
 const history={contactIds:[]};
 assert.deepEqual(activityRelations.activityChoices(1,0,opportunities,projects,contacts,history,{opportunityId:10}).projects.map(x=>x.id),[20]);
 assert.deepEqual(activityRelations.activityChoices(1,0,opportunities,projects,contacts,history,{projectId:20}).opportunities.map(x=>x.id),[10]);
 const former={opportunityId:10,projectId:20,contactIds:[]};
 const unlinkedOpportunities=opportunities.map(item=>item.id===10?{...item,projectIds:[]}:item);
 const unlinkedProjects=projects.map(item=>item.id===20?{...item,opportunityIds:[12]}:item);
 assert.deepEqual(activityRelations.activityChoices(1,1,unlinkedOpportunities,unlinkedProjects,contacts,former,former).projects.map(x=>x.id),[20]);
 assert.deepEqual(activityRelations.activityChoices(1,0,opportunities,projects,contacts,history).contacts.map(x=>x.id),[30,31]);
 const selected={opportunityId:10,projectId:20,contactIds:[30,31]};
 assert.deepEqual(activityRelations.retainedActivitySelections(1,0,opportunities,projects,contacts,history,{...selected,opportunityId:11},'opportunity'),{opportunityId:11,projectId:0,contactIds:[30,31]});
 assert.deepEqual(activityRelations.retainedActivitySelections(1,0,opportunities,projects,contacts,history,{...selected,projectId:21},'project'),{opportunityId:0,projectId:21,contactIds:[30,31]});
 assert.deepEqual(activityRelations.retainedActivitySelections(1,0,opportunities,projects,contacts,history,selected,'project'),selected);
 assert.deepEqual(activityRelations.retainedActivitySelections(2,0,opportunities,projects,contacts,history,selected),{opportunityId:10,projectId:20,contactIds:[31]});
});
test('Activity server validates Account, Opportunity, Project, and their link',async()=>{
 const value=work.parseActivity(form([['subject','Call'],['type','CALL'],['accountId','1'],['opportunityId','10'],['projectId','20'],['activityDate','2026-09-18T14:30']])).value;
 let opportunityAccount=true, projectAccount=true, linked=true, created=0;
 const tx={account:{findFirst:async()=>({id:1})},opportunity:{findFirst:async()=>({id:10})},opportunityAccount:{findUnique:async()=>opportunityAccount?{}:null},project:{findFirst:async()=>({id:20}),findUnique:async()=>({primaryAccountId:projectAccount?1:2,participants:[]})},opportunityProject:{findUnique:async()=>linked?{}:null},activityType:{findFirst:async()=>({code:'CALL'})},activity:{create:async({data})=>{created++;return {id:7,...data};}}};
 const client={$transaction:fn=>fn(tx)};
 assert.equal((await work.saveActivity(client,value)).id,7);
 opportunityAccount=false; await assert.rejects(work.saveActivity(client,value),/Opportunity is not associated/);
 opportunityAccount=true; projectAccount=false; await assert.rejects(work.saveActivity(client,value),/Project is not associated/);
 tx.project.findUnique=async()=>({primaryAccountId:null,participants:[]});
 await assert.rejects(work.saveActivity(client,value),/Project is not associated/);
 tx.project.findUnique=async()=>({primaryAccountId:1,participants:[]});
 projectAccount=true; linked=false; await assert.rejects(work.saveActivity(client,value),/Project is not linked/);
 assert.equal(created,1);
 assert.equal(work.activityErrorField('This Project is not linked to the selected Opportunity.'),'projectId');
});
test('unchanged historical Activity relationships survive unlink and archive; changed links are checked',async()=>{
 const value=work.parseActivity(form([['subject','Updated'],['type','CALL'],['accountId','1'],['opportunityId','10'],['projectId','20'],['activityDate','2026-09-18T14:30']])).value;
 let row={id:7,accountId:1,opportunityId:10,projectId:20,type:'CALL',archivedAt:null};
 const tx={activity:{findFirst:async()=>row,update:async({data})=>(row={...row,...data})},activityType:{findFirst:async()=>({code:'CALL'})},account:{findFirst:async()=>null},opportunity:{findFirst:async()=>null},opportunityAccount:{findUnique:async()=>null},project:{findFirst:async()=>null},opportunityProject:{findUnique:async()=>null}};
 const client={$transaction:fn=>fn(tx)};
 assert.equal((await work.saveActivity(client,value,7)).subject,'Updated');
 await assert.rejects(work.saveActivity(client,{...value,projectId:21},7),/Opportunity not found/);
 await assert.rejects(work.saveActivity(client,{...value,opportunityId:11},7),/Opportunity not found/);
});
test('account-less Projects are excluded from Activity choices unless retained as history',()=>{
 const project={id:20,name:'Internal',accountIds:[],opportunityIds:[]};
 assert.deepEqual(activityRelations.activityChoices(1,0,[],[project],[],{contactIds:[]}).projects,[]);
 assert.deepEqual(activityRelations.activityChoices(1,1,[],[project],[],{projectId:20,contactIds:[]},{projectId:20}).projects.map(item=>item.id),[20]);
});
test('Activity validation state retains every submitted field',()=>{
 const entries=[['subject','Call'],['description','Detailed notes'],['activityDate','2026-09-18T14:30'],['type','CALL'],['direction','OUTBOUND'],['accountId','1'],['opportunityId','10'],['projectId','20'],['contactIds','30'],['contactIds','32'],['outcome','Interested'],['nextStep','Send quote'],['followUpDate','2026-09-25'],['userId','4']];
 const submitted=form(entries);
 const state=work.activityFailureState(submitted,{projectId:'This Project does not include the selected Account.'});
 assert.deepEqual(state.values,Object.assign(Object.fromEntries(entries),{contactIds:'30,32'}));
 assert.equal(state.errors.projectId,'This Project does not include the selected Account.');
 assert.equal(work.activityErrorField('This Project does not include the selected Account.'),'projectId');
 assert.equal(work.activityErrorField('Account is not a participant in this opportunity.'),'opportunityId');
});
test('manually submitted unrelated Activity Project and Contact are rejected',async()=>{
 const input=work.parseActivity(form([['subject','Call'],['type','CALL'],['accountId','1'],['projectId','20'],['activityDate','2026-09-18T14:30'],['contactIds','30']]));
 const tx={account:{findFirst:async()=>({id:1})},project:{findFirst:async()=>({id:20}),findUnique:async()=>({primaryAccountId:2,participants:[]})},activityType:{findFirst:async()=>({code:'CALL'})},contact:{findMany:async()=>[{id:30,accountId:2,active:true}]},activity:{create:async({data})=>({id:7,...data})}};
 await assert.rejects(work.saveActivity({$transaction:fn=>fn(tx)},input.value),/Project is not associated/);
 tx.project.findUnique=async()=>({primaryAccountId:2,participants:[{accountId:1}]});
 await assert.rejects(work.saveActivity({$transaction:fn=>fn(tx)},input.value),/Contact is not associated/);
});
test('Activity accepts eligible unassigned Contacts and existing inactive Contact history',async()=>{
 const value=work.parseActivity(form([['subject','Call'],['type','CALL'],['accountId','1'],['activityDate','2026-09-18T14:30'],['contactIds','30'],['contactIds','31']])).value;
 const tx={account:{findFirst:async()=>({id:1})},activity:{findFirst:async()=>({id:7,accountId:1,type:'CALL'}),update:async({data})=>({id:7,...data})},activityType:{findFirst:async()=>({code:'CALL'})},activityContact:{count:async()=>2,findMany:async()=>[{contactId:31}],createMany:async()=>({})},contact:{findMany:async()=>[{id:30,accountId:null,active:true},{id:31,accountId:2,active:false}]}};
 const saved=await work.saveActivity({$transaction:fn=>fn(tx)},value,7);
 assert.equal(saved.accountId,1);
 assert.equal(saved.contactIds,undefined);
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
