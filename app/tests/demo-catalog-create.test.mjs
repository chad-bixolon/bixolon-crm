import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const require=Module.createRequire(import.meta.url);
const {createDemoCatalogSku,inspectDemoCatalog,demoProductCandidates}=require(path.join(root,'lib/demo-catalog-create.ts'));
const actor={id:1,role:'ADMIN',active:true,archivedAt:null};
const existingProduct={id:10,name:'PM5',sku:'PM5-BASE',active:true,archivedAt:null,categoryId:null,skus:[{partNumber:'PM5-BASE'}]};
function db(products=[existingProduct],skus=[{id:20,productId:10,partNumber:'PM5-BASE',normalizedPartNumber:'PM5-BASE',catalogSource:null,product:{name:'PM5'}}]){
  const state={products:structuredClone(products),skus:structuredClone(skus)};
  const client={state,
    product:{findMany:async()=>state.products.map(product=>({...product,skus:state.skus.filter(sku=>sku.productId===product.id).map(sku=>({partNumber:sku.partNumber}))})),findUnique:async({where})=>state.products.find(product=>product.id===where.id)||null,create:async({data})=>{const product={id:Math.max(0,...state.products.map(product=>product.id))+1,...data,archivedAt:null};state.products.push(product);return product;}},
    productCategory:{findMany:async()=>[],count:async()=>0},
    productSku:{findUnique:async({where})=>state.skus.find(sku=>where.id?sku.id===where.id:sku.normalizedPartNumber===where.normalizedPartNumber)||null,create:async({data})=>{const sku={id:Math.max(0,...state.skus.map(sku=>sku.id))+1,...data};state.skus.push(sku);return sku;}},
    account:{count:async()=>0},
  };
  client.$transaction=async fn=>{const snapshot=structuredClone(state);try{return await fn(client);}catch(error){Object.assign(state,snapshot);throw error;}};
  return client;
}
function form(fields={}){const data=new FormData();for(const [key,value] of Object.entries({mode:'existing',productId:'10',partNumber:'PM5-UPSDP',catalogSourceChoice:'UNCLASSIFIED',active:'true',...fields}))data.set(key,value);return data;}

test('likely Product family is surfaced for a missing Demo SKU',async()=>{
  const client=db();
  assert.deepEqual(demoProductCandidates('PM5-UPSDP','',await client.product.findMany()),[{id:10,name:'PM5',sku:'PM5-BASE'}]);
  const review=await inspectDemoCatalog(client,'PM5-UPSDP','New PM5 Model');
  assert.equal(review.candidates[0].id,10);
});
test('Admin adds a SKU beneath an existing Product with normal catalog validation',async()=>{
  const client=db();const result=await createDemoCatalogSku(client,actor,'PM5-UPSDP',form(),'',false);
  assert.equal(result.productId,10);
  assert.equal(client.state.products.length,1);
  assert.equal(client.state.skus.at(-1).partNumber,'PM5-UPSDP');
  assert.equal(client.state.skus.at(-1).catalogSource,null);
  assert.equal(client.state.skus.at(-1).normalizedPartNumber,'PM5-UPSDP');
});
test('Admin creates a missing Product and SKU after reviewing candidates',async()=>{
  const client=db();const name='New Demo Printer',review=await inspectDemoCatalog(client,'NEW-100',name);
  const result=await createDemoCatalogSku(client,actor,'NEW-100',form({mode:'new',productId:'',partNumber:'NEW-100',name,catalogSourceChoice:'PRICE_LIST'}),review.reviewToken,false);
  assert.equal(client.state.products.length,2);
  assert.equal(client.state.skus.length,2);
  assert.equal(client.state.skus.at(-1).productId,result.productId);
  assert.equal(client.state.skus.at(-1).catalogSource,'PRICE_LIST');
});
test('normalized duplicate SKU is blocked, including an inactive catalog SKU',async()=>{
  const client=db();
  await assert.rejects(createDemoCatalogSku(client,actor,'PM5-BASE',form({partNumber:' pm5-base '}),'',false),/already exists/);
  assert.equal(client.state.skus.length,1);
});
test('likely existing Product requires review and exact model duplicate cannot be created',async()=>{
  const client=db(),name='PM5 Printer',review=await inspectDemoCatalog(client,'PM5-UPSDP',name);
  const data=form({mode:'new',productId:'',name});
  await assert.rejects(createDemoCatalogSku(client,actor,'PM5-UPSDP',data,review.reviewToken,false),/Review likely Product/);
  await assert.rejects(createDemoCatalogSku(client,actor,'PM5-UPSDP',form({mode:'new',productId:'',name:'PM5'}),(await inspectDemoCatalog(client,'PM5-UPSDP','PM5')).reviewToken,true),/already exists/);
  assert.equal(client.state.products.length,1);
});
test('only an active Admin may create catalog records through Demo import',async()=>{
  for(const role of ['SALES','SALES_MANAGER','READ_ONLY']){
    const client=db();
    await assert.rejects(createDemoCatalogSku(client,{...actor,role},'PM5-UPSDP',form(),'',false),/Administrator access required/);
    assert.equal(client.state.skus.length,1);
  }
});
