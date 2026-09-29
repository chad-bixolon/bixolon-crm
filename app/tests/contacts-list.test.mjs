import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename);
const require=Module.createRequire(import.meta.url);
const {contactWhere,contactOrderBy,contactListState,contactListUrl,listContacts}=require(path.join(root,'lib/contacts.ts'));
const page=fs.readFileSync(path.join(root,'app/contacts/page.tsx'),'utf8');
const route=fs.readFileSync(path.join(root,'app/contacts/account-search/route.ts'),'utf8');

test('search includes name, email, and title in the database predicate',()=>{
  const where=contactWhere({q:'Manager'});
  assert.deepEqual(where.AND[0].OR.map(term=>Object.keys(term)[0]),['firstName','lastName','email','title']);
  for(const term of where.AND[0].OR) assert.deepEqual(Object.values(term)[0],{contains:'Manager',mode:'insensitive'});
});
test('account, status, marketing, title, primary and assignment filters compose with visibility',()=>{
  const where=contactWhere({accountId:'42',active:'active',marketingPreference:'OPTED_IN',title:'director',primary:'yes',assignment:'assigned'});
  assert.equal(where.accountId,42);
  assert.equal(where.active,true);
  assert.equal(where.archivedAt,null);
  assert.equal(where.marketingPreference,'OPTED_IN');
  assert.deepEqual(where.title,{contains:'director',mode:'insensitive'});
  assert.equal(where.isPrimary,true);
  assert.deepEqual(where.OR,[{accountId:null},{account:{is:{archivedAt:null,status:'ACTIVE'}}}]);
  assert.equal(contactWhere({active:'inactive'}).active,false);
  assert.deepEqual(contactWhere({active:'archived'}).archivedAt,{not:null});
  assert.equal(contactWhere({primary:'no'}).isPrimary,false);
  assert.deepEqual(contactWhere({assignment:'assigned'}).accountId,{not:null});
  assert.equal(contactWhere({assignment:'unassigned'}).accountId,null);
  assert.equal(contactWhere({accountId:'unassigned'}).accountId,null);
  assert.deepEqual(contactWhere({accountId:'unassigned',assignment:'assigned'}).AND,[{accountId:{not:null}}]);
});
test('each sortable column supports ascending and descending with stable ties',()=>{
  for(const sort of ['name','account','title','email','status']){
    const asc=contactOrderBy({sort,dir:'asc'}),desc=contactOrderBy({sort,dir:'desc'});
    assert.notDeepEqual(asc,desc,sort);
    assert.deepEqual(asc.at(-1),{id:'asc'});
    assert.deepEqual(desc.at(-1),{id:'asc'});
  }
  assert.deepEqual(contactOrderBy({}),[{lastName:'asc'},{firstName:'asc'},{id:'asc'}]);
  assert.equal(contactListState({sort:'unknown',dir:'invalid'}).sort,undefined);
  assert.equal(contactListState({sort:'name',dir:'desc'}).dir,'desc');
});
test('pagination and page size stay in the database query and use the same visibility predicate for count',async()=>{
  let countArgs,rowsArgs;
  const client={contact:{count:async args=>{countArgs=args;return 437},findMany:async args=>{rowsArgs=args;return [{id:1}]}}};
  const filters={q:'manager',active:'active',sort:'account',dir:'desc',page:'2',pageSize:'50'};
  const result=await listContacts(client,filters);
  assert.deepEqual({page:result.page,pages:result.pages,pageSize:result.pageSize,count:result.count},{page:2,pages:9,pageSize:50,count:437});
  assert.equal(rowsArgs.skip,50);assert.equal(rowsArgs.take,50);
  assert.deepEqual(rowsArgs.where,countArgs.where);
  assert.deepEqual(rowsArgs.orderBy,contactOrderBy(filters));
  for(const size of ['25','50','100']) assert.equal(contactListState({pageSize:size}).pageSize,Number(size));
  assert.equal(contactListState({pageSize:'10000'}).pageSize,25);
});
test('list controls retain query state, reset pages on filter and sort changes, and expose empty state',()=>{
  const filters={q:'manager',accountId:'42',active:'active',marketingPreference:'OPTED_IN',title:'lead',primary:'yes',assignment:'assigned',sort:'email',dir:'desc',page:'3',pageSize:'50'};
  const next=new URL(contactListUrl(filters,{page:'4'}),'https://example.test');
  for(const [key,value] of Object.entries(filters)) assert.equal(next.searchParams.get(key),key==='page'?'4':value);
  const sorted=new URL(contactListUrl(filters,{sort:'name',dir:'asc'}),'https://example.test');
  assert.equal(sorted.searchParams.has('page'),false);
  assert.equal(sorted.searchParams.get('sort'),'name');
  const cleared=new URL(contactListUrl(filters,{sort:undefined,dir:undefined}),'https://example.test');
  assert.equal(cleared.searchParams.has('sort'),false);
  assert.equal(cleared.searchParams.has('dir'),false);
  assert.match(page,/key!=="pageSize"/);
  assert.match(page,/contactListUrl\(filters,\{page:String\(page\+1\)\}\)/);
  assert.match(page,/href=\{contactListUrl\(filters,next\)\}/);
  assert.match(page,/No contacts match these filters\./);
  assert.match(page,/Clear filters/);
  assert.match(route,/requirePermission\("contacts\.read"\)/);
  assert.match(route,/take: 20/);
});
