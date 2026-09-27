import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename);
const require=Module.createRequire(import.meta.url);
const {Prisma}=require('@prisma/client');
const {planProductImport,applyProductImport}=require(path.join(root,'lib/product-import.ts'));
const sourceHeaders='model,part_number,catalog_source,odm_customer,odm_source_format,odm_source_workbook,odm_source_sheet,odm_source_row,odm_source_part_index,odm_source_part_count,odm_source_customer_cell,odm_source_part_number,odm_source_old_price,odm_source_prior_price,odm_source_new_price,odm_source_tariff_percent,odm_source_tariff_amount,odm_source_note';
const row=(sku,account,price,line=3)=>`Model,${sku},ODM,${account},ODM_CUSTOMER_PRICING,Gary.xlsx,Sheet,${line},1,1,${account},${sku},,,${price},,,`;
const input=(...rows)=>`${sourceHeaders}\n${rows.join('\n')}\n`;
function fixture({classification='PRICE_LIST',links=[],accounts=['Proax','NCR']}={}) {
  const sku={id:2,productId:1,partNumber:'SRP-275IIIAOSG',normalizedPartNumber:'SRP-275IIIAOSG',description:null,catalogSource:classification,odmSubtype:classification==='ODM'?'SPECIAL_CONFIGURATION':null,odmCustomerSourceName:null,baseSkuId:null,odmDescription:null,priceUnit:'EACH',active:true,prices:[],odmCustomers:links};
  const product={id:1,name:'Model',sku:'SRP-275IIIAOSG',archivedAt:null,category:null,skus:[sku]};
  const accountRows=accounts.map((name,i)=>({id:i+7,name}));
  const revisions=[];const evidence=new Set();let next=1;
  const db={product:{findMany:async()=>[product]},productCategory:{findMany:async()=>[]},account:{findMany:async()=>accountRows},productSku:{update:async()=>{throw Error('existing standard SKU must not be modified')}},productSkuOdmCustomer:{findUnique:async({where})=>links.find(link=>link.accountId===where.skuId_accountId.accountId)??null,upsert:async({where,create})=>{let link=links.find(link=>link.accountId===where.skuId_accountId.accountId);if(!link){link={...create,archivedAt:null};links.push(link);}return link;}},productSkuOdmCustomerPrice:{findMany:async()=>revisions.filter(p=>!p.archivedAt),findFirst:async({where})=>revisions.find(p=>p.skuId===where.skuId&&p.accountId===where.accountId&&!p.archivedAt)??null,update:async({where,data})=>{const p=revisions.find(p=>p.id===where.id);Object.assign(p,data);return p;},create:async({data})=>{const p={id:next++,...data,customerPrice:new Prisma.Decimal(data.customerPrice),tariffPercent:new Prisma.Decimal(data.tariffPercent),tariffAmount:new Prisma.Decimal(data.tariffAmount),archivedAt:null};revisions.push(p);return p;}},odmPricingImportSource:{findMany:async({where})=>where.sourceKey.in.filter(key=>evidence.has(key)).map(sourceKey=>({sourceKey})),upsert:async({where})=>{evidence.add(where.sourceKey);}},$transaction:async fn=>fn(db)};
  return {db,sku,links,revisions,evidence};
}
const review={applyRecommendations:true};

test('standard SKU receives negotiated Account prices without changing its catalog record',async()=>{
  const f=fixture();const csv=input(row('SRP-275IIIAOSG','Proax','150.65'),row('SRP-275IIIAOSG','NCR','140.00',4));
  const plan=await planProductImport(f.db,csv,undefined,review);
  assert.deepEqual(plan.items.map(item=>item.after.catalogSource),['PRICE_LIST','PRICE_LIST']);
  assert.ok(plan.items.every(item=>!item.after.odmSubtype&&!item.after.baseSkuId&&!item.messages.some(message=>message.includes('ODM subtype'))));
  assert.deepEqual(plan.items.map(item=>item.priceComparison?.kind),['NEW','NEW']);
  await applyProductImport(f.db,csv,plan.digest,undefined,review);
  assert.equal(f.sku.catalogSource,'PRICE_LIST');assert.equal(f.links.length,2);assert.deepEqual(f.revisions.map(p=>p.customerPrice.toFixed(2)),['150.65','140.00']);
  assert.ok(f.revisions.every(p=>p.sourceType==='GARY_WORKBOOK'&&p.sourceMetadata.workbook==='Gary.xlsx'));
  const again=await planProductImport(f.db,csv,undefined,review);
  assert.deepEqual(again.items.map(item=>item.status),['ALREADY IMPORTED','ALREADY IMPORTED']);
  await applyProductImport(f.db,csv,again.digest,undefined,review);
  assert.equal(f.revisions.length,2);
});

test('a changed Account price needs confirmation and retains the previous revision and provenance',async()=>{
  const f=fixture();const first=input(row('SRP-275IIIAOSG','Proax','150.65'));
  let plan=await planProductImport(f.db,first,undefined,review);await applyProductImport(f.db,first,plan.digest,undefined,review);
  const changed=input(row('SRP-275IIIAOSG','Proax','160.65'));
  plan=await planProductImport(f.db,changed,undefined,review);
  assert.equal(plan.items[0].status,'NEEDS REVIEW');assert.equal(plan.items[0].priceComparison.kind,'CHANGED');
  assert.match(plan.items[0].priceComparison.before,/150.65/);assert.match(plan.items[0].priceComparison.after,/160.65/);
  await applyProductImport(f.db,changed,plan.digest,undefined,review);
  assert.equal(f.revisions.length,1);
  const confirmed={...review,priceRevisions:{'3:1':plan.items[0].priceComparison.confirmationKey}};
  const ready=await planProductImport(f.db,changed,undefined,confirmed);
  assert.equal(ready.items[0].status,'READY');
  await applyProductImport(f.db,changed,ready.digest,undefined,confirmed);
  assert.equal(f.revisions.length,2);assert.ok(f.revisions[0].archivedAt);assert.equal(f.revisions[1].customerPrice.toFixed(2),'160.65');
  assert.equal(f.revisions[0].sourceMetadata.newPrice,'150.65');assert.equal(f.revisions[1].sourceMetadata.newPrice,'160.65');
});

test('standard to ODM conversion is explicit; existing ODM and Special Configuration retain Account pricing',async()=>{
  const standard=fixture();const csv=input(row('SRP-275IIIAOSG','Proax','150.65'));
  const ordinary=await planProductImport(standard.db,csv,undefined,review);
  assert.equal(ordinary.items[0].after.catalogSource,'PRICE_LIST');
  const conversion=await planProductImport(standard.db,csv,undefined,{...review,reclassifications:{'SRP-275IIIAOSG':'CONFIRM'},subtypes:{'SRP-275IIIAOSG':'SPECIAL_CONFIGURATION'}});
  assert.equal(conversion.items[0].after.catalogSource,'ODM');assert.equal(conversion.items[0].after.odmSubtype,'SPECIAL_CONFIGURATION');
  const odm=fixture({classification:'ODM'});
  const existing=await planProductImport(odm.db,csv,undefined,review);
  assert.equal(existing.items[0].after.catalogSource,'ODM');assert.equal(existing.items[0].after.odmSubtype,'SPECIAL_CONFIGURATION');
  const noAccount=await planProductImport(odm.db,input(row('SRP-275IIIAOSG','','150.65')),undefined,review);
  assert.equal(noAccount.items[0].after.odmSubtype,'SPECIAL_CONFIGURATION');assert.ok(!noAccount.items[0].messages.some(message=>message.includes('Customer-specific ODM needs')));
  const specific=fixture({classification:'ODM'});specific.sku.odmSubtype='CUSTOMER_SPECIFIC';
  const missing=await planProductImport(specific.db,input(row('SRP-275IIIAOSG','','150.65')),undefined,review);
  assert.match(missing.items[0].messages.join(' '),/Customer-specific ODM needs an existing SalesHub Account/);
});
