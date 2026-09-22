// Read-only workbook and catalog preview. Never calls applyProductImport.
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
const {calculateOdmCustomerPrice}=require(path.join(root,'lib/odm-customer-pricing.ts'));
const workbookPath=path.resolve(root,'../reference-data/ODM customer pricing_Sep 2026.xlsx');
const db=new PrismaClient();
try {
  const workbook=await parseProductWorkbookXlsx(fs.existsSync(workbookPath)?fs.readFileSync(workbookPath):fs.readFileSync(0),undefined,'USD');
  if(!workbook.csv)throw new Error(workbook.error??'Could not parse workbook');
  const raw=await planProductImport(db,workbook.csv);
  // This is a scenario preview: a source customer suggests Customer-Specific,
  // while existing SKU classification wins. No classifications are saved.
  const subtypes=Object.fromEntries(raw.items.map(item=>[normalizePartNumber(item.after.partNumber),item.after.odmSubtype??(item.source?.customerCell?'CUSTOMER_SPECIFIC':'OTHER')]));
  const reviewed=await planProductImport(db,workbook.csv,undefined,{subtypes});
  const items=reviewed.items.filter(item=>item.source);
  const rows=filter=>new Set(items.filter(filter).map(item=>`${item.source.sheet}:${item.line}`)).size;
  const repeated=new Map();
  const skuCustomers=new Map();
  const rawMath=new Map();
  for(const item of items){
    const sku=normalizePartNumber(item.after.partNumber), customer=item.after.odmCustomerAccountId??item.source.customerCell.toLowerCase();
    const key=`${sku}:${customer}`;repeated.set(key,(repeated.get(key)??0)+1);
    if(!skuCustomers.has(sku))skuCustomers.set(sku,new Set());skuCustomers.get(sku).add(customer);
    const rowKey=`${item.source.sheet}:${item.line}`;
    if(!rawMath.has(rowKey))try{const price=calculateOdmCustomerPrice({customerPrice:item.source.newPrice,previousPrice:item.source.oldPrice||item.source.priorPrice,tariffPercent:item.source.tariffPercent,tariffAmount:item.source.tariffAmount,currencyCode:'USD'});rawMath.set(rowKey,{final:price.finalUnitPrice});}catch(error){rawMath.set(rowKey,{error:error instanceof Error?error.message:'Invalid pricing'});}
  }
  console.log(JSON.stringify({workbook:workbookPath,selectedSheet:workbook.selectedSheet,classificationAssumption:'Existing SKU subtype where known; otherwise source rows with a customer are previewed as Customer-Specific. No import or classification changes.',candidateRows:rows(()=>true),candidateSkuEntries:items.length,validCustomerSpecificPricingRows:rows(item=>!!item.odmPricing&&!item.classes.includes('ERROR')),parsedPreviousPriceRows:rows(item=>!!(item.source.oldPrice||item.source.priorPrice)&&item.source.oldPrice!=='-'&&item.source.priorPrice!=='-'),parsedCurrentPriceRows:rows(item=>!!item.source.newPrice&&item.source.newPrice!=='-'),tariffPercentRows:rows(item=>!!item.source.tariffPercent&&item.source.tariffPercent!=='-'),tariffAmountRows:rows(item=>!!item.source.tariffAmount&&item.source.tariffAmount!=='-'),calculatedFinalPriceRows:[...rawMath.values()].filter(value=>value.final).length,inconsistentTariffMathRows:[...rawMath.values()].filter(value=>value.error?.includes('Tariff Amount disagrees')).length,blankNewPriceRows:rows(item=>!item.source.newPrice),dashPricingRows:rows(item=>[item.source.oldPrice,item.source.priorPrice,item.source.newPrice,item.source.tariffPercent,item.source.tariffAmount].includes('-')),discontinuedRows:rows(item=>/\bdiscontinued\b/i.test(item.source.note)),repeatedSkuCustomerPricingCases:[...repeated.values()].filter(count=>count>1).length,repeatedSkuDifferentCustomerCases:[...skuCustomers.values()].filter(customers=>customers.size>1).length,unresolvedCustomerSpecificPricingRows:rows(item=>item.after.odmSubtype==='CUSTOMER_SPECIFIC'&&!item.after.odmCustomerAccountId&&!!item.source.newPrice),reviewErrors:reviewed.counts.errors,pricingErrorExamples:[...new Set([...rawMath.values()].map(value=>value.error).filter(Boolean))].slice(0,8),importApplied:false},null,2));
}finally{await db.$disconnect();}
