import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename);
const require=Module.createRequire(fileURLToPath(import.meta.url));
let activity={id:4,accountId:1,opportunityId:null,projectId:null,archivedAt:null};
let pe={id:9,archivedAt:new Date(),expirationDate:new Date('2026-01-01'),status:'ARCHIVED',peCode:'PE-9'};
const db={activity:{findUnique:async()=>activity,update:async({data})=>(activity={...activity,...data})},priceException:{findFirst:async()=>pe,update:async({data})=>(pe={...pe,...data})}};
const load=Module._load;
Module._load=function(name,parent,isMain){
 if(name==='next/cache')return {revalidatePath:()=>{}};
 if(name==='next/navigation')return {redirect:destination=>{throw Object.assign(new Error('redirect'),{destination});}};
 if(name==='@/lib/prisma')return {prisma:db};
 if(name==='@/lib/current-user')return {currentUser:async()=>({id:7,role:'ADMIN',active:true,archivedAt:null}),requireMutation:async()=>({id:7,role:'ADMIN',active:true,archivedAt:null})};
 if(name==='@/lib/projects')return {assertProjectWorkEdit:async()=>{}};
 if(name==='@/lib/work')return require(path.join(root,'lib/work.ts'));
 if(name==='@/lib/authorization')return require(path.join(root,'lib/authorization.ts'));
 if(name==='@/lib/save-feedback')return require(path.join(root,'lib/save-feedback.ts'));
 if(name==='@/lib/price-exception-resolution')return require(path.join(root,'lib/price-exception-resolution.ts'));
 return load.call(this,name,parent,isMain);
};
const activities=require(path.join(root,'app/activities/actions.ts'));
const pricing=require(path.join(root,'app/price-exceptions/[id]/actions.ts'));
Module._load=load;

test('Activity archive and restore preserve the row and clear archive attribution',async()=>{
 for(const archived of [true,false]){
  const form=new FormData();form.set('id','4');form.set('archived',String(archived));
  await assert.rejects(activities.setActivityArchived(form),error=>error.destination==='/activities/4/edit');
  assert.equal(Boolean(activity.archivedAt),archived);
  assert.equal(activity.archivedById,archived?7:null);
 }
});

test('Price Exception restore retains imported source history and uses expiration for status',async()=>{
 const form=new FormData();form.set('id','9');
 await pricing.restorePriceException(form);
 assert.equal(pe.archivedAt,null);
 assert.equal(pe.status,'EXPIRED');
 assert.equal(pe.peCode,'PE-9');
});
