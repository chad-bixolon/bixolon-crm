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
const {Prisma}=require('@prisma/client');
const {planProductImport,applyProductImport,normalizePartNumber,productImportHeaders}=require(path.join(root,'lib/product-import.ts'));
const {productWhere,productHref,listProducts,productCategoryChoices}=require(path.join(root,'lib/products.ts'));
const {parseImportCsv}=require(path.join(root,'lib/import-csv.ts'));
const {routeAccess}=require(path.join(root,'lib/authorization.ts'));
const csv=(rows,header='model,part_number,description,standard_price,currency,active')=>`${header}\n${rows.join('\n')}\n`;
const sku=(id,productId,partNumber,price='10.00')=>({id,productId,partNumber,normalizedPartNumber:normalizePartNumber(partNumber),description:'Old',priceUnit:'EACH',active:true,prices:[{currencyCode:'USD',tier:'STANDARD',amount:new Prisma.Decimal(price)}]});
const product=(id,name,skus=[])=>({id,name,sku:skus[0]?.partNumber ?? 'LEGACY',active:true,archivedAt:null,skus});
const categories=['POS','LABEL','MOBILE','LASER','RIBBON','ACCESSORIES','PAPER','WARRANTY'].map(code=>({code,active:true}));
const db=(products=[],categoryRows=categories)=>({product:{findMany:async()=>products},productCategory:{findMany:async()=>categoryRows}});

test('catalog CSV parses quoted descriptions and validates headers',()=>{
  const parsed=parseImportCsv(csv(['SLP-DX220,DX220-STD,"Printer, standard",15,USD,true']),productImportHeaders);
  assert.deepEqual(parsed.errors,[]);assert.equal(parsed.rows[0].values.description,'Printer, standard');
  assert.match(parseImportCsv('part_number\nX',productImportHeaders).errors.join(' '),/model/);
});
test('normalization prevents duplicate and conflicting part numbers',async()=>{
  assert.equal(normalizePartNumber(' dx220  std '),'DX220 STD');
  const plan=await planProductImport(db(),csv(['SLP-DX220,DX220 STD,,,,','Other, dx220  std ,,,,']));
  assert.equal(plan.counts.errors,2);assert.match(plan.items[1].messages.join(' '),/Conflicting duplicate/);
  assert.equal((await planProductImport(db(),csv(['SLP-DX220,DX220 STD,,,,','SLP-DX220, dx220  std ,,,,']))).counts.errors,2);
});
test('new Product and second SKU map to one model',async()=>{
  const plan=await planProductImport(db(),csv(['SLP-DX220,DX220-STD,Standard,10,USD,true','SLP-DX220,DX220-PW,PrepWizard,12,USD,true']));
  assert.equal(plan.counts.newProducts,1);assert.equal(plan.counts.newSkus,2);assert.equal(plan.counts.priceChanges,2);
  assert.deepEqual(plan.items[0].classes,['NEW PRODUCT','NEW SKU','PRICE CHANGE']);
  assert.deepEqual(plan.items[1].classes,['NEW SKU','PRICE CHANGE']);
});
test('existing SKU changes and blank price preservation',async()=>{
  const old=product(1,'SLP-DX220',[sku(2,1,'DX220-STD')]);
  const changed=await planProductImport(db([old]),csv(['SLP-DX220, dx220-std ,New,12,USD,false']));
  assert.equal(changed.items[0].skuId,2);assert.equal(changed.counts.newSkus,0);assert.equal(changed.counts.updatedSkus,1);assert.equal(changed.counts.priceChanges,1);
  const blank=await planProductImport(db([old]),csv(['SLP-DX220,DX220-STD,,,,']));
  assert.equal(blank.items[0].after.standardPrice,'10.00');assert.equal(blank.counts.priceChanges,0);assert.equal(blank.counts.unchanged,1);
});
test('invalid price, currency, and ambiguous Product mapping block preview',async()=>{
  const bad=await planProductImport(db(),csv(['SLP-DX220,X,,−2,USD,','SLP-DX220,Y,,2,ZZZ,','SLP-DX220,Z,,2,,']));
  assert.equal(bad.counts.errors,3);
  const ambiguous=await planProductImport(db([product(1,'SLP-DX220'),product(2,' slp-dx220 ')]),csv(['SLP-DX220,X,,,,']));
  assert.match(ambiguous.items[0].messages.join(' '),/Ambiguous Product/);
  assert.equal(routeAccess('/administration/imports/products',{id:2,role:'SALES',active:true}),'denied');
});
test('confirmation refuses stale plan and rolls back a failed second SKU',async()=>{
  const input=csv(['SLP-DX220,DX220-STD,,10,USD,','SLP-DX220,DX220-PW,,12,USD,']);
  const store=db();let committed=[];
  store.$transaction=async callback=>{
    const staged=[];let next=1;
    const tx={product:{findMany:async()=>[],create:async({data})=>{const row={id:next++,...data};staged.push(row);return row;}},productCategory:{findMany:async()=>categories},productSku:{create:async({data})=>{if(data.partNumber==='DX220-PW')throw new Error('constraint');return {id:next++,...data};}},productPrice:{upsert:async()=>({})}};
    const result=await callback(tx);committed=staged;return result;
  };
  await assert.rejects(applyProductImport(store,input,'wrong'),/Preview changed/);
  const plan=await planProductImport(store,input);
  await assert.rejects(applyProductImport(store,input,plan.digest),/constraint/);
  assert.deepEqual(committed,[]);
});
test('price tiers are distinct and blank STANDARD does not replace the base price',async()=>{
  const existing=product(1,'SLP-DX220',[sku(2,1,'DX220-STD')]);
  const input='model,part_number,standard_price,msrp_price,reseller_price,distributor_price,currency,price_unit\nSLP-DX220,DX220-STD,,20,15,12,USD,CASE\n';
  const plan=await planProductImport(db([existing]),input);
  assert.equal(plan.items[0].before.standardPrice,'10.00');
  assert.equal(plan.items[0].after.standardPrice,'10.00');
  assert.equal(plan.items[0].after.msrpPrice,'20.00');
  assert.equal(plan.items[0].after.resellerPrice,'15.00');
  assert.equal(plan.items[0].after.distributorPrice,'12.00');
  assert.equal(plan.items[0].after.priceUnit,'CASE');
  assert.equal(plan.counts.priceChanges,1);
});
test('confirmation writes only supplied tiers and preserves existing STANDARD',async()=>{
  const existing=product(1,'SLP-DX220',[sku(2,1,'DX220-STD')]);
  const input='model,part_number,standard_price,msrp_price,reseller_price,distributor_price,currency\nSLP-DX220,DX220-STD,,20,15,12,USD\n';
  const calls=[];
  const client=db([existing]);
  client.$transaction=async callback=>callback({...client,productPrice:{upsert:async value=>{calls.push(value);return value;}}});
  const preview=await planProductImport(client,input);
  await applyProductImport(client,input,preview.digest);
  assert.deepEqual(calls.map(call=>call.create.tier),['MSRP','RESELLER','DISTRIBUTOR']);
  assert.ok(calls.every(call=>call.create.currencyCode==='USD'));
});
test('classification is optional for legacy imports and validates explicit list fields',async()=>{
  const legacy=await planProductImport(db(),csv(['Model,SKU,,,,']));
  assert.equal(legacy.items[0].after.category,undefined);
  assert.equal(legacy.items[0].after.catalogSource,undefined);
  const input='model,part_number,category,catalog_source\nModel,SKU,LABEL,PE_LIST\n';
  const plan=await planProductImport(db(),input);
  assert.equal(plan.counts.errors,0);
  assert.equal(plan.items[0].after.category,'LABEL');
  assert.equal(plan.items[0].after.catalogSource,'PE_LIST');
  const bad=await planProductImport(db(),'model,part_number,category,catalog_source\nModel,SKU,UNKNOWN,OTHER\n');
  assert.equal(bad.counts.errors,1);
  assert.match(bad.items[0].messages.join(' '),/Category must be/);
  assert.match(bad.items[0].messages.join(' '),/Catalog source must be/);
  const inactive=await planProductImport(db([],[{code:'LABEL',active:false}]),input);
  assert.equal(inactive.counts.errors,1);
  assert.match(inactive.items[0].messages.join(' '),/active Product Category code/);
  const selected=await planProductImport(db(),csv(['Model,SKU,,,,']),'PE_LIST');
  assert.equal(selected.items[0].after.catalogSource,'PE_LIST');
  const conflict=await planProductImport(db(),input,'SPECIAL_SKU_LIST');
  assert.equal(conflict.counts.errors,1);
  assert.match(conflict.items[0].messages.join(' '),/differs from the selected/);
});
test('confirmation writes category to Product and source to SKU',async()=>{
  const input='model,part_number,category,catalog_source\nModel,SKU,POS,SPECIAL_SKU_LIST\n';
  const writes=[];
  const client=db();
  client.$transaction=async callback=>callback({product:{findMany:async()=>[],create:async({data})=>{writes.push(['product',data]);return {id:1};}},productCategory:{findMany:async()=>categories},productSku:{create:async({data})=>{writes.push(['sku',data]);return {id:2};}},productPrice:{upsert:async()=>{}}});
  const plan=await planProductImport(client,input);
  await applyProductImport(client,input,plan.digest);
  assert.deepEqual(writes[0][1].category,{connect:{code:'POS'}});
  assert.equal(writes[1][1].catalogSource,'SPECIAL_SKU_LIST');
});
test('Products filters combine search, status, category, and SKU source',async()=>{
  assert.deepEqual(productWhere({q:'  DX  ',active:'active',category:'POS',catalogSource:'PRICE_LIST'}),{
    OR:[{name:{contains:'DX',mode:'insensitive'}},{sku:{contains:'DX',mode:'insensitive'}}],
    active:true,archivedAt:null,category:{code:'POS'},skus:{some:{catalogSource:'PRICE_LIST'}},
  });
  assert.deepEqual(productWhere({category:'BOGUS',catalogSource:'BOGUS'}),{category:{code:'BOGUS'}});
  let countWhere,rowsQuery;
  const client={product:{count:async({where})=>{countWhere=where;return 21;},findMany:async args=>{rowsQuery=args;return [];}}};
  const result=await listProducts(client,{category:'POS',catalogSource:'PE_LIST',page:'2'});
  assert.equal(result.page,2);assert.equal(result.pages,2);
  assert.deepEqual(countWhere,{category:{code:'POS'},skus:{some:{catalogSource:'PE_LIST'}}});
  assert.deepEqual(rowsQuery.where,countWhere);assert.equal(rowsQuery.skip,20);
});
test('category choices include active and linked inactive values in configured order',async()=>{
  let args;
  await productCategoryChoices({productCategory:{findMany:async value=>{args=value;return [];}}});
  assert.deepEqual(args.where,{OR:[{active:true},{products:{some:{}}}]});
  assert.deepEqual(args.orderBy,[{sortOrder:'asc'},{name:'asc'}]);
});
test('Products pagination URL retains filters and filter forms reset the page',()=>{
  const filters={q:'DX & Co',active:'inactive',category:'MOBILE',catalogSource:'SPECIAL_SKU_LIST',page:'3'};
  const next=new URL(productHref(filters,4),'http://localhost');
  for(const key of ['q','active','category','catalogSource'])assert.equal(next.searchParams.get(key),filters[key]);
  assert.equal(next.searchParams.get('page'),'4');
  assert.equal(new URL(productHref(filters),'http://localhost').searchParams.get('page'),null);
});
