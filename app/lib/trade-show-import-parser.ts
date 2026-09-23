import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import * as XLSX from 'xlsx';

export const MAX_TRADE_SHOW_FILE_BYTES = 2_000_000;
export const MAX_TRADE_SHOW_ROWS = 1000;
export const MAX_TRADE_SHOW_COLUMNS = 100;
export type ImportFormat = 'NRA_NRF' | 'XPRESSLEADS_MODEX';
export type ParsedLead = {
  sourceRow: number; sourceKey: string; rawSourceData: Record<string, string>;
  capturedSource: string; capturedAt: string | null; warnings: string[]; invalid: boolean;
  firstName: string; lastName: string; title: string | null; email: string | null; phone: string | null;
  sourceCompany: string | null; sourceCompanyWebsite: string | null; addressLine1: string | null;
  addressLine2: string | null; city: string | null; stateProvince: string | null;
  postalCode: string | null; country: string | null; sourceNotes: string | null;
};
export type ParsedWorkbook = { format: ImportFormat; sheet: string; sha256: string; rows: ParsedLead[] };
const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const norm = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const pick = (raw: Record<string, string>, names: string[]) => {
  const entries = Object.entries(raw); const found = entries.find(([header]) => names.some(name => key(header) === key(name)));
  return found?.[1] ?? '';
};
const placeholder = (value: string) => /^\s*\([^()]+\)\s*$/.test(value);
const OLE_SIGNATURE = 'd0cf11e0a1b11ae1';
const MAX_TRADE_SHOW_XLSX_UNCOMPRESSED_BYTES = 20_000_000;
type ZipEntry = { compressedSize: number; flags: number; localOffset: number; method: number; name: string; uncompressedSize: number };

function workbookExtension(filename: string) {
  const extension = /\.([^.]+)$/.exec(filename.toLowerCase())?.[1];
  if (extension !== 'xls' && extension !== 'xlsx') throw new Error('Choose a supported .xls or .xlsx Trade Show workbook.');
  return extension;
}

function zipEntries(buffer: Buffer) {
  let end = -1;
  for (let offset = Math.max(0, buffer.length - 65_557); offset <= buffer.length - 22; offset++) {
    if (buffer.readUInt32LE(offset) === 0x06054b50 && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) end = offset;
  }
  if (end < 0) throw new Error('Unsupported or corrupt .xlsx workbook package.');
  const disk = buffer.readUInt16LE(end + 4), centralDisk = buffer.readUInt16LE(end + 6);
  const diskEntries = buffer.readUInt16LE(end + 8), entryCount = buffer.readUInt16LE(end + 10);
  const centralSize = buffer.readUInt32LE(end + 12), centralOffset = buffer.readUInt32LE(end + 16);
  if (disk || centralDisk || diskEntries !== entryCount || entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff || centralOffset + centralSize > end) {
    throw new Error('Unsupported or corrupt .xlsx workbook package.');
  }
  const entries = new Map<string, ZipEntry>();
  let totalUncompressedSize = 0;
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Unsupported or corrupt .xlsx workbook package.');
    const flags = buffer.readUInt16LE(offset + 8), method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20), uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28), extraLength = buffer.readUInt16LE(offset + 30), commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42), next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > end || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) throw new Error('Unsupported or corrupt .xlsx workbook package.');
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (!name || name.includes('\0') || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..') || entries.has(name)) throw new Error('Unsupported or corrupt .xlsx workbook package.');
    if (flags & 0x0001) throw new Error('Encrypted or password-protected .xlsx workbooks are unsupported.');
    if (method !== 0 && method !== 8) throw new Error('Unsupported .xlsx compression method.');
    totalUncompressedSize += uncompressedSize;
    if (totalUncompressedSize > MAX_TRADE_SHOW_XLSX_UNCOMPRESSED_BYTES) throw new Error('The .xlsx workbook expands beyond the safe import limit.');
    entries.set(name, { compressedSize, flags, localOffset, method, name, uncompressedSize });
    offset = next;
  }
  if (offset !== centralOffset + centralSize) throw new Error('Unsupported or corrupt .xlsx workbook package.');
  return entries;
}

function zipText(buffer: Buffer, entry: ZipEntry) {
  if (entry.uncompressedSize > MAX_TRADE_SHOW_FILE_BYTES) throw new Error('Unsupported or corrupt .xlsx workbook package.');
  const offset = entry.localOffset;
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) throw new Error('Unsupported or corrupt .xlsx workbook package.');
  const nameLength = buffer.readUInt16LE(offset + 26), extraLength = buffer.readUInt16LE(offset + 28);
  const dataOffset = offset + 30 + nameLength + extraLength, dataEnd = dataOffset + entry.compressedSize;
  if (dataEnd > buffer.length || buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8') !== entry.name) throw new Error('Unsupported or corrupt .xlsx workbook package.');
  try {
    const data = buffer.subarray(dataOffset, dataEnd);
    const output = entry.method === 0 ? data : inflateRawSync(data, { maxOutputLength: MAX_TRADE_SHOW_FILE_BYTES });
    if (output.length !== entry.uncompressedSize) throw new Error();
    return output.toString('utf8');
  } catch { throw new Error('Unsupported or corrupt .xlsx workbook package.'); }
}

function xmlElements(xml: string, element: string) {
  return [...xml.matchAll(new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${element}\\b([^>]*)>`, 'gi'))].map(match => {
    const attributes: Record<string, string> = {};
    for (const attribute of match[1].matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*(["'])(.*?)\2/g)) attributes[attribute[1].toLowerCase()] = attribute[3];
    return attributes;
  });
}

function validateXlsxPackage(buffer: Buffer) {
  if (buffer.subarray(0, 4).toString('hex') !== '504b0304') {
    if (buffer.subarray(0, 8).toString('hex') === OLE_SIGNATURE) throw new Error('Encrypted, password-protected, or legacy .xls content cannot be opened as .xlsx.');
    throw new Error('Unsupported or corrupt .xlsx workbook package.');
  }
  const entries = zipEntries(buffer);
  const required = ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels'];
  if (required.some(name => !entries.has(name)) || ![...entries].some(([name]) => /^xl\/worksheets\/[^/]+\.xml$/i.test(name))) throw new Error('Unsupported or corrupt .xlsx workbook package.');
  if ([...entries].some(([name]) => /(^|\/)vbaProject\.bin$/i.test(name))) throw new Error('Macro-enabled workbooks are unsupported.');
  const contentTypes = xmlElements(zipText(buffer, entries.get('[Content_Types].xml')!), 'Override');
  if (!contentTypes.some(attributes => attributes.partname === '/xl/workbook.xml' && attributes.contenttype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml')) {
    throw new Error('Unsupported or corrupt .xlsx workbook package.');
  }
  const rootRelationships = xmlElements(zipText(buffer, entries.get('_rels/.rels')!), 'Relationship');
  if (!rootRelationships.some(attributes => attributes.type?.endsWith('/officeDocument') && attributes.target?.replace(/^\//, '') === 'xl/workbook.xml')) {
    throw new Error('Unsupported or corrupt .xlsx workbook package.');
  }
  const workbookRelationships = xmlElements(zipText(buffer, entries.get('xl/_rels/workbook.xml.rels')!), 'Relationship');
  const worksheetTargets = workbookRelationships.filter(attributes => attributes.type?.endsWith('/worksheet')).map(attributes => attributes.target?.replace(/^\/?xl\//, '').replace(/^\//, ''));
  if (!worksheetTargets.some(target => target && entries.has(`xl/${target}`))) throw new Error('Unsupported or corrupt .xlsx workbook package.');
}
function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, Number(part.value)]));
}
// Reject DST gaps and repeated local times: neither has one safe UTC interpretation.
export function parseCaptureTime(text: string, timezone: string | null): { iso: string | null; warning?: string } {
  if (!timezone) return { iso: null, warning: 'Trade Show timezone is missing.' };
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); } catch { return { iso: null, warning: 'Trade Show timezone is invalid.' }; }
  const value = text.trim();
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/.exec(value);
  let year: number, month: number, day: number, hour: number, minute: number, second: number, milli: number;
  if (match) { [, year, month, day, hour, minute, second, milli] = match as unknown as [string, number, number, number, number, number, number, number]; year=Number(year);month=Number(month);day=Number(day);hour=Number(hour);minute=Number(minute);second=Number(second||0);milli=Number(String(milli||'').padEnd(3,'0')); }
  else {
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i.exec(value);
    if (!match) return { iso: null, warning: 'Capture time could not be parsed.' };
    month=Number(match[1]);day=Number(match[2]);year=Number(match[3]);if(year<100)year+=2000;
    hour=Number(match[4])%12+(match[7].toUpperCase()==='PM'?12:0);minute=Number(match[5]);second=Number(match[6]||0);milli=0;
  }
  const target=Date.UTC(year,month-1,day,hour,minute,second,milli);
  const check=new Date(target);
  if (check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==day||hour>23||minute>59||second>59) return {iso:null,warning:'Capture time is invalid.'};
  const offsets=new Set<number>();
  for(const delta of [-172_800_000,-86_400_000,0,86_400_000,172_800_000]){
    const instant=new Date(target+delta),p=zonedParts(instant,timezone);
    offsets.add(Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-(instant.getTime()-instant.getUTCMilliseconds()));
  }
  const matches: Date[]=[];
  for(const offset of offsets){
    const candidate=new Date(target-offset);const p=zonedParts(candidate,timezone);
    if(p.year===year&&p.month===month&&p.day===day&&p.hour===hour&&p.minute===minute&&p.second===second)matches.push(candidate);
  }
  if(matches.length!==1)return {iso:null,warning:matches.length?'Capture time is ambiguous at a daylight-saving transition.':'Capture time does not exist in the Trade Show timezone.'};
  return {iso:matches[0].toISOString()};
}
// v1 identity: show ID + normalized source timestamp + person + company + email. Badge ID, file and row are excluded.
export function sourceKeyV1(showId: number, row: Pick<ParsedLead,'capturedSource'|'firstName'|'lastName'|'sourceCompany'|'email'>) {
  return 'v1:' + createHash('sha256').update(JSON.stringify([showId,norm(row.capturedSource),norm(row.firstName),norm(row.lastName),norm(row.sourceCompany??''),norm(row.email??'')])).digest('hex');
}
export function parseTradeShowWorkbook(buffer: Buffer, filename: string, showId: number, timezone: string | null): ParsedWorkbook {
  const extension = workbookExtension(filename);
  if (!buffer.length||buffer.length>MAX_TRADE_SHOW_FILE_BYTES) throw new Error('Workbook must be nonempty and at most 2 MB.');
  // Validate the declared container before invoking SheetJS. HTML, text, generic ZIPs and format mismatches are rejected.
  if (extension === 'xls') {
    if (buffer.subarray(0,8).toString('hex')!==OLE_SIGNATURE) throw new Error('Unsupported or corrupt binary .xls workbook.');
  } else validateXlsxPackage(buffer);
  let workbook: XLSX.WorkBook;
  try { workbook=XLSX.read(buffer,{type:'buffer',sheets:0,cellText:true,cellDates:false,cellFormula:false,cellHTML:false,cellNF:false,cellStyles:false,sheetStubs:false,bookDeps:false,bookVBA:false,bookFiles:false,WTF:true}); }
  catch { throw new Error('Workbook is corrupt, encrypted, or unsupported.'); }
  const sheet=workbook.SheetNames[0];
  if(!sheet)throw new Error('Workbook has no worksheet.');
  const ws=workbook.Sheets[sheet];const bounds=XLSX.utils.decode_range(ws['!ref']||'A1');
  if(bounds.e.r>MAX_TRADE_SHOW_ROWS)throw new Error(`Workbook exceeds ${MAX_TRADE_SHOW_ROWS} source rows.`);
  if(bounds.e.c+1>MAX_TRADE_SHOW_COLUMNS)throw new Error(`Workbook exceeds ${MAX_TRADE_SHOW_COLUMNS} source columns.`);
  const headers=Array.from({length:bounds.e.c+1},(_,c)=>String(ws[XLSX.utils.encode_cell({r:0,c})]?.w??ws[XLSX.utils.encode_cell({r:0,c})]?.v??'').trim());
  const has=(name:string)=>headers.some(header=>key(header)===key(name));
  const format: ImportFormat = has('DeviceLabel')&&has('Scan Date/Time')&&has('First Name')&&has('Last Name')&&has('Company')&&key(sheet)==='downloads'?'XPRESSLEADS_MODEX':has('Captured Date')&&has('FirstName')&&has('LastName')&&has('Company')&&key(sheet)==='exportextensionsflatfile1'?'NRA_NRF':(() => {throw new Error('Unsupported Trade Show worksheet or headers.');})();
  if(headers.filter(Boolean).length!==new Set(headers.filter(Boolean).map(key)).size)throw new Error('Duplicate source headers are unsupported.');
  const rows:ParsedLead[]=[];
  for(let r=1;r<=bounds.e.r;r++){
    const raw:Record<string,string>={};let any=false;const warnings:string[]=[];
    headers.forEach((header,c)=>{if(!header)return;const cell=ws[XLSX.utils.encode_cell({r,c})];const value=cell?String(cell.w??cell.v??''):'';raw[header]=value;if(value.trim())any=true;
      if(cell?.t==='n'&&/^(phone|phoneextension|ext|zipcode|zipcode|postalcode)$/i.test(key(header))&&cell.v!==undefined){const digits=String(cell.v);if(/^0/.test(value)&&!/^0/.test(digits))warnings.push(`${header}: numeric cell may have lost a leading zero.`);else if(/^(phone|zipcode|postalcode)$/.test(key(header))&&digits.length<5)warnings.push(`${header}: numeric cell may have lost a leading zero.`);}
    });
    if(!any)continue;
    const value=(names:string[],label:string)=>{const v=pick(raw,names);if(placeholder(v)){warnings.push(`${label} contains a placeholder.`);return null;}return v.trim()||null;};
    const capturedSource=pick(raw,['Captured Date','Scan Date/Time']);const time=parseCaptureTime(capturedSource,timezone);if(time.warning)warnings.push(time.warning);
    const firstName=value(['FirstName','First Name'],'First name')??'';const lastName=value(['LastName','Last Name'],'Last name')??'';
    const email=value(['Email'],'Email');const usableEmail=email&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email.toLowerCase():null;
    if(email&&!usableEmail)warnings.push('Email is invalid.');
    const lead:ParsedLead={sourceRow:r+1,sourceKey:'',rawSourceData:raw,capturedSource,capturedAt:time.iso,warnings,invalid:!capturedSource.trim()||!(firstName||lastName||usableEmail||pick(raw,['Company']).trim()),firstName,lastName,
      title:value(['Title'],'Title'),email:usableEmail,phone:value(['Phone'],'Phone'),sourceCompany:value(['Company'],'Company'),sourceCompanyWebsite:value(['Company Website'],'Website'),
      addressLine1:value(['Address','Address 1'],'Address'),addressLine2:value(['Address2','Address 2'],'Address 2'),city:value(['City'],'City'),stateProvince:value(['StateCode','State/Province'],'State'),postalCode:value(['ZipCode','Zipcode'],'Postal code'),country:value(['CountryCode','Country'],'Country'),sourceNotes:pick(raw,['Notes'])||null};
    if(lead.invalid)warnings.push('Missing capture time or usable identity.');
    lead.sourceKey=sourceKeyV1(showId,lead);rows.push(lead);
  }
  return {format,sheet,sha256:createHash('sha256').update(buffer).digest('hex'),rows};
}
