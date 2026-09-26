import { Prisma, ProductCatalogSource, OdmCustomizationSubtype, ProductPriceTier, ProductPriceUnit, AccountBusinessRoleCode, type PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { parseImportCsv } from './import-csv';
import { accountWriteData, checkAccountReferences, normalizeAccountName } from './accounts';
import { parseAccountForm } from './account-validation';
import { calculateOdmCustomerPrice } from './odm-customer-pricing';
export { normalizeAccountName } from './accounts';

export const productImportHeaders = ['model','part_number','description','standard_price','msrp_price','reseller_price','distributor_price','currency','price_unit','active','category','catalog_source','odm_customer','base_sku','odm_description','odm_subtype'] as const;
export const odmSourceHeaders = ['odm_source_format','odm_source_workbook','odm_source_sheet','odm_source_row','odm_source_part_index','odm_source_part_count','odm_source_customer_cell','odm_source_part_number','odm_source_old_price','odm_source_prior_price','odm_source_new_price','odm_source_tariff_percent','odm_source_tariff_amount','odm_source_note','odm_source_old_price_raw','odm_source_prior_price_raw','odm_source_new_price_raw','odm_source_tariff_percent_raw','odm_source_tariff_amount_raw'] as const;
export const productImportTemplate = productImportHeaders.join(',') + '\n';
export const normalizePartNumber = (value:string) => value.trim().replace(/\s+/g,' ').toUpperCase();
const normalizeModel = (value:string) => value.trim().replace(/\s+/g,' ').toLowerCase();
const odmStem = (part:string) => {
  const key=normalizePartNumber(part);
  return key.includes('/') ? key.slice(0,key.lastIndexOf('/')) : key.replace(/-[A-Z]{2,4}\d*$/,'');
};
const currencies = new Set(Intl.supportedValuesOf('currency'));
type Db = PrismaClient | Prisma.TransactionClient;
type Values = {model:string;partNumber:string;description?:string;standardPrice?:string;msrpPrice?:string;resellerPrice?:string;distributorPrice?:string;currency?:string;priceUnit?:ProductPriceUnit;active?:boolean;category?:string;catalogSource?:ProductCatalogSource;odmSubtype?:OdmCustomizationSubtype;odmCustomerAccountId?:number;odmCustomerSourceName?:string;odmCustomer?:string;baseSkuId?:number;baseSku?:string;odmDescription?:string};
const tierFields = [
  {header:'standard_price',field:'standardPrice',tier:ProductPriceTier.STANDARD},
  {header:'msrp_price',field:'msrpPrice',tier:ProductPriceTier.MSRP},
  {header:'reseller_price',field:'resellerPrice',tier:ProductPriceTier.RESELLER},
  {header:'distributor_price',field:'distributorPrice',tier:ProductPriceTier.DISTRIBUTOR},
] as const;
export type ProductImportSource = {workbook:string;sheet:string;customerCell:string;partNumber:string;partIndex:number;partCount:number;oldPrice:string;priorPrice:string;newPrice:string;tariffPercent:string;tariffAmount:string;note:string;rawOldPrice:string;rawPriorPrice:string;rawNewPrice:string;rawTariffPercent:string;rawTariffAmount:string};
export type ProductImportItem = {line:number;label:string;classes:string[];status:'READY'|'NEEDS REVIEW'|'ERROR'|'SKIPPED';before:Values|null;after:Values;messages:string[];productId?:number;skuId?:number;source?:ProductImportSource;odmPricing?:ReturnType<typeof calculateOdmCustomerPrice>;reviewKey?:string;suggestedBaseSku?:string;recommendations?:string[];catalogCreatable?:boolean;resolvedPrice?:string;resolvedTariffPercent?:string;resolvedTariffAmount?:string};
export type ProductImportCounts = {newProducts:number;updatedProducts:number;newSkus:number;updatedSkus:number;priceChanges:number;unchanged:number;warnings:number;errors:number};
export type CustomerResolution = {source:string;key:string;accountId?:number;accountName?:string;status:'Matched'|'Manually Mapped'|'Needs Review'|'Unresolved';rows:number};
export type ProductImportDecisionGroup = {key:string;kind:'PRICE'|'TARIFF';reason:'NOTE_PRICE'|'MISSING_PRICE'|'STRUCTURED_TARIFF'|'NOTE_TARIFF';customer:string;label:string;reviewKeys:string[];lines:number[];partNumbers:string[];oldPrice?:string;priorPrice?:string;newPrice?:string;notePrice?:string;proposedPrice?:string;tariffPercent?:string;tariffAmount?:string;noteTariff?:string};
export type AccountCreationCandidate = {key:string;name:string;role?:string};
export type ProductImportReview = {customerMappings?:Record<string,number>;rowAccountIds?:Record<string,number>;productIds?:Record<string,number>;modelNames?:Record<string,string>;subtypes?:Record<string,OdmCustomizationSubtype>;baseSkus?:Record<string,string>;partNumbers?:Record<string,string>;prices?:Record<string,string>;priceChoices?:Record<string,string>;tariffChoices?:Record<string,string>;tariffPercents?:Record<string,string>;tariffAmounts?:Record<string,string>;dispositions?:Record<string,string>;createCatalog?:Record<string,string>;noteChoices?:Record<string,string>;applyRecommendations?:boolean};
export type ProductImportPlan = {items:ProductImportItem[];customers:CustomerResolution[];decisionGroups:ProductImportDecisionGroup[];errors:string[];notices:string[];counts:ProductImportCounts;digest:string};
export function catalogCreationEligible(item:ProductImportItem) {
  if (!item.source || item.skuId || !item.after.model || !item.after.partNumber || !item.after.odmSubtype || /[\r\n()]/.test(item.after.partNumber) || /\bdiscontinued\b/i.test(item.source.note)) return false;
  return item.messages.every(message=>message.startsWith('WARNING:') || /^(New Product or SKU:|Customer-specific ODM needs|A price in Notes differs|Notes mention a different tariff rate|Customer pricing needs review:|New Price is unavailable)/.test(message));
}
const blankCounts = ():ProductImportCounts => ({newProducts:0,updatedProducts:0,newSkus:0,updatedSkus:0,priceChanges:0,unchanged:0,warnings:0,errors:0});
const digestOf = (items:ProductImportItem[]) => createHash('sha256').update(JSON.stringify(items)).digest('hex');
const validPrice = (value:string) => /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value);
const bool = (value:string) => /^(true|yes|1)$/i.test(value) ? true : /^(false|no|0)$/i.test(value) ? false : undefined;

export async function planProductImport(db:Db,csv:string,selectedSource?:ProductCatalogSource,review:ProductImportReview={}):Promise<ProductImportPlan> {
  const parsed = parseImportCsv(csv,[...productImportHeaders,...odmSourceHeaders]);
  const counts = blankCounts();
  if (parsed.errors.length) return {items:[],customers:[],decisionGroups:[],errors:parsed.errors,notices:[],counts:{...counts,errors:parsed.errors.length},digest:''};
  const products = await db.product.findMany({include:{category:true,skus:{include:{prices:true,odmCustomers:true}}}});
  const accounts = await db.account.findMany({where:{archivedAt:null,status:'ACTIVE'},select:{id:true,name:true}});
  const categoryRows = await db.productCategory.findMany({select:{code:true,active:true}});
  const activeCategories = new Set(categoryRows.filter(category=>category.active).map(category=>category.code));
  const allSkus = products.flatMap(product => product.skus.map(sku => ({product,sku})));
  const seen = new Map<string,ProductImportItem>();
  const proposedModels = new Set<string>();
  const modelCategories = new Map<string,string>();
  const items:ProductImportItem[] = [];
  const customers=new Map<string,CustomerResolution>();
  const odmWorkbook=parsed.rows.some(row=>(row.values as Record<string,string>).odm_source_format==='ODM_CUSTOMER_PRICING');
  const incomingOdmKeys=new Set(parsed.rows.filter(row=>(row.values as Record<string,string>).odm_source_format==='ODM_CUSTOMER_PRICING').map(row=>normalizePartNumber((row.values as Record<string,string>).part_number ?? '')));
  const incomingStems=new Map<string,Set<string>>();
  for (const key of incomingOdmKeys) {const stem=odmStem(key);if(stem!==key){const family=incomingStems.get(stem)??new Set<string>();family.add(key);incomingStems.set(stem,family);}}
  for (const row of parsed.rows) {
    const get = (key:string) => (row.values as Record<string,string>)[key]?.trim() ?? '';
    let model=get('model'), modelKey=normalizeModel(model);
    const sourcePartNumber=get('part_number');
    const fromOdm=get('odm_source_format')==='ODM_CUSTOMER_PRICING';
    const lineNumber=fromOdm && /^\d+$/.test(get('odm_source_row')) ? Number(get('odm_source_row')) : row.line;
    const entryKey=fromOdm ? `${lineNumber}:${Number(get('odm_source_part_index'))||1}` : normalizePartNumber(sourcePartNumber);
    const partNumber=review.partNumbers?.[entryKey] || sourcePartNumber, key=normalizePartNumber(partNumber);
    if (fromOdm && review.partNumbers?.[entryKey] && normalizeModel(model)===normalizeModel(sourcePartNumber)) {model=partNumber;modelKey=normalizeModel(model);}
    if (fromOdm && review.modelNames?.[entryKey]) {model=review.modelNames[entryKey].trim();modelKey=normalizeModel(model);}
    const source:ProductImportSource|undefined=fromOdm ? {workbook:get('odm_source_workbook'),sheet:get('odm_source_sheet'),customerCell:(row.values as Record<string,string>).odm_source_customer_cell ?? '',partNumber:(row.values as Record<string,string>).odm_source_part_number ?? '',partIndex:Number(get('odm_source_part_index'))||1,partCount:Number(get('odm_source_part_count'))||1,oldPrice:get('odm_source_old_price'),priorPrice:get('odm_source_prior_price'),newPrice:get('odm_source_new_price'),tariffPercent:get('odm_source_tariff_percent'),tariffAmount:get('odm_source_tariff_amount'),note:(row.values as Record<string,string>).odm_source_note ?? '',rawOldPrice:get('odm_source_old_price_raw'),rawPriorPrice:get('odm_source_prior_price_raw'),rawNewPrice:get('odm_source_new_price_raw'),rawTariffPercent:get('odm_source_tariff_percent_raw'),rawTariffAmount:get('odm_source_tariff_amount_raw')} : undefined;
    const reviewKey=entryKey;
    const recommendedHistorical=fromOdm && /\bdiscontinued\b/i.test(source?.note ?? '');
    const disposition=review.dispositions?.[reviewKey] ?? (review.applyRecommendations && recommendedHistorical ? 'HISTORICAL' : undefined);
    const skipped=disposition==='SKIP' || disposition==='HISTORICAL';
    const currencyText=get('currency'), activeText=get('active'), unitText=get('price_unit').toUpperCase();
    const categoryText=get('category'), sourceText=(get('catalog_source') || (fromOdm ? '' : selectedSource) || '').toUpperCase();
    const recommendedSubtype:OdmCustomizationSubtype|undefined=fromOdm ? get('odm_customer') ? 'CUSTOMER_SPECIFIC' : odmStem(partNumber)!==normalizePartNumber(partNumber) ? 'SPECIAL_CONFIGURATION' : undefined : undefined;
    const subtypeText=review.subtypes?.[key] ?? (review.applyRecommendations ? recommendedSubtype : undefined) ?? get('odm_subtype').toUpperCase();
    const odmSubtype=Object.values(OdmCustomizationSubtype).includes(subtypeText as OdmCustomizationSubtype) ? subtypeText as OdmCustomizationSubtype : undefined;
    const category=activeCategories.has(categoryText) ? categoryText : undefined;
    const catalogSource=fromOdm ? ProductCatalogSource.ODM : Object.values(ProductCatalogSource).includes(sourceText as ProductCatalogSource) ? sourceText as ProductCatalogSource : undefined;
    const messages:string[]=[];
    if (!model) messages.push('Product/model is required.');
    if (!partNumber) messages.push('Part number is required.');
    if (fromOdm && !odmSubtype) messages.push('Choose an ODM subtype.');
    if (fromOdm && /[\r\n]/.test(partNumber)) messages.push('Source part number could not be safely separated. Enter a corrected SKU.');
    if (fromOdm && /\([^)]*\)/.test(partNumber) && !/^.+?\s+\(Y\d+\)$/i.test(source?.partNumber ?? '')) messages.push('Annotated source part number needs a corrected SKU.');
    if (recommendedHistorical && !disposition) messages.push('Discontinued: choose Skip pricing or historical-only handling.');
    if (fromOdm && (!source?.newPrice || source.newPrice==='-' || /^N\/A$/i.test(source.newPrice)) && !['CORRECTED','PRIOR'].includes(review.priceChoices?.[reviewKey]??'') && review.noteChoices?.[reviewKey]!=='NOTES' && !skipped) messages.push('New Price is unavailable; choose a usable current price or historical-only handling.');
    const notePrices=fromOdm ? [...(source?.note.matchAll(/\$?\b\d+(?:\.\d+)?\b(?![.\d]|\s*%)/g) ?? [])].map(match=>match[0].replace('$','')) : [];
    const tariffInNote=fromOdm ? /\b(\d+(?:\.\d+)?)\s*%\s*(?:tariff|line)\b|\btariff\s*(\d+(?:\.\d+)?)\s*%/i.exec(source?.note ?? '') : null;
    const noteRate=tariffInNote?.[1] ?? tariffInNote?.[2];
    const notePriceConflict=!!source?.newPrice && validPrice(source.newPrice) && notePrices.length>0 && !/\bdiscontinued\b/i.test(source.note) && new Prisma.Decimal(notePrices[0]).toDecimalPlaces(2).toFixed(2)!==source.newPrice;
    if (fromOdm && notePriceConflict && !review.noteChoices?.[reviewKey] && !['CORRECTED','PRIOR'].includes(review.priceChoices?.[reviewKey]??'')) messages.push('A price in Notes differs from the structured New Price. Choose which value to use.');
    if (fromOdm && noteRate && !review.tariffChoices?.[reviewKey] && (!source?.tariffPercent || !/^\d+(?:\.\d+)?%?$/.test(source.tariffPercent) || new Prisma.Decimal(source.tariffPercent.replace('%','')).sub(noteRate).abs().gt('0.0001'))) messages.push('Notes mention a different tariff rate; choose structured tariff, Notes rate, or a correction.');
    if (fromOdm && source?.rawNewPrice && /^\d+(?:\.\d+)?$/.test(source.rawNewPrice) && validPrice(source.newPrice) && !new Prisma.Decimal(source.rawNewPrice).sub(source.newPrice).abs().lte('0.0000001')) messages.push('WARNING: New Price was rounded half up to cents; exact workbook value is retained in provenance.');
    if (model.length>200) messages.push('Model exceeds 200 characters.');
    if (partNumber.length>100) messages.push('Part number exceeds 100 characters.');
    if (get('description').length>2000) messages.push('Description exceeds 2000 characters.');
    if (categoryText && !category) messages.push('Category must be an active Product Category code.');
    if (sourceText && !catalogSource) messages.push('Catalog source must be PRICE_LIST, PE_LIST, or ODM.');
    if (catalogSource === 'SPECIAL_SKU_LIST') messages.push('New Special SKU classification is unavailable; use ODM with a subtype.');
    if (!fromOdm && (get('odm_customer') || get('base_sku') || get('odm_description') || subtypeText) && catalogSource !== 'ODM') messages.push('Customer and customization details require Catalog Source ODM.');
    if (subtypeText && !odmSubtype) messages.push('Choose a valid ODM subtype.');
    if (odmSubtype === 'LEGACY_SPECIAL_SKU') messages.push('Legacy Special SKU is reserved for migrated records.');
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
    const selectedProductId=review.productIds?.[reviewKey];
    const selectedProduct=products.find(candidate=>candidate.id===selectedProductId && !candidate.archivedAt);
    if (selectedProductId && !selectedProduct) messages.push('Selected Product is no longer available.');
    const skuMatches=allSkus.filter(entry=>entry.sku.normalizedPartNumber===key);
    if (skuMatches.length>1) messages.push('Ambiguous SKU mapping in catalog.');
    const skuMatch=skuMatches.length===1 ? skuMatches[0] : undefined;
    const stem=fromOdm ? odmStem(partNumber) : key;
    const baseMatches=fromOdm && stem!==key ? allSkus.filter(entry=>entry.sku.normalizedPartNumber===stem && entry.sku.catalogSource!=='ODM' && !entry.product.archivedAt) : [];
    const uniqueBase=baseMatches.length===1 ? baseMatches[0] : undefined;
    if (fromOdm && skuMatch) {model=skuMatch.product.name;modelKey=normalizeModel(model);}
    else if (fromOdm && selectedProduct) {model=selectedProduct.name;modelKey=normalizeModel(model);}
    else if (fromOdm && uniqueBase && !skuMatch && !review.modelNames?.[entryKey]) {model=uniqueBase.product.name;modelKey=normalizeModel(model);}
    else if (fromOdm && !skuMatch && !review.modelNames?.[entryKey] && stem!==key && (incomingStems.get(stem)?.size??0)>1) {model=stem;modelKey=normalizeModel(model);}
    const prior=seen.get(key);
    if (key && prior && fromOdm && (prior.after.catalogSource!==catalogSource || normalizeModel(prior.after.model)!==modelKey)) messages.push(`Repeated part number (line ${prior.line}) has conflicting SKU classification or model.`);
    if (key && prior && !fromOdm) {
      const conflict=normalizeModel(prior.after.model)!==modelKey;
      messages.push(conflict ? `Conflicting duplicate part number (line ${prior.line}) maps to a different model.` : `Duplicate part number in import (line ${prior.line}).`);
      prior.messages.push(conflict ? `Conflicting duplicate part number on line ${lineNumber}.` : `Duplicate part number on line ${lineNumber}.`);
      prior.classes=['ERROR'];
      prior.status='ERROR';
    }
    const modelMatches=products.filter(product=>normalizeModel(product.name)===modelKey);
    if (modelMatches.length>1) messages.push('Ambiguous Product mapping: multiple Products have this model.');
    const modelMatch=modelMatches.length===1 ? modelMatches[0] : undefined;
    if (skuMatch && modelMatch && skuMatch.product.id!==modelMatch.id) messages.push('Part number and model identify different Products.');
    if (skuMatch && skuMatch.product.archivedAt) messages.push('Matched Product is archived.');
    if (modelMatch?.archivedAt) messages.push('Matched Product is archived.');
    if (skuMatch && normalizeModel(skuMatch.product.name)!==modelKey && skuMatch.product.skus.length>1) messages.push('Changing a model shared by multiple SKUs is ambiguous. Review the Product manually.');
    if (selectedProduct && skuMatch && selectedProduct.id!==skuMatch.product.id) messages.push('Selected Product does not own the resolved SKU.');
    if (selectedProduct && uniqueBase && selectedProduct.id!==uniqueBase.product.id) messages.push('Selected Product differs from the exact standard SKU family; review this relationship.');
    if (fromOdm && skuMatch && skuMatch.sku.catalogSource!=='ODM') messages.push('Existing SKU is not ODM; review before changing its catalog classification.');
    const product=skuMatch?.product ?? selectedProduct ?? uniqueBase?.product ?? modelMatch;
    const sku=skuMatch?.sku;
    if (catalogSource === 'ODM' && sku && allSkus.some(entry=>entry.sku.baseSkuId===sku.id)) messages.push('An ODM SKU cannot be used as a Base SKU.');
    const existingCurrency=currency || (sku && new Set(sku.prices.map(p=>p.currencyCode)).size===1 ? sku.prices[0]?.currencyCode : undefined);
    const oldPrices=sku?.prices.filter(p=>p.currencyCode===existingCurrency) ?? [];
    const before:Values|null=sku ? {model:skuMatch!.product.name,partNumber:sku.partNumber,description:sku.description ?? undefined,currency:existingCurrency,priceUnit:sku.priceUnit,active:sku.active,category:skuMatch!.product.category?.code,catalogSource:sku.catalogSource ?? undefined,odmSubtype:sku.odmSubtype??undefined,odmCustomerAccountId:sku.odmCustomers?.[0]?.accountId,odmCustomerSourceName:sku.odmCustomerSourceName??undefined,baseSkuId:sku.baseSkuId??undefined,odmDescription:sku.odmDescription??undefined} : null;
    const after:Values={model,partNumber,description:get('description') || before?.description,currency:currency || before?.currency,priceUnit:unitText && Object.values(ProductPriceUnit).includes(unitText as ProductPriceUnit) ? unitText as ProductPriceUnit : before?.priceUnit ?? ProductPriceUnit.EACH,active:active ?? before?.active ?? true,category:category ?? product?.category?.code,catalogSource:catalogSource ?? before?.catalogSource,odmSubtype:odmSubtype ?? before?.odmSubtype};
    if (after.catalogSource==='SPECIAL_SKU_LIST') messages.push('Special SKU classification is unavailable; use ODM with a subtype.');
    if (after.catalogSource==='ODM' && !after.odmSubtype && !fromOdm && !sku) messages.push('Choose an ODM subtype.');
    const customer=get('odm_customer'), customerKey=normalizeAccountName(customer);
    const matches=customer ? accounts.filter(account=>normalizeAccountName(account.name)===customerKey) : [];
    const mappedId=customer ? review.customerMappings?.[customerKey] : undefined;
    const mapped=accounts.find(account=>account.id===mappedId);
    const relationshipMatches=customer && sku ? (sku.odmCustomers ?? []).filter(link=>link.sourceCustomerName?.split('\n').some(name=>normalizeAccountName(name)===customerKey)).map(link=>accounts.find(account=>account.id===link.accountId)).filter((account):account is typeof accounts[number]=>!!account) : [];
    const relationshipAccount=relationshipMatches.length===1 ? relationshipMatches[0] : undefined;
    if (relationshipMatches.length>1 || (relationshipAccount && matches.length===1 && relationshipAccount.id!==matches[0].id)) messages.push('Existing ODM customer relationship conflicts with Account name; choose the Account.');
    if (customer && after.odmSubtype==='CUSTOMER_SPECIFIC' && !skipped) {
      const resolved=mapped ?? (matches.length===1 ? matches[0] : undefined) ?? relationshipAccount;
      const status:CustomerResolution['status']=mapped?'Manually Mapped':resolved?'Matched':matches.length>1?'Needs Review':'Unresolved';
      const priorCustomer=customers.get(customerKey);
      if (priorCustomer) priorCustomer.rows++;
      else customers.set(customerKey,{source:customer,key:customerKey,accountId:resolved?.id,accountName:resolved?.name,status,rows:1});
      if (mappedId && !mapped) messages.push('Selected ODM Customer Account is no longer available.');
    }
    if (after.catalogSource === 'ODM') {
      const rowAccountId=review.rowAccountIds?.[reviewKey] ?? review.rowAccountIds?.[fromOdm ? String(lineNumber) : key];
      const rowAccount=accounts.find(account=>account.id===rowAccountId);
      if (rowAccountId && !rowAccount) messages.push('Selected ODM Customer Account is no longer available.');
      after.odmCustomer=customer || undefined;
      after.odmCustomerAccountId=after.odmSubtype==='CUSTOMER_SPECIFIC' ? rowAccount?.id ?? mapped?.id ?? (matches.length===1?matches[0].id:undefined) ?? relationshipAccount?.id ?? (!customer && !fromOdm?before?.odmCustomerAccountId:undefined) : undefined;
      after.odmCustomerSourceName=customer || before?.odmCustomerSourceName;
      if (after.odmSubtype==='CUSTOMER_SPECIFIC' && !after.odmCustomerAccountId) messages.push('Customer-specific ODM needs an existing SalesHub Account before import.');
      const base=review.baseSkus?.[reviewKey] ?? review.baseSkus?.[key] ?? (get('base_sku') || (review.applyRecommendations && !incomingOdmKeys.has(stem) ? uniqueBase?.sku.partNumber : undefined));
      if (base) {
        const match=allSkus.find(entry=>entry.sku.normalizedPartNumber===normalizePartNumber(base));
        if (!match) messages.push('Base SKU must match an existing part number.');
        else if (match.sku.id===sku?.id || match.sku.catalogSource==='ODM') messages.push('Base SKU must be a different, non-ODM SKU.');
        else {after.baseSkuId=match.sku.id;after.baseSku=match.sku.partNumber;}
      } else after.baseSkuId=before?.baseSkuId;
      after.odmDescription=get('odm_description')||before?.odmDescription;
    }
    const priceChoice=review.priceChoices?.[reviewKey];
    const noteChoice=review.noteChoices?.[reviewKey];
    const chosenPrice=priceChoice==='CORRECTED' ? review.prices?.[reviewKey] : priceChoice==='PRIOR' ? source?.priorPrice : noteChoice==='NOTES' && notePrices[0] ? new Prisma.Decimal(notePrices[0]).toDecimalPlaces(2,Prisma.Decimal.ROUND_HALF_UP).toFixed(2) : source?.newPrice;
    const tariffChoice=review.tariffChoices?.[reviewKey];
    const chosenTariffPercent=tariffChoice==='NONE'||tariffChoice==='AMOUNT' ? '' : tariffChoice==='CORRECTED' ? review.tariffPercents?.[reviewKey] ?? '' : tariffChoice==='NOTES' ? noteRate ?? '' : source?.tariffPercent ?? '';
    const chosenTariffAmount=tariffChoice==='NONE'||tariffChoice==='PERCENT'||tariffChoice==='NOTES' ? '' : tariffChoice==='CORRECTED' ? review.tariffAmounts?.[reviewKey] ?? '' : source?.tariffAmount ?? '';
    if (tariffChoice==='PERCENT' && !source?.tariffPercent) messages.push('Source tariff percentage is blank; enter a corrected tariff.');
    if (tariffChoice==='AMOUNT' && !source?.tariffAmount) messages.push('Source tariff amount is blank; enter a corrected tariff.');
    if (tariffChoice==='NOTES' && !noteRate) messages.push('Notes have no tariff percentage; enter a corrected tariff.');
    if (priceChoice==='CORRECTED' && !chosenPrice) messages.push('Enter a corrected price.');
    if (priceChoice==='PRIOR' && (!chosenPrice || chosenPrice==='-' || /^N\/A$/i.test(chosenPrice))) messages.push('Prior Price is unavailable; enter a corrected price.');
    if (noteChoice==='NOTES' && !notePrices.length) messages.push('Notes have no usable price; enter a corrected price.');
    if (tariffChoice==='CORRECTED' && !chosenTariffPercent && !chosenTariffAmount) messages.push('Enter a corrected tariff percentage or amount.');
    let odmPricing: ReturnType<typeof calculateOdmCustomerPrice> | undefined;
    if (fromOdm && after.odmSubtype === 'CUSTOMER_SPECIFIC' && chosenPrice && chosenPrice !== '-' && !skipped && !/\bdiscontinued\b/i.test(source?.note ?? '')) {
      try { const checked=calculateOdmCustomerPrice({ customerPrice: chosenPrice, previousPrice: [source?.oldPrice,source?.priorPrice].find(value=>value&&value!=='-'&&!/^N\/A$/i.test(value)), tariffPercent: chosenTariffPercent, tariffAmount: chosenTariffAmount, currencyCode: currency || 'USD', notes: source?.note });if(after.odmCustomerAccountId)odmPricing=checked; }
      catch (error) { messages.push(`Customer pricing needs review: ${error instanceof Error ? error.message : 'invalid price or tariff'}`); }
    }
    if (fromOdm && after.odmSubtype !== 'CUSTOMER_SPECIFIC' && (source?.oldPrice || source?.newPrice || source?.tariffPercent || source?.tariffAmount)) messages.push('WARNING: Source prices and tariff retained; non-customer-specific ODM has no active customer pricing.');
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
    if (sku && (sku.partNumber!==partNumber || (get('description') && sku.description!==get('description')) || (active!==undefined && sku.active!==active) || (unitText && sku.priceUnit!==unitText) || (catalogSource && sku.catalogSource!==catalogSource) || (sku.odmSubtype??null)!==(after.odmSubtype??null) || (sku.odmCustomerSourceName??null)!==(after.odmCustomerSourceName??null) || (sku.baseSkuId??null)!==(after.baseSkuId??null) || (sku.odmDescription??null)!==(after.odmDescription??null) || (after.catalogSource==='ODM' && after.odmCustomerAccountId && !sku.odmCustomers?.some(link=>link.accountId===after.odmCustomerAccountId)))) classes.push('UPDATE SKU');
    if (tierFields.some(spec=>get(spec.header) && validPrice(get(spec.header)) && !oldPrices.find(price=>price.tier===spec.tier)?.amount.equals(get(spec.header)))) classes.push('PRICE CHANGE');
    if (!classes.length) classes.push('UNCHANGED');
    if (fromOdm && (classes.includes('NEW PRODUCT') || classes.includes('NEW SKU')) && review.createCatalog?.[reviewKey]!=='CONFIRM' && !skipped) messages.push('New Product or SKU: confirm catalog creation or select an existing catalog record.');
    const suggestedBaseSku=!incomingOdmKeys.has(stem) ? uniqueBase?.sku.partNumber : undefined;
    if (fromOdm && suggestedBaseSku && !after.baseSkuId) messages.push(`WARNING: Suggested Base SKU: ${suggestedBaseSku}. Select it if correct.`);
    if (!sku && !get('standard_price') && !fromOdm) {classes.push('WARNING');messages.push('WARNING: No STANDARD/base price supplied for this new SKU. Other tiers remain separate.');}
    if (messages.some(message=>message.startsWith('WARNING:')) && !classes.includes('WARNING')) classes.push('WARNING');
    if (messages.some(message=>!message.startsWith('WARNING:'))) {if(fromOdm) classes.push('REVIEW'); else classes.splice(0,classes.length,'ERROR');}
    const status:ProductImportItem['status']=disposition==='HISTORICAL' ? 'READY' : skipped ? 'SKIPPED' : messages.some(message=>/Model exceeds|Part number exceeds|Description exceeds|must be a nonnegative|Ambiguous SKU mapping|Product\/model is required|Part number is required/i.test(message)) ? 'ERROR' : classes.includes('ERROR')||classes.includes('REVIEW') ? 'NEEDS REVIEW' : 'READY';
    const recommendations:string[]=[];
    if (recommendedSubtype && !get('odm_subtype') && !review.subtypes?.[key]) recommendations.push(`ODM subtype: ${recommendedSubtype}`);
    if (recommendedHistorical && !review.dispositions?.[reviewKey]) recommendations.push('Historical only; no active pricing');
    if (suggestedBaseSku && !review.baseSkus?.[reviewKey]) recommendations.push(`Base SKU: ${suggestedBaseSku}`);
    if (source?.newPrice && validPrice(source.newPrice) && !notePriceConflict) recommendations.push(`Current price: ${source.newPrice}`);
    const item:ProductImportItem={line:lineNumber,label:partNumber || '(missing part number)',classes,status,before,after,messages,productId:product?.id,skuId:sku?.id,source,odmPricing,reviewKey,suggestedBaseSku,recommendations,resolvedPrice:chosenPrice,resolvedTariffPercent:chosenTariffPercent,resolvedTariffAmount:chosenTariffAmount};
    item.catalogCreatable=catalogCreationEligible(item);
    items.push(item);
    if (key && !prior) seen.set(key,item);
    if (modelKey) proposedModels.add(modelKey);
  }
  const importedOdmIds = new Set(items.filter(item=>item.skuId && item.after.catalogSource==='ODM').map(item=>item.skuId));
  for (const item of items) if (item.after.baseSkuId && importedOdmIds.has(item.after.baseSkuId)) {
    item.messages.push('Base SKU is classified ODM in this import. ODM chains are not allowed.');
    item.classes=['ERROR'];
    item.status='ERROR';
    item.catalogCreatable=false;
  }
  const pricingByRelationship = new Map<string, ProductImportItem>();
  for (const item of items) {
    if (!item.odmPricing || !item.after.odmCustomerAccountId) continue;
    const key = `${normalizePartNumber(item.after.partNumber)}:${item.after.odmCustomerAccountId}`;
    const prior = pricingByRelationship.get(key);
    if (prior && JSON.stringify(prior.odmPricing) !== JSON.stringify(item.odmPricing)) {
      for (const conflict of [prior, item]) { conflict.messages.push('Repeated SKU/Account has conflicting customer pricing; skip one source entry or correct the pricing.'); conflict.classes = ['ERROR']; conflict.status='NEEDS REVIEW'; }
    } else if (!prior) pricingByRelationship.set(key, item);
  }
  const productUpdates=new Set<number>();
  const updatedSkuKeys=new Set<string>();
  for (const item of items) {
    if (item.messages.some(message=>message.startsWith('WARNING:'))) counts.warnings++;
    if (item.status==='SKIPPED') continue;
    if (item.status!=='READY') counts.errors++;
    if (item.classes.includes('NEW PRODUCT') && (!item.source || seen.get(normalizePartNumber(item.after.partNumber))===item)) counts.newProducts++;
    if (item.classes.includes('UPDATE PRODUCT') && item.productId) productUpdates.add(item.productId);
    if (item.classes.includes('NEW SKU') && (!item.source || seen.get(normalizePartNumber(item.after.partNumber))===item)) counts.newSkus++;
    if (item.classes.includes('UPDATE SKU')) updatedSkuKeys.add(normalizePartNumber(item.after.partNumber));
    if (item.classes.includes('PRICE CHANGE')) counts.priceChanges++;
    if (item.classes.includes('UNCHANGED')) counts.unchanged++;
  }
  counts.updatedProducts=productUpdates.size;
  counts.updatedSkus=updatedSkuKeys.size;
  return {items,customers:[...customers.values()],decisionGroups:productImportDecisionGroups(items),errors:[],notices:odmWorkbook?['Choose an ODM subtype for each SKU candidate. Resolved Customer-Specific prices are saved per SKU and Account.','Workbook pricing is never written to generic catalog tiers. Blank Customer cells are left unresolved.']:[],counts,digest:digestOf(items)};
}

export function productImportDecisionGroups(items:ProductImportItem[]):ProductImportDecisionGroup[] {
  const groups=new Map<string,ProductImportDecisionGroup>();
  for(const item of items) {
    if(!item.source || item.status==='READY' && /\bdiscontinued\b/i.test(item.source.note) || item.status==='SKIPPED') continue;
    const source=item.source,customer=source.customerCell,sku=item.after.partNumber;
    const notePrice=item.messages.some(message=>message.startsWith('A price in Notes differs'));
    const missingPrice=item.messages.some(message=>message.startsWith('New Price is unavailable'));
    const structuredTariff=item.messages.some(message=>message.includes('Tariff Amount disagrees'));
    const noteTariff=item.messages.some(message=>message.startsWith('Notes mention a different tariff rate'));
    const candidates:{kind:'PRICE'|'TARIFF';reason:ProductImportDecisionGroup['reason'];pattern:string;label:string}[]=[];
    const notePriceValue=source.note.match(/\$?\b\d+(?:\.\d+)?\b(?![.\d]|\s*%)/)?.[0]??'';
    if(notePrice)candidates.push({kind:'PRICE',reason:'NOTE_PRICE',pattern:JSON.stringify([customer,sku,source.oldPrice,source.priorPrice,source.newPrice,notePriceValue]),label:`${source.newPrice} versus price in Notes`});
    if(missingPrice)candidates.push({kind:'PRICE',reason:'MISSING_PRICE',pattern:JSON.stringify([customer,sku,source.oldPrice,source.priorPrice,source.newPrice,notePriceValue]),label:'No usable current price'});
    if(structuredTariff)candidates.push({kind:'TARIFF',reason:'STRUCTURED_TARIFF',pattern:[customer,sku,source.newPrice,source.tariffPercent,source.tariffAmount,source.note].join('|'),label:'Structured tariff fields disagree'});
    if(noteTariff)candidates.push({kind:'TARIFF',reason:'NOTE_TARIFF',pattern:[customer,source.tariffPercent,source.note.match(/\d+(?:\.\d+)?\s*%/)?.[0]??'',source.note.replace(/\d+(?:\.\d+)?/g,'#')].join('|'),label:`Structured ${source.tariffPercent||'blank'} versus Notes tariff`});
    for(const candidate of candidates) {
      const key=createHash('sha256').update(`${candidate.kind}|${candidate.reason}|${candidate.pattern}`).digest('hex').slice(0,16);
      const group=groups.get(key);
      if(group){group.reviewKeys.push(item.reviewKey??'');group.lines.push(item.line);group.partNumbers.push(item.after.partNumber);}
      else groups.set(key,{key,kind:candidate.kind,reason:candidate.reason,customer:source.customerCell,label:candidate.label,reviewKeys:[item.reviewKey??''],lines:[item.line],partNumbers:[item.after.partNumber],oldPrice:source.oldPrice,priorPrice:source.priorPrice,newPrice:source.newPrice,notePrice:source.note.match(/\$?\b\d+(?:\.\d+)?\b(?![.\d]|\s*%)/)?.[0],proposedPrice:item.resolvedPrice,tariffPercent:source.tariffPercent,tariffAmount:source.tariffAmount,noteTariff:source.note.match(/\b\d+(?:\.\d+)?\s*%\s*(?:tariff|line)\b|\btariff\s*\d+(?:\.\d+)?\s*%/i)?.[0]});
    }
  }
  return [...groups.values()];
}

export async function applyProductImport(db:PrismaClient,csv:string,expectedDigest:string,selectedSource?:ProductCatalogSource,review:ProductImportReview={}) {
  return db.$transaction(async tx=>{
    const plan=await planProductImport(tx,csv,selectedSource,review);
    if (!expectedDigest || plan.digest!==expectedDigest || plan.errors.length) throw new Error('Preview changed or contains errors. Preview the file again before confirming.');
    const created=new Map<string,number>();
    const createdSkus=new Map<string,number>();
    for (const item of plan.items) {
      if (item.status!=='READY') continue;
      if (item.source) {
        const source=item.source;
        const decision=review.dispositions?.[item.reviewKey ?? ''] ?? (review.applyRecommendations && /\bdiscontinued\b/i.test(source.note) ? 'HISTORICAL' : undefined);
        const disposition=decision==='HISTORICAL' ? 'HISTORICAL' : 'IMPORTED';
        const entryKey=item.reviewKey??'';
        const resolution={partNumber:item.after.partNumber,accountId:item.after.odmCustomerAccountId??null,subtype:item.after.odmSubtype??null,baseSku:item.after.baseSku??null,price:item.resolvedPrice??null,tariffPercent:item.resolvedTariffPercent??null,tariffAmount:item.resolvedTariffAmount??null,disposition,choices:{partNumber:review.partNumbers?.[entryKey],productId:review.productIds?.[entryKey],accountId:review.rowAccountIds?.[entryKey],subtype:review.subtypes?.[normalizePartNumber(item.after.partNumber)],baseSku:review.baseSkus?.[entryKey],priceChoice:review.priceChoices?.[entryKey],correctedPrice:review.prices?.[entryKey],noteChoice:review.noteChoices?.[entryKey],tariffChoice:review.tariffChoices?.[entryKey],correctedTariffPercent:review.tariffPercents?.[entryKey],correctedTariffAmount:review.tariffAmounts?.[entryKey]}};
        const sourceKey=createHash('sha256').update(JSON.stringify({source,resolution})).digest('hex');
        await tx.odmPricingImportSource.upsert({where:{sourceKey},create:{sourceKey,workbook:source.workbook||'Unknown workbook',sheet:source.sheet,rowNumber:item.line,partIndex:source.partIndex,disposition,source:source as Prisma.InputJsonValue,resolution:JSON.parse(JSON.stringify(resolution)) as Prisma.InputJsonValue},update:{}});
        if (disposition==='HISTORICAL') continue;
      }
      const value=item.after;
      const modelKey=normalizeModel(value.model);
      const skuKey=normalizePartNumber(value.partNumber);
      const repeatedOdmRow=!!item.source && createdSkus.has(skuKey);
      let productId=item.productId ?? created.get(modelKey);
      if (!productId) {
        const product=await tx.product.create({data:{name:value.model,sku:value.partNumber,active:value.active ?? true,category:value.category ? {connect:{code:value.category}} : undefined}});
        productId=product.id;created.set(modelKey,productId);
      } else if (item.classes.includes('UPDATE PRODUCT') || (created.has(modelKey) && value.category)) await tx.product.update({where:{id:productId},data:{name:value.model,category:value.category ? {connect:{code:value.category}} : undefined}});
      let skuId=item.skuId ?? createdSkus.get(skuKey);
      if (!skuId) {
        const sku=await tx.productSku.create({data:{productId,partNumber:value.partNumber,normalizedPartNumber:skuKey,description:value.description,priceUnit:value.priceUnit ?? ProductPriceUnit.EACH,active:value.active ?? true,catalogSource:value.catalogSource,odmSubtype:value.odmSubtype,odmCustomerSourceName:value.odmCustomerSourceName,baseSkuId:value.baseSkuId,odmDescription:value.odmDescription}});
        skuId=sku.id;
      } else if (!repeatedOdmRow && item.classes.includes('UPDATE SKU')) {
        if (value.catalogSource!=='ODM') await tx.productSkuOdmCustomer.updateMany({where:{skuId,archivedAt:null},data:{archivedAt:new Date()}});
        await tx.productSku.update({where:{id:skuId},data:{partNumber:value.partNumber,description:value.description,priceUnit:value.priceUnit,active:value.active,catalogSource:value.catalogSource,odmSubtype:value.catalogSource==='ODM'?value.odmSubtype??null:null,odmCustomerSourceName:value.odmCustomerSourceName??null,baseSkuId:value.baseSkuId??null,odmDescription:value.odmDescription??null}});
      }
      createdSkus.set(skuKey,skuId);
      if (value.catalogSource==='ODM' && value.odmCustomerAccountId) {
        const where={skuId_accountId:{skuId,accountId:value.odmCustomerAccountId}};
        const existing=await tx.productSkuOdmCustomer.findUnique({where,select:{sourceCustomerName:true}});
        const names=[...new Set([...(existing?.sourceCustomerName?.split('\n') ?? []),...(value.odmCustomerSourceName ? [value.odmCustomerSourceName] : [])])];
        await tx.productSkuOdmCustomer.upsert({where,create:{skuId,accountId:value.odmCustomerAccountId,sourceCustomerName:names.join('\n') || null},update:{sourceCustomerName:names.join('\n') || null,archivedAt:null}});
        if (item.odmPricing && value.odmSubtype === 'CUSTOMER_SPECIFIC') {
          const active = await tx.productSkuOdmCustomerPrice.findFirst({where:{skuId,accountId:value.odmCustomerAccountId,archivedAt:null}});
          const terms=item.odmPricing;
          if (!active || active.currencyCode!==terms.currencyCode || !active.customerPrice.equals(terms.customerPrice) || (active.previousPrice?.toFixed(2)??null)!==terms.previousPrice || !active.tariffPercent.equals(terms.tariffPercent) || !active.tariffAmount.equals(terms.tariffAmount) || active.notes!==terms.notes) {
            if (active) await tx.productSkuOdmCustomerPrice.update({where:{id:active.id},data:{archivedAt:new Date()}});
            await tx.productSkuOdmCustomerPrice.create({data:{skuId,accountId:value.odmCustomerAccountId,...terms,sourceType:'GARY_WORKBOOK',sourceMetadata:{workbook:item.source?.workbook,sheet:item.source?.sheet,row:item.line,partIndex:item.source?.partIndex,sourcePartNumber:item.source?.partNumber,sourceCustomer:item.source?.customerCell,oldPrice:item.source?.oldPrice,priorPrice:item.source?.priorPrice,newPrice:item.source?.newPrice,tariffPercent:item.source?.tariffPercent,tariffAmount:item.source?.tariffAmount,note:item.source?.note,rawOldPrice:item.source?.rawOldPrice,rawPriorPrice:item.source?.rawPriorPrice,rawNewPrice:item.source?.rawNewPrice,rawTariffPercent:item.source?.rawTariffPercent,rawTariffAmount:item.source?.rawTariffAmount,resolvedPrice:item.resolvedPrice,resolvedTariffPercent:item.resolvedTariffPercent,resolvedTariffAmount:item.resolvedTariffAmount}}});
          }
        }
      }
      if (value.currency && !item.source) for (const spec of tierFields) {
        const amount=value[spec.field];
        if (amount && amount!==item.before?.[spec.field]) await tx.productPrice.upsert({where:{skuId_currencyCode_tier:{skuId,currencyCode:value.currency,tier:spec.tier}},create:{skuId,currencyCode:value.currency,tier:spec.tier,amount},update:{amount}});
      }
    }
    return plan.counts;
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}

/** Explicit catalog-only stage. Pricing and customer links are left for the final import. */
export async function createProductImportCatalog(db:PrismaClient,csv:string,expectedDigest:string,review:ProductImportReview,selectedKeys:string[],selectedSource?:ProductCatalogSource) {
  if (!selectedKeys.length || selectedKeys.length>5000 || new Set(selectedKeys).size!==selectedKeys.length) throw new Error('Choose valid catalog records to create.');
  return db.$transaction(async tx=>{
    const plan=await planProductImport(tx,csv,selectedSource,review);
    if (!expectedDigest || plan.digest!==expectedDigest || plan.errors.length) throw new Error('Preview changed. Refresh before creating catalog records.');
    const selected=new Set(selectedKeys);
    const candidates=plan.items.filter(item=>selected.has(item.reviewKey ?? ''));
    if (candidates.length!==selected.size || candidates.some(item=>!catalogCreationEligible(item))) throw new Error('Some selected catalog records need review. Refresh the preview.');
    const createdProducts=new Map<string,number>();
    const createdSkus=new Set<string>();
    let newProducts=0,newSkus=0;
    for (const item of candidates) {
      const value=item.after, skuKey=normalizePartNumber(value.partNumber), modelKey=normalizeModel(value.model);
      if (createdSkus.has(skuKey)) continue;
      let productId=item.productId ?? createdProducts.get(modelKey);
      if (!productId) {
        const product=await tx.product.create({data:{name:value.model,sku:value.partNumber,active:value.active ?? true,category:value.category ? {connect:{code:value.category}} : undefined}});
        productId=product.id;createdProducts.set(modelKey,productId);newProducts++;
      }
      await tx.productSku.create({data:{productId,partNumber:value.partNumber,normalizedPartNumber:skuKey,description:value.description,priceUnit:value.priceUnit ?? ProductPriceUnit.EACH,active:value.active ?? true,catalogSource:'ODM',odmSubtype:value.odmSubtype,odmCustomerSourceName:value.odmCustomerSourceName,baseSkuId:value.baseSkuId,odmDescription:value.odmDescription}});
      createdSkus.add(skuKey);newSkus++;
    }
    return {newProducts,newSkus};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}

/** One confirmed, atomic creation for unique source customers; no pricing or catalog writes. */
export async function createProductImportAccounts(db:PrismaClient,csv:string,expectedDigest:string,review:ProductImportReview,candidates:AccountCreationCandidate[],actorId:number,selectedSource?:ProductCatalogSource) {
  if(!candidates.length || candidates.length>200 || new Set(candidates.map(candidate=>candidate.key)).size!==candidates.length) throw new Error('Choose unique source Accounts to create.');
  const validated=[] as {key:string;value:NonNullable<ReturnType<typeof parseAccountForm>['value']>}[];
  for(const candidate of candidates) {
    if(!candidate.key || candidate.key.length>200 || typeof candidate.name!=='string' || candidate.name.length>200 || candidate.role && !Object.values(AccountBusinessRoleCode).includes(candidate.role as AccountBusinessRoleCode)) throw new Error('An Account proposal is invalid.');
    const form=new FormData();form.set('name',candidate.name);form.set('status','ACTIVE');if(candidate.role)form.append('roles',candidate.role);
    const parsed=parseAccountForm(form);
    if(!parsed.value) throw new Error(`Account ${candidate.name||candidate.key}: ${Object.values(parsed.errors).join(' ')}`);
    const references=await checkAccountReferences(db,parsed.value);
    if(Object.keys(references).length) throw new Error(`Account ${candidate.name}: ${Object.values(references).join(' ')}`);
    validated.push({key:candidate.key,value:parsed.value});
  }
  if(new Set(validated.map(candidate=>normalizeAccountName(candidate.value.name))).size!==validated.length) throw new Error('Proposed Account names must be unique. Map shared customers to one Account instead.');
  return db.$transaction(async tx=>{
    const plan=await planProductImport(tx,csv,selectedSource,review);
    if(!expectedDigest || plan.digest!==expectedDigest || plan.errors.length) throw new Error('Preview changed. Refresh before creating Accounts.');
    const missing=new Map(plan.customers.filter(customer=>customer.status==='Unresolved' && !customer.accountId).map(customer=>[customer.key,customer]));
    if(validated.some(candidate=>!missing.has(candidate.key))) throw new Error('One or more source customers are already resolved. Refresh the preview.');
    if(validated.some(candidate=>/->|\s[&/]\s|\([^)]*\)/.test(missing.get(candidate.key)!.source))) throw new Error('Composite Account labels need individual manual interpretation.');
    const existing=await tx.account.findMany({select:{id:true,name:true,status:true,archivedAt:true}});
    const names=new Set(existing.map(account=>normalizeAccountName(account.name)));
    const mappings:Record<string,number>={};
    for(const candidate of validated) {
      const nameKey=normalizeAccountName(candidate.value.name);
      if(names.has(nameKey)) throw new Error(`Account ${candidate.value.name} already exists. Select the existing Account instead.`);
      const account=await tx.account.create({data:{...accountWriteData(candidate.value),createdById:actorId,updatedById:actorId,businessRoles:{create:candidate.value.roles.map(role=>({role}))}}});
      names.add(nameKey);mappings[candidate.key]=account.id;
    }
    return mappings;
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
