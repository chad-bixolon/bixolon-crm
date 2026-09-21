import { createHash } from 'node:crypto';
import readExcelFile from 'read-excel-file/node';
import { Prisma, type PrismaClient } from '@prisma/client';
import { inspectZip, maxXlsxBytes } from './import-xlsx';
import { normalizePartNumber } from './product-import';

export const legacyPriceExceptionSheets = ['Active Disty PEs', 'Expired Disty PEs'] as const;
export const legacyPriceExceptionAdapter = 'BIXOLON_DISTRIBUTOR_PE_V1';
type Status = 'ACTIVE'|'EXPIRED';
type Db = PrismaClient | Prisma.TransactionClient;
type Raw = string|null;
type ParsedRow = {
  sheet:string; rowNumber:number; status:Status; distributor:Raw; varName:Raw; rep:Raw; endUser:Raw;
  code:Raw; oldCode:Raw; expirationDate:Raw; sku:Raw; price:Raw; quantity:Raw; comments:Raw; competitor:Raw;
  rawValues:Raw[];
};
export type PriceExceptionImportLine = {sourceLineKey:string;sourceSku:string|null;productSkuId?:number;price:string|null;currency:'USD';currencyDefaulted:true;sourceQuantity:string|null;sourceQuantityRaw:string|null;sourceUnit:string|null;comments:string|null;competitor:string|null;sortOrder:number;rawValues:Raw[];unresolvedSku:boolean};
export type PriceExceptionImportItem = {sourceKey:string;existingId?:number;archived?:boolean;change:'NEW'|'UPDATE';code:string|null;oldCode:string|null;status:Status;distributor:string|null;varName:string|null;endUser:string|null;distributorAccountId?:number;varAccountId?:number;endUserAccountId?:number;rep:string|null;expirationDate:string|null;sourceDescription:string|null;competitor:string|null;sourceSheet:string;lines:PriceExceptionImportLine[];messages:string[]};
export type PriceExceptionImportCounts = {headers:number;lines:number;newPriceExceptions:number;existingToUpdate:number;resolvedAccounts:number;unresolvedAccounts:number;resolvedSkus:number;unresolvedSkus:number;active:number;expired:number;skippedRows:number;errors:number};
export type PriceExceptionImportPlan = {items:PriceExceptionImportItem[];counts:PriceExceptionImportCounts;errors:string[];digest:string;fileName:string;currencyNote:string};
export type LegacyParseResult = {rows:ParsedRow[];skippedRows:number;errors:string[]};

const text = (value:unknown):string|null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) { if(Number.isNaN(value.valueOf()))return null;const iso=value.toISOString();const year=value.getUTCFullYear();return year>=1900&&year<=2100?iso.slice(0,10):iso; }
  const result=String(value).normalize('NFKC').trim().replace(/\s+/g,' ');
  return result || null;
};
export const normalizeAccountName = (value:string) => value.normalize('NFKC').trim().toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const normalized = (value:Raw) => value ? value.toLowerCase().replace(/\s+/g,' ').trim() : '';
const hash = (value:string) => createHash('sha256').update(value).digest('hex');
const isNumber = (value:Raw) => !!value && /^[-+]?[$]?\s*[\d,.]+$/.test(value);
const money = (value:Raw) => { if (!value) return null; const clean=value.replace(/[$,\s]/g,''); return /^\d{1,10}(?:\.\d{1,2})?$/.test(clean) ? new Prisma.Decimal(clean).toFixed(2) : null; };
export function parseLegacyDate(value:Raw):string|null {
  if (!value) return null;
  const iso=value.match(/^(\d{4})-(\d{2})-(\d{2})/); if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  if (/^\d{7,8}$/.test(value)) { const digits=value.padStart(8,'0'); const month=Number(digits.slice(0,2)),day=Number(digits.slice(2,4)),year=Number(digits.slice(4)); const d=new Date(Date.UTC(year,month-1,day)); if(year>=1900&&year<=2100&&d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===day)return d.toISOString().slice(0,10); }
  if (/^\d{5}(?:\.\d+)?$/.test(value)) { const d=new Date(Date.UTC(1899,11,30)+Number(value)*86400000); if(!Number.isNaN(d.valueOf())&&d.getUTCFullYear()>=1900&&d.getUTCFullYear()<=2100) return d.toISOString().slice(0,10); }
  const d=new Date(value); return Number.isNaN(d.valueOf())||d.getUTCFullYear()<1900||d.getUTCFullYear()>2100 ? null : d.toISOString().slice(0,10);
}
function quantity(value:Raw) { if(!value)return {value:null,unit:null}; const match=value.replaceAll(',','').match(/^([0-9]+(?:\.[0-9]+)?)\s*(.*)$/); return match ? {value:new Prisma.Decimal(match[1]).toFixed(3),unit:match[2]?.trim()||null} : {value:null,unit:null}; }
function expiredLayout(row:unknown[]) { const h=text(row[7]), i=text(row[8]); return !h && !!i && !isNumber(i); }

/** Adapter for the historical workbook only. It deliberately models the Active and Expired layouts separately. */
export async function parseLegacyPriceExceptionWorkbook(buffer:Buffer):Promise<LegacyParseResult> {
  if (!buffer.length || buffer.length>maxXlsxBytes) return {rows:[],skippedRows:0,errors:['Choose an .xlsx file smaller than 4 MB.']};
  const zipError=inspectZip(buffer); if(zipError)return {rows:[],skippedRows:0,errors:[zipError]};
  try {
    const workbook=await readExcelFile<string>(buffer,{parseNumber:value=>value});
    const found=new Set(workbook.map(sheet=>sheet.sheet));
    const missing=legacyPriceExceptionSheets.filter(name=>!found.has(name));
    if(missing.length)return {rows:[],skippedRows:0,errors:[`Legacy workbook is missing worksheet${missing.length===1?'':'s'}: ${missing.join(', ')}.`]};
    const rows:ParsedRow[]=[]; let skippedRows=0;
    for(const sheet of workbook.filter(candidate=>legacyPriceExceptionSheets.includes(candidate.sheet as typeof legacyPriceExceptionSheets[number]))) {
      const active=sheet.sheet==='Active Disty PEs';
      for(let index=1;index<sheet.data.length;index++) {
        const source=sheet.data[index]; const values=source.map(text); if(!values.some(Boolean)){skippedRows++;continue;}
        const shifted=!active&&expiredLayout(source);
        const parsed:ParsedRow={sheet:sheet.sheet,rowNumber:index+1,status:active?'ACTIVE':'EXPIRED',distributor:text(source[0]),varName:text(source[1]),rep:text(source[2]),endUser:text(source[3]),code:text(source[4]),oldCode:text(source[5]),expirationDate:text(source[6]),sku:text(source[active?8:shifted?8:7]),price:text(source[active?9:shifted?9:8]),quantity:text(source[active?10:shifted?10:9]),comments:text(source[active?11:shifted?11:10]),competitor:text(source[active?12:shifted?12:11]),rawValues:values};
        // A nonblank separator/label without a SKU or price is not a commercial line.
        if(!parsed.sku&&!parsed.price){skippedRows++;continue;}
        rows.push(parsed);
      }
    }
    return {rows,skippedRows,errors:[]};
  } catch { return {rows:[],skippedRows:0,errors:['Malformed or unsupported workbook. Save a standard unencrypted .xlsx copy.']}; }
}

function headerIdentity(row:ParsedRow) {
  const header=[row.code,row.oldCode,row.distributor,row.varName,row.rep,row.endUser].map(normalized).join('|');
  // Generic/blank codes are row-scoped by meaningful line content to avoid merging unrelated overrides.
  const ambiguous=!row.code||normalized(row.code)==='sk$override';
  const discriminator=ambiguous ? [row.sku,row.price,row.quantity,row.expirationDate,row.comments].map(normalized).join('|') : '';
  return hash(`${legacyPriceExceptionAdapter}|${header}|${discriminator}`);
}
function lineIdentity(row:ParsedRow, occurrence:number) { return hash([row.sku,row.price,row.quantity,row.comments,row.competitor].map(normalized).join('|')+`|${occurrence}`); }
function blankCounts():PriceExceptionImportCounts{return {headers:0,lines:0,newPriceExceptions:0,existingToUpdate:0,resolvedAccounts:0,unresolvedAccounts:0,resolvedSkus:0,unresolvedSkus:0,active:0,expired:0,skippedRows:0,errors:0};}

export async function planPriceExceptionImport(db:Db, parsed:LegacyParseResult, fileName:string):Promise<PriceExceptionImportPlan> {
  const counts=blankCounts(); counts.skippedRows=parsed.skippedRows;
  if(parsed.errors.length){counts.errors=parsed.errors.length;return {items:[],counts,errors:parsed.errors,digest:'',fileName,currencyNote:'Prices in this workbook use USD because it has no currency column.'};}
  const [accounts,skus,existing]=await Promise.all([
    db.account.findMany({where:{archivedAt:null},select:{id:true,name:true}}),
    db.productSku.findMany({select:{id:true,normalizedPartNumber:true}}),
    db.priceException.findMany({where:{sourceType:'LEGACY_WORKBOOK'},select:{id:true,sourceKey:true,archivedAt:true,distributorAccountId:true,varAccountId:true,endUserAccountId:true}}),
  ]);
  const accountMap=new Map<string,{id:number;name:string}[]>(); for(const account of accounts){const key=normalizeAccountName(account.name);accountMap.set(key,[...(accountMap.get(key)??[]),account]);}
  const skuMap=new Map(skus.map(sku=>[sku.normalizedPartNumber,sku.id])); const existingMap=new Map(existing.map(pe=>[pe.sourceKey,pe]));
  const groups=new Map<string,ParsedRow[]>(); for(const row of parsed.rows){const key=headerIdentity(row);groups.set(key,[...(groups.get(key)??[]),row]);}
  const items:PriceExceptionImportItem[]=[];
  for(const [sourceKey,rows] of groups){const first=rows[0];const messages:string[]=[];
    const resolve=(name:Raw,role:string)=>{if(!name)return undefined;const matches=accountMap.get(normalizeAccountName(name))??[];if(matches.length===1){counts.resolvedAccounts++;return matches[0].id;}counts.unresolvedAccounts++;messages.push(matches.length?`${role} account is ambiguous (${matches.length} matches).`:`${role} account is unresolved.`);return undefined;};
    const occurrences=new Map<string,number>(); const lines=rows.map((row,index)=>{const base=[row.sku,row.price,row.quantity,row.comments,row.competitor].map(normalized).join('|');const occurrence=(occurrences.get(base)??0)+1;occurrences.set(base,occurrence);const skuId=row.sku?skuMap.get(normalizePartNumber(row.sku)):undefined;if(skuId)counts.resolvedSkus++;else {counts.unresolvedSkus++;messages.push(`Row ${row.rowNumber}: SKU ${row.sku??'(blank)'} is unresolved.`);}const parsedPrice=money(row.price);if(row.price&&!parsedPrice)messages.push(`Row ${row.rowNumber}: price “${row.price}” could not be read as a number. The original value was kept; the unit price is blank.`);const qty=quantity(row.quantity);if(row.quantity&&!qty.value)messages.push(`Row ${row.rowNumber}: quantity “${row.quantity}” could not be read as a number. The original value was kept; MOQ is blank.`);return {sourceLineKey:lineIdentity(row,occurrence),sourceSku:row.sku,productSkuId:skuId,price:parsedPrice,currency:'USD' as const,currencyDefaulted:true as const,sourceQuantity:qty.value,sourceQuantityRaw:row.quantity,sourceUnit:qty.unit,comments:row.comments,competitor:row.competitor,sortOrder:index,rawValues:row.rawValues,unresolvedSku:!skuId};});
    const existingRow=existingMap.get(sourceKey); const existingId=existingRow?.id; const expirationDate=parseLegacyDate(first.expirationDate); if(first.expirationDate&&!expirationDate)messages.push(`Expiration date “${first.expirationDate}” could not be read. The original value was kept; the expiration date is blank.`);
    const automaticDistributorAccountId=resolve(first.distributor,'Distributor/OEM');
    const automaticVarAccountId=resolve(first.varName,'VAR/ISV');
    const automaticEndUserAccountId=resolve(first.endUser,'End User');
    // Existing links may have been resolved manually. Re-import only fills a null link;
    // it never replaces or clears a relationship that is already part of CRM history.
    const item:PriceExceptionImportItem={sourceKey,existingId,archived:!!existingRow?.archivedAt,change:existingId?'UPDATE':'NEW',code:first.code,oldCode:first.oldCode,status:first.status,distributor:first.distributor,varName:first.varName,endUser:first.endUser,distributorAccountId:existingRow?.distributorAccountId??automaticDistributorAccountId,varAccountId:existingRow?.varAccountId??automaticVarAccountId,endUserAccountId:existingRow?.endUserAccountId??automaticEndUserAccountId,rep:first.rep,expirationDate,sourceDescription:[...new Set(rows.map(r=>r.comments).filter(Boolean))].join('\n')||null,competitor:[...new Set(rows.map(r=>r.competitor).filter(Boolean))].join(', ')||null,sourceSheet:[...new Set(rows.map(r=>r.sheet))].join(', '),lines,messages};items.push(item);
    counts.headers++;counts.lines+=lines.length;
    if(existingId)counts.existingToUpdate++;else counts.newPriceExceptions++;
    if(first.status==='ACTIVE')counts.active++;else counts.expired++;
  }
  const errors:string[]=[];
  const digest=hash(JSON.stringify(items));
  return {items,counts,errors,digest,fileName,currencyNote:'Prices in this workbook use USD because it has no currency column.'};
}

export async function applyPriceExceptionImport(db:PrismaClient,parsed:LegacyParseResult,fileName:string,expectedDigest:string,actorId:number){
  return db.$transaction(async tx=>{const plan=await planPriceExceptionImport(tx,parsed,fileName);if(!expectedDigest||plan.digest!==expectedDigest||plan.errors.length)throw new Error('Preview changed or contains errors. Preview the workbook again before confirming.');
    for(const item of plan.items){const data={peCode:item.code,predecessorPeCode:item.oldCode,status:item.archived?'ARCHIVED' as const:item.status,sourceKey:item.sourceKey,distributorAccountId:item.distributorAccountId??null,varAccountId:item.varAccountId??null,endUserAccountId:item.endUserAccountId??null,distributorSourceName:item.distributor,varSourceName:item.varName,endUserSourceName:item.endUser,distributorSalesRep:item.rep,expirationDate:item.expirationDate?new Date(`${item.expirationDate}T00:00:00.000Z`):null,sourceDescription:item.sourceDescription,competitor:item.competitor,sourceFileName:fileName,sourceSheet:item.sourceSheet,sourceMetadata:{adapter:legacyPriceExceptionAdapter,currencyDefaulted:'USD'},updatedById:actorId};
      const pe=await tx.priceException.upsert({where:{sourceType_sourceKey:{sourceType:'LEGACY_WORKBOOK',sourceKey:item.sourceKey}},create:{...data,status:item.status,sourceType:'LEGACY_WORKBOOK',createdById:actorId},update:data});
      // Lines already selected on an Opportunity are commercial history. Keep those
      // rows even when a later source file omits them; unreferenced omissions can be removed.
      const keys=item.lines.map(line=>line.sourceLineKey);await tx.priceExceptionLine.deleteMany({where:{priceExceptionId:pe.id,sourceLineKey:{notIn:keys},opportunityProducts:{none:{}}}});
      for(const line of item.lines){const lineData={productSkuId:line.productSkuId??null,sourceSku:line.sourceSku,approvedUnitPrice:line.price,currencyCode:line.currency,sourceQuantity:line.sourceQuantity,sourceQuantityRaw:line.sourceQuantityRaw,sourceUnit:line.sourceUnit,comments:line.comments,competitor:line.competitor,sortOrder:line.sortOrder,sourceMetadata:{rawValues:line.rawValues,currencyDefaulted:true}};await tx.priceExceptionLine.upsert({where:{priceExceptionId_sourceLineKey:{priceExceptionId:pe.id,sourceLineKey:line.sourceLineKey}},create:{priceExceptionId:pe.id,sourceLineKey:line.sourceLineKey,...lineData},update:lineData});}
    } return plan.counts;
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:60000});
}
