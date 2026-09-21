import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText, filename);
const require = Module.createRequire(import.meta.url);
const { saveSkuMetadata } = require(path.join(root,'lib/odm-skus.ts'));
function fixture() {
  const calls=[];
  const rows=new Map([[1,{id:1,productId:10,catalogSource:'PRICE_LIST'}],[2,{id:2,productId:10,catalogSource:'ODM'}]]);
  const tx={product:{findUnique:async()=>({id:10,archivedAt:null})},productSku:{findUnique:async({where})=>where.normalizedPartNumber?null:rows.get(where.id)??null,count:async()=>0,create:async({data})=>{calls.push(data);return {id:3,...data};},update:async({data})=>{calls.push(data);return {id:2,...data};}},account:{findUnique:async({where})=>where.id===7?{id:7}:null}};
  return {calls,db:{$transaction:async callback=>callback(tx)}};
}
const input={productId:10,partNumber:'XT5-UPS',description:null,catalogSource:'ODM',odmCustomerAccountId:7,baseSkuId:1,odmDescription:'RFID'};
test('ODM SKU links existing Account and standard base without touching Account roles',async()=>{
  const {db,calls}=fixture();await saveSkuMetadata(db,input);
  assert.equal(calls[0].odmCustomerAccountId,7);assert.equal(calls[0].baseSkuId,1);
  assert.equal(calls[0].odmDescription,'RFID');
  const empty=fixture();await saveSkuMetadata(empty.db,{...input,odmCustomerAccountId:null,baseSkuId:null,odmDescription:null});
  assert.equal(empty.calls[0].catalogSource,'ODM');
});
test('ODM validation rejects invalid Account, self base, and ODM base',async()=>{
  const {db}=fixture();
  await assert.rejects(saveSkuMetadata(db,{...input,odmCustomerAccountId:99}),/existing Account/);
  await assert.rejects(saveSkuMetadata(db,{...input,skuId:2,baseSkuId:2}),/own Base SKU/);
  await assert.rejects(saveSkuMetadata(db,{...input,baseSkuId:2}),/non-ODM/);
});
test('moving away from ODM rejects metadata and clears stored ODM fields',async()=>{
  const {db,calls}=fixture();
  await assert.rejects(saveSkuMetadata(db,{...input,catalogSource:'PRICE_LIST'}),/require Catalog Source ODM/);
  await saveSkuMetadata(db,{...input,skuId:2,catalogSource:'PRICE_LIST',odmCustomerAccountId:null,baseSkuId:null,odmDescription:null});
  assert.equal(calls[0].odmCustomerAccountId,null);
  assert.equal(calls[0].baseSkuId,null);
  assert.equal(calls[0].odmDescription,null);
});
