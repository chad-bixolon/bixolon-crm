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
const {parseImportXlsx}=require(path.join(root,'lib/import-xlsx.ts'));
const {parseImportCsv}=require(path.join(root,'lib/import-csv.ts'));
const {planProductImport,applyProductImport,productImportHeaders}=require(path.join(root,'lib/product-import.ts'));
const {mapProductWorkbookSheet}=require(path.join(root,'lib/product-workbook.ts'));
const workbookPath=path.resolve(root,'../reference-data/BIXOLON_Price_List.xlsx');
const emptyDb={product:{findMany:async()=>[]},account:{findMany:async()=>[]},productCategory:{findMany:async()=>['POS','LABEL','MOBILE','LASER','RIBBON','ACCESSORIES','PAPER','WARRANTY'].map(code=>({code,active:true}))}};

test('real workbook maps STANDARD, MSRP, and channel tiers separately', {skip:!fs.existsSync(workbookPath)}, async()=>{
  const file=fs.readFileSync(workbookPath);
  const adapter=(sheet,rows)=>mapProductWorkbookSheet(sheet,rows,'USD');
  const first=await parseImportXlsx(file);
  assert.ok(first.sheets.includes('POS printers'));
  assert.ok(first.sheets.includes('TT ribbon  (2)'));
  const pos=await parseImportXlsx(file,'POS printers',adapter);
  assert.equal(pos.error,undefined);
  const rows=parseImportCsv(pos.csv,productImportHeaders).rows;
  assert.equal(rows.length,132);
  assert.deepEqual(rows[0].values,{model:'SRP-275IIIAOSG',part_number:'SRP-275IIIAOSG',description:rows[0].values.description,standard_price:'144.10',msrp_price:'299.20',reseller_price:'',distributor_price:'',currency:'USD',price_unit:'EACH',active:'',category:'POS',catalog_source:'PRICE_LIST',odm_customer:'',base_sku:'',odm_description:'',odm_subtype:''});
  assert.match((await parseImportXlsx(file,'TT ribbon ',adapter)).error,/older TT ribbon/);
  const ribbon=await parseImportXlsx(file,'TT ribbon  (2)',adapter);
  const ribbonRows=parseImportCsv(ribbon.csv,productImportHeaders).rows;
  assert.equal(ribbonRows.length,96);
  assert.equal(ribbonRows[0].values.model,'BR-WX11');
  assert.equal(ribbonRows[0].values.part_number,'BR-WX110-11-300');
  assert.equal(ribbonRows[0].values.standard_price,'');
  assert.equal(ribbonRows[0].values.msrp_price,'159.91');
  assert.equal(ribbonRows[0].values.distributor_price,'79.95');
  assert.equal(ribbonRows[0].values.price_unit,'CASE');
  assert.equal(ribbonRows[0].values.category,'RIBBON');
  assert.equal(ribbonRows[0].values.catalog_source,'PRICE_LIST');
  const label=await parseImportXlsx(file,'Label printers',adapter);
  const labelRow=parseImportCsv(label.csv,productImportHeaders).rows[0].values;
  assert.equal(labelRow.standard_price,'');
  assert.equal(labelRow.msrp_price,'646.80');
  assert.equal(labelRow.reseller_price,'317.00');
  assert.equal(labelRow.distributor_price,'266.00');
  assert.equal(labelRow.category,'MOBILE');
  const paper=await parseImportXlsx(file,'Linerless paper',adapter);
  const paperRows=parseImportCsv(paper.csv,productImportHeaders).rows;
  assert.equal(paperRows.length,7);
  assert.equal(paperRows[0].values.price_unit,'BOX');
  assert.equal(paperRows[6].values.price_unit,'ROLL');
  assert.equal(paperRows[0].values.category,'PAPER');
  for (const [sheet,category] of [['Laser printers','LASER'],[' Mobile Printer Accessories','ACCESSORIES'],['Warranty Options','WARRANTY']]) {
    const mapped=await parseImportXlsx(file,sheet,adapter);
    assert.equal(mapped.error,undefined);
    const first=parseImportCsv(mapped.csv,productImportHeaders).rows[0].values;
    assert.equal(first.category,category);
    assert.equal(first.catalog_source,'PRICE_LIST');
  }
});
test('Mobile printers keeps only the later Bluetooth 4.1 + BLE SKU row', {skip:!fs.existsSync(workbookPath)}, async()=>{
  const file=fs.readFileSync(workbookPath);
  const mobile=await parseImportXlsx(file,'Mobile printers',(sheet,rows)=>mapProductWorkbookSheet(sheet,rows,'USD'));
  const parsed=parseImportCsv(mobile.csv,productImportHeaders);
  const matches=parsed.rows.filter(row=>row.values.part_number==='SPP-R200IIIiK');
  assert.equal(matches.length,1);
  assert.equal(matches[0].line,7);
  assert.match(matches[0].values.description,/Bluetooth V4\.1.*BLE/);
  assert.equal(matches[0].values.standard_price,'218.90');
  assert.equal(matches[0].values.msrp_price,'368.50');
  assert.equal(matches[0].values.category,'MOBILE');
  assert.doesNotMatch(matches[0].values.description,/Bluetooth V3\.0/);
  assert.ok(!parsed.rows.some(row=>row.values.part_number==='SPP-R200IIIplusiK'));
  const plan=await planProductImport(emptyDb,mobile.csv);
  assert.equal(plan.counts.errors,0);
  assert.equal(plan.counts.newSkus,21);
});
test('obsolete Mobile SKU cannot be silently selected if its replacement is missing',()=>{
  const rows=[[],['MODEL NAME','DESCRIPTION','','MSRP','STANDARD'],[],['SPP-R200IIIiK','Bluetooth V3.0 +EDR','','368.5','218.9']];
  assert.match(mapProductWorkbookSheet('Mobile printers',rows,'USD').error,/expected later Bluetooth 4\.1/);
});
const posRows=[[],['MODEL NAME','DESCRIPTION','','MSRP','STANDARD'],['SRP-TEST','Test printer','','20','10']];
const mappedPos=(override)=>parseImportCsv(mapProductWorkbookSheet('POS printers',posRows,override).rows.map(row=>row.join(',')).join('\n'),productImportHeaders).rows[0].values;

test('missing worksheet currency defaults to USD',async()=>{
  const values=mappedPos('');
  assert.equal(values.currency,'USD');
  const plan=await planProductImport(emptyDb,mapProductWorkbookSheet('POS printers',posRows,'').rows.map(row=>row.join(',')).join('\n'));
  assert.equal(plan.counts.errors,0);
});
test('explicit workbook currency wins over the default',()=>{
  const rows=[['','PART NUMBER','','','','','','','CURRENCY','','','MSRP PER CASE'],['','BR-TEST','Ribbon','','','','','','CAD','Ribbon','','20']];
  const mapped=mapProductWorkbookSheet('TT ribbon  (2)',rows,'USD');
  assert.equal(mapped.rows[1][7],'CAD');
  assert.deepEqual(mapProductWorkbookSheet('Catalog',[['model','part_number','currency'],['X','Y','EUR']],'USD').rows,[['model','part_number','currency'],['X','Y','EUR']]);
});
test('Admin currency override applies to worksheets without currency',()=>{
  assert.equal(mappedPos('CAD').currency,'CAD');
});
test('invalid currency override is rejected by preview validation',async()=>{
  const mapped=mapProductWorkbookSheet('POS printers',posRows,'ZZZ');
  const plan=await planProductImport(emptyDb,mapped.rows.map(row=>row.join(',')).join('\n'));
  assert.equal(plan.counts.errors,1);
  assert.match(plan.items[0].messages.join(' '),/valid ISO 4217 code/);
});
test('workbook mapping rejects history tab',()=>{
  assert.match(mapProductWorkbookSheet('Cover',[],'USD').error,/change history/);
  assert.deepEqual(mapProductWorkbookSheet('Catalog',[['model','part_number'],['X','Y']],'').rows,[['model','part_number'],['X','Y']]);
});

const printerCsv=(sheet,models)=>mapProductWorkbookSheet(sheet,[[],
  sheet==='Laser printers' ? ['MODEL NAME','DESCRIPTION','','','MSRP'] : ['MODEL NAME','DESCRIPTION','','MSRP'],
  ...models.map(model=>[model,'Mobile XM7 SPP compatible printer','','20','30']),
],'USD').rows.map(row=>row.join(',')).join('\n');

test('explicit mobile families override every printer worksheet, with bounded model matching',async()=>{
  for(const sheet of ['POS printers','Label printers','Laser printers','Mobile printers']) {
    const models=['XM7-20iK','XM7-30WK','XM7-40RFIWK','SPP-L310iK5','SPP-L3000iWK','SPP-R410K',' spp-l410wk5 '];
    const plan=await planProductImport(emptyDb,printerCsv(sheet,models));
    assert.equal(plan.counts.errors,0);
    assert.ok(plan.items.every(item=>item.after.category==='MOBILE' && item.after.catalogSource==='PRICE_LIST'));
  }
  const fallback=await planProductImport(emptyDb,printerCsv('Label printers',['XD5-40dK','XM70-20K','OTHER-XM7-20K','SPPX-L310','XM7']));
  assert.ok(fallback.items.every(item=>item.after.category==='LABEL'));
  const accessories=mapProductWorkbookSheet('Mobile Printer Accessories',[
    ['','PART CODE','','','MSRP'],['','XM7-20K','SPP compatible accessory','10','20'],
  ],'USD');
  assert.equal(accessories.rows[1][10],'ACCESSORIES');
});

test('real Label worksheet assigns all 27 mobile variants and retains other worksheet defaults', {skip:!fs.existsSync(workbookPath)},async()=>{
  const result=await parseImportXlsx(fs.readFileSync(workbookPath),'Label printers',(sheet,rows)=>mapProductWorkbookSheet(sheet,rows,'USD'));
  assert.equal(result.error,undefined);
  const plan=await planProductImport(emptyDb,result.csv);
  assert.equal(plan.counts.errors,0);
  const mobile=plan.items.filter(item=>item.after.category==='MOBILE');
  assert.equal(mobile.filter(item=>item.after.model.startsWith('XM7-')).length,19);
  assert.equal(mobile.filter(item=>item.after.model.startsWith('SPP-')).length,8);
  assert.ok(plan.items.every(item=>item.after.catalogSource==='PRICE_LIST'));
  assert.ok(plan.items.filter(item=>!mobile.includes(item)).every(item=>item.after.category==='LABEL'));
});

test('reimport corrects an existing primary category without rewriting SKU provenance',async()=>{
  const input=printerCsv('Label printers',['XM7-30WK']);
  const initial=await planProductImport(emptyDb,input);
  const value=initial.items[0].after;
  const {Prisma}=require('@prisma/client');
  const existing={id:1,name:value.model,category:{code:'LABEL'},skus:[{
    id:2,partNumber:value.partNumber,normalizedPartNumber:value.partNumber,description:value.description,
    catalogSource:'PRICE_LIST',priceUnit:'EACH',active:true,
    prices:[{currencyCode:'USD',tier:'MSRP',amount:new Prisma.Decimal('20')},{currencyCode:'USD',tier:'RESELLER',amount:new Prisma.Decimal('30')}],
  }]};
  const writes=[];
  const client={...emptyDb,product:{findMany:async()=>[existing],update:async args=>{writes.push(args);return existing;}}};
  client.$transaction=async callback=>callback(client);
  const plan=await planProductImport(client,input);
  assert.deepEqual(plan.items[0].classes,['UPDATE PRODUCT']);
  assert.equal(plan.items[0].after.catalogSource,'PRICE_LIST');
  await applyProductImport(client,input,plan.digest);
  assert.deepEqual(writes,[{where:{id:1},data:{name:value.model,category:{connect:{code:'MOBILE'}}}}]);
});
