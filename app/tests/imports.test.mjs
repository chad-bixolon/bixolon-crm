import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(fileURLToPath(import.meta.url));
const {parseImportCsv,template} = require(path.join(root,'lib/import-csv.ts'));
const {planImport,applyImport,normalizeAccountName,normalizeDomain} = require(path.join(root,'lib/import-plan.ts'));
const {routeAccess} = require(path.join(root,'lib/authorization.ts'));
const db = (overrides={}) => ({
  account:{findMany:async()=>overrides.accounts ?? []},contact:{findMany:async()=>overrides.contacts ?? []},
  user:{findMany:async()=>overrides.users ?? []},territory:{findMany:async()=>overrides.territories ?? []},industry:{findMany:async()=>overrides.industries ?? []},
});
const account = (id,name,website='') => ({id,name,website,archivedAt:null,status:'ACTIVE',businessRoles:[],phone:null});
const contact = (id,email,accountId=null) => ({id,email,accountId,firstName:'Ada',lastName:'Lee',active:true,isPrimary:false,archivedAt:null,phone:null});
test('CSV parses quoted commas, trims cells, and rejects malformed or duplicate headers',()=>{
  assert.equal(parseImportCsv('record_type,account_name\naccount," Acme, Inc "\n').rows[0].values.account_name,'Acme, Inc');
  assert.match(parseImportCsv('record_type,account_name\naccount,"bad').errors[0],/Malformed/);
  assert.match(parseImportCsv('record_type,account_name,account_name\naccount,x,y').errors[0],/Duplicate/);
  assert.match(parseImportCsv('account_name\nx').errors.join(' '),/record_type/);
  assert.ok(template.includes('contact_account_name'));
});
test('Account matching normalizes name and domain and rejects ambiguity',async()=>{
  assert.equal(normalizeAccountName(' Acme  CO '),'acme co'); assert.equal(normalizeDomain('https://www.EXAMPLE.com/a'),'example.com');
  const data=db({accounts:[account(1,'Acme Co','https://acme.com'),account(2,'Other','https://other.com')]});
  assert.equal((await planImport(data,'record_type,account_name\naccount, ACME  co')).items[0].status,'UPDATE');
  assert.equal((await planImport(data,'record_type,account_name,website\naccount,Fresh,https://www.acme.com')).items[0].id,1);
  assert.equal((await planImport(data,'record_type,account_name,website\naccount,Acme Co,https://other.com')).items[0].status,'ERROR');
});
test('lookup validation, roles, duplicate rows, and blank preservation',async()=>{
  const data=db({accounts:[account(1,'Acme')],users:[{id:4,email:'owner@example.com',active:true,archivedAt:null}],territories:[{code:'EAST',name:'East',active:true}],industries:[{code:'RETAIL',active:true}]});
  const good=await planImport(data,'record_type,account_name,phone,owner_email,territory_code,industry_code,business_roles\naccount,Acme,,owner@example.com,EAST,RETAIL,VAR|ISV');
  assert.equal(good.items[0].status,'UPDATE'); assert.equal(good.items[0].data.phone,undefined); assert.equal(good.items[0].data.ownerId,4); assert.deepEqual(good.items[0].roles,['VAR','ISV']);
  const bad=await planImport(data,'record_type,account_name,owner_email,territory_code,industry_code,business_roles\naccount,Acme,no@example.com,NO,NO,Reseller\naccount,ACME,,,,');
  assert.equal(bad.counts.errors,2); assert.match(bad.items[0].messages.join(' '),/Owner email.*Territory.*Industry.*business role/);
});
test('CSV import rejects new retired Territory assignments but preserves historical ones',async()=>{
  const retired={code:'STRATEGIC_SALES',name:'Strategic / National Accounts',active:true};
  const data=db({accounts:[{...account(1,'Historical'),territory:retired.code},account(2,'Other')],territories:[retired]});
  const csv='record_type,account_name,territory_code\naccount,New,STRATEGIC_SALES\naccount,Other,STRATEGIC_SALES\naccount,Historical,STRATEGIC_SALES';
  const plan=await planImport(data,csv);
  assert.deepEqual(plan.items.map(item=>item.status),['ERROR','ERROR','UNCHANGED']);
  assert.match(plan.items[0].messages.join(' '),/retired Territory/);
});
test('Contact email matching, unassigned Contact, and Primary rules',async()=>{
  const data=db({accounts:[account(1,'Acme')],contacts:[contact(1,'ADA@example.com',1),{...contact(2,'primary@example.com',1),isPrimary:true}]});
  const matched=await planImport(data,'record_type,contact_first_name,contact_last_name,contact_email,contact_phone\ncontact,Ada,Lee,ada@EXAMPLE.com,555-1234');
  assert.equal(matched.items[0].id,1); assert.equal(matched.items[0].data.accountId,undefined);
  const unassigned=await planImport(db(),'record_type,contact_first_name,contact_last_name\ncontact,New,Person');
  assert.equal(unassigned.items[0].status,'NEW');
  const invalid=await planImport(db(),'record_type,contact_first_name,contact_last_name,contact_primary\ncontact,New,Person,true');
  assert.equal(invalid.items[0].status,'ERROR');
  const transfer=await planImport(data,'record_type,contact_first_name,contact_last_name,contact_email,contact_account_name,contact_primary\ncontact,Ada,Lee,ada@example.com,Acme,true');
  assert.equal(transfer.items[0].status,'WARNING'); assert.equal(transfer.items[0].primaryTransferId,2);
});
test('confirmation refuses stale preview and non-admin route is denied',async()=>{
  let wrote=false; const data=db(); data.$transaction=async callback=>callback({...data,account:{...data.account,create:async()=>{wrote=true;}}});
  await assert.rejects(applyImport(data,'record_type,account_name\naccount,Acme','wrong',1),/Preview changed/);
  assert.equal(wrote,false);
  assert.equal(routeAccess('/administration/imports',{id:2,role:'SALES',active:true}),'denied');
});
test('a failed write leaves the transaction without a committed Account',async()=>{
  const data=db(); let committed=[];
  data.$transaction=async callback=>{
    const staged=[];
    const tx={...data,account:{findMany:async()=>[],create:async({data:record})=>{
      if (record.name==='Fail') throw new Error('constraint');
      staged.push(record); return {id:staged.length,...record};
    }}};
    const result=await callback(tx); committed=staged; return result;
  };
  const csv='record_type,account_name\naccount,Good\naccount,Fail';
  const preview=await planImport(data,csv);
  await assert.rejects(applyImport(data,csv,preview.digest,1),/constraint/);
  assert.deepEqual(committed,[]);
});
