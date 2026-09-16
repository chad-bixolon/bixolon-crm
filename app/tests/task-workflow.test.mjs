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
const require=Module.createRequire(fileURLToPath(import.meta.url));
for(const ext of ['.ts','.tsx']) Module._extensions[ext]=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText,filename);
const work=require(path.join(root,'lib/work.ts'));
let row={id:7,subject:'Follow up',archivedAt:null,accountId:null,opportunityId:null};
const prisma={task:{findUnique:async()=>row,update:async({data})=>(row={...row,...data})}};
const originalLoad=Module._load;
Module._load=function(name,parent,isMain){
 if(name==='next/cache') return {revalidatePath:()=>{}};
 if(name==='next/navigation') return {redirect:(destination)=>{throw Object.assign(new Error('redirect'),{destination});},notFound:()=>{throw new Error('not found');}};
 if(name==='next/link') return {__esModule:true,default:({href,children,...props})=>React.createElement('a',{href,...props},children)};
 if(name==='@/lib/prisma') return {prisma};
 if(name==='@/lib/work') return work;
 if(name==='@/components/shell') return {Content:({children})=>React.createElement('main',null,children),PageHeader:({title,action})=>React.createElement('header',null,React.createElement('h1',null,title),action)};
 if(name==='@/components/work-form') return {WorkForm:()=>React.createElement('form'),ReactivateTask:()=>React.createElement('button',null,'Reactivate task')};
 if(name==='@/lib/work-options') return {workOptions:async()=>({accounts:[],opportunities:[],users:[]})};
 return originalLoad.call(this,name,parent,isMain);
};
const actions=require(path.join(root,'app/tasks/actions.ts'));
const detail=require(path.join(root,'app/tasks/[id]/edit/page.tsx'));
function form(entries){const data=new FormData();for(const [key,value] of entries)data.set(key,value);return data;}

test('successful create redirects to its task and repeated token reuses the row',async()=>{
 let creates=0;row=null;
 prisma.task.findUnique=async({where})=>row?.createKey===where.createKey?row:null;
 prisma.task.create=async({data})=>{creates++;row={id:7,...data};return row;};
 prisma.$transaction=async(fn)=>fn({task:prisma.task});
 const data=form([['subject','Follow up'],['status','OPEN'],['priority','NORMAL'],['createKey','d7054358-5d57-4398-8550-506157266184']]);
 for(let i=0;i<2;i++) await assert.rejects(actions.submitTask(null,{errors:{}},data),error=>error.destination==='/tasks/7/edit');
 assert.equal(creates,1);
});
test('archive redirects to tasks, and direct archived detail renders reactivation',async()=>{
 row={id:7,subject:'Follow up',description:'Call the customer',status:'OPEN',priority:'HIGH',dueDate:null,assignedTo:null,account:null,opportunity:null,archivedAt:null,accountId:null,opportunityId:null};
 prisma.task.findUnique=async()=>row;
 await assert.rejects(actions.archiveTask(7,{errors:{}}),error=>error.destination==='/tasks?visibility=archived');
 assert.ok(row.archivedAt instanceof Date);
 const html=renderToStaticMarkup(await detail.default({params:Promise.resolve({id:'7'})}));
 assert.match(html,/Archived/);
 assert.match(html,/Call the customer/);
 assert.match(html,/HIGH/);
 assert.match(html,/Reactivate task/);
 assert.match(html,/href="\/tasks\?visibility=archived"/);
 await assert.rejects(actions.reactivateTask(7,{errors:{}}),error=>error.destination==='/tasks/7/edit');
 assert.equal(row.archivedAt,null);
});
