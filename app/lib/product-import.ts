import { Prisma, ProductCatalogSource, ProductPriceTier, ProductPriceUnit, type PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { parseImportCsv } from './import-csv';

export const productImportHeaders = ['model','part_number','description','standard_price','msrp_price','reseller_price','distributor_price','currency','price_unit','active','category','catalog_source','odm_customer','base_sku','odm_description'] as const;
export const productImportTemplate = productImportHeaders.join(',') + '\n';
export const normalizePartNumber = (value:string) => value.trim().replace(/\s+/g,' ').toUpperCase();
export const normalizeAccountName = (value:string) => value.trim().replace(/\s+/g,' ').toLocaleLowerCase();
const normalizeModel = (value:string) => value.trim().replace(/\s+/g,' ').toLowerCase();
const currencies = new Set(Intl.supportedValuesOf('currency'));
type Db = PrismaClient | Prisma.TransactionClient;
type Values = {model:string;partNumber:string;description?:string;standardPrice?:string;msrpPrice?:string;resellerPrice?:string;distributorPrice?:string;currency?:string;priceUnit?:ProductPriceUnit;active?:boolean;category?:string;catalogSource?:ProductCatalogSource;odmCustomerAccountId?:number;odmCustomerSourceName?:string;odmCustomer?:string;baseSkuId?:number;baseSku?:string;odmDescription?:string};
const tierFields = [
  {header:'standard_price',field:'standardPrice',tier:ProductPriceTier.STANDARD},
  {header:'msrp_price',field:'msrpPrice',tier:ProductPriceTier.MSRP},
  {header:'reseller_price',field:'resellerPrice',tier:ProductPriceTier.RESELLER},
  {header:'distributor_price',field:'distributorPrice',tier:ProductPriceTier.DISTRIBUTOR},
] as const;
export type ProductImportItem = {line:number;label:string;classes:string[];before:Values|null;after:Values;messages:string[];productId?:number;skuId?:number};
export type ProductImportCounts = {newProducts:number;updatedProducts:number;newSkus:number;updatedSkus:number;priceChanges:number;unchanged:number;warnings:number;errors:number};
export type ProductImportPlan = {items:ProductImportItem[];errors:string[];counts:ProductImportCounts;digest:string};
const blankCounts = ():ProductImportCounts => ({newProducts:0,updatedProducts:0,newSkus:0,updatedSkus:0,priceChanges:0,unchanged:0,warnings:0,errors:0});
const digestOf = (items:ProductImportItem[]) => createHash('sha256').update(JSON.stringify(items)).digest('hex');
const validPrice = (value:string) => /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value);
const bool = (value:string) => /^(true|yes|1)$/i.test(value) ? true : /^(false|no|0)$/i.test(value) ? false : undefined;

export async function planProductImport(db:Db,csv:string,selectedSource?:ProductCatalogSource):Promise<ProductImportPlan> {
  const parsed = parseImportCsv(csv,productImportHeaders);
  const counts = blankCounts();
  if (parsed.errors.length) return {items:[],errors:parsed.errors,counts:{...counts,errors:parsed.errors.length},digest:''};
  const products = await db.product.findMany({include:{category:true,skus:{include:{prices:true}}}});
  const accounts = await db.account.findMany({select:{id:true,name:true}});
  const categoryRows = await db.productCategory.findMany({select:{code:true,active:true}});
  const activeCategories = new Set(categoryRows.filter(category=>category.active).map(category=>category.code));
  const allSkus = products.flatMap(product => product.skus.map(sku => ({product,sku})));
  const seen = new Map<string,ProductImportItem>();
  const proposedModels = new Set<string>();
  const modelCategories = new Map<string,string>();
  const items:ProductImportItem[] = [];
  for (const row of parsed.rows) {
    const get = (key:string) => (row.values as Record<string,string>)[key]?.trim() ?? '';
    const model=get('model'), partNumber=get('part_number'), key=normalizePartNumber(partNumber), modelKey=normalizeModel(model);
    const currencyText=get('currency'), activeText=get('active'), unitText=get('price_unit').toUpperCase();
    const categoryText=get('category'), sourceText=(get('catalog_source') || selectedSource || '').toUpperCase();
    const category=activeCategories.has(categoryText) ? categoryText : undefined;
    const catalogSource=Object.values(ProductCatalogSource).includes(sourceText as ProductCatalogSource) ? sourceText as ProductCatalogSource : undefined;
    const messages:string[]=[];
    if (!model) messages.push('Product/model is required.');
    if (!partNumber) messages.push('Part number is required.');
    if (model.length>200) messages.push('Model exceeds 200 characters.');
    if (partNumber.length>100) messages.push('Part number exceeds 100 characters.');
    if (get('description').length>2000) messages.push('Description exceeds 2000 characters.');
    if (categoryText && !category) messages.push('Category must be an active Product Category code.');
    if (sourceText && !catalogSource) messages.push('Catalog source must be PRICE_LIST, PE_LIST, SPECIAL_SKU_LIST, or ODM.');
    if ((get('odm_customer') || get('base_sku') || get('odm_description')) && catalogSource !== 'ODM') messages.push('ODM metadata requires explicit Catalog Source ODM.');
    if (get('odm_description').length > 2000) messages.push('ODM Description exceeds 2000 characters.');
    if (selectedSource && get('catalog_source') && get('catalog_source').toUpperCase()!==selectedSource) messages.push('Catalog source differs from the selected upload source.');
    if (category && modelCategories.has(modelKey) && modelCategories.get(modelKey)!==category) messages.push('Conflicting categories for the same Product/model in this import.');
    if (category && modelKey) modelCategories.set(modelKey,category);
    for (const spec of tierFields) if (get(spec.header) && !validPrice(get(spec.header))) messages.push(`${spec.header} must be a nonnegative number with up to two decimal places and at most ten whole digits.`);
    const currency=currencyText.toUpperCase();
    if (currencyText && (!/^[A-Z]{3}$/.test(currency) || !currencies.has(currency))) messages.push('Currency must be a valid ISO 4217 code.');
    if (tierFields.some(spec=>get(spec.header)) && !currencyText) messages.push('Currency is required when a price is present.');
    if (unitText && !Object.values(ProductPriceUnit).includes(unitText as ProductPriceUnit)) messages.push('Price unit must be EACH, CASE, BOX, or ROLL.');
    const active=activeText ? bool(activeText) : undefined;
    if (activeText && active===undefined) messages.push('Active must be true or false.');
    const prior=seen.get(key);
    if (key && prior) {
      const conflict=normalizeModel(prior.after.model)!==modelKey;
      messages.push(conflict ? `Conflicting duplicate part number (line ${prior.line}) maps to a different model.` : `Duplicate part number in import (line ${prior.line}).`);
      prior.messages.push(conflict ? `Conflicting duplicate part number on line ${row.line}.` : `Duplicate part number on line ${row.line}.`);
      prior.classes=['ERROR'];
    }
    const skuMatches=allSkus.filter(entry=>entry.sku.normalizedPartNumber===key);
    if (skuMatches.length>1) messages.push('Ambiguous SKU mapping in catalog.');
    const skuMatch=skuMatches.length===1 ? skuMatches[0] : undefined;
    const modelMatches=products.filter(product=>normalizeModel(product.name)===modelKey);
    if (modelMatches.length>1) messages.push('Ambiguous Product mapping: multiple Products have this model.');
    const modelMatch=modelMatches.length===1 ? modelMatches[0] : undefined;
    if (skuMatch && modelMatch && skuMatch.product.id!==modelMatch.id) messages.push('Part number and model identify different Products.');
    if (skuMatch && skuMatch.product.archivedAt) messages.push('Matched Product is archived.');
    if (modelMatch?.archivedAt) messages.push('Matched Product is archived.');
    if (skuMatch && normalizeModel(skuMatch.product.name)!==modelKey && skuMatch.product.skus.length>1) messages.push('Changing a model shared by multiple SKUs is ambiguous. Review the Product manually.');
    const product=skuMatch?.product ?? modelMatch;
    const sku=skuMatch?.sku;
    if (catalogSource === 'ODM' && sku && allSkus.some(entry=>entry.sku.baseSkuId===sku.id)) messages.push('An ODM SKU cannot be used as a Base SKU.');
    const existingCurrency=currency || (sku && new Set(sku.prices.map(p=>p.currencyCode)).size===1 ? sku.prices[0]?.currencyCode : undefined);
    const oldPrices=sku?.prices.filter(p=>p.currencyCode===existingCurrency) ?? [];
    const before:Values|null=sku ? {model:skuMatch!.product.name,partNumber:sku.partNumber,description:sku.description ?? undefined,currency:existingCurrency,priceUnit:sku.priceUnit,active:sku.active,category:skuMatch!.product.category?.code,catalogSource:sku.catalogSource ?? undefined,odmCustomerAccountId:sku.odmCustomerAccountId??undefined,odmCustomerSourceName:sku.odmCustomerSourceName??undefined,baseSkuId:sku.baseSkuId??undefined,odmDescription:sku.odmDescription??undefined} : null;
    const after:Values={model,partNumber,description:get('description') || before?.description,currency:currency || before?.currency,priceUnit:unitText && Object.values(ProductPriceUnit).includes(unitText as ProductPriceUnit) ? unitText as ProductPriceUnit : before?.priceUnit ?? ProductPriceUnit.EACH,active:active ?? before?.active ?? true,category:category ?? product?.category?.code,catalogSource:catalogSource ?? before?.catalogSource};
    if (after.catalogSource === 'ODM') {
      const customer = get('odm_customer');
      const matches = customer ? accounts.filter(account=>normalizeAccountName(account.name)===normalizeAccountName(customer)) : [];
      if (customer) { after.odmCustomer=customer; after.odmCustomerAccountId=matches.length===1?matches[0].id:undefined; after.odmCustomerSourceName=matches.length===1?undefined:customer; if(matches.length!==1) messages.push('WARNING: ODM Customer has no unique Account match and will remain unresolved.'); }
      else { after.odmCustomerAccountId=before?.odmCustomerAccountId; after.odmCustomerSourceName=before?.odmCustomerSourceName; }
      const base=get('base_sku');
      if (base) {
        const match=allSkus.find(entry=>entry.sku.normalizedPartNumber===normalizePartNumber(base));
        if (!match) messages.push('Base SKU must match an existing part number.');
        else if (match.sku.id===sku?.id || match.sku.catalogSource==='ODM') messages.push('Base SKU must be a different, non-ODM SKU.');
        else {after.baseSkuId=match.sku.id;after.baseSku=match.sku.partNumber;}
      } else after.baseSkuId=before?.baseSkuId;
      after.odmDescription=get('odm_description')||before?.odmDescription;
    }
    for (const spec of tierFields) {
      const old=oldPrices.find(price=>price.tier===spec.tier);
      if (before) before[spec.field]=old?.amount.toFixed(2);
      const input=get(spec.header);
      after[spec.field]=input && validPrice(input) ? new Prisma.Decimal(input).toFixed(2) : before?.[spec.field];
    }
    const classes:string[]=[];
    if (!product && !proposedModels.has(modelKey)) classes.push('NEW PRODUCT');
    if (!sku) classes.push('NEW SKU');
    if (product && (product.name!==model || (category && product.category?.code!==category))) classes.push('UPDATE PRODUCT');
    if (sku && (sku.partNumber!==partNumber || (get('description') && sku.description!==get('description')) || (active!==undefined && sku.active!==active) || (unitText && sku.priceUnit!==unitText) || (catalogSource && sku.catalogSource!==catalogSource) || (sku.odmCustomerAccountId??null)!==(after.odmCustomerAccountId??null) || (sku.odmCustomerSourceName??null)!==(after.odmCustomerSourceName??null) || (sku.baseSkuId??null)!==(after.baseSkuId??null) || (sku.odmDescription??null)!==(after.odmDescription??null))) classes.push('UPDATE SKU');
    if (tierFields.some(spec=>get(spec.header) && validPrice(get(spec.header)) && !oldPrices.find(price=>price.tier===spec.tier)?.amount.equals(get(spec.header)))) classes.push('PRICE CHANGE');
    if (!classes.length) classes.push('UNCHANGED');
    const hasError=messages.length>0;
    if (!sku && !get('standard_price')) {classes.push('WARNING');messages.push('WARNING: No STANDARD/base price supplied for this new SKU. Other tiers remain separate.');}
    if (messages.some(message=>message.startsWith('WARNING:')) && !classes.includes('WARNING')) classes.push('WARNING');
    if (hasError && messages.some(message=>!message.startsWith('WARNING:'))) classes.splice(0,classes.length,'ERROR');
    const item:ProductImportItem={line:row.line,label:partNumber || '(missing part number)',classes,before,after,messages,productId:product?.id,skuId:sku?.id};
    items.push(item);
    if (key) seen.set(key,item);
    if (modelKey) proposedModels.add(modelKey);
  }
  const importedOdmIds = new Set(items.filter(item=>item.skuId && item.after.catalogSource==='ODM').map(item=>item.skuId));
  for (const item of items) if (item.after.baseSkuId && importedOdmIds.has(item.after.baseSkuId)) {
    item.messages.push('Base SKU is classified ODM in this import. ODM chains are not allowed.');
    item.classes=['ERROR'];
  }
  const productUpdates=new Set<number>();
  for (const item of items) {
    if (item.classes.includes('ERROR')) {counts.errors++;continue;}
    if (item.classes.includes('WARNING')) counts.warnings++;
    if (item.classes.includes('NEW PRODUCT')) counts.newProducts++;
    if (item.classes.includes('UPDATE PRODUCT') && item.productId) productUpdates.add(item.productId);
    if (item.classes.includes('NEW SKU')) counts.newSkus++;
    if (item.classes.includes('UPDATE SKU')) counts.updatedSkus++;
    if (item.classes.includes('PRICE CHANGE')) counts.priceChanges++;
    if (item.classes.includes('UNCHANGED')) counts.unchanged++;
  }
  counts.updatedProducts=productUpdates.size;
  return {items,errors:[],counts,digest:digestOf(items)};
}

export async function applyProductImport(db:PrismaClient,csv:string,expectedDigest:string,selectedSource?:ProductCatalogSource) {
  return db.$transaction(async tx=>{
    const plan=await planProductImport(tx,csv,selectedSource);
    if (!expectedDigest || plan.digest!==expectedDigest || plan.errors.length || plan.counts.errors) throw new Error('Preview changed or contains errors. Preview the file again before confirming.');
    const created=new Map<string,number>();
    for (const item of plan.items) {
      const value=item.after;
      const modelKey=normalizeModel(value.model);
      let productId=item.productId ?? created.get(modelKey);
      if (!productId) {
        const product=await tx.product.create({data:{name:value.model,sku:value.partNumber,active:value.active ?? true,category:value.category ? {connect:{code:value.category}} : undefined}});
        productId=product.id;created.set(modelKey,productId);
      } else if (item.classes.includes('UPDATE PRODUCT') || (created.has(modelKey) && value.category)) await tx.product.update({where:{id:productId},data:{name:value.model,category:value.category ? {connect:{code:value.category}} : undefined}});
      let skuId=item.skuId;
      if (!skuId) {
        const sku=await tx.productSku.create({data:{productId,partNumber:value.partNumber,normalizedPartNumber:normalizePartNumber(value.partNumber),description:value.description,priceUnit:value.priceUnit ?? ProductPriceUnit.EACH,active:value.active ?? true,catalogSource:value.catalogSource,odmCustomerAccountId:value.odmCustomerAccountId,odmCustomerSourceName:value.odmCustomerSourceName,baseSkuId:value.baseSkuId,odmDescription:value.odmDescription}});
        skuId=sku.id;
      } else if (item.classes.includes('UPDATE SKU')) await tx.productSku.update({where:{id:skuId},data:{partNumber:value.partNumber,description:value.description,priceUnit:value.priceUnit,active:value.active,catalogSource:value.catalogSource,odmCustomerAccountId:value.odmCustomerAccountId??null,odmCustomerSourceName:value.odmCustomerSourceName??null,baseSkuId:value.baseSkuId??null,odmDescription:value.odmDescription??null}});
      if (value.currency) for (const spec of tierFields) {
        const amount=value[spec.field];
        if (amount && amount!==item.before?.[spec.field]) await tx.productPrice.upsert({where:{skuId_currencyCode_tier:{skuId,currencyCode:value.currency,tier:spec.tier}},create:{skuId,currencyCode:value.currency,tier:spec.tier,amount},update:{amount}});
      }
    }
    return plan.counts;
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
