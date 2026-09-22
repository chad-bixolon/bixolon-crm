import { Prisma } from '@prisma/client';
import { parseImportXlsx, type XlsxResult, type XlsxTransform } from './import-xlsx';
import { productImportHeaders, odmSourceHeaders } from './product-import';
import { mapProductWorkbookSheet } from './product-workbook';

const flat=(value:string|undefined)=>(value ?? '').replace(/\s+/g,' ').trim();
const header=(value:string|undefined)=>flat(value).toLowerCase();
const expected=['customer','bixolon part number','old price','old price','new price','tariff separate line (%)','tariff separate line ($)'];

/** Gary's sheet has two Old Price columns and separate percentage/dollar tariff columns. */
export function odmHeaderIndex(rows:string[][]):number {
  for(let index=0;index<Math.min(rows.length,15);index++) {
    if (!expected.every((name,offset)=>header(rows[index]?.[offset+1])===name)) continue;
    const sample=rows.slice(index+1,index+13);
    if (sample.filter(row=>flat(row[2]) && (flat(row[1]) || flat(row[5]))).length>=2) return index;
  }
  return -1;
}

const price=(value:string|undefined)=>{
  const raw=flat(value);
  if (!raw || raw==='-' || /^N\/A$/i.test(raw)) return raw;
  try { return new Prisma.Decimal(raw).toDecimalPlaces(2,Prisma.Decimal.ROUND_HALF_UP).toFixed(2); }
  catch { return raw; }
};
const percent=(value:string|undefined)=>{
  const raw=flat(value);
  if (!raw) return '';
  try { return `${new Prisma.Decimal(raw).mul(100).toDecimalPlaces(2).toString()}%`; }
  catch { return raw; }
};

/** Leaves one output row per source row so import preview line numbers remain workbook row numbers. */
export const mapOdmProductWorkbookSheet:XlsxTransform=(sheet,rows)=>{
  void sheet;
  const headerIndex=odmHeaderIndex(rows);
  if (headerIndex<0) return {error:'The worksheet does not match the supported ODM customer-pricing format.'};
  const mapped:string[][]=[[...productImportHeaders,...odmSourceHeaders]];
  for(let index=1;index<rows.length;index++) {
    const row=rows[index] ?? [];
    if(index<=headerIndex) {mapped.push([]);continue;}
    const rawPart=(row[2] ?? '').trim();
    if(!rawPart && !row.some(value=>flat(value))) {mapped.push([]);continue;}
    const external=/^(.+?)\s+\((Y\d+)\)$/i.exec(rawPart);
    const part=external ? external[1].trim() : rawPart;
    const note=flat(row[8]);
    const description=[note && !/^\$?\d+(?:\.\d+)?$/.test(note) ? note : '',external ? `Customer reference ${external[2]}` : ''].filter(Boolean).join('; ');
    const values:Record<string,string>={model:part,part_number:part,odm_customer:flat(row[1]),odm_description:description,
      odm_source_format:'ODM_CUSTOMER_PRICING',odm_source_row:String(index+1),odm_source_customer_cell:flat(row[1]),odm_source_part_number:rawPart,
      odm_source_old_price:price(row[3]),odm_source_prior_price:price(row[4]),odm_source_new_price:price(row[5]),
      odm_source_tariff_percent:percent(row[6]),odm_source_tariff_amount:price(row[7]),odm_source_note:note};
    mapped.push([...productImportHeaders,...odmSourceHeaders].map(key=>values[key] ?? ''));
  }
  return {rows:mapped};
};

export const routeProductWorkbookSheet=(sheet:string,rows:string[][],currency:string):ReturnType<XlsxTransform>=>{
  if(odmHeaderIndex(rows)>=0) return mapOdmProductWorkbookSheet(sheet,rows);
  const standard=mapProductWorkbookSheet(sheet,rows,currency);
  if(standard.error?.includes('is not a supported BIXOLON product worksheet')) return {error:'The workbook does not match the supported BIXOLON price-list or ODM customer-pricing formats.'};
  return standard;
};

export async function parseProductWorkbookXlsx(buffer:Buffer,requestedSheet:string|undefined,currency:string):Promise<XlsxResult & {ignoredSheets?:string[]}> {
  const route:XlsxTransform=(sheet,rows)=>routeProductWorkbookSheet(sheet,rows,currency);
  if(requestedSheet) return parseImportXlsx(buffer,requestedSheet,route);
  const initial=await parseImportXlsx(buffer);
  if(initial.sheets.length<=1) return initial.error && initial.sheets.length===0 ? initial : parseImportXlsx(buffer,initial.sheets[0],route);
  const odmSheets:string[]=[];
  for(const sheet of initial.sheets) {
    const probe=await parseImportXlsx(buffer,sheet,(_name,rows)=>({rows:[[odmHeaderIndex(rows)>=0?'ODM':'OTHER']]}));
    if(probe.csv?.startsWith('ODM\n')) odmSheets.push(sheet);
  }
  if(odmSheets.length===1) {
    const result=await parseImportXlsx(buffer,odmSheets[0],route);
    return {...result,ignoredSheets:initial.sheets.filter(sheet=>sheet!==odmSheets[0])};
  }
  return {sheets:initial.sheets,error:odmSheets.length>1?'Choose an ODM customer-pricing worksheet to preview. Worksheets are never combined.':initial.error};
}
