import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';

export const rosaHeaders = ['PE Number','Status','Requested At','Reviewed At','Requested By','Reviewed By','Customer','VAR','End User','Expiration Date','SKU','Quantity','Original Price','Approved Price','Currency','Description'] as const;
export type RosaColumn = typeof rosaHeaders[number];
export type RosaDisposition = 'READY' | 'REVIEW REQUIRED' | 'EXISTING / NO CHANGE' | 'ERROR';
export type RosaSourceRow = { line:number; values:Record<RosaColumn,string> };
export type RosaParsed = { rows:RosaSourceRow[]; errors:string[] };
export type RosaResolution = { source:string; id:number|null; name:string|null; issue:string|null };
export type RosaPlanTier = { line:number; sku:RosaResolution; quantity:string; originalPrice:string; approvedPrice:string; currency:string; sourceLineKey:string; sourceFingerprint:string };
export type RosaPlanGroup = {
  peNumber:string; sourceLines:number[]; statusSource:string; statusMapped:'ACTIVE'|null;
  requestedAt:string; reviewedAt:string; requestedBy:RosaResolution; reviewedBy:RosaResolution;
  customer:RosaResolution; varAccount:RosaResolution; endUser:RosaResolution;
  expirationDate:string; currency:string; description:string; tiers:RosaPlanTier[];
  disposition:RosaDisposition; messages:string[]; conflictingFields:string[]; changedFields:string[]; existingId:number|null; fingerprint:string;
};
export type RosaPlan = { groups:RosaPlanGroup[]; counts:Record<RosaDisposition,number>; sourceRowCount:number; errors:string[]; digest:string; fileName:string };
type Db = PrismaClient | Prisma.TransactionClient;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const normalizedName=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const key=(value:string)=>value.normalize('NFKC').trim().toUpperCase();
const normalizePartNumber=(value:string)=>value.trim().replace(/\s+/g,' ').toUpperCase();
const emptyCounts=():Record<RosaDisposition,number>=>({'READY':0,'REVIEW REQUIRED':0,'EXISTING / NO CHANGE':0,'ERROR':0});

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
function resolveUser(source:string,users:{id:number;name:string;firstName:string}[]):RosaResolution{const value=source.trim();if(!value)return {source,id:null,name:null,issue:'Missing source value.'};const normalized=normalizedName(value);const matches=users.filter(user=>normalizedName(user.name)===normalized||normalizedName(user.firstName)===normalized);return matches.length===1?{source,id:matches[0].id,name:matches[0].name,issue:null}:{source,id:null,name:null,issue:matches.length?'Multiple CRM matches.':'No CRM match.'};}
function sourceFingerprint(row:RosaSourceRow){return hash(JSON.stringify(rosaHeaders.map(header=>row.values[header])));}
const headerFields = ['Status','Requested At','Reviewed At','Requested By','Reviewed By','Customer','VAR','End User','Expiration Date','Currency','Description'] as const;
type HeaderField = typeof headerFields[number];
function headerValue(field:HeaderField,value:string){
  if(field==='Requested At'||field==='Reviewed At')return timestamp(value)??value.trim();
  if(field==='Expiration Date')return parseRosaExpirationDate(value)??value.trim();
  if(field==='Status'||field==='Currency')return value.normalize('NFKC').trim().toUpperCase();
  if(field==='Description')return value.normalize('NFKC').trim().replace(/\s+/g,' ');
  return normalizedName(value);
}
function canonicalHeader(row:RosaSourceRow){return Object.fromEntries(headerFields.map(field=>[field,headerValue(field,row.values[field])])) as Record<HeaderField,string>;}
function canonicalTier(row:RosaSourceRow){const raw=row.values;return JSON.stringify([normalizePartNumber(raw.SKU),decimal(raw.Quantity,3,11)??raw.Quantity.trim(),decimal(raw['Original Price'],2,10)??raw['Original Price'].trim(),decimal(raw['Approved Price'],2,10)??raw['Approved Price'].trim(),raw.Currency.trim().toUpperCase()]);}
function sortedTierValues(rows:RosaSourceRow[]){return rows.map(canonicalTier).sort();}
function existingTierValues(lines:{sourceSku:string|null;sourceQuantityRaw:string|null;sourceQuantity:Prisma.Decimal|null;approvedUnitPrice:Prisma.Decimal|null;currencyCode:string;sourceMetadata:Prisma.JsonValue}[]){return lines.map(line=>JSON.stringify([normalizePartNumber(line.sourceSku??''),line.sourceQuantity?.toFixed(3)??line.sourceQuantityRaw, decimal((line.sourceMetadata as {originalPrice?:string}|null)?.originalPrice??'',2,10)??(line.sourceMetadata as {originalPrice?:string}|null)?.originalPrice??null,line.approvedUnitPrice?.toFixed(2)??null,line.currencyCode.trim().toUpperCase()])).sort();}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function conflictingHeaderFields(rows:RosaSourceRow[]){const first=canonicalHeader(rows[0]);return headerFields.filter(field=>rows.some(row=>canonicalHeader(row)[field]!==first[field]));}
function headerConflictMessage(field:HeaderField,rows:RosaSourceRow[]){return `${field} differs across source lines: ${rows.map(row=>`${row.line}=${JSON.stringify(row.values[field].slice(0,100))}`).join('; ')}.`;}
export async function planRosaPriceExceptions(db:Db,parsed:RosaParsed,fileName:string):Promise<RosaPlan>{
  const counts=emptyCounts();if(parsed.errors.length)return {groups:[],counts,sourceRowCount:parsed.rows.length,errors:parsed.errors,digest:'',fileName};
  const [users,accounts,skus,existing,currencies]=await Promise.all([
    db.user.findMany({select:{id:true,firstName:true,lastName:true,active:true,archivedAt:true,role:true}}),
    db.account.findMany({select:{id:true,name:true,status:true,archivedAt:true}}),
    db.productSku.findMany({select:{id:true,partNumber:true,normalizedPartNumber:true,active:true,product:{select:{active:true,archivedAt:true}}}}),
    db.priceException.findMany({select:{id:true,peCode:true,sourceType:true,sourceKey:true,sourceMetadata:true,lines:{select:{sourceSku:true,sourceQuantity:true,sourceQuantityRaw:true,approvedUnitPrice:true,currencyCode:true,sourceMetadata:true}}}}),
    db.currency.findMany({select:{code:true,active:true}}),
  ]);
  const userChoices=users.filter(user=>user.active&&!user.archivedAt).map(user=>({id:user.id,name:`${user.firstName} ${user.lastName}`,firstName:user.firstName}));
  const accountChoices=accounts.filter(account=>account.status==='ACTIVE'&&!account.archivedAt);
  const skuChoices=skus.filter(sku=>sku.active&&sku.product.active&&!sku.product.archivedAt).map(sku=>({id:sku.id,name:sku.partNumber}));
  const grouped=new Map<string,RosaSourceRow[]>();for(const row of parsed.rows){const code=key(row.values['PE Number']);const groupKey=code||`BLANK:${row.line}`;grouped.set(groupKey,[...(grouped.get(groupKey)??[]),row]);}
  const groups:RosaPlanGroup[]=[];
  for(const sourceRows of grouped.values()){
    const first=sourceRows[0],raw=first.values,peNumber=raw['PE Number'].trim(),code=key(peNumber),messages:string[]=[],changedFields:string[]=[];
    let invalid=false;const sourceError=(message:string)=>{messages.push(message);invalid=true;};
    const conflictingFields=conflictingHeaderFields(sourceRows);
    for(const field of conflictingFields)messages.push(headerConflictMessage(field,sourceRows));
    const requestedBy=resolveUser(raw['Requested By'],userChoices),reviewedBy=resolveUser(raw['Reviewed By'],userChoices);
    const customer=resolve(raw.Customer,accountChoices,normalizedName),varAccount=resolve(raw.VAR,accountChoices,normalizedName),endUser=resolve(raw['End User'],accountChoices,normalizedName);
    const requestedAt=timestamp(raw['Requested At']),reviewedAt=timestamp(raw['Reviewed At']),expirationDate=parseRosaExpirationDate(raw['Expiration Date']);
    const statusSource=raw.Status.trim(),statusMapped=statusSource.toLowerCase()==='approved'?'ACTIVE' as const:null;
    if(!code)sourceError('PE Number is required.');if(!statusMapped)sourceError(`Unsupported status: ${statusSource||'(blank)'}.`);
    if(!requestedAt||!reviewedAt)sourceError('Requested At and Reviewed At must be valid timestamps with offsets.');
    if(requestedAt&&reviewedAt&&requestedAt>reviewedAt)sourceError('Reviewed At is before Requested At.');
    if(!expirationDate)sourceError('Expiration Date is invalid or outside 1900–2100.');
    if(!raw.Description.trim())sourceError('Description is required.');
    if(!raw.Customer.trim())sourceError('Customer is required.');
    for(const row of sourceRows.slice(1)){
      const value=row.values,requested=timestamp(value['Requested At']),reviewed=timestamp(value['Reviewed At']);
      if(!parseRosaExpirationDate(value['Expiration Date']))sourceError(`Line ${row.line}: Expiration Date is invalid or outside 1900–2100.`);
      if(!requested||!reviewed)sourceError(`Line ${row.line}: Requested At and Reviewed At must be valid timestamps with offsets.`);
      if(requested&&reviewed&&requested>reviewed)sourceError(`Line ${row.line}: Reviewed At is before Requested At.`);
      if(value.Status.trim().toLowerCase()!=='approved')sourceError(`Line ${row.line}: Unsupported status: ${value.Status.trim()||'(blank)'}.`);
      if(!value.Description.trim())sourceError(`Line ${row.line}: Description is required.`);
      if(!value.Customer.trim())sourceError(`Line ${row.line}: Customer is required.`);
    }
    for(const [label,item] of [['Requested By',requestedBy],['Reviewed By',reviewedBy],['Customer',customer],['VAR',varAccount],['End User',endUser]] as const)if(item.issue)messages.push(`${label}: ${item.issue}`);
    const tierOccurrences=new Map<string,number>();
    const tiers:RosaPlanTier[]=sourceRows.map(row=>{
      const value=row.values,tierKey=canonicalTier(row),occurrence=(tierOccurrences.get(tierKey)??0)+1;tierOccurrences.set(tierKey,occurrence);
      const sku=resolve(value.SKU,skuChoices,normalizePartNumber),quantity=decimal(value.Quantity,3,11),originalPrice=decimal(value['Original Price'],2,10),approvedPrice=decimal(value['Approved Price'],2,10),currency=value.Currency.trim().toUpperCase();
      if(sku.issue)sourceError(`Line ${row.line} SKU: ${sku.issue}`);
      if(!quantity||!originalPrice||!approvedPrice)sourceError(`Line ${row.line}: Quantity and both prices must be positive values within CRM precision.`);
      if(!currencies.some(item=>item.code===currency&&item.active))sourceError(`Line ${row.line}: Currency ${currency||'(blank)'} is not active in CRM.`);
      return {line:row.line,sku,quantity:value.Quantity,originalPrice:value['Original Price'],approvedPrice:value['Approved Price'],currency:value.Currency,sourceLineKey:`ROSA:${hash(tierKey)}:${occurrence}`,sourceFingerprint:sourceFingerprint(row)};
    });
    const matching=existing.filter(item=>item.peCode&&key(item.peCode)===code||item.sourceType==='EXTERNAL_EXPORT'&&item.sourceKey===`ROSA:${code}`);
    const header=canonicalHeader(first),fingerprint=hash(JSON.stringify({header,tiers:sortedTierValues(sourceRows)}));
    let identical=false;
    if(matching.length===1){
      const record=matching[0],metadata=record.sourceMetadata as {adapter?:string;rosaHeader?:Record<HeaderField,string>}|null;
      if(metadata?.adapter==='ROSA_PE_CSV_V1'&&metadata.rosaHeader){
        for(const field of headerFields)if(metadata.rosaHeader[field]!==header[field])changedFields.push(field);
        if(!same(existingTierValues(record.lines),sortedTierValues(sourceRows)))changedFields.push('Pricing tiers');
        identical=changedFields.length===0;
      }else changedFields.push('Existing PE has no comparable Rosa group metadata.');
      messages.push(identical?'Existing PE and all pricing tiers are identical.':'Existing PE differs; historical data will not be changed.');
    }else if(matching.length>1){changedFields.push('Multiple existing PEs share this number.');messages.push('Multiple existing PEs share this number.');}
    const needsReview=conflictingFields.length>0||changedFields.length>0||[requestedBy,reviewedBy,customer,varAccount,endUser].some(item=>!!item.issue);
    const disposition:RosaDisposition=invalid?'ERROR':needsReview?'REVIEW REQUIRED':matching.length?'EXISTING / NO CHANGE':'READY';
    counts[disposition]++;
    groups.push({peNumber,sourceLines:sourceRows.map(row=>row.line),statusSource,statusMapped,requestedAt:raw['Requested At'],reviewedAt:raw['Reviewed At'],requestedBy,reviewedBy,customer,varAccount,endUser,expirationDate:expirationDate??raw['Expiration Date'],currency:raw.Currency,description:raw.Description,tiers,disposition,messages,conflictingFields:[...conflictingFields],changedFields,existingId:matching[0]?.id??null,fingerprint});
  }
  return {groups,counts,sourceRowCount:parsed.rows.length,errors:[],digest:hash(JSON.stringify({fileName,groups})),fileName};
}
export async function applyRosaPriceExceptions(db:PrismaClient,parsed:RosaParsed,fileName:string,expectedDigest:string,confirmed:boolean,actorId:number){
  if(confirmed!==true||!expectedDigest)throw new Error('Preview and explicit confirmation required.');
  return db.$transaction(async tx=>{
    const plan=await planRosaPriceExceptions(tx,parsed,fileName);
    if(plan.digest!==expectedDigest||plan.errors.length)throw new Error('Preview changed. Preview the file again.');
    const ready=plan.groups.filter(group=>group.disposition==='READY');
    if(!ready.length)throw new Error('No Price Exceptions ready to import.');
    for(const group of ready){
      const sourceRows=parsed.rows.filter(row=>group.sourceLines.includes(row.line));const raw=sourceRows[0].values;
      const assignee=await tx.user.findUnique({where:{id:group.requestedBy.id!},select:{role:true}});
      await tx.priceException.create({data:{
        peCode:group.peNumber,status:'ACTIVE',sourceType:'EXTERNAL_EXPORT',sourceKey:`ROSA:${key(group.peNumber)}`,
        distributorAccountId:group.customer.id,varAccountId:group.varAccount.id,endUserAccountId:group.endUser.id,
        distributorSourceName:raw.Customer,varSourceName:raw.VAR,endUserSourceName:raw['End User'],sourceSalesRepName:raw['Requested By'],
        assignedSalesRepUserId:usersSalesRepId(group.requestedBy.id,assignee),expirationDate:new Date(`${group.expirationDate}T00:00:00.000Z`),
        sourceDescription:raw.Description,sourceFileName:fileName,createdById:actorId,
        sourceMetadata:{adapter:'ROSA_PE_CSV_V1',rosaFingerprint:group.fingerprint,rosaHeader:canonicalHeader(sourceRows[0]),rosaRawRows:sourceRows.map(row=>({line:row.line,values:row.values})),requestedAt:raw['Requested At'],reviewedAt:raw['Reviewed At'],requestedByUserId:group.requestedBy.id,reviewedByUserId:group.reviewedBy.id,sourceStatus:raw.Status,partyMapping:{Customer:'distributorAccount',VAR:'varAccount','End User':'endUserAccount'}},
        lines:{create:group.tiers.map((tier,index)=>{const row=sourceRows.find(candidate=>candidate.line===tier.line)!;return {sourceLineKey:tier.sourceLineKey,productSkuId:tier.sku.id,sourceSku:row.values.SKU,approvedUnitPrice:new Prisma.Decimal(row.values['Approved Price']),currencyCode:row.values.Currency.trim().toUpperCase(),sourceQuantity:new Prisma.Decimal(row.values.Quantity),sourceQuantityRaw:row.values.Quantity,sortOrder:index,sourceMetadata:{originalPrice:row.values['Original Price'],sourceLine:row.line,rosaRaw:row.values,rosaFingerprint:tier.sourceFingerprint}}})},
      }});
    }
    return {created:ready.length,lines:ready.reduce((sum,group)=>sum+group.tiers.length,0),skipped:plan.groups.length-ready.length,counts:plan.counts};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:60000});
}
function usersSalesRepId(id:number|null,user:{role:string}|null){return id&&user&&['SALES','SALES_MANAGER'].includes(user.role)?id:null;}
