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
const { saveSkuMetadata, parseSkuMetadataForm, DuplicateSkuError } = require(path.join(root,'lib/odm-skus.ts'));
function fixture() {
  const calls=[];
  const rows=new Map([[1,{id:1,productId:10,catalogSource:'PRICE_LIST',odmCustomers:[]}],[2,{id:2,productId:10,catalogSource:'ODM',odmSubtype:'CUSTOMER_SPECIFIC',baseSkuId:null,odmDescription:null,odmCustomers:[]}]]);
  const tx={product:{findUnique:async()=>({id:10,archivedAt:null})},productSku:{findUnique:async({where})=>where.normalizedPartNumber?rows.get('duplicate')??null:rows.get(where.id)??null,count:async()=>0,create:async({data})=>{calls.push(data);return {id:3,...data};},update:async({data})=>{calls.push(data);return {id:2,...data};}},account:{count:async({where})=>where.id.in.filter(id=>[7,8].includes(id)).length},productSkuOdmCustomer:{deleteMany:async args=>{calls.push({delete:args.where});},upsert:async({create})=>{calls.push(create)}}};
  return {calls,rows,db:{$transaction:async callback=>callback(tx)}};
}
const input={productId:10,partNumber:'XT5-UPS',description:null,active:true,catalogSource:'ODM',odmSubtype:'CUSTOMER_SPECIFIC',odmCustomerAccountIds:[7,8],baseSkuId:1,odmDescription:'RFID'};
test('ODM SKU links existing Account and standard base without touching Account roles',async()=>{
  const {db,calls}=fixture();await saveSkuMetadata(db,input);
  assert.equal(calls.filter(call=>call.accountId).length,2);assert.equal(calls[0].baseSkuId,1);assert.equal(calls[0].active,true);
  assert.equal(calls[0].odmDescription,'RFID');
  assert.equal(calls[0].odmSubtype,'CUSTOMER_SPECIFIC');
  for(const subtype of ['SPECIAL_CONFIGURATION','CABLE_PACKAGING_ACCESSORY','OTHER']){
    const empty=fixture();await saveSkuMetadata(empty.db,{...input,odmSubtype:subtype,odmCustomerAccountIds:[],baseSkuId:null,odmDescription:null});
    assert.equal(empty.calls[0].catalogSource,'ODM');assert.equal(empty.calls[0].odmSubtype,subtype);
  }
});
test('ODM validation rejects invalid Account, self base, and ODM base',async()=>{
  const {db}=fixture();
  await assert.rejects(saveSkuMetadata(db,{...input,odmCustomerAccountIds:[99]}),/existing active Account/);
  await assert.rejects(saveSkuMetadata(db,{...input,skuId:2,baseSkuId:2}),/own Base SKU/);
  await assert.rejects(saveSkuMetadata(db,{...input,baseSkuId:2}),/non-ODM/);
  await assert.rejects(saveSkuMetadata(db,{...input,odmCustomerAccountIds:[]}),/requires at least one active Account/);
  await assert.rejects(saveSkuMetadata(db,{...input,odmSubtype:'LEGACY_SPECIAL_SKU'}),/reserved for migrated/);
  await assert.rejects(saveSkuMetadata(db,{...input,catalogSource:'SPECIAL_SKU_LIST'}),/Use ODM/);
});
test('free-text customer name cannot satisfy Customer-Specific validation',async()=>{
  const form=new FormData();
  form.set('partNumber','XT5-UPS');form.set('catalogSource','ODM');form.set('odmSubtype','CUSTOMER_SPECIFIC');
  form.set('odmCustomerNames','7-Eleven');
  const parsed=parseSkuMetadataForm(form);
  assert.deepEqual(parsed.odmCustomerAccountIds,[]);
  const {db}=fixture();
  await assert.rejects(saveSkuMetadata(db,{...parsed,productId:10}),/requires at least one active Account/);
});
test('source changes require ODM subtype and preserve existing ODM history',async()=>{
  const {db}=fixture();
  await assert.rejects(saveSkuMetadata(db,{...input,catalogSource:'PRICE_LIST'}),/requires Catalog Source ODM/);
  await assert.rejects(saveSkuMetadata(db,{...input,skuId:2,catalogSource:'PRICE_LIST',odmSubtype:null,odmCustomerAccountIds:[],baseSkuId:null,odmDescription:null}),/cannot change Catalog Source/);
  await assert.rejects(saveSkuMetadata(db,{...input,skuId:1,odmSubtype:null}),/subtype is required/);
  const converted=fixture();await saveSkuMetadata(converted.db,{...input,skuId:1,baseSkuId:null});assert.equal(converted.calls.find(call=>call.catalogSource==='ODM').odmSubtype,'CUSTOMER_SPECIFIC');
});
test('historical unresolved customer-specific SKU can be edited without inventing an Account',async()=>{
  const {db,calls}=fixture();
  await saveSkuMetadata(db,{...input,skuId:2,odmCustomerAccountIds:[],baseSkuId:null,odmDescription:null,active:false});
  assert.equal(calls.find(call=>call.catalogSource==='ODM').odmSubtype,'CUSTOMER_SPECIFIC');
  assert.equal(calls.filter(call=>call.accountId).length,0);
  await assert.rejects(saveSkuMetadata(db,{...input,skuId:2,odmCustomerAccountIds:[],baseSkuId:null,odmDescription:'Changed'}),/requires at least one active Account/);
});
test('changing Catalog Source cannot silently remove existing ODM customer links',async()=>{
  const {db,rows}=fixture();
  rows.get(2).odmCustomers=[{accountId:7}];
  await assert.rejects(saveSkuMetadata(db,{...input,skuId:2,catalogSource:'PRICE_LIST',odmSubtype:null,odmCustomerAccountIds:[],baseSkuId:null,odmDescription:null}),/cannot change Catalog Source/);
});
test('editing ODM updates customers and fields without touching prices',async()=>{
  const {db,rows,calls}=fixture();rows.get(2).odmCustomers=[{accountId:7}];
  await saveSkuMetadata(db,{...input,skuId:2,odmCustomerAccountIds:[8],baseSkuId:1,active:false});
  assert.deepEqual(calls.find(call=>call.delete).delete.accountId.notIn,[8]);
  assert.equal(calls.find(call=>call.catalogSource==='ODM').active,false);
  assert.ok(calls.some(call=>call.accountId===8));
  assert.ok(calls.every(call=>!('prices' in call)));
});
test('normalized duplicate identifies the existing Product and SKU',async()=>{
  const {db,rows,calls}=fixture();rows.set('duplicate',{id:40,productId:20,partNumber:'XT5-UPS',catalogSource:'ODM',product:{name:'Printer'}});
  await assert.rejects(saveSkuMetadata(db,{...input,partNumber:' xt5-ups  '}),error=>error instanceof DuplicateSkuError&&error.existing.id===40&&error.existing.productName==='Printer');
  assert.equal(calls.length,0);
});
