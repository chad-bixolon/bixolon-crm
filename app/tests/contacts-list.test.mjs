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
const {routeAccess}=require(path.join(root,'lib/authorization.ts'));
const page=fs.readFileSync(path.join(root,'app/contacts/page.tsx'),'utf8');
const detail=fs.readFileSync(path.join(root,'app/contacts/[id]/page.tsx'),'utf8');
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
test('Contact status filters retain their existing predicates and default visibility',()=>{
  const accountVisibility=[{accountId:null},{account:{is:{archivedAt:null,status:'ACTIVE'}}}];
  assert.deepEqual(contactWhere({}),{archivedAt:null,OR:accountVisibility});
  assert.deepEqual(contactWhere({active:'active'}),{archivedAt:null,OR:accountVisibility,active:true});
  assert.deepEqual(contactWhere({active:'inactive'}),{archivedAt:null,OR:accountVisibility,active:false});
  assert.deepEqual(contactWhere({active:'archived'}),{archivedAt:{not:null}});
  assert.deepEqual(contactWhere({active:'all'}),{});
  assert.match(page,/<option value="">Not Archived<\/option>/);
  assert.doesNotMatch(page,/<option[^>]*>Current<\/option>/);
  assert.match(page,/defaultValue=\{filters\.active\?\?""\}/);
  assert.match(page,/c\.archivedAt\?"Archived":c\.active\?"Active":"Inactive"/);
  assert.match(detail,/state === "active" \? "Active" : state === "inactive" \? "Inactive" : "Archived"/);
  assert.doesNotMatch(detail,/"Current"/);
});
test('Contact list status selections return the expected active, inactive and archived rows',async()=>{
  const rows=[
    {id:1,active:true,archivedAt:null,accountId:null},
    {id:2,active:false,archivedAt:null,accountId:null},
    {id:3,active:false,archivedAt:new Date('2026-01-01'),accountId:null},
    {id:4,active:true,archivedAt:null,accountId:9,account:{status:'INACTIVE',archivedAt:null}},
  ];
  const matches=where=>rows.filter(row=>
    (where.archivedAt===undefined||where.archivedAt===null ? where.archivedAt===undefined||row.archivedAt===null : row.archivedAt!==null)
    && (where.active===undefined||row.active===where.active)
    && (where.OR===undefined||row.accountId===null||row.account?.status==='ACTIVE'&&row.account.archivedAt===null)
  );
  const client={contact:{count:async({where})=>matches(where).length,findMany:async({where})=>matches(where)}};
  for(const [filter,expected] of [[undefined,[1,2]],['active',[1]],['inactive',[2]],['archived',[3]],['all',[1,2,3,4]]]){
    const result=await listContacts(client,filter?{active:filter}:{});
    assert.deepEqual(result.contacts.map(row=>row.id),expected,filter??'default');
    assert.equal(result.count,expected.length);
  }
});
test('Contacts read access remains available to existing roles',()=>{
  for(const role of ['ADMIN','SALES_MANAGER','SALES','MARKETING_MANAGER','READ_ONLY'])
    assert.equal(routeAccess('/contacts',{id:7,role,active:true,archivedAt:null}),'allowed');
  assert.equal(routeAccess('/contacts',{id:7,role:'SALES',active:false,archivedAt:null}),'denied');
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
