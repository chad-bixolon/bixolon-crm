import { Prisma } from '@prisma/client';
import { productImportHeaders } from './product-import';
import type { XlsxTransform } from './import-xlsx';

const flat=(value:string|undefined)=> (value ?? '').replace(/\s+/g,' ').trim();
const firstLine=(value:string|undefined)=> (value ?? '').split(/\r\n|\n|\r/)[0].trim();
const cell=(row:string[],index:number)=>flat(row[index]);
const money=(value:string)=>{
  const text=flat(value);
  if (!text) return '';
  try { return new Prisma.Decimal(text).toDecimalPlaces(2,Prisma.Decimal.ROUND_HALF_UP).toFixed(2); }
  catch { return text; } // Keep invalid source values visible to normal row validation.
};
const mapped=(model:string,part:string,description:string,prices:{standard?:string;msrp?:string;reseller?:string;distributor?:string},currency:string,unit='EACH')=>[model,part,description,money(prices.standard ?? ''),money(prices.msrp ?? ''),money(prices.reseller ?? ''),money(prices.distributor ?? ''),currency,unit,''];

/** Adapts a selected 2026 BIXOLON price-list tab to the normal catalog CSV columns. */
export const mapProductWorkbookSheet=(sheet:string,rows:string[][],currencyOverride:string):ReturnType<XlsxTransform>=>{
  if (flat(rows[0]?.[0]).toLowerCase()==='model' && flat(rows[0]?.[1]).toLowerCase()==='part_number') return {rows};
  const name=sheet.trim();
  if (name==='Cover') return {error:'Cover is change history, not a product price list. Choose a catalog worksheet.'};
  if (name==='TT ribbon') return {error:'Use TT ribbon  (2). The older TT ribbon tab is excluded because its overlapping SKUs have different prices.'};
  const fixedCurrency=currencyOverride.trim().toUpperCase();
  const needsCurrency=!['TT ribbon  (2)','Linerless paper'].includes(name);
  if (needsCurrency && !fixedCurrency) return {error:`${sheet} has no currency column. Enter its currency code before previewing.`};
  let priceColumn:number;
  let start:number;
  let kind:'printer'|'ribbon'|'accessory'|'warranty'|'paper';
  if (['POS printers','Mobile printers','Label printers','Laser printers'].includes(name)) {
    kind='printer'; start=2; priceColumn=name==='Laser printers'?4:3;
    if (cell(rows[1] ?? [],0).toUpperCase()!=='MODEL NAME' || cell(rows[1] ?? [],priceColumn).toUpperCase()!=='MSRP') return {error:`${sheet} headers differ from the supported BIXOLON price-list layout.`};
  } else if (name==='TT ribbon  (2)') {
    kind='ribbon';start=1;priceColumn=11;
    if (cell(rows[0] ?? [],1).toUpperCase()!=='PART NUMBER' || cell(rows[0] ?? [],11).toUpperCase()!=='MSRP PER CASE') return {error:`${sheet} headers differ from the supported ribbon layout.`};
  } else if (name==='Mobile Printer Accessories') {
    kind='accessory';start=1;priceColumn=4;
    if (cell(rows[0] ?? [],1).toUpperCase()!=='PART CODE' || cell(rows[0] ?? [],4).toUpperCase()!=='MSRP') return {error:`${sheet} headers differ from the supported accessories layout.`};
  } else if (name==='Warranty Options') {
    kind='warranty';start=2;priceColumn=4;
    if (cell(rows[1] ?? [],0).toUpperCase()!=='SERVICE SKU' || cell(rows[1] ?? [],4).toUpperCase()!=='MSRP') return {error:`${sheet} headers differ from the supported warranty layout.`};
  } else if (name==='Linerless paper') {
    kind='paper';start=3;priceColumn=8;
    if (cell(rows[2] ?? [],3).toUpperCase()!=='NEW PART NUMBER FROM JAPAN (BOX)' || cell(rows[2] ?? [],8).toUpperCase()!=='MSRP (USD)/BOX') return {error:'Linerless paper headers differ from the supported layout.'};
  } else return {error:`${sheet} is not a supported BIXOLON product worksheet. Choose a catalog worksheet or use the CSV template.`};

  const obsoleteMobileRows=new Set<number>();
  if (name==='Mobile printers') {
    for (const [index,row] of rows.entries()) {
      if (firstLine(row[0]).toLowerCase()!=='spp-r200iiiik' || !/bluetooth\s*v3\.0/i.test(cell(row,1))) continue;
      const current=rows.findIndex((candidate,later)=>later>index && firstLine(candidate[0]).toLowerCase()==='spp-r200iiiik' && /replaced\s+SPP-R200IIIplusiK/i.test(flat(candidate[0])) && /bluetooth\s*v4\.1/i.test(cell(candidate,1)) && /\bBLE\b/i.test(cell(candidate,1)));
      if (current<0) return {error:'Mobile printers has the obsolete SPP-R200IIIiK Bluetooth 3.0 row without its expected later Bluetooth 4.1 + BLE replacement. Review the worksheet.'};
      obsoleteMobileRows.add(index);
    }
  }
  const output:string[][]=[Array.from(productImportHeaders)];
  for (let index=1;index<rows.length;index++) {
    const row=rows[index] ?? [];
    if (index<start) {output.push([]);continue;}
    if (obsoleteMobileRows.has(index)) {output.push([]);continue;}
    let data:string[]=[];
    if (kind==='printer') {
      const part=firstLine(row[0]);
      if (part && (cell(row,1) || cell(row,priceColumn))) data=mapped(part,part,cell(row,1),{
        standard:name==='POS printers'||name==='Mobile printers' ? row[4] : undefined,
        msrp:row[priceColumn],
        reseller:name==='Label printers' ? row[4] : name==='Laser printers' ? row[5] : undefined,
        distributor:name==='Label printers' ? row[6] : name==='Laser printers' ? row[7] : undefined,
      },fixedCurrency);
    } else if (kind==='ribbon') {
      const part=cell(row,1);
      if (part && (cell(row,9) || cell(row,priceColumn))) data=mapped(cell(row,2),part,cell(row,9),{msrp:row[11],distributor:row[12]},cell(row,8),'CASE');
    } else if (kind==='accessory') {
      const part=cell(row,1);
      if (part && (cell(row,2) || cell(row,priceColumn))) data=mapped(part,part,cell(row,2),{msrp:row[4],distributor:row[3]},fixedCurrency);
    } else if (kind==='warranty') {
      const part=cell(row,0);
      if (part && (cell(row,2) || cell(row,priceColumn))) data=mapped(part,part,cell(row,2),{msrp:row[4],distributor:row[5]},fixedCurrency);
    } else {
      const part=cell(row,3);
      // The table beginning at row 16 describes container quantities, not prices.
      if (index<=9 && part && (cell(row,4) || cell(row,priceColumn))) {
        const model=cell(row,1) || part;
        const description=[cell(row,5),cell(row,4),'linerless paper',cell(row,6) ? `compatible with ${cell(row,6)}` : '',index===9?'price per roll':'price per box'].filter(Boolean).join('; ');
        data=mapped(model,part,description,{msrp:row[priceColumn],distributor:row[9]},'USD',index===9?'ROLL':'BOX');
      }
    }
    output.push(data);
  }
  return {rows:output};
};
