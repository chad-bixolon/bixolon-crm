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
const {createPeReviewAccount}=require(path.join(root,'lib/price-exception-account-create.ts'));
const admin={id:7,role:'ADMIN',active:true,archivedAt:null};
const form=(name,extra={})=>{const data=new FormData();data.set('name',name);data.set('status','ACTIVE');for(const [key,value] of Object.entries(extra))data.set(key,value);return data;};
function client(accounts=[]){const state={accounts:[...accounts],writes:0};const db={state,
  account:{findMany:async()=>state.accounts,create:async({data})=>{state.writes++;const account={id:state.accounts.length+1,...data};state.accounts.push(account);return account;}},
  industry:{findFirst:async()=>null},territory:{findFirst:async()=>null},user:{findFirst:async()=>null},
};db.$transaction=async callback=>callback(db);return db;}

test('shared import Account guard presents normalized name, domain, and address candidates',async()=>{
  const db=client([
    {id:1,name:'North Star LLC',status:'ACTIVE',archivedAt:null,website:null,addressLine1:null,postalCode:null},
    {id:2,name:'Unrelated',status:'ACTIVE',archivedAt:null,website:'https://example.com',addressLine1:null,postalCode:null},
    {id:3,name:'Another Company',status:'ACTIVE',archivedAt:null,website:null,addressLine1:'10 Main St',postalCode:'10001'},
  ]);
  const reviewed=await createPeReviewAccount(db,admin,form('North Star Branch',{website:'https://example.com',addressLine1:'10 Main St',postalCode:'10001'}),false,false);
  assert.equal(reviewed.kind,'review');assert.deepEqual(new Set(reviewed.matches.map(match=>match.reason)),new Set(['Similar company name','Same website domain','Same street address and postal code']));assert.equal(db.state.writes,0);
  const guarded=await createPeReviewAccount(db,admin,form('North Star Branch',{website:'https://example.com',addressLine1:'10 Main St',postalCode:'10001'}),true,false,reviewed.reviewToken);
  assert.equal(guarded.kind,'review');assert.equal(db.state.writes,0);
  const created=await createPeReviewAccount(db,admin,form('North Star Branch',{website:'https://example.com',addressLine1:'10 Main St',postalCode:'10001'}),true,true,reviewed.reviewToken);
  assert.equal(created.kind,'created');assert.equal(db.state.writes,1);
});
test('shared import guard blocks exact normalized names and stale create-anyway review',async()=>{
  const db=client([{id:1,name:'CoreGroup Displays',status:'ACTIVE',archivedAt:null,website:null,addressLine1:null,postalCode:null}]);
  assert.equal((await createPeReviewAccount(db,admin,form('  coregroup   displays  '),false,false)).kind,'exact');
  const reviewed=await createPeReviewAccount(db,admin,form('CoreGroup East'),false,false);
  assert.equal(reviewed.kind,'review');
  const stale=await createPeReviewAccount(db,admin,form('CoreGroup West'),true,true,reviewed.reviewToken);
  assert.equal(stale.kind,'review');assert.equal(db.state.writes,0);
});
test('shared import Account creation enforces existing Account write permission',async()=>{
  const db=client();
  for(const role of ['SALES','SALES_MANAGER','READ_ONLY'])await assert.rejects(createPeReviewAccount(db,{...admin,role},form('New Company'),false,false),/Access denied/);
  assert.equal(db.state.writes,0);
});
