import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename);
const require=Module.createRequire(fileURLToPath(import.meta.url));
const {parseProductWorkbookXlsx,routeProductWorkbookSheet,odmHeaderIndex,mapOdmProductWorkbookSheet}=require(path.join(root,'lib/odm-product-workbook.ts'));
const {planProductImport,applyProductImport,createProductImportAccounts,createProductImportCatalog,productImportHeaders,odmSourceHeaders}=require(path.join(root,'lib/product-import.ts'));
const {parseImportCsv}=require(path.join(root,'lib/import-csv.ts'));
const realPath=path.resolve(root,'../reference-data/ODM customer pricing_Sep 2026.xlsx');
const real=fs.readFileSync(realPath);
const headers=[...productImportHeaders,...odmSourceHeaders];
const parsed=async buffer=>{const result=await parseProductWorkbookXlsx(buffer,undefined,'USD');return {result,rows:result.csv?parseImportCsv(result.csv,headers).rows:[]};};
const fakeDb=(accounts=[],products=[])=>({account:{findMany:async()=>accounts},product:{findMany:async()=>products},productCategory:{findMany:async()=>[]}});
const odmHeader=['','Customer','Bixolon Part Number','Old Price','Old Price','New Price','Tariff Separate Line (%)','Tariff Separate Line ($)'];
function syntheticCsv(part,customer='NCR',extra=[]) {
  const mapped=mapOdmProductWorkbookSheet('Test sheet',[[],odmHeader,['',customer,part,'100','110','120','0.135','15','Shared note'],['','UPS','SINGLE-SKU','','','200'],...extra]);
  assert.equal(mapped.error,undefined);
  const csv=mapped.rows.map(row=>row.map(value=>/[",\r\n]/.test(value)?`"${value.replaceAll('"','""')}"`:value).join(',')).join('\n')+'\n';
  return {csv,rows:parseImportCsv(csv,headers).rows};
}
function withSecondSheet(name,xml) {
  const entries=unzipSync(real);
  entries['xl/workbook.xml']=strToU8(strFromU8(entries['xl/workbook.xml']).replace('</sheets>',`<sheet name="${name}" sheetId="17" r:id="rId22"/></sheets>`));
  entries['xl/_rels/workbook.xml.rels']=strToU8(strFromU8(entries['xl/_rels/workbook.xml.rels']).replace('</Relationships>','<Relationship Id="rId22" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>'));
  entries['[Content_Types].xml']=strToU8(strFromU8(entries['[Content_Types].xml']).replace('</Types>','<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'));
  entries['xl/worksheets/sheet2.xml']=xml;
  return Buffer.from(zipSync(entries));
}

test('real ODM sheet is recognized by row-two structure and preserves commercial source details',async()=>{
  const {result,rows}=await parsed(real);
  assert.equal(result.error,undefined);
  assert.deepEqual(result.sheets,['09.14.26']);
  assert.equal(result.selectedSheet,'09.14.26');
  assert.equal(rows.length,122);
  assert.equal(rows[0].line,3);
  assert.equal(rows[0].values.odm_source_new_price,'425.70');
  assert.equal(rows[0].values.standard_price,'');
  assert.equal(rows.find(row=>row.values.odm_source_row==='18').values.odm_source_tariff_percent,'13.5%');
  const brady=rows.find(row=>row.values.odm_source_row==='122').values;
  assert.equal(brady.part_number,'XT5-43D9S/BRD');
  assert.equal(brady.odm_source_part_number,'XT5-43D9S/BRD (Y6727848)');
  assert.match(brady.odm_description,/Customer reference Y6727848/);
  assert.equal(rows.find(row=>row.values.odm_source_row==='46').values.part_number,'RSC-S300II (KM04-01262A)');
  assert.equal(rows.find(row=>row.values.odm_source_row==='85').values.odm_customer,'');
});
test('ODM detection ignores worksheet names but rejects unrelated sheets',async()=>{
  const entries=unzipSync(real);
  const workbook=strFromU8(entries['xl/workbook.xml']);
  assert.match(workbook,/09\.14\.26/);
  entries['xl/workbook.xml']=strToU8(workbook.replace('09.14.26','Future Customer Prices'));
  const changed=await parsed(Buffer.from(zipSync(entries)));
  assert.equal(changed.result.error,undefined);
  assert.equal(changed.result.selectedSheet,'Future Customer Prices');
  assert.equal(changed.rows.length,122);
  const signature=[[],['','Customer','Bixolon Part Number','Old Price','Old Price','New Price','Tariff\nSeparate Line\n(%)','Tariff\nSeparate Line\n($)'],['','UPS','SKU-1','','','10'],['','UPS','SKU-2','','','11']];
  assert.equal(odmHeaderIndex(signature),1);
  assert.equal(odmHeaderIndex([['Customer','Bixolon Part Number','New Price'],['UPS','SKU-1','10']]),-1);
  assert.match(routeProductWorkbookSheet('Unrelated',[['Some','Other','Headers']], 'USD').error,/does not match the supported/);
});
test('multi-sheet upload selects one ODM sheet and reports unrelated sheets',async()=>{
  const note=strToU8('<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Notes only</t></is></c></row></sheetData></worksheet>');
  const one=await parseProductWorkbookXlsx(withSecondSheet('Notes',note),undefined,'USD');
  assert.equal(one.error,undefined);
  assert.equal(one.selectedSheet,'09.14.26');
  assert.deepEqual(one.ignoredSheets,['Notes']);
  const duplicate=await parseProductWorkbookXlsx(withSecondSheet('Later',unzipSync(real)['xl/worksheets/sheet1.xml']),undefined,'USD');
  assert.match(duplicate.error,/Choose an ODM customer-pricing worksheet/);
  assert.equal(duplicate.csv,undefined);
});
test('standard price-list routing and worksheet validation remain intact',async()=>{
  const file=fs.readFileSync(path.resolve(root,'../reference-data/BIXOLON_Price_List.xlsx'));
  const pos=await parseProductWorkbookXlsx(file,'POS printers','USD');
  assert.equal(pos.error,undefined);
  const rows=parseImportCsv(pos.csv,productImportHeaders).rows;
  assert.equal(rows.length,132);
  assert.equal(rows[0].values.catalog_source,'PRICE_LIST');
  assert.equal(rows[0].values.category,'POS');
  assert.match((await parseProductWorkbookXlsx(file,'TT ribbon ','USD')).error,/older TT ribbon/);
  assert.match((await parseProductWorkbookXlsx(file,undefined,'USD')).error,/Choose the worksheet/);
});
test('blank customers are not carried forward and uncertain part numbers block review',async()=>{
  const {result}=await parsed(real);
  const review={subtypes:{'IFJ-WDK (NEW PART IFJ-WDAK)':'CUSTOMER_SPECIFIC','XT5-43D9S/BRD':'CUSTOMER_SPECIFIC'}};
  const plan=await planProductImport(fakeDb([{id:7,name:'Brady'}]),result.csv,undefined,review);
  const blank=plan.items.find(item=>item.line===85);
  assert.equal(blank.source.customerCell,'');
  assert.equal(blank.after.odmCustomerAccountId,undefined);
  assert.match(blank.messages.join(' '),/needs an existing SalesHub Account/);
  assert.match(blank.messages.join(' '),/Annotated source part number/);
  const multiline=plan.items.filter(item=>item.line===66);
  assert.equal(multiline.length,2);
  assert.ok(multiline.every(item=>!item.messages.some(message=>message.includes('multiple lines'))));
  const brady=plan.items.find(item=>item.line===122);
  assert.equal(brady.after.odmCustomerAccountId,7);
  assert.equal(brady.after.odmCustomerSourceName,'Brady');
  assert.equal(brady.after.partNumber,'XT5-43D9S/BRD');
  assert.equal(brady.after.standardPrice,undefined);
});
test('real workbook requires classification, keeps complex labels for mapping, and never writes prices',async()=>{
  const {result}=await parsed(real);
  const initial=await planProductImport(fakeDb([{id:7,name:'UPS'},{id:8,name:'Amazon'}]),result.csv);
  assert.equal(initial.items.length,122);
  assert.equal(initial.customers.length,0);
  const recommended=await planProductImport(fakeDb([{id:7,name:'UPS'},{id:8,name:'Amazon'}]),result.csv,undefined,{applyRecommendations:true});
  assert.equal(recommended.customers.length,21);
  assert.equal(recommended.customers.find(c=>c.source==='UPS').status,'Matched');
  assert.equal(recommended.customers.find(c=>c.source==='Amazon (thr BS -> Levata)').status,'Unresolved');
  assert.equal(initial.items.filter(item=>item.source&&!item.source.customerCell).length,6);
  assert.equal(initial.items.filter(item=>item.messages.some(message=>message.includes('Choose an ODM subtype'))).length,122);
  assert.equal(initial.items.filter(item=>item.after.catalogSource==='ODM').length,122);
  assert.equal(initial.items.filter(item=>item.after.catalogSource==='SPECIAL_SKU_LIST').length,0);
  const review={customerMappings:{'amazon (thr bs -> levata)':8},subtypes:{'XL5-40CTG/AMZ':'CUSTOMER_SPECIFIC','XL5-40CTBG/AMZ':'SPECIAL_CONFIGURATION'}};
  const mapped=await planProductImport(fakeDb([{id:7,name:'UPS'},{id:8,name:'Amazon'}]),result.csv,undefined,review);
  assert.equal(mapped.items.find(item=>item.line===4).after.odmCustomerAccountId,8);
  assert.equal(mapped.items.find(item=>item.line===4).after.odmCustomerSourceName,'Amazon (thr BS -> Levata)');
  assert.equal(mapped.items.find(item=>item.line===5).after.odmCustomerAccountId,undefined);
  assert.equal(mapped.items.find(item=>item.line===5).after.catalogSource,'ODM');
  assert.equal(mapped.items.filter(item=>item.classes.includes('PRICE CHANGE')).length,0);
  assert.match(mapped.notices.join(' '),/never written to generic catalog tiers/);
  assert.doesNotMatch(mapped.items.find(item=>item.line===45).messages.join(' '),/Duplicate part number/);
  assert.doesNotMatch(mapped.items.find(item=>item.line===47).messages.join(' '),/Duplicate part number/);
});
test('current-upload Account mapping resolves every matching real workbook row without changing source text or classification',async()=>{
  const {result}=await parsed(real);
  const initial=await planProductImport(fakeDb(),result.csv,undefined,{applyRecommendations:true});
  const brady=initial.customers.find(customer=>customer.source==='Brady');
  const amazon=initial.customers.find(customer=>customer.source==='Amazon (thr BS -> Levata)');
  assert.equal(brady.status,'Unresolved');
  assert.equal(amazon.status,'Unresolved');
  const review={customerMappings:{[brady.key]:70,[amazon.key]:71}};
  const accounts=[{id:70,name:'Brady'},{id:71,name:'Amazon'}];
  const mapped=await planProductImport(fakeDb(accounts),result.csv,undefined,{...review,applyRecommendations:true});
  for(const source of ['Brady','Amazon (thr BS -> Levata)']) {
    const rows=mapped.items.filter(item=>item.source?.customerCell===source);
    assert.ok(rows.length>0);
    assert.equal(rows.length,initial.customers.find(customer=>customer.source===source).rows);
    assert.equal(mapped.customers.find(customer=>customer.source===source).status,'Manually Mapped');
    for(const item of rows) {
      assert.equal(item.source.customerCell,source);
      assert.equal(item.after.catalogSource,'ODM');
      assert.equal(item.after.odmCustomerAccountId,source==='Brady'?70:71);
    }
  }
  const classified=await planProductImport(fakeDb(accounts),result.csv,undefined,{...review,subtypes:{'XT5-43D9S/BRD':'CUSTOMER_SPECIFIC'}});
  const row=classified.items.find(item=>item.line===122);
  assert.equal(row.after.odmCustomerAccountId,70);
  assert.equal(row.after.odmCustomerSourceName,'Brady');
  assert.equal(row.after.catalogSource,'ODM');
});
test('existing SKU keeps its Product and category until its classification is explicitly reviewed',async()=>{
  const {result}=await parsed(real);
  const sku={id:2,partNumber:'XT5-40S',normalizedPartNumber:'XT5-40S',catalogSource:'PRICE_LIST',description:null,priceUnit:'EACH',active:true,prices:[]};
  const product={id:1,name:'XT5-40',category:{code:'LABEL'},archivedAt:null,skus:[sku]};
  const initial=await planProductImport(fakeDb([], [product]),result.csv);
  const row=initial.items.find(item=>item.line===98);
  assert.equal(row.skuId,2);
  assert.equal(row.after.model,'XT5-40');
  assert.equal(row.after.category,'LABEL');
  assert.equal(row.after.catalogSource,'ODM');
  const reviewed=await planProductImport(fakeDb([], [product]),result.csv,undefined,{subtypes:{'XT5-40S':'SPECIAL_CONFIGURATION'}});
  assert.equal(reviewed.items.find(item=>item.line===98).after.odmSubtype,'SPECIAL_CONFIGURATION');
  assert.equal(reviewed.items.find(item=>item.line===98).classes.includes('NEW SKU'),false);
});
test('LF, CRLF, CR, blanks, and whitespace expand into independent candidates with shared provenance',async()=>{
  for(const separator of ['\n','\r\n','\r']) {
    const raw=`  SRP-S300LOEK/RDU  ${separator}${separator} SRP-S300LOEK/NSU  `;
    const {rows}=syntheticCsv(raw);
    const split=rows.filter(row=>row.values.odm_source_row==='3');
    assert.deepEqual(split.map(row=>row.values.part_number),['SRP-S300LOEK/RDU','SRP-S300LOEK/NSU']);
    for(const [index,row] of split.entries()) {
      assert.equal(row.values.odm_source_part_number,raw);
      assert.equal(row.values.odm_source_sheet,'Test sheet');
      assert.equal(row.values.odm_source_part_index,String(index+1));
      assert.equal(row.values.odm_source_part_count,'2');
      assert.equal(row.values.odm_source_customer_cell,'NCR');
      assert.equal(row.values.odm_source_old_price,'100.00');
      assert.equal(row.values.odm_source_new_price,'120.00');
      assert.equal(row.values.odm_source_tariff_percent,'13.5%');
      assert.equal(row.values.odm_source_tariff_amount,'15.00');
      assert.equal(row.values.odm_source_note,'Shared note');
    }
  }
});
test('classification and import decisions remain per SKU and repeats consolidate after expansion',async()=>{
  const {csv:rawCsv}=syntheticCsv('SRP-S300LOEK/RDU\nSRP-S300LOEK/NSU','NCR',[['','UPS','SRP-S300LOEK/RDU','','','250']]);
  const csv=rawCsv.replaceAll('15.00','16.20');
  const review={subtypes:{'SRP-S300LOEK/RDU':'CUSTOMER_SPECIFIC','SRP-S300LOEK/NSU':'SPECIAL_CONFIGURATION','SINGLE-SKU':'OTHER'},createCatalog:{'3:1':'CONFIRM','3:2':'CONFIRM','4:1':'CONFIRM','5:1':'CONFIRM'}};
  const plan=await planProductImport(fakeDb([{id:1,name:'NCR'},{id:2,name:'UPS'}]),csv,undefined,review);
  const rdu=plan.items.filter(item=>item.after.partNumber==='SRP-S300LOEK/RDU');
  const nsu=plan.items.find(item=>item.after.partNumber==='SRP-S300LOEK/NSU');
  assert.equal(rdu.length,2);
  assert.deepEqual(rdu.map(item=>item.after.odmCustomerAccountId),[1,2]);
  assert.equal(nsu.after.catalogSource,'ODM');
  assert.equal(nsu.after.odmCustomerAccountId,undefined);
  assert.equal(nsu.line,3);
  assert.equal(plan.counts.newSkus,3); // Includes the unrelated single-line SKU.
  assert.ok(rdu.every(item=>!item.classes.includes('ERROR')));
  assert.ok(nsu.messages.every(message=>!message.includes('Choose an ODM subtype')));
  const unresolved=await planProductImport(fakeDb([{id:2,name:'UPS'}]),csv,undefined,review);
  assert.match(unresolved.items.find(item=>item.line===3&&item.after.partNumber==='SRP-S300LOEK/RDU').messages.join(' '),/needs an existing SalesHub Account/);
  assert.equal(unresolved.items.find(item=>item.line===3&&item.after.partNumber==='SRP-S300LOEK/NSU').classes.includes('ERROR'),false);
  const createdSkus=[];
  const links=[];
  const client={...fakeDb([{id:1,name:'NCR'},{id:2,name:'UPS'}]),$transaction:async callback=>callback({
    ...fakeDb([{id:1,name:'NCR'},{id:2,name:'UPS'}]),
    product:{findMany:async()=>[],create:async()=>({id:createdSkus.length+1})},
    productSku:{create:async({data})=>{createdSkus.push(data);return {id:createdSkus.length}}},
    productSkuOdmCustomer:{findUnique:async()=>null,upsert:async({create})=>{links.push(create)}},
    odmPricingImportSource:{upsert:async()=>{}},productSkuOdmCustomerPrice:{findFirst:async()=>null,create:async()=>{}},
  })};
  await applyProductImport(client,csv,plan.digest,undefined,review);
  assert.equal(createdSkus.filter(sku=>sku.partNumber==='SRP-S300LOEK/RDU').length,1);
  assert.deepEqual(links.map(link=>link.accountId),[1,2]);
});
test('Gary Old/New and tariff columns produce reviewed customer pricing and flag inconsistent source math',async()=>{
  const {csv:raw}=syntheticCsv('ODM-PRICED','UPS');
  const review={subtypes:{'ODM-PRICED':'CUSTOMER_SPECIFIC','SINGLE-SKU':'OTHER'}};
  const inconsistent=await planProductImport(fakeDb([{id:7,name:'UPS'}]),raw,undefined,review);
  assert.match(inconsistent.items[0].messages.join(' '),/Tariff Amount disagrees/);
  assert.equal(inconsistent.items[0].odmPricing,undefined);
  const valid=await planProductImport(fakeDb([{id:7,name:'UPS'}]),raw.replace('15.00','16.20'),undefined,review);
  const price=valid.items[0].odmPricing;
  assert.deepEqual([price.previousPrice,price.customerPrice,price.tariffPercent,price.tariffAmount,price.finalUnitPrice],['100.00','120.00','13.5000','16.20','136.20']);
  assert.equal(valid.items[0].after.odmCustomerAccountId,7);
});
test('single-line parts stay unchanged and ambiguous multiline cells remain blocked',async()=>{
  const single=syntheticCsv('SINGLE-SKU').rows.find(row=>row.values.odm_source_row==='3');
  assert.equal(single.values.part_number,'SINGLE-SKU');
  assert.equal(single.values.odm_source_part_count,'1');
  const padded=syntheticCsv('\r\n SINGLE-SKU \n\n').rows.find(row=>row.values.odm_source_row==='3');
  assert.equal(padded.values.part_number,'SINGLE-SKU');
  assert.equal(padded.values.odm_source_part_number,'\r\n SINGLE-SKU \n\n');
  const {csv,rows}=syntheticCsv('GOOD-SKU\nquestionable part?');
  assert.equal(rows.filter(row=>row.values.odm_source_row==='3').length,1);
  const plan=await planProductImport(fakeDb(),csv,undefined,{subtypes:{'GOOD-SKU QUESTIONABLE PART?':'OTHER'}});
  assert.match(plan.items.find(item=>item.line===3).messages.join(' '),/could not be safely separated/);
});

test('review decisions turn workbook exceptions into Ready without losing source cells',async()=>{
  const {result}=await parsed(real);
  const accounts=[{id:7,name:'NCR'},{id:8,name:'Oracle'}];
  const base=await planProductImport(fakeDb(accounts),result.csv,undefined,{subtypes:{'SRP-S300TOEK/SBK':'CUSTOMER_SPECIFIC','SPP-R310IK-ORA2':'CUSTOMER_SPECIFIC'}});
  const tariff=base.items.find(item=>item.line===63);
  assert.equal(tariff.status,'NEEDS REVIEW');
  assert.match(tariff.messages.join(' '),/different tariff rate/);
  const resolved=await planProductImport(fakeDb(accounts),result.csv,undefined,{subtypes:{'SRP-S300TOEK/SBK':'CUSTOMER_SPECIFIC'},tariffChoices:{'63:1':'SOURCE'},createCatalog:{'63:1':'CONFIRM'}});
  const ready=resolved.items.find(item=>item.line===63);
  assert.equal(ready.status,'READY');
  assert.equal(ready.odmPricing.customerPrice,'176.60');
  assert.equal(ready.odmPricing.tariffPercent,'7.5000');
  assert.equal(ready.source.rawTariffAmount,'13.244999999999999');
  const corrected=await planProductImport(fakeDb(accounts),result.csv,undefined,{subtypes:{'SRP-S300TOEK/SBK':'CUSTOMER_SPECIFIC'},tariffChoices:{'63:1':'CORRECTED'},tariffPercents:{'63:1':'4.5'},createCatalog:{'63:1':'CONFIRM'}});
  assert.equal(corrected.items.find(item=>item.line===63).odmPricing.tariffAmount,'7.95');
  const oracle=base.items.find(item=>item.line===6);
  assert.equal(oracle.source.rawNewPrice,'233.52160000000003');
  assert.equal(oracle.source.newPrice,'233.52');
  assert.equal(oracle.source.note,'233.52');
});

test('blank customer, corrected SKU, corrected price and historical-only decisions are scoped by source entry',async()=>{
  const {result}=await parsed(real);
  const review={subtypes:{'SRP-F312IICOPK/OXO':'SPECIAL_CONFIGURATION'},createCatalog:{'86:1':'CONFIRM'},partNumbers:{'85:1':'IFJ-WDAK'},dispositions:{'9:1':'HISTORICAL'}};
  const plan=await planProductImport(fakeDb(),result.csv,undefined,review);
  assert.equal(plan.items.find(item=>item.line===86).status,'READY');
  assert.equal(plan.items.find(item=>item.line===85).after.partNumber,'IFJ-WDAK');
  assert.equal(plan.items.find(item=>item.line===85).after.model,'IFJ-WDAK');
  assert.equal(plan.items.find(item=>item.line===9).status,'READY');
  const price=await planProductImport(fakeDb([{id:8,name:'Oracle'}]),result.csv,undefined,{subtypes:{'SPP-R310IK-ORA2':'CUSTOMER_SPECIFIC'},createCatalog:{'6:1':'CONFIRM'},priceChoices:{'6:1':'CORRECTED'},prices:{'6:1':'230.45'}});
  assert.equal(price.items.find(item=>item.line===6).odmPricing.customerPrice,'230.45');
  assert.equal(price.items.find(item=>item.line===6).source.rawNewPrice,'233.52160000000003');
});

test('N/A, dash and blank prices remain nonnumeric while multiline provenance stays exact',async()=>{
  const {result}=await parsed(real);
  const rows=parseImportCsv(result.csv,headers).rows;
  assert.equal(rows.find(row=>row.values.odm_source_row==='13').values.odm_source_old_price,'N/A');
  assert.equal(rows.find(row=>row.values.odm_source_row==='9').values.odm_source_new_price,'-');
  assert.equal(rows.find(row=>row.values.odm_source_row==='30').values.odm_source_new_price,'');
  assert.equal(rows.find(row=>row.values.odm_source_row==='24').values.odm_source_note,'Separate Line Item ');
  const split=rows.filter(row=>row.values.odm_source_row==='66');
  assert.equal(split.length,2);
  assert.equal(split[0].values.odm_source_part_number,split[1].values.odm_source_part_number);
  assert.match(split[0].values.odm_source_part_number,/\n/);
});

test('historical-only source evidence is idempotent and never creates active pricing',async()=>{
  const {result}=await parsed(real);
  const keys=new Set();let catalogWrites=0;
  const client={...fakeDb(),odmPricingImportSource:{upsert:async({where,create})=>{keys.add(where.sourceKey);assert.equal(create.disposition,'HISTORICAL');assert.equal(create.rowNumber,9);assert.equal(create.source.newPrice,'-');}},productSku:{create:async()=>{catalogWrites++}},productSkuOdmCustomerPrice:{create:async()=>{catalogWrites++}}};
  client.$transaction=async callback=>callback(client);
  const review={dispositions:{'9:1':'HISTORICAL'}};
  const first=await planProductImport(client,result.csv,undefined,review);
  assert.equal(first.items.find(item=>item.line===9).status,'READY');
  await applyProductImport(client,result.csv,first.digest,undefined,review);
  await applyProductImport(client,result.csv,first.digest,undefined,review);
  assert.equal(keys.size,1);
  assert.equal(catalogWrites,0);
});

test('new workbook SKU can be assigned to an existing Product inline',async()=>{
  const {result}=await parsed(real);
  const existing={id:50,name:'IFJ Model',category:null,archivedAt:null,skus:[]};
  const review={partNumbers:{'85:1':'IFJ-WDAK'},productIds:{'85:1':50},subtypes:{'IFJ-WDAK':'SPECIAL_CONFIGURATION'},createCatalog:{'85:1':'CONFIRM'}};
  const plan=await planProductImport(fakeDb([], [existing]),result.csv,undefined,review);
  const row=plan.items.find(item=>item.line===85);
  assert.equal(row.productId,50);
  assert.equal(row.after.model,'IFJ Model');
  assert.equal(row.status,'READY');
  assert.equal(row.classes.includes('NEW PRODUCT'),false);
  assert.equal(row.classes.includes('NEW SKU'),true);
});

test('tariff mentioned only in Notes needs an explicit tariff choice',async()=>{
  const mapped=mapOdmProductWorkbookSheet('Test sheet',[[],odmHeader,['','UPS','CUSTOM-UPS','100','','120','','','120 w/ 4.5% line (5.40)'],['','UPS','SECOND-UPS','','','20']]);
  const csv=mapped.rows.map(row=>row.map(value=>/[",\r\n]/.test(value)?`"${value.replaceAll('"','""')}"`:value).join(',')).join('\n')+'\n';
  const base={subtypes:{'CUSTOM-UPS':'CUSTOMER_SPECIFIC'},createCatalog:{'3:1':'CONFIRM'},noteChoices:{'3:1':'STRUCTURED'}};
  const initial=await planProductImport(fakeDb([{id:1,name:'UPS'}]),csv,undefined,base);
  assert.equal(initial.items[0].status,'NEEDS REVIEW');
  assert.match(initial.items[0].messages.join(' '),/different tariff rate/);
  const reviewed=await planProductImport(fakeDb([{id:1,name:'UPS'}]),csv,undefined,{...base,tariffChoices:{'3:1':'NOTES'}});
  assert.equal(reviewed.items[0].status,'READY');
  assert.equal(reviewed.items[0].odmPricing.tariffPercent,'4.5000');
  assert.equal(reviewed.items[0].odmPricing.tariffAmount,'5.40');
  assert.equal(reviewed.items[0].source.tariffPercent,'');
});

test('recommendations resolve exact family and optional base without bypassing account or note conflicts',async()=>{
  const {csv}=syntheticCsv('MODEL-1/UPS','UPS',[['','UPS','MODEL-1/ALT','','','125','','','100 competing price']]);
  const standard={id:10,partNumber:'MODEL-1',normalizedPartNumber:'MODEL-1',catalogSource:'PRICE_LIST',prices:[],odmCustomers:[]};
  const model={id:2,name:'MODEL-1',archivedAt:null,category:null,skus:[standard]};
  const plan=await planProductImport(fakeDb([{id:7,name:' UPS '}],[model]),csv,undefined,{applyRecommendations:true});
  const first=plan.items[0],conflict=plan.items.find(item=>item.after.partNumber==='MODEL-1/ALT');
  assert.equal(first.productId,2);
  assert.equal(first.after.baseSkuId,10);
  assert.equal(first.after.odmCustomerAccountId,7);
  assert.equal(first.after.odmSubtype,'CUSTOMER_SPECIFIC');
  assert.equal(first.odmPricing,undefined); // synthetic source tariff is inconsistent
  assert.match(conflict.messages.join(' '),/price in Notes differs/);
  assert.equal(conflict.status,'NEEDS REVIEW');
  const blank=await planProductImport(fakeDb(),syntheticCsv('KIT/OXO','').csv,undefined,{applyRecommendations:true});
  assert.equal(blank.items[0].after.odmSubtype,'SPECIAL_CONFIGURATION');
  assert.equal(blank.items[0].after.odmCustomerAccountId,undefined);
  assert.equal(blank.customers.length,1); // second synthetic row still has UPS
});

test('batch catalog creation is explicit, rechecks the preview, and writes no pricing',async()=>{
  const {csv}=syntheticCsv('NEW/UPS','UPS',[['','UPS','NEW/ALT','','','125']]);
  const products=[];const skus=[];let pricingWrites=0;
  const client={...fakeDb([{id:7,name:'UPS'}]),product:{findMany:async()=>products,create:async({data})=>{const item={id:products.length+1,name:data.name,archivedAt:null,category:null,skus:[]};products.push(item);return item;}},productSku:{create:async({data})=>{const sku={id:skus.length+1,...data};skus.push(sku);return sku;}},productSkuOdmCustomerPrice:{create:async()=>{pricingWrites++;}}};
  client.$transaction=async fn=>fn(client);
  const review={applyRecommendations:true};
  const plan=await planProductImport(client,csv,undefined,review);
  assert.equal(plan.items[0].catalogCreatable,true);
  await assert.rejects(createProductImportCatalog(client,csv,'stale',review,['3:1']),/Preview changed/);
  const result=await createProductImportCatalog(client,csv,plan.digest,review,['3:1','5:1']);
  assert.deepEqual(result,{newProducts:1,newSkus:2});
  assert.equal(pricingWrites,0);
  assert.equal(products.length,1);
  assert.deepEqual(skus.map(sku=>sku.productId),[1,1]);
});

test('reviewed Product assignment and subtype reach the catalog creation plan',async()=>{
  const {csv}=syntheticCsv('NEW/UPS','UPS');
  const review={applyRecommendations:true,modelNames:{'3:1':'Reviewed Product'},subtypes:{'NEW/UPS':'SPECIAL_CONFIGURATION'}};
  const plan=await planProductImport(fakeDb([{id:7,name:'UPS'}]),csv,undefined,review);
  assert.equal(plan.items[0].after.model,'Reviewed Product');
  assert.equal(plan.items[0].after.odmSubtype,'SPECIAL_CONFIGURATION');
  assert.equal(plan.items[0].catalogCreatable,true);
});

test('missing current price stays in review while unambiguous discontinued rows become historical',async()=>{
  const {result}=await parsed(real);
  const plan=await planProductImport(fakeDb(),result.csv,undefined,{applyRecommendations:true});
  assert.equal(plan.items.find(item=>item.line===30).status,'NEEDS REVIEW');
  assert.match(plan.items.find(item=>item.line===30).messages.join(' '),/New Price is unavailable/);
  assert.equal(plan.items.find(item=>item.line===9).status,'READY');
  assert.equal(plan.items.find(item=>item.line===9).odmPricing,undefined);
});

test('recommended historical disposition records source audit without catalog or pricing writes',async()=>{
  const {csv:base}=syntheticCsv('OLD/UPS','UPS');
  const csv=base.replaceAll('Shared note','discontinued');
  const audit=[];let writes=0;
  const client={...fakeDb(),odmPricingImportSource:{upsert:async({create})=>audit.push(create)},product:{findMany:async()=>[],create:async()=>{writes++;}},productSku:{create:async()=>{writes++;}},productSkuOdmCustomerPrice:{create:async()=>{writes++;}}};
  client.$transaction=async fn=>fn(client);
  const review={applyRecommendations:true};
  const plan=await planProductImport(client,csv,undefined,review);
  assert.equal(plan.items[0].status,'READY');
  await applyProductImport(client,csv,plan.digest,undefined,review);
  assert.equal(audit.length,1);
  assert.equal(audit[0].disposition,'HISTORICAL');
  assert.equal(writes,0);
});

test('one confirmed Account creation maps every entry sharing a normalized source customer',async()=>{
  const {csv}=syntheticCsv('FIRST/UPS',' UPS ',[['','ups','THIRD/UPS','','','90']]);
  const accounts=[];const writes=[];
  const client={...fakeDb(),account:{findMany:async()=>accounts,create:async({data})=>{const account={id:accounts.length+1,name:data.name,status:data.status,archivedAt:null};accounts.push(account);writes.push(data);return account;}}};
  client.$transaction=async fn=>fn(client);
  const review={applyRecommendations:true};
  const preview=await planProductImport(client,csv,undefined,review);
  assert.equal(preview.customers.length,1);
  assert.equal(preview.customers[0].rows,3);
  await assert.rejects(createProductImportAccounts(client,csv,'stale',review,[{key:'ups',name:'UPS',role:'END_USER'}],7),/Preview changed/);
  assert.equal(writes.length,0);
  const mapped=await createProductImportAccounts(client,csv,preview.digest,review,[{key:'ups',name:'UPS',role:'END_USER'}],7);
  assert.deepEqual(mapped,{ups:1});
  assert.equal(writes.length,1);
  assert.equal(writes[0].accountType,'END_USER');
  assert.deepEqual(writes[0].businessRoles.create,[{role:'END_USER'}]);
  const refreshed=await planProductImport(client,csv,undefined,{...review,customerMappings:mapped});
  assert.deepEqual(refreshed.items.map(item=>item.after.odmCustomerAccountId),[1,1,1]);
  assert.equal(refreshed.items[0].source.customerCell,' UPS ');
});

test('duplicate Account names block confirmed batch creation before any write',async()=>{
  const {csv}=syntheticCsv('FIRST/UPS','UPS');
  const accounts=[{id:2,name:'Existing',status:'ACTIVE',archivedAt:null}];let writes=0;
  const client={...fakeDb(accounts),account:{findMany:async()=>accounts,create:async()=>{writes++;return {id:3};}}};
  client.$transaction=async fn=>fn(client);
  const review={applyRecommendations:true};
  const preview=await planProductImport(client,csv,undefined,review);
  await assert.rejects(createProductImportAccounts(client,csv,preview.digest,review,[{key:'ups',name:' Existing ',role:''}],7),/already exists/);
  assert.equal(writes,0);
});

test('composite source Account labels cannot enter safe Account batch creation',async()=>{
  const {csv}=syntheticCsv('FIRST/UPS','Zones & CDW');
  const accounts=[];let writes=0;
  const client={...fakeDb(accounts),account:{findMany:async()=>accounts,create:async()=>{writes++;return {id:3};}}};
  client.$transaction=async fn=>fn(client);
  const review={applyRecommendations:true};
  const preview=await planProductImport(client,csv,undefined,review);
  const key=preview.customers.find(customer=>customer.source==='Zones & CDW').key;
  await assert.rejects(createProductImportAccounts(client,csv,preview.digest,review,[{key,name:'Zones'}],7),/manual interpretation/);
  assert.equal(writes,0);
});

test('tariff choices group identical rate conflicts while price choices stay tied to exact relationships',async()=>{
  const {result}=await parsed(real);
  const preview=await planProductImport(fakeDb(),result.csv,undefined,{applyRecommendations:true});
  const prices=preview.decisionGroups.filter(group=>group.kind==='PRICE');
  const tariffs=preview.decisionGroups.filter(group=>group.kind==='TARIFF');
  assert.equal(prices.length,31);
  assert.equal(prices.reduce((sum,group)=>sum+group.reviewKeys.length,0),31);
  assert.equal(tariffs.length,1);
  assert.equal(tariffs[0].reviewKeys.length,15);
  const choices=Object.fromEntries(tariffs[0].reviewKeys.map(key=>[key,'SOURCE']));
  const resolved=await planProductImport(fakeDb(),result.csv,undefined,{applyRecommendations:true,tariffChoices:choices});
  assert.equal(resolved.decisionGroups.filter(group=>group.kind==='TARIFF').length,0);
  assert.equal(resolved.decisionGroups.filter(group=>group.kind==='PRICE').length,31);
});

test('identical price conflicts for one customer and SKU share one explicit decision',async()=>{
  const mapped=mapOdmProductWorkbookSheet('Test sheet',[[],odmHeader,['','UPS','REPEATED/UPS','100','110','120','','','115'],['','UPS','REPEATED/UPS','100','110','120','','','115']]);
  const csv=mapped.rows.map(row=>row.map(value=>/[",\r\n]/.test(value)?`"${value.replaceAll('"','""')}"`:value).join(',')).join('\n')+'\n';
  const preview=await planProductImport(fakeDb([{id:7,name:'UPS'}]),csv,undefined,{applyRecommendations:true});
  const priceGroups=preview.decisionGroups.filter(group=>group.kind==='PRICE');
  assert.equal(priceGroups.length,1);
  assert.deepEqual(priceGroups[0].reviewKeys,['3:1','4:1']);
  const noteChoices=Object.fromEntries(priceGroups[0].reviewKeys.map(key=>[key,'STRUCTURED']));
  const resolved=await planProductImport(fakeDb([{id:7,name:'UPS'}]),csv,undefined,{applyRecommendations:true,noteChoices});
  assert.equal(resolved.decisionGroups.filter(group=>group.kind==='PRICE').length,0);
});
