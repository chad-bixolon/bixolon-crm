// Read-only workbook and catalog audit. Never creates Accounts, catalog records, or prices.
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename);
const require=Module.createRequire(import.meta.url);
const {parseProductWorkbookXlsx}=require(path.join(root,'lib/odm-product-workbook.ts'));
const {planProductImport,normalizePartNumber}=require(path.join(root,'lib/product-import.ts'));
const workbookPath=path.resolve(root,'../reference-data/ODM customer pricing_Sep 2026.xlsx');
const db=new PrismaClient();
const active=item=>item.status==='NEEDS REVIEW' || item.status==='ERROR';
const reason=message=>message.startsWith('Customer-specific ODM needs')?'account':message.startsWith('New Product or SKU:')?'catalog':/price in Notes differs|New Price is unavailable|Customer pricing needs review: (?!Tariff Amount)/i.test(message)?'price':/tariff rate|Tariff Amount disagrees/i.test(message)?'tariff':'other';
const blockers=plan=>{
  const result={solelyCatalog:0,solelyPrice:0,solelyTariff:0,solelyAccount:0,otherOrMultiple:0,withCatalog:0,withPrice:0,withTariff:0,withAccount:0,withOther:0};
  for(const item of plan.items.filter(active)) {
    const kinds=new Set(item.messages.filter(message=>!message.startsWith('WARNING:')).map(reason));
    for(const kind of kinds) result[`with${kind[0].toUpperCase()}${kind.slice(1)}`]++;
    if(kinds.size===1 && kinds.has('catalog'))result.solelyCatalog++;
    else if(kinds.size===1 && kinds.has('price'))result.solelyPrice++;
    else if(kinds.size===1 && kinds.has('tariff'))result.solelyTariff++;
    else if(kinds.size===1 && kinds.has('account'))result.solelyAccount++;
    else result.otherOrMultiple++;
  }
  return result;
};
const status=plan=>({ready:plan.items.filter(item=>item.status==='READY').length,needsReview:plan.items.filter(item=>item.status==='NEEDS REVIEW').length,error:plan.items.filter(item=>item.status==='ERROR').length});
try {
  const workbook=await parseProductWorkbookXlsx(fs.existsSync(workbookPath)?fs.readFileSync(workbookPath):fs.readFileSync(0),undefined,'USD');
  if(!workbook.csv)throw new Error(workbook.error??'Could not parse workbook');
  const [initial,recommended,accounts,products]=await Promise.all([
    planProductImport(db,workbook.csv),
    planProductImport(db,workbook.csv,undefined,{applyRecommendations:true}),
    db.account.findMany({select:{id:true,name:true,status:true,archivedAt:true}}),
    db.product.findMany({select:{id:true,name:true,skus:{select:{id:true,partNumber:true,normalizedPartNumber:true,catalogSource:true}}}}),
  ]);
  const missing=recommended.customers.filter(customer=>customer.status==='Unresolved'&&!customer.accountId);
  const safe=missing.filter(customer=>!/->|\s[&/]\s|\([^)]*\)/.test(customer.source));
  const previewWithAccounts=async selected=>{
    const synthetic=selected.map((customer,index)=>({id:1000000+index,name:customer.source}));
    const wrapped={product:db.product,productCategory:db.productCategory,account:{findMany:async args=>[...await db.account.findMany(args),...synthetic]}};
    return planProductImport(wrapped,workbook.csv,undefined,{applyRecommendations:true});
  };
  const [safePlan,allPlan]=await Promise.all([previewWithAccounts(safe),previewWithAccounts(missing)]);
  const catalogProducts=await db.product.findMany({include:{category:true,skus:{include:{prices:true,odmCustomers:true}}}});
  const simulatedProducts=catalogProducts.map(product=>({...product,skus:[...product.skus]}));
  const byId=new Map(simulatedProducts.map(product=>[product.id,product]));
  const byName=new Map(simulatedProducts.map(product=>[product.name.trim().toLowerCase(),product]));
  let nextProductId=1000000,nextSkuId=1000000;
  const createdSkuKeys=new Set();
  for(const item of safePlan.items.filter(item=>item.catalogCreatable)) {
    const key=normalizePartNumber(item.after.partNumber);
    if(createdSkuKeys.has(key))continue;
    createdSkuKeys.add(key);
    let product=item.productId?byId.get(item.productId):byName.get(item.after.model.trim().toLowerCase());
    if(!product) {
      product={id:nextProductId++,name:item.after.model,archivedAt:null,category:item.after.category?{code:item.after.category}:null,skus:[]};
      simulatedProducts.push(product);byId.set(product.id,product);byName.set(product.name.trim().toLowerCase(),product);
    }
    product.skus.push({id:nextSkuId++,productId:product.id,partNumber:item.after.partNumber,normalizedPartNumber:key,description:item.after.description??null,priceUnit:item.after.priceUnit,active:item.after.active??true,catalogSource:'ODM',odmSubtype:item.after.odmSubtype,odmCustomerSourceName:item.after.odmCustomerSourceName??null,baseSkuId:item.after.baseSkuId??null,odmDescription:item.after.odmDescription??null,prices:[],odmCustomers:[]});
  }
  const syntheticAccounts=safe.map((customer,index)=>({id:1000000+index,name:customer.source}));
  const afterCatalog=await planProductImport({product:{findMany:async()=>simulatedProducts},productCategory:db.productCategory,account:{findMany:async args=>[...await db.account.findMany(args),...syntheticAccounts]}},workbook.csv,undefined,{applyRecommendations:true});
  const entries=recommended.items.filter(item=>item.source);
  const catalogSkus=new Set(entries.filter(item=>item.classes.includes('NEW SKU')).map(item=>normalizePartNumber(item.after.partNumber)));
  const existingSkus=products.flatMap(product=>product.skus.map(sku=>({product,sku})));
  const exact=entries.filter(item=>existingSkus.some(entry=>entry.sku.normalizedPartNumber===normalizePartNumber(item.after.partNumber)));
  const family=entries.filter(item=>{const key=normalizePartNumber(item.after.partNumber);const stem=key.includes('/')?key.slice(0,key.lastIndexOf('/')):key.replace(/-[A-Z]{2,4}\d*$/,'');return stem!==key&&existingSkus.some(entry=>entry.sku.normalizedPartNumber===stem&&entry.sku.catalogSource!=='ODM');});
  const sourceRows=new Set(entries.map(item=>`${item.source.sheet}:${item.line}`)).size;
  const report={workbook:workbookPath,sheet:workbook.selectedSheet,sourceRows,entries:entries.length,
    initial:status(initial),afterRecommendations:status(recommended),afterHypotheticalSafeAccounts:status(safePlan),afterHypotheticalAllMissingAccounts:status(allPlan),
    accountResolution:{missingUnique:missing.length,missingActiveEntries:missing.reduce((sum,customer)=>sum+customer.rows,0),safeCandidates:safe.length,compositeOrAnnotated:missing.filter(customer=>!safe.includes(customer)).map(customer=>customer.source),exactMatched:recommended.customers.filter(customer=>customer.status==='Matched').map(customer=>({source:customer.source,entries:customer.rows})),nearMatches:missing.flatMap(customer=>accounts.filter(account=>{const a=account.name.toLowerCase(),b=customer.source.toLowerCase();return a!==b&&a.length>=4&&(a.includes(b)||b.includes(a));}).map(account=>({source:customer.source,account:account.name})))},
    remainingAfterSafeAccounts:blockers(safePlan),remainingAfterAllMissingAccounts:blockers(allPlan),
    afterHypotheticalSafeCatalog:{status:status(afterCatalog),remaining:blockers(afterCatalog),safeProductsCreated:new Set(safePlan.items.filter(item=>item.catalogCreatable&&!item.productId).map(item=>item.after.model.trim().toLowerCase())).size,safeSkusCreated:createdSkuKeys.size,priceDecisions:afterCatalog.decisionGroups.filter(group=>group.kind==='PRICE').length,tariffDecisions:afterCatalog.decisionGroups.filter(group=>group.kind==='TARIFF').length,compositeAccounts:safePlan.customers.filter(customer=>customer.status==='Unresolved'&&/->|\s[&/]\s|\([^)]*\)/.test(customer.source)).length,otherExceptions:afterCatalog.items.filter(item=>active(item)&&item.messages.some(message=>!message.startsWith('WARNING:')&&reason(message)==='other')).map(item=>({row:item.line,sku:item.after.partNumber,messages:item.messages.filter(message=>!message.startsWith('WARNING:')&&reason(message)==='other')}))},
    catalog:{newProducts:new Set(entries.filter(item=>item.classes.includes('NEW PRODUCT')).map(item=>item.after.model.toLowerCase())).size,newSkus:catalogSkus.size,batchProducts:new Set(entries.filter(item=>item.catalogCreatable&&!item.productId).map(item=>item.after.model.toLowerCase())).size,batchSkus:new Set(entries.filter(item=>item.catalogCreatable).map(item=>normalizePartNumber(item.after.partNumber))).size,newSkusUnderExistingProduct:new Set(entries.filter(item=>item.classes.includes('NEW SKU')&&item.productId).map(item=>normalizePartNumber(item.after.partNumber))).size,exactExistingSkuEntries:exact.length,normalizationOnlyAliases:0,standardFamilyEntries:family.length,exactExamples:exact.map(item=>({row:item.line,sku:item.after.partNumber})),familyExamples:family.slice(0,5).map(item=>({row:item.line,sku:item.after.partNumber,product:item.after.model}))},
    price:{ambiguousEntries:recommended.decisionGroups.filter(group=>group.kind==='PRICE').reduce((sum,group)=>sum+group.reviewKeys.length,0),uniqueDecisions:recommended.decisionGroups.filter(group=>group.kind==='PRICE').length,groupedDecisions:recommended.decisionGroups.filter(group=>group.kind==='PRICE'&&group.reviewKeys.length>1).map(group=>({lines:group.lines,count:group.reviewKeys.length}))},
    tariff:{ambiguousEntries:recommended.decisionGroups.filter(group=>group.kind==='TARIFF').reduce((sum,group)=>sum+group.reviewKeys.length,0),uniqueDecisions:recommended.decisionGroups.filter(group=>group.kind==='TARIFF').length,groupedDecisions:recommended.decisionGroups.filter(group=>group.kind==='TARIFF'&&group.reviewKeys.length>1).map(group=>({lines:group.lines,count:group.reviewKeys.length}))},
    discontinued:entries.filter(item=>/\bdiscontinued\b/i.test(item.source.note)).length,productionWrites:false};
  console.log(JSON.stringify(report,null,2));
}finally{await db.$disconnect();}
