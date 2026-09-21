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
const {zipSync,strToU8}=require('fflate');
const {parseImportXlsx}=require(path.join(root,'lib/import-xlsx.ts'));
const {parseImportCsv}=require(path.join(root,'lib/import-csv.ts'));
const {planImport}=require(path.join(root,'lib/import-plan.ts'));
const {planProductImport}=require(path.join(root,'lib/product-import.ts'));
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
function workbook(sheets) {
  const entries={
    '[Content_Types].xml':`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels':`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml':`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s,i)=>`<sheet name="${esc(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml':`<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>`,
  };
  for (const [i,sheet] of sheets.entries()) entries[`xl/worksheets/sheet${i+1}.xml`]=`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet.rows.map((row,r)=>`<row r="${r+1}">${row.map((value,c)=>{
    if (value===null || value===undefined) return '';
    const ref=`${String.fromCharCode(65+c)}${r+1}`;
    if (typeof value==='object' && value.formula) return `<c r="${ref}"><f>${esc(value.formula)}</f><v>${esc(value.cached)}</v></c>`;
    if (typeof value==='object' && value.date) return `<c r="${ref}" s="1"><v>${value.date}</v></c>`;
    if (typeof value==='number') return `<c r="${ref}"><v>${value}</v></c>`;
    if (typeof value==='boolean') return `<c r="${ref}" t="b"><v>${value?1:0}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t>${esc(value)}</t></is></c>`;
  }).join('')}</row>`).join('')}</sheetData></worksheet>`;
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([name,xml])=>[name,strToU8(xml)]))));
}
const emptyDb={account:{findMany:async()=>[]},contact:{findMany:async()=>[]},user:{findMany:async()=>[]},territory:{findMany:async()=>[]},industry:{findMany:async()=>[]}};

test('valid XLSX uses CSV headers, blank cells and safe numeric strings',async()=>{
  const result=await parseImportXlsx(workbook([{name:'Import',rows:[[' RECORD_TYPE ',' ACCOUNT_NAME ','phone','postal_code'],['account',' Acme ',null,12345]]}]));
  assert.equal(result.error,undefined); assert.equal(result.selectedSheet,'Import');
  const parsed=parseImportCsv(result.csv);
  assert.deepEqual(parsed.errors,[]); assert.equal(parsed.rows[0].values.account_name,'Acme'); assert.equal(parsed.rows[0].values.phone,''); assert.equal(parsed.rows[0].values.postal_code,'12345');
});
test('dates and cached formula values become strings without calculating formulas',async()=>{
  const result=await parseImportXlsx(workbook([{name:'Import',rows:[['record_type','account_name','city','phone'],['account','Acme',{date:45292},{formula:'2+3',cached:5}]]}]));
  assert.equal(result.error,undefined);
  const row=parseImportCsv(result.csv).rows[0].values;
  assert.equal(row.city,'2024-01-01'); assert.equal(row.phone,'5');
});
test('multiple populated worksheets require explicit choice',async()=>{
  const file=workbook([{name:'Notes',rows:[['Not import data']]},{name:'Import',rows:[['record_type','account_name'],['account','Acme']]}]);
  const first=await parseImportXlsx(file);
  assert.match(first.error,/Choose the worksheet/); assert.deepEqual(first.sheets,['Notes','Import']);
  const chosen=await parseImportXlsx(file,'Import'); assert.equal(parseImportCsv(chosen.csv).rows[0].values.account_name,'Acme');
  assert.match((await parseImportXlsx(file,'Missing')).error,/unavailable/);
});
test('malformed, unsupported and encrypted workbooks give useful errors',async()=>{
  assert.match((await parseImportXlsx(Buffer.from('bad'))).error,/Unsupported|Malformed/);
  assert.match((await parseImportXlsx(Buffer.from('d0cf11e0a1b11ae1','hex'))).error,/Password-protected or encrypted/);
  const file=workbook([{name:'Import',rows:[['record_type','account_name'],['account','Acme']]}]);
  const encrypted=Buffer.from(file); encrypted.writeUInt16LE(encrypted.readUInt16LE(6)|1,6);
  const central=encrypted.indexOf(Buffer.from([0x50,0x4b,0x01,0x02])); encrypted.writeUInt16LE(encrypted.readUInt16LE(central+8)|1,central+8);
  assert.match((await parseImportXlsx(encrypted)).error,/Password-protected or encrypted/);
  const forged=Buffer.from(file); forged.writeUInt32LE(1,central+24);
  assert.match((await parseImportXlsx(forged)).error,/size does not match/);
  assert.match((await parseImportXlsx(file,'Import')).error ?? '',/^$/);
});
test('XLSX and equivalent CSV produce the same import preview plan',async()=>{
  const xlsx=await parseImportXlsx(workbook([{name:'Import',rows:[['record_type','account_name','phone'],['account','Acme',null]]}]));
  const csv='record_type,account_name,phone\naccount,Acme,\n';
  const [fromXlsx,fromCsv]=await Promise.all([planImport(emptyDb,xlsx.csv),planImport(emptyDb,csv)]);
  assert.deepEqual(fromXlsx,fromCsv);
});
test('XLSX file and row limits are enforced before import',async()=>{
  assert.match((await parseImportXlsx(Buffer.alloc(4_000_001))).error,/smaller than 4 MB/);
  const rows=[['record_type','account_name'],...Array.from({length:5001},(_,i)=>['account',`Account ${i}`])];
  assert.match((await parseImportXlsx(workbook([{name:'Import',rows}]))).error,/5,000 data rows/);
});
test('product XLSX and CSV yield the same catalog preview',async()=>{
  const result=await parseImportXlsx(workbook([{name:'Catalog',rows:[['model','part_number','description','standard_price','currency','active'],['SLP-DX220','DX220-STD','Printer',12.5,'USD',true]]}]));
  const catalogDb={product:{findMany:async()=>[]},productCategory:{findMany:async()=>[]},account:{findMany:async()=>[]}};
  assert.equal(result.error,undefined);
  assert.deepEqual(await planProductImport(catalogDb,result.csv),await planProductImport(catalogDb,'model,part_number,description,standard_price,currency,active\nSLP-DX220,DX220-STD,Printer,12.5,USD,true\n'));
});
