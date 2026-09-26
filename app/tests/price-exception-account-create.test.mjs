import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const require=Module.createRequire(fileURLToPath(import.meta.url));
const {createPeReviewAccount,likelyAccountMatches}=require(path.join(root,'lib/price-exception-account-create.ts'));
const {parseRosaCsv,planRosaPriceExceptions}=require(path.join(root,'lib/rosa-price-exception-import.ts'));
const csv=fs.readFileSync(path.join(root,'../reference-data/price-exceptions-2026-09-25.csv'),'utf8');
const first=parseRosaCsv(csv).rows[0];
const actor={id:91,role:'ADMIN',active:true};
function form(name,role){const data=new FormData();data.set('name',name);data.set('status','ACTIVE');data.append('roles',role);return data}
function db(field){
  const accounts=[{id:10,name:first.values.Customer,status:'ACTIVE',archivedAt:null},{id:11,name:first.values.VAR,status:'ACTIVE',archivedAt:null},{id:12,name:first.values['End User'],status:'ACTIVE',archivedAt:null}].filter(account=>account.name!==first.values[field]);
  const client={accounts,created:[],peWrites:[],account:{findMany:async()=>accounts,create:async({data})=>{const account={id:100+client.created.length,name:data.name,status:data.status,archivedAt:null};accounts.push(account);client.created.push(data);return account}},industry:{findFirst:async()=>null},territory:{findFirst:async()=>null},user:{findMany:async()=>[{id:1,firstName:first.values['Requested By'].split(' ')[0],lastName:first.values['Requested By'].split(' ').slice(1).join(' '),active:true,archivedAt:null,role:'SALES'},{id:2,firstName:first.values['Reviewed By'].split(' ')[0],lastName:first.values['Reviewed By'].split(' ').slice(1).join(' '),active:true,archivedAt:null,role:'ADMIN'}]},productSku:{findMany:async()=>[{id:20,partNumber:first.values.SKU,normalizedPartNumber:first.values.SKU.toUpperCase(),active:true,product:{active:true,archivedAt:null}}]},priceException:{findMany:async()=>[],create:async({data})=>client.peWrites.push(data)},currency:{findMany:async()=>[{code:'USD',active:true}]}};
  client.$transaction=async callback=>callback(client);return client;
}
const input={rows:[first],errors:[]};
test('unresolved Customer, VAR, and End User creation is confirmed, selected, and re-evaluated without importing the PE',async()=>{
  for(const [field,role] of [['Customer','DISTRIBUTOR'],['VAR','VAR'],['End User','END_USER']]){
    const client=db(field),name=first.values[field];
    const before=await planRosaPriceExceptions(client,input,'rosa.csv');
    assert.equal(before.counts['REVIEW REQUIRED'],1,field);
    assert.equal((await createPeReviewAccount(client,actor,form(name,role),false,false)).kind,'review');
    assert.equal(client.created.length,0);
    const created=await createPeReviewAccount(client,actor,form(name,role),true,false);
    assert.equal(created.kind,'created');
    const choices={[before.groups[0].groupKey]:{accountIds:{[field]:created.account.id}}};
    const after=await planRosaPriceExceptions(client,input,'rosa.csv',choices);
    assert.equal(after.counts.READY,1,field);
    assert.equal(after.groups[0][field==='Customer'?'customer':field==='VAR'?'varAccount':'endUser'].id,created.account.id);
    assert.equal(after.groups[0][field==='Customer'?'customer':field==='VAR'?'varAccount':'endUser'].source,name);
    assert.equal(client.created[0].accountType,role);
    assert.equal(client.peWrites.length,0);
    assert.equal(client.accounts.some(account=>account.id===created.account.id),true);
  }
});
test('likely duplicates require a second explicit choice before creation',async()=>{
  const client=db('VAR');client.accounts.push({id:50,name:'Sonda Chile',status:'ACTIVE',archivedAt:null});
  assert.equal(likelyAccountMatches(client.accounts,'Sonda Chile')[0].id,50);
  const result=await createPeReviewAccount(client,actor,form('Sonda Chile','VAR'),true,false);
  assert.equal(result.kind,'review');assert.equal(result.matches[0].id,50);assert.equal(client.created.length,0);
  assert.equal((await createPeReviewAccount(client,actor,form('Sonda Chile','VAR'),true,true)).kind,'created');
});
test('Account creation from import requires Account write permission',async()=>{
  const client=db('VAR');await assert.rejects(createPeReviewAccount(client,{id:1,role:'READ_ONLY',active:true},form('New Partner','VAR'),true,true),/Access denied/);assert.equal(client.created.length,0);
});
test('Administration landing restores PE Cleanup as ongoing maintenance',()=>{
  const page=fs.readFileSync(path.join(root,'app/administration/page.tsx'),'utf8');
  assert.match(page,/\["Imports"/);assert.match(page,/\["PE Cleanup", "\/administration\/price-exceptions", "Review and correct imported Price Exceptions, account mappings, owners, statuses, and other data issues\."\]/);
  assert.doesNotMatch(page,/legacy cleanup/i);
});
