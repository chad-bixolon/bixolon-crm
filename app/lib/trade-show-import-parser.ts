import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import * as XLSX from 'xlsx';
import { MAPPING_DESTINATIONS, REVIEWABLE_LEAD_FIELDS, type MappingDefinition, type MappingDestination, type ReviewedOverrides, type ReviewableLeadField } from './trade-show-import-fields';
export { MAPPING_DESTINATIONS } from './trade-show-import-fields';
export type { MappingDefinition, MappingDestination } from './trade-show-import-fields';

export const MAX_TRADE_SHOW_FILE_BYTES = 2_000_000;
export const MAX_TRADE_SHOW_ROWS = 1000;
export const MAX_TRADE_SHOW_COLUMNS = 100;
export type ImportFormat = 'NRA_NRF' | 'XPRESSLEADS_MODEX' | 'CUSTOM_MAPPING';
export type WorkbookColumn = { header: string; samples: string[] };
export type InspectedWorkbook = { sheet: string; sha256: string; headers: string[]; headerFingerprint: string; columns: WorkbookColumn[]; rows: { sourceRow: number; rawSourceData: Record<string,string>; warnings:string[] }[]; builtInFormat: Exclude<ImportFormat,'CUSTOM_MAPPING'> | null };
export type ParsedLead = {
  sourceRow: number; sourceKey: string; rawSourceData: Record<string, string>;
  capturedSource: string; capturedAt: string | null; identityStrategy: 'CAPTURE_TIME'|'SOURCE_LEAD_ID'|'ATTENDEE_FIELDS'; warnings: string[]; correctionErrors: string[]; invalid: boolean;
  sourceValues: Record<ReviewableLeadField,string|null>;
  firstName: string; lastName: string; title: string | null; email: string | null; phone: string | null;
  sourceCompany: string | null; sourceCompanyWebsite: string | null; addressLine1: string | null;
  addressLine2: string | null; city: string | null; stateProvince: string | null;
  postalCode: string | null; country: string | null; sourceNotes: string | null; sourceLeadId: string | null;
  productInterest: string | null; competitorSourceText: string | null; currentProductBeingUsed: string | null; customerPainPoints: string | null;
};
export type ParsedWorkbook = { format: ImportFormat; sheet: string; sha256: string; headerFingerprint: string; rows: ParsedLead[] };
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
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$/i.exec(value);
    if (!match) return { iso: null, warning: 'Capture time could not be parsed.' };
    month=Number(match[1]);day=Number(match[2]);year=Number(match[3]);if(year<100)year+=2000;
    hour=Number(match[4]);if(match[7])hour=hour%12+(match[7].toUpperCase()==='PM'?12:0);minute=Number(match[5]);second=Number(match[6]||0);milli=0;
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
function parseMappedCaptureTime(text:string,timezone:string|null){
  if(/^\d{4,6}(?:\.\d+)?$/.test(text.trim())){const decoded=XLSX.SSF.parse_date_code(Number(text));if(decoded&&decoded.y>=1900&&decoded.y<=2200){const local=`${decoded.y}-${String(decoded.m).padStart(2,'0')}-${String(decoded.d).padStart(2,'0')} ${String(decoded.H).padStart(2,'0')}:${String(decoded.M).padStart(2,'0')}`;return parseCaptureTime(local,timezone);}}
  return parseCaptureTime(text,timezone);
}
// v1 identity: show ID + normalized source timestamp + person + company + email. Badge ID, file and row are excluded.
export function sourceKeyV1(showId: number, row: Pick<ParsedLead,'capturedSource'|'firstName'|'lastName'|'sourceCompany'|'email'>) {
  return 'v1:' + createHash('sha256').update(JSON.stringify([showId,norm(row.capturedSource),norm(row.firstName),norm(row.lastName),norm(row.sourceCompany??''),norm(row.email??'')])).digest('hex');
}
export function sourceLeadIdKeyV1(showId:number,sourceLeadId:string){return 'v1:source-id:'+createHash('sha256').update(JSON.stringify([showId,norm(sourceLeadId)])).digest('hex');}
const normalizedPhone=(value:string|null)=>norm(value??'').replace(/[^a-z0-9]/g,'');
export function attendeeFieldsKeyV1(showId:number,row:Pick<ParsedLead,'firstName'|'lastName'|'sourceCompany'|'email'|'phone'>){return 'v1:attendee:'+createHash('sha256').update(JSON.stringify([showId,norm(row.firstName),norm(row.lastName),norm(row.sourceCompany??''),norm(row.email??''),normalizedPhone(row.phone)])).digest('hex');}

const reviewFieldLabels=new Map<ReviewableLeadField,string>(REVIEWABLE_LEAD_FIELDS);
const reviewWarningPrefixes:Record<ReviewableLeadField,string[]>={firstName:['First name contains a placeholder.'],lastName:['Last name contains a placeholder.'],title:['Title contains a placeholder.'],sourceCompany:['Company contains a placeholder.'],email:['Email contains a placeholder.','Email is invalid.'],phone:['Phone contains a placeholder.'],sourceCompanyWebsite:['Website contains a placeholder.'],addressLine1:['Address contains a placeholder.'],addressLine2:['Address 2 contains a placeholder.'],city:['City contains a placeholder.'],stateProvince:['State contains a placeholder.'],postalCode:['Postal code contains a placeholder.'],country:['Country contains a placeholder.'],productInterest:['Product interest contains a placeholder.'],sourceNotes:['Source notes contains a placeholder.'],competitorSourceText:['Competitor contains a placeholder.'],currentProductBeingUsed:['Current product contains a placeholder.'],customerPainPoints:['Customer pain points contains a placeholder.']};
const longReviewFields=new Set<ReviewableLeadField>(['productInterest','sourceNotes','customerPainPoints']);
export function validateReviewedOverrides(value:unknown):ReviewedOverrides{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Reviewed corrections are invalid. Preview again.');
  const allowed=new Set(REVIEWABLE_LEAD_FIELDS.map(([field])=>field));const result:ReviewedOverrides={};
  for(const [field,input] of Object.entries(value)){if(!allowed.has(field as ReviewableLeadField)||typeof input!=='string')throw new Error('Reviewed corrections are invalid. Preview again.');const key=field as ReviewableLeadField,max=longReviewFields.has(key)?10_000:500;if(input.length>max)throw new Error(`${reviewFieldLabels.get(key)} correction is too long.`);result[key]=input;}
  return result;
}
export function applyReviewedOverrides(showId:number,format:ImportFormat,row:ParsedLead,value:unknown):ParsedLead{
  const overrides=validateReviewedOverrides(value),next={...row,warnings:[...row.warnings],correctionErrors:[]} as ParsedLead;
  for(const [field,input] of Object.entries(overrides) as [ReviewableLeadField,string][]) {
    next.warnings=next.warnings.filter(warning=>!reviewWarningPrefixes[field].includes(warning));
    const trimmed=input.trim();
    if(placeholder(trimmed)){next.correctionErrors.push(`${reviewFieldLabels.get(field)} correction cannot be a placeholder.`);(next as unknown as Record<string,unknown>)[field]=field==='firstName'||field==='lastName'?'':null;continue;}
    if(field==='email'){
      const valid=!trimmed||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
      if(!valid){next.warnings.push('Email is invalid.');next.correctionErrors.push('Email correction is invalid.');next.email=null;}else next.email=trimmed?trimmed.toLowerCase():null;
    }else (next as unknown as Record<string,unknown>)[field]=field==='firstName'||field==='lastName'?trimmed:(trimmed||null);
  }
  next.warnings=next.warnings.filter(warning=>warning!=='Fallback identity requires First Name, Last Name, Company, and Email or Phone.'&&warning!=='Missing capture time or usable identity.');
  const fallbackValid=!!next.firstName&&!!next.lastName&&!!next.sourceCompany&&!!(next.email||next.phone);
  const sourceInvalid=format!=='CUSTOM_MAPPING'?(!next.capturedSource.trim()||!(next.firstName||next.lastName||next.email||next.sourceCompany)):next.identityStrategy==='ATTENDEE_FIELDS'?!fallbackValid:!(next.firstName||next.lastName||next.email||next.sourceCompany);
  next.invalid=sourceInvalid||next.correctionErrors.length>0;
  if(sourceInvalid)next.warnings.push(next.identityStrategy==='ATTENDEE_FIELDS'?'Fallback identity requires First Name, Last Name, Company, and Email or Phone.':'Missing capture time or usable identity.');
  next.sourceKey=format!=='CUSTOM_MAPPING'?sourceKeyV1(showId,next):next.identityStrategy==='CAPTURE_TIME'?sourceKeyV1(showId,{...next,capturedSource:next.capturedAt??next.capturedSource}):next.identityStrategy==='SOURCE_LEAD_ID'?sourceLeadIdKeyV1(showId,next.sourceLeadId!):attendeeFieldsKeyV1(showId,next);
  return next;
}

// Fingerprint recipe: trim/collapse/lowercase each header, remove punctuation,
// sort the normalized names, JSON encode, then SHA-256. It intentionally ignores
// filename, container (.xls/.xlsx), row count, and column order.
export function headerFingerprint(headers: string[]) {
  return createHash('sha256').update(JSON.stringify(headers.map(key).sort())).digest('hex');
}

export function inspectTradeShowWorkbook(buffer: Buffer, filename: string): InspectedWorkbook {
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
  if(headers.some(header=>!header))throw new Error('Every source column must have a heading.');
  if(headers.filter(Boolean).length!==new Set(headers.filter(Boolean).map(key)).size)throw new Error('Duplicate source headers are unsupported.');
  const has=(name:string)=>headers.some(header=>key(header)===key(name));
  const builtInFormat:InspectedWorkbook['builtInFormat']=has('DeviceLabel')&&has('Scan Date/Time')&&has('First Name')&&has('Last Name')&&has('Company')&&key(sheet)==='downloads'?'XPRESSLEADS_MODEX':has('Captured Date')&&has('FirstName')&&has('LastName')&&has('Company')&&key(sheet)==='exportextensionsflatfile1'?'NRA_NRF':null;
  const rows:InspectedWorkbook['rows']=[];
  for(let r=1;r<=bounds.e.r;r++){
    const raw:Record<string,string>={};let any=false;const warnings:string[]=[];
    headers.forEach((header,c)=>{const cell=ws[XLSX.utils.encode_cell({r,c})];const value=cell?String(cell.w??cell.v??''):'';raw[header]=value;if(value.trim())any=true;
      if(cell?.t==='n'&&/^(phone|phoneextension|ext|zipcode|postalcode|zippostalcode)$/i.test(key(header))&&cell.v!==undefined){const digits=String(cell.v);if(/^0/.test(value)&&!/^0/.test(digits))warnings.push(`${header}: numeric cell may have lost a leading zero.`);else if(/^(phone|zipcode|postalcode|zippostalcode)$/.test(key(header))&&digits.length<5)warnings.push(`${header}: numeric cell may have lost a leading zero.`);}
    });
    if(!any)continue;
    rows.push({sourceRow:r+1,rawSourceData:raw,warnings});
  }
  const columns=headers.map(header=>({header,samples:[...new Set(rows.map(row=>row.rawSourceData[header].trim()).filter(Boolean))].slice(0,3)}));
  return {sheet,sha256:createHash('sha256').update(buffer).digest('hex'),headers,headerFingerprint:headerFingerprint(headers),columns,rows,builtInFormat};
}

const requiredDestinations: MappingDestination[]=['firstName','lastName','sourceCompany'];
export function validateMapping(headers:string[],mapping:MappingDefinition){
  if(mapping?.version!==1||!Array.isArray(mapping.columns))throw new Error('Mapping definition is invalid.');
  const normalizedHeaders=new Map(headers.map(header=>[key(header),header]));
  const missing:string[]=[];const destinations=new Set<MappingDestination>();
  for(const column of mapping.columns){
    if(!column||typeof column.sourceHeader!=='string'||(column.destination!==null&&!MAPPING_DESTINATIONS.some(([value])=>value===column.destination)))throw new Error('Mapping definition is invalid.');
    if(!normalizedHeaders.has(key(column.sourceHeader))&&column.destination)missing.push(column.sourceHeader);
    if(column.destination){if(destinations.has(column.destination))throw new Error(`SalesHub field “${MAPPING_DESTINATIONS.find(([value])=>value===column.destination)?.[1]}” may only be mapped once.`);destinations.add(column.destination);}
  }
  if(missing.length)throw new Error(`Mapping review required. Missing mapped source column${missing.length===1?'':'s'}: ${missing.join(', ')}.`);
  const absent:string[]=requiredDestinations.filter(destination=>!destinations.has(destination)).map(destination=>MAPPING_DESTINATIONS.find(([value])=>value===destination)![1]);
  if(!destinations.has('email')&&!destinations.has('phone'))absent.push('Email or Phone');
  if(absent.length)throw new Error(`Map the following before preview: ${absent.join(', ')}.`);
  return mapping;
}

export function mappingCompatibility(headers:string[],mapping:MappingDefinition){
  try{validateMapping(headers,mapping);return 'COMPATIBLE' as const;}catch(error){return error instanceof Error&&error.message.startsWith('Mapping review required.')?'MISSING_HEADERS' as const:'INVALID' as const;}
}

export function parseTradeShowWorkbook(buffer: Buffer, filename: string, showId: number, timezone: string | null, customMapping?:MappingDefinition): ParsedWorkbook {
  const inspected=inspectTradeShowWorkbook(buffer,filename);
  if(!inspected.builtInFormat&&!customMapping)throw new Error('Column Mapping Required');
  if(!inspected.builtInFormat)validateMapping(inspected.headers,customMapping!);
  const mappedByDestination=new Map<MappingDestination,string>();
  if(customMapping)for(const column of customMapping.columns)if(column.destination)mappedByDestination.set(column.destination,inspected.headers.find(header=>key(header)===key(column.sourceHeader))!);
  const rows:ParsedLead[]=[];
  for(const source of inspected.rows){
    const raw=source.rawSourceData,warnings=[...source.warnings];
    const value=(names:string[],label:string)=>{const v=pick(raw,names);if(placeholder(v)){warnings.push(`${label} contains a placeholder.`);return null;}return v.trim()||null;};
    const names=(destination:MappingDestination,builtIn:string[])=>inspected.builtInFormat?builtIn:[mappedByDestination.get(destination)!].filter(Boolean);
    const capturedSource=pick(raw,names('capturedAt',['Captured Date','Scan Date/Time']));const time=inspected.builtInFormat?parseCaptureTime(capturedSource,timezone):capturedSource.trim()?parseMappedCaptureTime(capturedSource,timezone):{iso:null};if(time.warning)warnings.push(time.warning);
    const firstName=value(names('firstName',['FirstName','First Name']),'First name')??'';const lastName=value(names('lastName',['LastName','Last Name']),'Last name')??'';
    const email=value(names('email',['Email']),'Email');const usableEmail=email&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email.toLowerCase():null;
    if(email&&!usableEmail)warnings.push('Email is invalid.');
    const phone=value(names('phone',['Phone']),'Phone'),sourceCompany=value(names('sourceCompany',['Company']),'Company'),sourceLeadId=value(names('sourceLeadId',[]),'Source lead ID');
    const identityStrategy:ParsedLead['identityStrategy']=capturedSource.trim()?'CAPTURE_TIME':sourceLeadId?'SOURCE_LEAD_ID':'ATTENDEE_FIELDS';
    const fallbackValid=!!firstName&&!!lastName&&!!sourceCompany&&!!(usableEmail||phone);
    const sourceValues=Object.fromEntries(REVIEWABLE_LEAD_FIELDS.map(([destination])=>[destination,pick(raw,names(destination,({firstName:['FirstName','First Name'],lastName:['LastName','Last Name'],title:['Title'],sourceCompany:['Company'],email:['Email'],phone:['Phone'],sourceCompanyWebsite:['Company Website'],addressLine1:['Address','Address 1'],addressLine2:['Address2','Address 2'],city:['City'],stateProvince:['StateCode','State/Province'],postalCode:['ZipCode','Zipcode'],country:['CountryCode','Country'],sourceNotes:['Notes'],productInterest:[],competitorSourceText:[],currentProductBeingUsed:[],customerPainPoints:[]})[destination]))||null])) as Record<ReviewableLeadField,string|null>;
    const lead:ParsedLead={sourceRow:source.sourceRow,sourceKey:'',rawSourceData:raw,capturedSource,capturedAt:time.iso,identityStrategy,warnings,correctionErrors:[],sourceValues,invalid:inspected.builtInFormat?(!capturedSource.trim()||!(firstName||lastName||usableEmail||sourceCompany)):identityStrategy==='ATTENDEE_FIELDS'?!fallbackValid:!(firstName||lastName||usableEmail||sourceCompany),firstName,lastName,
      title:value(names('title',['Title']),'Title'),email:usableEmail,phone,sourceCompany,sourceCompanyWebsite:value(names('sourceCompanyWebsite',['Company Website']),'Website'),
      addressLine1:value(names('addressLine1',['Address','Address 1']),'Address'),addressLine2:value(names('addressLine2',['Address2','Address 2']),'Address 2'),city:value(names('city',['City']),'City'),stateProvince:value(names('stateProvince',['StateCode','State/Province']),'State'),postalCode:value(names('postalCode',['ZipCode','Zipcode']),'Postal code'),country:value(names('country',['CountryCode','Country']),'Country'),sourceNotes:value(names('sourceNotes',['Notes']),'Source notes'),
      sourceLeadId,productInterest:value(names('productInterest',[]),'Product interest'),competitorSourceText:value(names('competitorSourceText',[]),'Competitor'),currentProductBeingUsed:value(names('currentProductBeingUsed',[]),'Current product'),customerPainPoints:value(names('customerPainPoints',[]),'Customer pain points')};
    if(lead.invalid)warnings.push(identityStrategy==='ATTENDEE_FIELDS'?'Fallback identity requires First Name, Last Name, Company, and Email or Phone.':'Missing capture time or usable identity.');
    if(identityStrategy==='ATTENDEE_FIELDS')warnings.push("This export does not include a captured time or stable lead ID. Re-import matching will use the attendee's identifying fields. Identical repeat scans may be treated as the same lead.");
    lead.sourceKey=inspected.builtInFormat?sourceKeyV1(showId,lead):identityStrategy==='CAPTURE_TIME'?sourceKeyV1(showId,{...lead,capturedSource:lead.capturedAt??lead.capturedSource}):identityStrategy==='SOURCE_LEAD_ID'?sourceLeadIdKeyV1(showId,sourceLeadId!):attendeeFieldsKeyV1(showId,lead);rows.push(lead);
  }
  return {format:inspected.builtInFormat??'CUSTOM_MAPPING',sheet:inspected.sheet,sha256:inspected.sha256,headerFingerprint:inspected.headerFingerprint,rows};
}
