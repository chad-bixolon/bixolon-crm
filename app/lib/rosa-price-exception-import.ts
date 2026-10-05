import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { formatEasternDateTime } from './display-format';
import { isAbsentPriceExceptionParty } from './price-exception-party';

export const rosaHeaders = ['PE Number','Status','Requested At','Reviewed At','Requested By','Reviewed By','Customer','VAR','End User','Expiration Date','SKU','Quantity','Original Price','Approved Price','Currency','Description'] as const;
export type RosaColumn = typeof rosaHeaders[number];
export type RosaDisposition = 'READY' | 'REVIEW REQUIRED' | 'EXISTING / NO CHANGE' | 'ERROR';
export type RosaSourceRow = { line:number; values:Record<RosaColumn,string> };
export type RosaParsed = { rows:RosaSourceRow[]; errors:string[] };
export type RosaResolution = { source:string; id:number|null; name:string|null; issue:string|null };
export type RosaHeaderChoiceField = 'Requested At'|'Reviewed At'|'Requested By'|'Reviewed By'|'Customer'|'VAR'|'End User'|'Description';
export type RosaManualGroupChoice = {
  headerLines?:Partial<Record<RosaHeaderChoiceField,number>>;
  accountIds?:Partial<Record<'Customer'|'VAR'|'End User',number>>;
  userIds?:Partial<Record<'Requested By'|'Reviewed By',number>>;
  skuIds?:Record<string,number>;
};
export type RosaManualChoices = Record<string,RosaManualGroupChoice>;
export type RosaChoice = {id:number;name:string};
export type RosaPlanTier = { line:number; sku:RosaResolution; quantity:string; originalPrice:string; approvedPrice:string; currency:string; sourceLineKey:string; sourceFingerprint:string };
export type RosaPlanGroup = {
  groupKey:string; peNumber:string; sourceLines:number[]; statusSource:string; statusMapped:'ACTIVE'|null;
  requestedAt:string; reviewedAt:string; requestedBy:RosaResolution; reviewedBy:RosaResolution;
  customer:RosaResolution; varAccount:RosaResolution; endUser:RosaResolution;
  expirationDate:string; currency:string; description:string; tiers:RosaPlanTier[];
  disposition:RosaDisposition; messages:string[]; conflictingFields:string[]; conflictOptions:{field:RosaHeaderChoiceField;values:{line:number;value:string}[]}[]; changedFields:string[]; revisionDifferences:{field:string;current:string;proposed:string}[]; existingId:number|null; fingerprint:string;
  currentRevision:{id:number|null;fileName:string;header:Record<string,string>;tiers:string[]}|null;
  revisionAction:'PROMOTE'|'OLDER'|'SAME_TIME'|'NONE';
  revisionRecorded:boolean;
};
export type RosaPlan = { groups:RosaPlanGroup[]; counts:Record<RosaDisposition,number>; sourceRowCount:number; errors:string[]; digest:string; fileName:string; choices:{accounts:RosaChoice[];users:RosaChoice[];skus:RosaChoice[]}; restoredChoices:RosaManualChoices };
type Db = PrismaClient | Prisma.TransactionClient;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const normalizedName=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const key=(value:string)=>value.normalize('NFKC').trim().toUpperCase();
const normalizePartNumber=(value:string)=>value.trim().replace(/\s+/g,' ').toUpperCase();
const emptyCounts=():Record<RosaDisposition,number>=>({'READY':0,'REVIEW REQUIRED':0,'EXISTING / NO CHANGE':0,'ERROR':0});
const emptyChoices=()=>({accounts:[],users:[],skus:[]});

/** Strict RFC-style quoted CSV reader with physical source line numbers. */
export function parseRosaCsv(input:string):RosaParsed {
  if(!input||Buffer.byteLength(input,'utf8')>2_000_000)return {rows:[],errors:['Choose a UTF-8 CSV file smaller than 2 MB.']};
  const source=input.replace(/^\uFEFF/,'');const records:{line:number;cells:string[]}[]=[];let cells:string[]=[],cell='',quoted=false,closed=false,line=1,start=1;
  for(let i=0;i<source.length;i++){const c=source[i];if(quoted){if(c==='"'&&source[i+1]==='"'){cell+='"';i++;}else if(c==='"'){quoted=false;closed=true;}else{cell+=c;if(c==='\n')line++;}}else if(c===','||c==='\n'||c==='\r'){cells.push(cell);cell='';closed=false;if(c!==','){if(cells.some(x=>x.trim()))records.push({line:start,cells});cells=[];if(c==='\r'&&source[i+1]==='\n')i++;line++;start=line;}}else if(c==='"'&&!cell&&!closed)quoted=true;else if(c==='"'||closed)return {rows:[],errors:[`Malformed CSV at line ${line}.`]};else cell+=c;}
  if(quoted)return {rows:[],errors:[`Unclosed quoted value at line ${start}.`]};cells.push(cell);if(cells.some(x=>x.trim()))records.push({line:start,cells});
  if(!records.length)return {rows:[],errors:['CSV header row is required.']};
  if(records[0].cells.length!==rosaHeaders.length||rosaHeaders.some((header,index)=>records[0].cells[index]?.replace(/^\uFEFF/,'').trim()!==header))return {rows:[],errors:['CSV columns must exactly match the Rosa export header and order.']};
  const rows:RosaSourceRow[]=[],errors:string[]=[];
  for(const record of records.slice(1)){if(record.cells.length!==rosaHeaders.length){errors.push(`Line ${record.line}: expected ${rosaHeaders.length} columns, found ${record.cells.length}.`);continue;}rows.push({line:record.line,values:Object.fromEntries(rosaHeaders.map((header,index)=>[header,record.cells[index]])) as Record<RosaColumn,string>});}
  return {rows,errors};
}
function timestamp(value:string){const raw=value.trim();if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw))return null;const date=new Date(raw);return Number.isNaN(date.valueOf())||date.getUTCFullYear()<1900||date.getUTCFullYear()>2100?null:date.toISOString();}
export function parseRosaExpirationDate(value:string){
  const raw=value.trim(),iso=/^(\d{4})-(\d{2})-(\d{2})$/.exec(raw),slash=/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(raw);
  if(!iso&&!slash)return null;
  const year=iso?Number(iso[1]):slash![3].length===2?2000+Number(slash![3]):Number(slash![3]);
  const month=Number(iso?iso[2]:slash![1]),day=Number(iso?iso[3]:slash![2]);
  if(year<1900||year>2100||month<1||month>12)return null;
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(day<1||day>days[month-1])return null;
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
function decimal(value:string,scale:number,whole:number){const raw=value.trim();if(!new RegExp(`^\\d{1,${whole}}(?:\\.\\d{1,${scale}})?$`).test(raw))return null;const number=new Prisma.Decimal(raw);return number.gt(0)?number.toFixed(scale):null;}
function resolve(source:string,candidates:{id:number;name:string}[],normalizer:(value:string)=>string):RosaResolution{const value=source.trim();if(!value)return {source,id:null,name:null,issue:'Missing source value.'};const matches=candidates.filter(candidate=>normalizer(candidate.name)===normalizer(value));return matches.length===1?{source,id:matches[0].id,name:matches[0].name,issue:null}:{source,id:null,name:null,issue:matches.length?'Multiple CRM matches.':'No CRM match.'};}
function resolveParty(source:string,candidates:{id:number;name:string}[]):RosaResolution{
  return isAbsentPriceExceptionParty(source)?{source,id:null,name:null,issue:null}:resolve(source,candidates,normalizedName);
}
function resolveUser(source:string,users:{id:number;name:string;firstName:string}[]):RosaResolution{const value=source.trim();if(!value)return {source,id:null,name:null,issue:'Missing source value.'};const normalized=normalizedName(value);const matches=users.filter(user=>normalizedName(user.name)===normalized||normalizedName(user.firstName)===normalized);return matches.length===1?{source,id:matches[0].id,name:matches[0].name,issue:null}:{source,id:null,name:null,issue:matches.length?'Multiple CRM matches.':'No CRM match.'};}
function sourceFingerprint(row:RosaSourceRow){return hash(JSON.stringify(rosaHeaders.map(header=>row.values[header])));}
const headerFields = ['Status','Requested At','Reviewed At','Requested By','Reviewed By','Customer','VAR','End User','Expiration Date','Currency','Description'] as const;
type HeaderField = typeof headerFields[number];
const choiceHeaderFields:RosaHeaderChoiceField[]=['Requested At','Reviewed At','Requested By','Reviewed By','Customer','VAR','End User','Description'];
const accountFields=['Customer','VAR','End User'] as const;
const userFields=['Requested By','Reviewed By'] as const;
function checkedRecord(value:unknown,label:string):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`Invalid ${label}. Preview the file again.`);return value as Record<string,unknown>;}
function checkedKeys(value:Record<string,unknown>,allowed:readonly string[],label:string){for(const field of Object.keys(value))if(!allowed.includes(field))throw new Error(`Invalid ${label}. Preview the file again.`);}
function checkedId(value:unknown,label:string){if(!Number.isSafeInteger(value)||Number(value)<=0)throw new Error(`Invalid ${label}. Preview the file again.`);return Number(value);}
function manualResolution(source:string,id:unknown,candidates:RosaChoice[],label:string):RosaResolution{
  const selected=candidates.find(candidate=>candidate.id===checkedId(id,label));
  if(!selected)throw new Error(`${label} is no longer an active CRM choice. Preview the file again.`);
  return {source,id:selected.id,name:selected.name,issue:null};
}
function headerValue(field:HeaderField,value:string){
  if(field==='Requested At'||field==='Reviewed At')return timestamp(value)??value.trim();
  if(field==='Expiration Date')return parseRosaExpirationDate(value)??value.trim();
  if(field==='Status'||field==='Currency')return value.normalize('NFKC').trim().toUpperCase();
  if(field==='Description')return value.normalize('NFKC').trim().replace(/\s+/g,' ');
  if(accountFields.includes(field as typeof accountFields[number])&&isAbsentPriceExceptionParty(value))return '';
  return normalizedName(value);
}
function canonicalHeader(row:RosaSourceRow){return Object.fromEntries(headerFields.map(field=>[field,headerValue(field,row.values[field])])) as Record<HeaderField,string>;}
function canonicalTier(row:RosaSourceRow){const raw=row.values;return JSON.stringify([normalizePartNumber(raw.SKU),decimal(raw.Quantity,3,11)??raw.Quantity.trim(),decimal(raw['Original Price'],2,10)??raw['Original Price'].trim(),decimal(raw['Approved Price'],2,10)??raw['Approved Price'].trim(),raw.Currency.trim().toUpperCase()]);}
function sortedTierValues(rows:RosaSourceRow[]){return rows.map(canonicalTier).sort();}
function existingTierValues(lines:{sourceSku:string|null;sourceQuantityRaw:string|null;sourceQuantity:Prisma.Decimal|null;approvedUnitPrice:Prisma.Decimal|null;currencyCode:string;sourceMetadata:Prisma.JsonValue}[]){return lines.map(line=>JSON.stringify([normalizePartNumber(line.sourceSku??''),line.sourceQuantity?.toFixed(3)??line.sourceQuantityRaw, decimal((line.sourceMetadata as {originalPrice?:string}|null)?.originalPrice??'',2,10)??(line.sourceMetadata as {originalPrice?:string}|null)?.originalPrice??null,line.approvedUnitPrice?.toFixed(2)??null,line.currencyCode.trim().toUpperCase()])).sort();}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function tierDifferences(current:string[],proposed:string[]){
  const fields=['SKU','Quantity','Original Price','Approved Price','Currency'];
  const values=(tiers:string[],index:number)=>tiers.map(tier=>{const parsed=JSON.parse(tier) as (string|null)[];return parsed[index]??'—';}).sort();
  const changes=fields.flatMap((field,index)=>{
    const before=values(current,index),after=values(proposed,index);
    return same(before,after)?[]:[{field,current:before.join('; ')||'—',proposed:after.join('; ')||'—'}];
  });
  if(changes.length||same(current,proposed))return changes;
  const describe=(tiers:string[])=>tiers.map(tier=>(JSON.parse(tier) as string[]).join(' · ')).join('; ')||'—';
  return [{field:'Pricing tier combinations',current:describe(current),proposed:describe(proposed)}];
}
function conflictingHeaderFields(rows:RosaSourceRow[]){const first=canonicalHeader(rows[0]);return headerFields.filter(field=>rows.some(row=>canonicalHeader(row)[field]!==first[field]));}
function headerConflictMessage(field:HeaderField,rows:RosaSourceRow[]){return `${field} differs across source lines: ${rows.map(row=>{const value=row.values[field];const parsed=(field==='Requested At'||field==='Reviewed At')&&timestamp(value);return `${row.line}=${JSON.stringify((parsed?formatEasternDateTime(new Date(parsed)):value).slice(0,100))}`;}).join('; ')}.`;}
function safeHeaderConflict(field:HeaderField,rows:RosaSourceRow[]):field is RosaHeaderChoiceField{
  if(!choiceHeaderFields.includes(field as RosaHeaderChoiceField))return false;
  return rows.every(row=>field==='Requested At'||field==='Reviewed At'?!!timestamp(row.values[field]):!!row.values[field].trim());
}
export async function planRosaPriceExceptions(db:Db,parsed:RosaParsed,fileName:string,manualChoices:RosaManualChoices={}):Promise<RosaPlan>{
  const counts=emptyCounts();if(parsed.errors.length)return {groups:[],counts,sourceRowCount:parsed.rows.length,errors:parsed.errors,digest:'',fileName,choices:emptyChoices(),restoredChoices:{}};
  const [users,accounts,skus,existing,currencies]=await Promise.all([
    db.user.findMany({select:{id:true,firstName:true,lastName:true,active:true,archivedAt:true,role:true}}),
    db.account.findMany({select:{id:true,name:true,status:true,archivedAt:true}}),
    db.productSku.findMany({select:{id:true,partNumber:true,normalizedPartNumber:true,active:true,product:{select:{name:true,active:true,archivedAt:true}}}}),
    db.priceException.findMany({select:{id:true,peCode:true,sourceType:true,sourceKey:true,sourceFileName:true,sourceMetadata:true,currentSourceRevision:{select:{id:true,sourceFileName:true,resolvedHeader:true,resolvedTiers:true,sourceReviewedAt:true,contentHash:true}},sourceRevisions:{select:{contentHash:true}},lines:{where:{retiredAt:null},select:{sourceSku:true,sourceQuantity:true,sourceQuantityRaw:true,approvedUnitPrice:true,currencyCode:true,sourceMetadata:true}}}}),
    db.currency.findMany({select:{code:true,active:true}}),
  ]);
  const userChoices=users.filter(user=>user.active&&!user.archivedAt).map(user=>({id:user.id,name:`${user.firstName} ${user.lastName}`,firstName:user.firstName}));
  const accountChoices=accounts.filter(account=>account.status==='ACTIVE'&&!account.archivedAt);
  const skuChoices=skus.filter(sku=>sku.active&&sku.product.active&&!sku.product.archivedAt).map(sku=>({id:sku.id,name:sku.partNumber,productName:sku.product.name}));
  const byCode=new Map<string,RosaSourceRow[]>();for(const row of parsed.rows){const code=key(row.values['PE Number'])||`BLANK:${row.line}`;byCode.set(code,[...(byCode.get(code)??[]),row]);}
  const grouped=new Map<string,RosaSourceRow[]>();
  for(const [code,rows] of byCode){
    const submissions=new Map<string,RosaSourceRow[]>();
    for(const row of rows){const identity=JSON.stringify([timestamp(row.values['Requested At'])??row.values['Requested At'].trim(),timestamp(row.values['Reviewed At'])??row.values['Reviewed At'].trim()]);submissions.set(identity,[...(submissions.get(identity)??[]),row]);}
    for(const [identity,submissionRows] of submissions)grouped.set(submissions.size===1?code:`${code}::${hash(identity).slice(0,12)}`,submissionRows);
  }
  const requestedChoices=checkedRecord(manualChoices,'manual resolutions');
  for(const groupKey of Object.keys(requestedChoices))if(!grouped.has(groupKey))throw new Error('Manual resolution does not match this CSV. Preview the file again.');
  const restoredChoices:RosaManualChoices={...manualChoices};
  for(const [groupKey,sourceRows] of grouped){
    if(Object.hasOwn(restoredChoices,groupKey))continue;
    const code=key(sourceRows[0].values['PE Number']);
    const matches=existing.filter(item=>item.peCode&&key(item.peCode)===code||item.sourceType==='EXTERNAL_EXPORT'&&item.sourceKey===`ROSA:${code}`);
    if(matches.length!==1)continue;
    const latest=matches[0].currentSourceRevision;
    let metadata=matches[0].sourceMetadata as {adapter?:string;rosaRawRows?:RosaSourceRow[];rosaReviewedChoices?:RosaManualGroupChoice}|null;
    if(latest){const revision=await db.priceExceptionSourceRevision.findUnique({where:{id:latest.id},select:{sourceFileName:true,rawRows:true,reviewedChoices:true}});metadata={adapter:'ROSA_PE_CSV_V1',rosaRawRows:revision?.rawRows as RosaSourceRow[]|undefined,rosaReviewedChoices:revision?.reviewedChoices as RosaManualGroupChoice|undefined};if(revision?.sourceFileName!==fileName)continue;}
    else if(matches[0].sourceFileName!==fileName)continue;
    if(metadata?.adapter!=='ROSA_PE_CSV_V1'||!same(metadata.rosaRawRows,sourceRows)||!metadata.rosaReviewedChoices)continue;
    const prior=metadata.rosaReviewedChoices;
    const safeHeaders=new Set<HeaderField>(conflictingHeaderFields(sourceRows).filter(field=>safeHeaderConflict(field,sourceRows)));
    const headerLines=Object.fromEntries(Object.entries(prior.headerLines??{}).filter(([field,line])=>safeHeaders.has(field as HeaderField)&&sourceRows.some(row=>row.line===line))) as RosaManualGroupChoice['headerLines'];
    const raw={...sourceRows[0].values};
    for(const [field,line] of Object.entries(headerLines??{}))raw[field as RosaHeaderChoiceField]=sourceRows.find(row=>row.line===line)!.values[field as RosaHeaderChoiceField];
    const accountSource:{[K in typeof accountFields[number]]:string}={Customer:raw.Customer,VAR:raw.VAR,'End User':raw['End User']};
    const userSource:{[K in typeof userFields[number]]:string}={'Requested By':raw['Requested By'],'Reviewed By':raw['Reviewed By']};
    const accountIds=Object.fromEntries(Object.entries(prior.accountIds??{}).filter(([field,id])=>accountFields.includes(field as typeof accountFields[number])&&!isAbsentPriceExceptionParty(accountSource[field as typeof accountFields[number]])&&accountChoices.some(item=>item.id===id)&&(!resolveParty(accountSource[field as typeof accountFields[number]],accountChoices).id||resolveParty(accountSource[field as typeof accountFields[number]],accountChoices).id===id))) as RosaManualGroupChoice['accountIds'];
    const userIds=Object.fromEntries(Object.entries(prior.userIds??{}).filter(([field,id])=>userFields.includes(field as typeof userFields[number])&&userChoices.some(item=>item.id===id)&&(!resolveUser(userSource[field as typeof userFields[number]],userChoices).id||resolveUser(userSource[field as typeof userFields[number]],userChoices).id===id))) as RosaManualGroupChoice['userIds'];
    const skuIds=Object.fromEntries(Object.entries(prior.skuIds??{}).filter(([line,id])=>{const row=sourceRows.find(item=>String(item.line)===line);if(!row||!skuChoices.some(item=>item.id===id))return false;const automatic=resolve(row.values.SKU,skuChoices,normalizePartNumber);return !automatic.id||automatic.id===id;}));
    restoredChoices[groupKey]={headerLines,accountIds,userIds,skuIds};
  }
  const groups:RosaPlanGroup[]=[];
  for(const [groupKey,sourceRows] of grouped){
    const groupChoice=checkedRecord(restoredChoices[groupKey]??{},'manual resolution');checkedKeys(groupChoice,['headerLines','accountIds','userIds','skuIds'],'manual resolution');
    const headerLines=checkedRecord(groupChoice.headerLines??{},'header choices');checkedKeys(headerLines,choiceHeaderFields,'header choice');
    const accountIds=checkedRecord(groupChoice.accountIds??{},'Account choices');checkedKeys(accountIds,accountFields,'Account choice');
    const userIds=checkedRecord(groupChoice.userIds??{},'user choices');checkedKeys(userIds,userFields,'user choice');
    const skuIds=checkedRecord(groupChoice.skuIds??{},'SKU choices');
    const first=sourceRows[0],raw={...first.values},peNumber=raw['PE Number'].trim(),code=key(peNumber),messages:string[]=[],changedFields:string[]=[],revisionDifferences:RosaPlanGroup['revisionDifferences']=[];
    let invalid=false;const sourceError=(message:string)=>{messages.push(message);invalid=true;};
    const allConflicts=conflictingHeaderFields(sourceRows);
    const safeConflicts=allConflicts.filter(field=>safeHeaderConflict(field,sourceRows));
    for(const [field,line] of Object.entries(headerLines)){
      if(!safeConflicts.includes(field as RosaHeaderChoiceField))throw new Error('Header choice is not safe for this source conflict. Preview the file again.');
      const chosen=sourceRows.find(row=>row.line===checkedId(line,'header source line'));
      if(!chosen)throw new Error('Header source line changed. Preview the file again.');
      raw[field as RosaHeaderChoiceField]=chosen.values[field as RosaHeaderChoiceField];
    }
    const conflictingFields=allConflicts.filter(field=>!Object.hasOwn(headerLines,field));
    for(const field of conflictingFields)messages.push(headerConflictMessage(field,sourceRows));
    const conflictOptions=safeConflicts.map(field=>({field,values:sourceRows.map(row=>({line:row.line,value:row.values[field]})).filter((item,index,all)=>all.findIndex(other=>headerValue(field,other.value)===headerValue(field,item.value))===index)}));
    for(const line of Object.keys(skuIds))if(!sourceRows.some(row=>String(row.line)===line))throw new Error('SKU choice does not match a source line. Preview the file again.');
    const automaticUsers={ 'Requested By':resolveUser(raw['Requested By'],userChoices),'Reviewed By':resolveUser(raw['Reviewed By'],userChoices) };
    const automaticAccounts={Customer:resolveParty(raw.Customer,accountChoices),VAR:resolveParty(raw.VAR,accountChoices),'End User':resolveParty(raw['End User'],accountChoices)};
    for(const field of Object.keys(userIds))if(!automaticUsers[field as keyof typeof automaticUsers].issue&&automaticUsers[field as keyof typeof automaticUsers].id!==userIds[field])throw new Error('User choice is no longer needed. Preview the file again.');
    for(const field of Object.keys(accountIds))if(!automaticAccounts[field as keyof typeof automaticAccounts].issue&&automaticAccounts[field as keyof typeof automaticAccounts].id!==accountIds[field])throw new Error('Account choice is no longer needed. Preview the file again.');
    const requestedBy=Object.hasOwn(userIds,'Requested By')?manualResolution(raw['Requested By'],userIds['Requested By'],userChoices,'Requested By'):automaticUsers['Requested By'];
    const reviewedBy=Object.hasOwn(userIds,'Reviewed By')?manualResolution(raw['Reviewed By'],userIds['Reviewed By'],userChoices,'Reviewed By'):automaticUsers['Reviewed By'];
    const customer=Object.hasOwn(accountIds,'Customer')?manualResolution(raw.Customer,accountIds.Customer,accountChoices,'Customer'):automaticAccounts.Customer;
    const varAccount=Object.hasOwn(accountIds,'VAR')?manualResolution(raw.VAR,accountIds.VAR,accountChoices,'VAR'):automaticAccounts.VAR;
    const endUser=Object.hasOwn(accountIds,'End User')?manualResolution(raw['End User'],accountIds['End User'],accountChoices,'End User'):automaticAccounts['End User'];
    const requestedAt=timestamp(raw['Requested At']),reviewedAt=timestamp(raw['Reviewed At']),expirationDate=parseRosaExpirationDate(raw['Expiration Date']);
    const statusSource=raw.Status.trim(),statusMapped=statusSource.toLowerCase()==='approved'?'ACTIVE' as const:null;
    if(!code)sourceError('PE Number is required.');if(!statusMapped)sourceError(`Unsupported status: ${statusSource||'(blank)'}.`);
    if(!requestedAt||!reviewedAt)sourceError('Requested At and Reviewed At must be valid timestamps with offsets.');
    if(requestedAt&&reviewedAt&&requestedAt>reviewedAt)sourceError('Reviewed At is before Requested At.');
    if(!expirationDate)sourceError('Expiration Date is invalid or outside 1900–2100.');
    if(!raw.Description.trim())sourceError('Description is required.');
    if(isAbsentPriceExceptionParty(raw.Customer))sourceError('Customer is required.');
    if(Object.keys(headerLines).length){
      const original=first.values,originalRequested=timestamp(original['Requested At']),originalReviewed=timestamp(original['Reviewed At']);
      if(!originalRequested||!originalReviewed)sourceError(`Line ${first.line}: Requested At and Reviewed At must be valid timestamps with offsets.`);
      if(originalRequested&&originalReviewed&&originalRequested>originalReviewed)sourceError(`Line ${first.line}: Reviewed At is before Requested At.`);
      if(!original.Description.trim())sourceError(`Line ${first.line}: Description is required.`);
      if(isAbsentPriceExceptionParty(original.Customer))sourceError(`Line ${first.line}: Customer is required.`);
    }
    for(const row of sourceRows.slice(1)){
      const value=row.values,requested=timestamp(value['Requested At']),reviewed=timestamp(value['Reviewed At']);
      if(!parseRosaExpirationDate(value['Expiration Date']))sourceError(`Line ${row.line}: Expiration Date is invalid or outside 1900–2100.`);
      if(!requested||!reviewed)sourceError(`Line ${row.line}: Requested At and Reviewed At must be valid timestamps with offsets.`);
      if(requested&&reviewed&&requested>reviewed)sourceError(`Line ${row.line}: Reviewed At is before Requested At.`);
      if(value.Status.trim().toLowerCase()!=='approved')sourceError(`Line ${row.line}: Unsupported status: ${value.Status.trim()||'(blank)'}.`);
      if(!value.Description.trim())sourceError(`Line ${row.line}: Description is required.`);
      if(isAbsentPriceExceptionParty(value.Customer))sourceError(`Line ${row.line}: Customer is required.`);
    }
    for(const [label,item] of [['Requested By',requestedBy],['Reviewed By',reviewedBy],['Customer',customer],['VAR',varAccount],['End User',endUser]] as const)if(item.issue)messages.push(`${label}: ${item.issue}`);
    const tierOccurrences=new Map<string,number>();
    const tiers:RosaPlanTier[]=sourceRows.map(row=>{
      const value=row.values,tierKey=canonicalTier(row),occurrence=(tierOccurrences.get(tierKey)??0)+1;tierOccurrences.set(tierKey,occurrence);
      const automaticSku=resolve(value.SKU,skuChoices,normalizePartNumber);
      if(Object.hasOwn(skuIds,String(row.line))&&!automaticSku.issue&&automaticSku.id!==skuIds[String(row.line)])throw new Error('SKU choice is no longer needed. Preview the file again.');
      const sku=Object.hasOwn(skuIds,String(row.line))?manualResolution(value.SKU,skuIds[String(row.line)],skuChoices,`Line ${row.line} SKU`):automaticSku;
      const quantity=decimal(value.Quantity,3,11),originalPrice=decimal(value['Original Price'],2,10),approvedPrice=decimal(value['Approved Price'],2,10),currency=value.Currency.trim().toUpperCase();
      if(sku.issue){
        if(!value.SKU.trim())sourceError(`Line ${row.line} SKU: ${sku.issue}`);
        else messages.push(`Line ${row.line} SKU: ${sku.issue}`);
      }
      if(!quantity||!originalPrice||!approvedPrice)sourceError(`Line ${row.line}: Quantity and both prices must be positive values within CRM precision.`);
      if(!currencies.some(item=>item.code===currency&&item.active))sourceError(`Line ${row.line}: Currency ${currency||'(blank)'} is not active in CRM.`);
      return {line:row.line,sku,quantity:value.Quantity,originalPrice:value['Original Price'],approvedPrice:value['Approved Price'],currency:value.Currency,sourceLineKey:`ROSA:${hash(tierKey)}:${occurrence}`,sourceFingerprint:sourceFingerprint(row)};
    });
    const matching=existing.filter(item=>item.peCode&&key(item.peCode)===code||item.sourceType==='EXTERNAL_EXPORT'&&item.sourceKey===`ROSA:${code}`);
    const header=Object.fromEntries(headerFields.map(field=>[field,headerValue(field,raw[field])])) as Record<HeaderField,string>;
    const reviewedChoice={headerLines,accountIds,userIds,skuIds};
    const fingerprint=hash(JSON.stringify({header,tiers:sortedTierValues(sourceRows),reviewedChoice}));
    let identical=false;let currentRevision:RosaPlanGroup['currentRevision']=null;let revisionAction:RosaPlanGroup['revisionAction']='NONE';let revisionRecorded=false;
    if(matching.length===1){
      const record=matching[0],metadata=record.sourceMetadata as {adapter?:string;rosaHeader?:Record<HeaderField,string>;rosaReviewedChoices?:RosaManualGroupChoice}|null;
      revisionRecorded=!!record.sourceRevisions?.some(revision=>revision.contentHash===fingerprint);
      const current=record.currentSourceRevision;
      const oldHeader=(current?.resolvedHeader as Record<HeaderField,string>|undefined)??(metadata?.adapter==='ROSA_PE_CSV_V1'?metadata.rosaHeader:undefined);
      const currentSourceValues=(current?.resolvedHeader as {sourceValues?:Record<string,string>}|undefined)?.sourceValues;
      const originalSourceValues=(record.sourceMetadata as {rosaRawRows?:RosaSourceRow[]}|null)?.rosaRawRows?.[0]?.values;
      currentRevision=oldHeader?{id:current?.id??null,fileName:current?.sourceFileName??record.sourceFileName??'',header:currentSourceValues??originalSourceValues??oldHeader,tiers:existingTierValues(record.lines)}:null;
      if(oldHeader){
        for(const field of headerFields)if(oldHeader[field]!==header[field]){
          changedFields.push(field);
          revisionDifferences.push({field,current:currentRevision?.header[field]??oldHeader[field],proposed:raw[field]});
        }
        const currentTiers=existingTierValues(record.lines),proposedTiers=sortedTierValues(sourceRows);
        if(!same(currentTiers,proposedTiers)){
          changedFields.push('Pricing tiers');
          revisionDifferences.push(...tierDifferences(currentTiers,proposedTiers));
        }
        identical=changedFields.length===0;
      }else changedFields.push('Existing PE has no comparable Rosa group metadata.');
      const priorReviewedAt=current?.sourceReviewedAt.toISOString()??timestamp((record.sourceMetadata as {reviewedAt?:string}|null)?.reviewedAt??'');
      if(!identical)revisionAction=priorReviewedAt&&reviewedAt&&reviewedAt>priorReviewedAt?'PROMOTE':priorReviewedAt&&reviewedAt&&reviewedAt<priorReviewedAt?'OLDER':'SAME_TIME';
      messages.push(identical?'Already imported / No changes.':revisionAction==='PROMOTE'?'Newer submission available.':revisionAction==='OLDER'?'Older submission detected. This Price Exception already has a newer reviewed submission. No pricing changes will be made.':'Submission needs review. Its reviewed time is the same as the current submission or cannot be compared. No pricing changes will be made.');
    }else if(matching.length>1){changedFields.push('Multiple existing PEs share this number.');messages.push('Multiple existing PEs share this number.');}
    const siblingSubmissions=[...grouped].filter(([,rows])=>key(rows[0].values['PE Number'])===code);
    const earliest=siblingSubmissions.sort((a,b)=>(timestamp(a[1][0].values['Reviewed At'])??'').localeCompare(timestamp(b[1][0].values['Reviewed At'])??''))[0]?.[0];
    const pendingSibling=!matching.length&&siblingSubmissions.length>1&&earliest!==groupKey;
    if(pendingSibling)messages.push('Another submission for this PE Number appears earlier in this file. Import it first, then review this revision for promotion.');
    const needsReview=pendingSibling||conflictingFields.length>0||changedFields.length>0||!identical&&[requestedBy,reviewedBy,customer,varAccount,endUser].some(item=>!!item.issue)||!identical&&tiers.some(tier=>!!tier.sku.issue);
    const disposition:RosaDisposition=identical?'EXISTING / NO CHANGE':invalid?'ERROR':needsReview?'REVIEW REQUIRED':matching.length?'EXISTING / NO CHANGE':'READY';
    counts[disposition]++;
    groups.push({groupKey,peNumber,sourceLines:sourceRows.map(row=>row.line),statusSource,statusMapped,requestedAt:raw['Requested At'],reviewedAt:raw['Reviewed At'],requestedBy,reviewedBy,customer,varAccount,endUser,expirationDate:expirationDate??raw['Expiration Date'],currency:raw.Currency,description:raw.Description,tiers,disposition,messages,conflictingFields:[...conflictingFields],conflictOptions,changedFields,revisionDifferences,existingId:matching[0]?.id??null,fingerprint,currentRevision,revisionAction,revisionRecorded});
  }
  return {groups,counts,sourceRowCount:parsed.rows.length,errors:[],digest:hash(JSON.stringify({fileName,groups,manualChoices:restoredChoices})),fileName,choices:{accounts:accountChoices.map(({id,name})=>({id,name})),users:userChoices.map(({id,name})=>({id,name})),skus:skuChoices.map(({id,name,productName})=>({id,name:productName?`${name} · ${productName}`:name}))},restoredChoices};
}
export async function applyRosaPriceExceptions(db:PrismaClient,parsed:RosaParsed,fileName:string,expectedDigest:string,confirmed:boolean,actorId:number,manualChoices:RosaManualChoices={}){
  if(confirmed!==true||!expectedDigest)throw new Error('Preview and explicit confirmation required.');
  return db.$transaction(async tx=>{
    const plan=await planRosaPriceExceptions(tx,parsed,fileName,manualChoices);
    if(plan.digest!==expectedDigest||plan.errors.length)throw new Error('Preview changed. Preview the file again.');
    const ready=plan.groups.filter(group=>group.disposition==='READY');
    if(!ready.length)throw new Error('No Price Exceptions ready to import.');
    for(const group of ready){
      const sourceRows=parsed.rows.filter(row=>group.sourceLines.includes(row.line));const raw={...sourceRows[0].values};
      const groupKey=group.groupKey;
      const reviewedChoice=manualChoices[groupKey]??{};
      for(const [field,line] of Object.entries(reviewedChoice.headerLines??{}))raw[field as RosaHeaderChoiceField]=sourceRows.find(row=>row.line===line)!.values[field as RosaHeaderChoiceField];
      const assignee=await tx.user.findUnique({where:{id:group.requestedBy.id!},select:{role:true}});
      const pe=await tx.priceException.create({data:{
        peCode:group.peNumber,status:'ACTIVE',sourceType:'EXTERNAL_EXPORT',sourceKey:`ROSA:${key(group.peNumber)}`,
        distributorAccountId:group.customer.id,varAccountId:group.varAccount.id,endUserAccountId:group.endUser.id,
        distributorSourceName:raw.Customer,varSourceName:raw.VAR,endUserSourceName:raw['End User'],sourceSalesRepName:raw['Requested By'],
        assignedSalesRepUserId:usersSalesRepId(group.requestedBy.id,assignee),expirationDate:new Date(`${group.expirationDate}T00:00:00.000Z`),
        sourceDescription:raw.Description,sourceFileName:fileName,createdById:actorId,
        sourceMetadata:{adapter:'ROSA_PE_CSV_V1',rosaFingerprint:group.fingerprint,rosaHeader:Object.fromEntries(headerFields.map(field=>[field,headerValue(field,raw[field])])),rosaRawRows:sourceRows.map(row=>({line:row.line,values:row.values})),rosaReviewedChoices:reviewedChoice,requestedAt:raw['Requested At'],reviewedAt:raw['Reviewed At'],requestedByUserId:group.requestedBy.id,reviewedByUserId:group.reviewedBy.id,sourceStatus:raw.Status,partyMapping:{Customer:'distributorAccount',VAR:'varAccount','End User':'endUserAccount'}},
      }});
      const revision=await createRevision(tx,pe.id,group,sourceRows,fileName,reviewedChoice,actorId);
      await tx.priceExceptionLine.createMany({data:lineData(pe.id,revision.id,group,sourceRows)});
      await tx.priceException.update({where:{id:pe.id},data:{currentSourceRevisionId:revision.id}});
    }
    return {created:ready.length,lines:ready.reduce((sum,group)=>sum+group.tiers.length,0),skipped:plan.groups.length-ready.length,counts:plan.counts};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:60000});
}
function usersSalesRepId(id:number|null,user:{role:string}|null){return id&&user&&['SALES','SALES_MANAGER'].includes(user.role)?id:null;}

function resolvedHeader(group:RosaPlanGroup,raw:Record<RosaColumn,string>){
  return Object.fromEntries(headerFields.map(field=>[field,headerValue(field,raw[field])])) as Record<HeaderField,string>;
}
function lineData(peId:number,revisionId:number,group:RosaPlanGroup,sourceRows:RosaSourceRow[]){return group.tiers.map((tier,index)=>{const row=sourceRows.find(candidate=>candidate.line===tier.line)!;return {
  priceExceptionId:peId,sourceRevisionId:revisionId,sourceLineKey:`ROSA:${group.fingerprint}:${tier.sourceLineKey}`,productSkuId:tier.sku.id,sourceSku:row.values.SKU,approvedUnitPrice:new Prisma.Decimal(row.values['Approved Price']),currencyCode:row.values.Currency.trim().toUpperCase(),sourceQuantity:new Prisma.Decimal(row.values.Quantity),sourceQuantityRaw:row.values.Quantity,sortOrder:index,sourceMetadata:{originalPrice:row.values['Original Price'],sourceLine:row.line,rosaRaw:row.values,rosaFingerprint:tier.sourceFingerprint},
};});}
async function createRevision(tx:Prisma.TransactionClient,peId:number,group:RosaPlanGroup,rows:RosaSourceRow[],fileName:string,choice:RosaManualGroupChoice,actorId:number){
  const raw={...rows[0].values};for(const [field,line] of Object.entries(choice.headerLines??{}))raw[field as RosaHeaderChoiceField]=rows.find(row=>row.line===line)!.values[field as RosaHeaderChoiceField];
  return tx.priceExceptionSourceRevision.create({data:{priceExceptionId:peId,peNumber:key(group.peNumber),contentHash:group.fingerprint,sourceFileName:fileName,sourceReviewedAt:new Date(group.reviewedAt),rawRows:rows as unknown as Prisma.InputJsonValue,reviewedChoices:choice as Prisma.InputJsonValue,resolvedHeader:{...resolvedHeader(group,raw),sourceValues:raw,resolutions:{requestedBy:group.requestedBy,reviewedBy:group.reviewedBy,customer:group.customer,varAccount:group.varAccount,endUser:group.endUser}} as Prisma.InputJsonValue,resolvedTiers:group.tiers as unknown as Prisma.InputJsonValue,recordedById:actorId}});
}

/** Explicit administrator promotion; preview digest and current pointer are rechecked inside the transaction. */
export async function promoteRosaRevision(db:PrismaClient,parsed:RosaParsed,fileName:string,expectedDigest:string,groupKey:string,confirmed:boolean,actorId:number,manualChoices:RosaManualChoices={}){
  if(!confirmed||!expectedDigest)throw new Error('Preview and explicit confirmation required.');
  return db.$transaction(async tx=>{
    const plan=await planRosaPriceExceptions(tx,parsed,fileName,manualChoices);
    if(plan.digest!==expectedDigest||plan.errors.length)throw new Error('Preview changed. Preview the file again.');
    const group=plan.groups.find(item=>item.groupKey===groupKey);
    if(!group||!group.existingId||group.revisionAction!=='PROMOTE'||group.disposition!=='REVIEW REQUIRED'||group.conflictingFields.length||[group.requestedBy,group.reviewedBy,group.customer,group.varAccount,group.endUser,...group.tiers.map(tier=>tier.sku)].some(item=>item.issue))throw new Error('Resolve the newer source revision before promotion.');
    const pe=await tx.priceException.findUniqueOrThrow({where:{id:group.existingId},select:{currentSourceRevisionId:true,sourceType:true,sourceKey:true,archivedAt:true}});
    if(pe.archivedAt||pe.sourceType!=='EXTERNAL_EXPORT'||pe.sourceKey!==`ROSA:${key(group.peNumber)}`||pe.currentSourceRevisionId!==group.currentRevision?.id)throw new Error('Current Price Exception changed. Preview again.');
    const sourceRows=parsed.rows.filter(row=>group.sourceLines.includes(row.line));
    const choice=plan.restoredChoices[groupKey]??{};
    const revision=await tx.priceExceptionSourceRevision.findUnique({where:{priceExceptionId_contentHash:{priceExceptionId:group.existingId,contentHash:group.fingerprint}}})??await createRevision(tx,group.existingId,group,sourceRows,fileName,choice,actorId);
    const retiredAt=new Date();
    await tx.priceExceptionLine.updateMany({where:{priceExceptionId:group.existingId,retiredAt:null},data:{retiredAt}});
    await tx.priceExceptionLine.createMany({data:lineData(group.existingId,revision.id,group,sourceRows)});
    const raw={...sourceRows[0].values};for(const [field,line] of Object.entries(choice.headerLines??{}))raw[field as RosaHeaderChoiceField]=sourceRows.find(row=>row.line===line)!.values[field as RosaHeaderChoiceField];
    const assignee=await tx.user.findUnique({where:{id:group.requestedBy.id!},select:{role:true}});
    await tx.priceException.update({where:{id:group.existingId},data:{currentSourceRevisionId:revision.id,status:'ACTIVE',distributorAccountId:group.customer.id,varAccountId:group.varAccount.id,endUserAccountId:group.endUser.id,distributorSourceName:raw.Customer,varSourceName:raw.VAR,endUserSourceName:raw['End User'],sourceSalesRepName:raw['Requested By'],assignedSalesRepUserId:usersSalesRepId(group.requestedBy.id,assignee),expirationDate:new Date(`${group.expirationDate}T00:00:00.000Z`),sourceDescription:raw.Description,updatedById:actorId}});
    return {priceExceptionId:group.existingId,revisionId:revision.id,retiredAt,tiers:group.tiers.length};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:60000});
}

/** Keep operational pricing current while recording the reviewed source submission as immutable evidence. */
export async function recordRosaRevision(db:PrismaClient,parsed:RosaParsed,fileName:string,expectedDigest:string,groupKey:string,confirmed:boolean,actorId:number,manualChoices:RosaManualChoices={}){
  if(!confirmed||!expectedDigest)throw new Error('Preview and explicit confirmation required.');
  return db.$transaction(async tx=>{
    const plan=await planRosaPriceExceptions(tx,parsed,fileName,manualChoices);
    if(plan.digest!==expectedDigest||plan.errors.length)throw new Error('Preview changed. Preview the file again.');
    const group=plan.groups.find(item=>item.groupKey===groupKey);
    if(!group||!group.existingId||group.revisionAction!=='PROMOTE'||group.disposition!=='REVIEW REQUIRED'||group.conflictingFields.length||[group.requestedBy,group.reviewedBy,group.customer,group.varAccount,group.endUser,...group.tiers.map(tier=>tier.sku)].some(item=>item.issue))throw new Error('Resolve the source revision before recording it.');
    const pe=await tx.priceException.findUniqueOrThrow({where:{id:group.existingId},select:{currentSourceRevisionId:true,sourceType:true,sourceKey:true,archivedAt:true}});
    if(pe.archivedAt||pe.sourceType!=='EXTERNAL_EXPORT'||pe.sourceKey!==`ROSA:${key(group.peNumber)}`||pe.currentSourceRevisionId!==group.currentRevision?.id)throw new Error('Current Price Exception changed. Preview again.');
    const existing=await tx.priceExceptionSourceRevision.findUnique({where:{priceExceptionId_contentHash:{priceExceptionId:group.existingId,contentHash:group.fingerprint}}});
    if(existing)return {priceExceptionId:group.existingId,revisionId:existing.id,created:false};
    const sourceRows=parsed.rows.filter(row=>group.sourceLines.includes(row.line));
    const revision=await createRevision(tx,group.existingId,group,sourceRows,fileName,plan.restoredChoices[groupKey]??{},actorId);
    return {priceExceptionId:group.existingId,revisionId:revision.id,created:true};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:60000});
}
