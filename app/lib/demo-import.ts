import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { normalizeAccountName } from './accounts';
import { reconcileDemoUnits } from './demo-operations';

export const demoHeaders = ['Request ID','Demo Number','Status','Requested At','Requested By','Reviewed At','Reviewed By','VAR','Shipping Address','Shipping Carrier','Carrier Account Number','SKU / Model','Quantity','Serial Numbers','Tracking Numbers','Inventory Locations','Shipped At','Shipped By','Duration Value','Duration Unit','Notes','Approval Comments'] as const;
export type DemoColumn = typeof demoHeaders[number];
export type DemoRow = {line:number;values:Record<DemoColumn,string>};
export type DemoParsed = {rows:DemoRow[];errors:string[]};
export type DemoChoices = Record<string,{accountId?:number;userIds?:Partial<Record<'Requested By'|'Reviewed By'|'Shipped By',number>>;skuIds?:Record<string,number>;headerLines?:Record<string,number>}>;
export type DemoDisposition = 'Ready to import'|'Needs review'|'Error'|'Already imported / No changes'|'Source update available'|'Older source submission detected';
export type DemoResolution = {source:string;id:number|null;name:string|null;issue:string|null};
export type DemoPlanItem = {line:number;sourceSku:string;sku:DemoResolution;quantity:number;serialNumbers:string[];trackingNumbers:string[];inventoryLocations:string[];sourceLineKey:string;raw:Record<DemoColumn,string>};
export type DemoPlanGroup = {requestId:string;demoNumber:string;status:string;requestedAt:string;reviewedAt:string|null;shippedAt:string|null;header:Record<DemoColumn,string>;rows:DemoRow[];account:DemoResolution;users:Record<'Requested By'|'Reviewed By'|'Shipped By',DemoResolution>;items:DemoPlanItem[];disposition:DemoDisposition;issues:string[];changes:{field:string;before:string;after:string}[];conflicts:{field:string;options:{line:number;value:string}[]}[];existingId:number|null;contentHash:string;sourceTimestamp:string};
export type DemoPlan = {groups:DemoPlanGroup[];counts:Record<DemoDisposition,number>;sourceRowCount:number;errors:string[];digest:string;fileName:string;choices:{accounts:{id:number;name:string}[];users:{id:number;name:string}[];skus:{id:number;name:string}[]}};
type Db = PrismaClient | Prisma.TransactionClient;
const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const norm=(value:string)=>value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
const normSku=(value:string)=>value.normalize('NFKC').trim().toUpperCase().replace(/\s+/g,' ');
const multi=(value:string)=>value.split(/[;\n]+/).map(part=>part.trim()).filter(Boolean);
const headerFields=demoHeaders.filter(field=>!['SKU / Model','Quantity','Serial Numbers','Tracking Numbers','Inventory Locations'].includes(field));
const userFields=['Requested By','Reviewed By','Shipped By'] as const;
const statuses=['PENDING','APPROVED','SHIPPED'] as const;
const statusRank:Record<string,number>={PENDING:0,APPROVED:1,SHIPPED:2};
const dispositions:DemoDisposition[]=['Ready to import','Needs review','Error','Already imported / No changes','Source update available','Older source submission detected'];
const counts=()=>Object.fromEntries(dispositions.map(value=>[value,0])) as Record<DemoDisposition,number>;
const date=(value:string)=>{const raw=value.trim();if(!raw)return null;const match=/^(\d{4})-(\d\d)-(\d\d)T\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.exec(raw);if(!match)return null;const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);if(year<1900||year>2100||month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate())return null;const result=new Date(raw);return Number.isNaN(result.valueOf())?null:result.toISOString();};
const uuid=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const positiveInt=(value:string)=>/^[1-9]\d*$/.test(value.trim())&&Number.isSafeInteger(Number(value.trim()))?Number(value.trim()):null;
const choiceId=(value:unknown)=>{if(!Number.isSafeInteger(value)||Number(value)<=0)throw new Error('Invalid manual choice. Preview the file again.');return Number(value);};

/** One reviewed source company maps to one Account across this upload; Request IDs remain independent. */
export function mapDemoSourceAccount(plan:DemoPlan,choices:DemoChoices,requestId:string,accountId:number):DemoChoices {
  const target=plan.groups.find(group=>group.requestId===requestId);
  if(!target?.account.source.trim())throw new Error('Source Account was not found. Preview again.');
  if(!plan.choices.accounts.some(account=>account.id===choiceId(accountId)))throw new Error('Account choice is no longer active.');
  const key=normalizeAccountName(target.account.source);
  const next={...choices};
  for(const group of plan.groups){
    if(normalizeAccountName(group.account.source)!==key)continue;
    if(!group.account.issue && choices[group.requestId]?.accountId===undefined && group.account.id!==accountId)continue;
    next[group.requestId]={...next[group.requestId],accountId};
  }
  return next;
}

/** A reviewed source part number has one CRM SKU mapping throughout an upload. */
export function mapDemoSourceSku(plan:DemoPlan,choices:DemoChoices,requestId:string,line:number,skuId:number|null):DemoChoices {
  const target=plan.groups.find(group=>group.requestId===requestId)?.items.find(item=>item.line===line);
  if(!target?.sourceSku.trim())throw new Error('Source SKU was not found. Preview again.');
  if(skuId!==null&&!plan.choices.skus.some(sku=>sku.id===choiceId(skuId)))throw new Error('SKU choice is no longer active.');
  const key=normSku(target.sourceSku),next={...choices};
  for(const group of plan.groups)for(const item of group.items){
    if(normSku(item.sourceSku)!==key)continue;
    if(skuId!==null&&item.sku.id!==null&&normSku(item.sku.name??'')===key&&item.sku.id!==skuId)throw new Error('SKU mapping conflicts with an exact match.');
    const skuIds={...next[group.requestId]?.skuIds};
    if(skuId===null)delete skuIds[item.line];else skuIds[item.line]=skuId;
    next[group.requestId]={...next[group.requestId],skuIds};
  }
  return next;
}

/** RFC-style CSV reader with physical line numbers and no source-specific assumptions. */
export function parseDemoCsv(input:string):DemoParsed {
  if(!input||Buffer.byteLength(input)>2_000_000)return {rows:[],errors:['Choose a UTF-8 Demo CSV smaller than 2 MB.']};
  const source=input.replace(/^\uFEFF/,'');const records:{line:number;cells:string[]}[]=[];
  let cells:string[]=[],cell='',quoted=false,closed=false,line=1,start=1;
  for(let i=0;i<source.length;i++){
    const c=source[i];
    if(quoted){if(c==='"'&&source[i+1]==='"'){cell+='"';i++;}else if(c==='"'){quoted=false;closed=true;}else{cell+=c;if(c==='\n')line++;}}
    else if(c===','||c==='\n'||c==='\r'){cells.push(cell);cell='';closed=false;if(c!==','){if(cells.some(x=>x.trim()))records.push({line:start,cells});cells=[];if(c==='\r'&&source[i+1]==='\n')i++;line++;start=line;}}
    else if(c==='"'&&!cell&&!closed)quoted=true;
    else if(c==='"'||closed)return {rows:[],errors:[`Malformed CSV at line ${line}.`]};
    else cell+=c;
  }
  if(quoted)return {rows:[],errors:[`Unclosed quoted field at line ${start}.`]};
  cells.push(cell);if(cells.some(x=>x.trim()))records.push({line:start,cells});
  if(!records.length)return {rows:[],errors:['CSV header row is required.']};
  if(records[0].cells.length!==demoHeaders.length||demoHeaders.some((header,index)=>records[0].cells[index].trim()!==header))return {rows:[],errors:['CSV headers must match the Demo export exactly.']};
  const rows:DemoRow[]=[],errors:string[]=[];
  for(const record of records.slice(1)){
    if(record.cells.length!==demoHeaders.length){errors.push(`Line ${record.line}: expected ${demoHeaders.length} columns, found ${record.cells.length}.`);continue;}
    rows.push({line:record.line,values:Object.fromEntries(demoHeaders.map((header,index)=>[header,record.cells[index]])) as Record<DemoColumn,string>});
  }
  return {rows,errors};
}

function resolve(source:string,candidates:{id:number;name:string}[],normalizer:(value:string)=>string,optional=false):DemoResolution {
  if(!source.trim())return {source,id:null,name:null,issue:optional?null:'Missing source value.'};
  const matches=candidates.filter(item=>normalizer(item.name)===normalizer(source));
  return matches.length===1?{source,id:matches[0].id,name:matches[0].name,issue:null}:{source,id:null,name:null,issue:matches.length?'Multiple CRM matches.':'No CRM match.'};
}
function resolveUser(source:string,candidates:{id:number;name:string}[],required:boolean):DemoResolution {
  if(!source.trim())return {source,id:null,name:null,issue:required?'Missing source user.':null};
  const full=candidates.filter(item=>norm(item.name)===norm(source));
  const first=full.length?full:candidates.filter(item=>norm(item.name.split(' ')[0])===norm(source));
  return first.length===1?{source,id:first[0].id,name:first[0].name,issue:null}:{source,id:null,name:null,issue:required?first.length?'Multiple CRM users match.':'No CRM user matches.':null};
}
function canonical(field:string,value:string){if(['Requested At','Reviewed At','Shipped At'].includes(field))return date(value)??value.trim();if(field==='Status')return value.trim().toUpperCase();if(field==='Duration Unit')return norm(value).replace(/s$/,'');if(field==='VAR')return normalizeAccountName(value);return value.normalize('NFKC').trim().replace(/\s+/g,' ');}
const show=(value:unknown)=>value===null||value===undefined||value===''?'—':Array.isArray(value)?value.join('; ')||'—':String(value);
function currentComparison(existing:{demoNumber:string|null;status:string;requestedAt:Date;reviewedAt:Date|null;shippedAt:Date|null;shippingAddress:string|null;shippingCarrier:string|null;carrierAccountNumber:string|null;durationValue:number|null;durationUnit:string|null;notes:string|null;approvalComments:string|null;sourceHeader:Prisma.JsonValue;items:{sourceLineKey:string;sourceSku:string;quantity:number;serialNumbers:Prisma.JsonValue;trackingNumbers:Prisma.JsonValue;inventoryLocations:Prisma.JsonValue;retiredAt:Date|null}[]},header:Record<DemoColumn,string>,items:DemoPlanItem[]){
  const changes:{field:string;before:string;after:string}[]=[];
  const old=(existing.sourceHeader??{}) as Record<string,string>;
  for(const field of headerFields){
    if(field==='Request ID')continue;
    const live:Record<string,string>={'Demo Number':existing.demoNumber??'',Status:existing.status,'Requested At':existing.requestedAt.toISOString(),'Reviewed At':existing.reviewedAt?.toISOString()??'','Shipped At':existing.shippedAt?.toISOString()??'','Shipping Address':existing.shippingAddress??'','Shipping Carrier':existing.shippingCarrier??'','Carrier Account Number':existing.carrierAccountNumber??'','Duration Value':existing.durationValue?.toString()??'','Duration Unit':existing.durationUnit??'',Notes:existing.notes??'','Approval Comments':existing.approvalComments??''};
    const before=Object.hasOwn(live,field)?live[field]:old[field]??'';
    if(canonical(field,before)!==canonical(field,header[field]))changes.push({field,before:show(before),after:show(header[field])});
  }
  const active=existing.items.filter(item=>!item.retiredAt);
  const oldShape=active.map(item=>`${item.sourceLineKey}:${item.quantity}`).sort();
  const newShape=items.map(item=>`${item.sourceLineKey}:${item.quantity}`).sort();
  if(JSON.stringify(oldShape)!==JSON.stringify(newShape))changes.push({field:'Demo Items',before:active.map(item=>`${item.sourceSku} × ${item.quantity} | serials ${show(item.serialNumbers)} | tracking ${show(item.trackingNumbers)} | locations ${show(item.inventoryLocations)}`).join('; ')||'—',after:items.map(item=>`${item.sourceSku} × ${item.quantity} | serials ${show(item.serialNumbers)} | tracking ${show(item.trackingNumbers)} | locations ${show(item.inventoryLocations)}`).join('; ')||'—'});
  else for(const item of items){const prior=active.find(old=>old.sourceLineKey===item.sourceLineKey)!;for(const [field,before,after] of [['Serial Numbers',prior.serialNumbers,item.serialNumbers],['Tracking Numbers',prior.trackingNumbers,item.trackingNumbers],['Inventory Locations',prior.inventoryLocations,item.inventoryLocations]] as const)if(JSON.stringify(before)!==JSON.stringify(after))changes.push({field:`${field} · ${item.sourceSku}`,before:show(before),after:show(after)});}
  return changes;
}

export async function planDemoImport(db:Db,parsed:DemoParsed,fileName:string,manual:DemoChoices={}):Promise<DemoPlan>{
  const result:DemoPlan={groups:[],counts:counts(),sourceRowCount:parsed.rows.length,errors:parsed.errors,digest:'',fileName,choices:{accounts:[],users:[],skus:[]}};
  if(parsed.errors.length)return result;
  const [accounts,users,skus,existing]=await Promise.all([
    db.account.findMany({where:{status:'ACTIVE',archivedAt:null},select:{id:true,name:true}}),
    db.user.findMany({where:{active:true,archivedAt:null},select:{id:true,firstName:true,lastName:true}}),
    db.productSku.findMany({where:{active:true,product:{active:true,archivedAt:null}},select:{id:true,partNumber:true}}),
    db.demoRequest.findMany({where:{sourceRequestId:{in:[...new Set(parsed.rows.map(row=>row.values['Request ID'].trim().toLowerCase()).filter(uuid))]}},include:{items:true,revisions:{orderBy:{id:'desc'},take:1}}}),
  ]);
  result.choices={accounts,users:users.map(user=>({id:user.id,name:`${user.firstName} ${user.lastName}`})),skus:skus.map(sku=>({id:sku.id,name:sku.partNumber}))};
  const grouped=new Map<string,DemoRow[]>();for(const row of parsed.rows){const id=row.values['Request ID'].trim().toLowerCase();grouped.set(id,[...(grouped.get(id)??[]),row]);}
  for(const id of Object.keys(manual))if(!grouped.has(id))throw new Error('Manual choices do not match this file. Preview again.');
  for(const [requestId,rows] of grouped){
    const selected=manual[requestId]??{};const issues:string[]=[];let invalid=false;
    for(const key of Object.keys(selected))if(!['accountId','userIds','skuIds','headerLines'].includes(key))throw new Error('Invalid manual choice. Preview again.');
    for(const field of Object.keys(selected.userIds??{}))if(!userFields.includes(field as typeof userFields[number]))throw new Error('Invalid user choice. Preview again.');
    const chosenHeaders=selected.headerLines??{};
    const conflicts=headerFields.filter(field=>field!=='Request ID'&&rows.some(row=>canonical(field,row.values[field])!==canonical(field,rows[0].values[field]))).map(field=>({field,options:rows.map(row=>({line:row.line,value:row.values[field]})).filter((option,index,array)=>array.findIndex(other=>canonical(field,other.value)===canonical(field,option.value))===index)}));
    for(const [field,line] of Object.entries(chosenHeaders))if(!conflicts.some(item=>item.field===field)||!rows.some(row=>row.line===line))throw new Error('Header choice no longer matches this file. Preview again.');
    const header={...rows[0].values};for(const [field,line] of Object.entries(chosenHeaders))header[field as DemoColumn]=rows.find(row=>row.line===line)!.values[field as DemoColumn];
    for(const conflict of conflicts)if(!Object.hasOwn(chosenHeaders,conflict.field))issues.push(`${conflict.field} differs across source rows.`);
    for(const row of rows){const values=row.values;
      if(!statuses.includes(values.Status.trim().toUpperCase() as typeof statuses[number])||!date(values['Requested At'])||values['Reviewed At'].trim()&&!date(values['Reviewed At'])||values['Shipped At'].trim()&&!date(values['Shipped At'])||!positiveInt(values['Duration Value'])||!['day','days','week','weeks','month','months'].includes(norm(values['Duration Unit']))){invalid=true;issues.push(`Line ${row.line}: invalid status, timestamp, or duration; correct the source file.`);}
    }
    const status=header.Status.trim().toUpperCase(),requestedAt=date(header['Requested At']),reviewedAt=date(header['Reviewed At']),shippedAt=date(header['Shipped At']);
    if(!uuid(requestId)){invalid=true;issues.push('Request ID must be a UUID.');}
    if(!statuses.includes(status as typeof statuses[number])){invalid=true;issues.push(`Unsupported source status: ${header.Status||'blank'}.`);}
    if(!requestedAt){invalid=true;issues.push('Requested At must be a timestamp with a timezone.');}
    if(header['Reviewed At'].trim()&&!reviewedAt){invalid=true;issues.push('Reviewed At is invalid.');}
    if(header['Shipped At'].trim()&&!shippedAt){invalid=true;issues.push('Shipped At is invalid.');}
    if(status==='SHIPPED'&&!shippedAt){invalid=true;issues.push('Shipped requests require Shipped At.');}
    if(requestedAt&&reviewedAt&&requestedAt>reviewedAt||reviewedAt&&shippedAt&&reviewedAt>shippedAt){invalid=true;issues.push('Lifecycle timestamps are out of order.');}
    const duration=positiveInt(header['Duration Value']);if(!duration||!['day','days','week','weeks','month','months'].includes(norm(header['Duration Unit']))){invalid=true;issues.push('Duration must have a positive value and day, week, or month unit.');}
    const autoAccount=resolve(header.VAR,result.choices.accounts,normalizeAccountName);
    const account=selected.accountId===undefined?autoAccount:(()=>{if(!autoAccount.issue&&autoAccount.id!==selected.accountId)throw new Error('Account mapping conflicts with exact match.');const item=result.choices.accounts.find(item=>item.id===choiceId(selected.accountId));if(!item)throw new Error('Account choice is no longer active.');return {source:header.VAR,id:item.id,name:item.name,issue:null};})();
    const resolvedUsers={} as DemoPlanGroup['users'];for(const field of userFields){
      const auto=resolveUser(header[field],result.choices.users,field==='Requested By');const choice=selected.userIds?.[field];
      if(choice!==undefined){if(!header[field].trim()||auto.id!==null&&auto.id!==choice)throw new Error('User mapping conflicts with source.');const item=result.choices.users.find(item=>item.id===choiceId(choice));if(!item)throw new Error('User choice is no longer active.');resolvedUsers[field]={source:header[field],id:item.id,name:item.name,issue:null};}
      else resolvedUsers[field]=auto;
    }
    const occurrence=new Map<string,number>();const items:DemoPlanItem[]=[];
    for(const row of rows){const raw=row.values,sourceSku=raw['SKU / Model'].trim(),skuKey=normSku(sourceSku),index=(occurrence.get(skuKey)??0)+1;occurrence.set(skuKey,index);
      const quantity=positiveInt(raw.Quantity);if(!quantity){invalid=true;issues.push(`Line ${row.line}: Quantity must be a positive integer.`);}
      if(!sourceSku){invalid=true;issues.push(`Line ${row.line}: SKU / Model is required.`);}
      const auto=resolve(sourceSku,result.choices.skus,normSku),choice=selected.skuIds?.[String(row.line)];let sku=auto;
      if(choice!==undefined){if(!auto.issue&&auto.id!==choice)throw new Error('SKU choice conflicts with exact match.');const item=result.choices.skus.find(item=>item.id===choiceId(choice));if(!item)throw new Error('SKU choice is no longer active.');sku={source:sourceSku,id:item.id,name:item.name,issue:null};}
      const serialNumbers=multi(raw['Serial Numbers']);
      if(quantity&&(serialNumbers.length>quantity||new Set(serialNumbers.map(value=>value.toUpperCase())).size!==serialNumbers.length)){invalid=true;issues.push(`Line ${row.line}: serials must be unique and no more than Quantity.`);}
      items.push({line:row.line,sourceSku,sku,quantity:quantity??0,serialNumbers,trackingNumbers:multi(raw['Tracking Numbers']),inventoryLocations:multi(raw['Inventory Locations']),sourceLineKey:`${skuKey}:${index}`,raw});
    }
    for(const line of Object.keys(selected.skuIds??{}))if(!rows.some(row=>String(row.line)===line))throw new Error('SKU choice no longer matches a source row.');
    if(resolvedUsers['Requested By'].issue)issues.push(`Requested By: ${resolvedUsers['Requested By'].issue}`);
    if(account.issue)issues.push(`VAR: ${account.issue}`);
    for(const item of items)if(item.sku.issue)issues.push(`Line ${item.line} SKU: ${item.sku.issue}`);
    const current=existing.find(item=>item.sourceRequestId?.toLowerCase()===requestId);
    if(current&&account.id!==null&&account.id!==current.accountId&&(current.projectId!=null||current.opportunityId!=null))issues.push('Account changed while Project or Opportunity is linked; unlink business context before applying this source update.');
    const contentHash=sha({header:demoHeaders.filter(field=>!['SKU / Model','Quantity','Serial Numbers','Tracking Numbers','Inventory Locations'].includes(field)).map(field=>header[field]),items:rows.map(row=>['SKU / Model','Quantity','Serial Numbers','Tracking Numbers','Inventory Locations'].map(field=>row.values[field as DemoColumn])).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))});
    const sourceTimestamp=[requestedAt,reviewedAt,shippedAt].filter((value):value is string=>!!value).sort().at(-1)??'';
    const changes=current?currentComparison(current,header,items):[];
    let disposition:DemoDisposition=invalid?'Error':issues.length?'Needs review':current?'Source update available':'Ready to import';
    if(current){
      const latest=current.revisions[0];const oldTimestamp=latest?.sourceTimestamp.toISOString()??current.shippedAt?.toISOString()??current.reviewedAt?.toISOString()??current.requestedAt.toISOString();
      if(latest?.contentHash===contentHash||!changes.length)disposition='Already imported / No changes';
      else if(sourceTimestamp<oldTimestamp||statusRank[status]<statusRank[current.status])disposition='Older source submission detected';
      else if(!invalid&&issues.length)disposition='Needs review';
    }
    result.groups.push({requestId,demoNumber:header['Demo Number'].trim(),status,requestedAt:requestedAt??'',reviewedAt,shippedAt,header,rows,account,users:resolvedUsers,items,disposition,issues,changes,conflicts,existingId:current?.id??null,contentHash,sourceTimestamp});
    result.counts[disposition]++;
  }
  result.digest=sha({fileName,rows:parsed.rows,manual,groups:result.groups.map(group=>({id:group.requestId,disposition:group.disposition,existingId:group.existingId,contentHash:group.contentHash,changes:group.changes,accountId:group.account.id,users:Object.values(group.users).map(user=>user.id),skus:group.items.map(item=>item.sku.id)}))});
  return result;
}

export async function applyDemoImport(client:PrismaClient,parsed:DemoParsed,fileName:string,expectedDigest:string,confirmed:boolean,actorId:number,manual:DemoChoices={},approvedUpdates:string[]=[]){
  if(!confirmed||!expectedDigest)throw new Error('Confirm the reviewed Demo import first.');
  return client.$transaction(async tx=>{
    const plan=await planDemoImport(tx,parsed,fileName,manual);
    if(plan.digest!==expectedDigest)throw new Error('Preview changed. Preview the file again.');
    if(approvedUpdates.some(id=>!plan.groups.some(group=>group.requestId===id&&group.disposition==='Source update available')))throw new Error('Update selection changed. Preview again.');
    let created=0,updated=0;
    for(const group of plan.groups){
      if(group.disposition!=='Ready to import'&&!(group.disposition==='Source update available'&&approvedUpdates.includes(group.requestId)))continue;
      const accountId=group.account.id;
      if(accountId===null)throw new Error(`Account unresolved for Request ID ${group.requestId}.`);
      const h=group.header;
      const data={demoNumber:group.demoNumber||null,status:group.status as 'PENDING'|'APPROVED'|'SHIPPED',requestedAt:new Date(group.requestedAt),requestedById:group.users['Requested By'].id,reviewedAt:group.reviewedAt?new Date(group.reviewedAt):null,reviewedById:group.users['Reviewed By'].id,accountId,shippingAddress:h['Shipping Address']||null,shippingCarrier:h['Shipping Carrier']||null,carrierAccountNumber:h['Carrier Account Number']||null,shippedAt:group.shippedAt?new Date(group.shippedAt):null,shippedById:group.users['Shipped By'].id,durationValue:positiveInt(h['Duration Value']),durationUnit:norm(h['Duration Unit']).replace(/s$/,''),notes:h.Notes||null,approvalComments:h['Approval Comments']||null,sourceHeader:h};
      const request=group.existingId?await tx.demoRequest.update({where:{id:group.existingId},data}):await tx.demoRequest.create({data:{...data,sourceRequestId:group.requestId}});
      if(group.existingId)updated++;else created++;
      const mappings={accountId:group.account.id,userIds:Object.fromEntries(userFields.map(field=>[field,group.users[field].id])),skuIds:Object.fromEntries(group.items.map(item=>[item.line,item.sku.id]))};
      await tx.demoSourceRevision.create({data:{demoRequestId:request.id,contentHash:group.contentHash,sourceFileName:fileName,sourceRowNumbers:group.rows.map(row=>row.line),sourceRows:group.rows as unknown as Prisma.InputJsonValue,reviewedMappings:mappings,resolvedHeader:data as unknown as Prisma.InputJsonValue,resolvedItems:group.items as unknown as Prisma.InputJsonValue,sourceTimestamp:new Date(group.sourceTimestamp),recordedById:actorId}});
      const keys=new Set(group.items.map(item=>item.sourceLineKey));
      for(const item of group.items){const lineData={sourceRowNumber:item.line,sourceSku:item.sourceSku,productSkuId:item.sku.id,quantity:item.quantity,serialNumbers:item.serialNumbers,trackingNumbers:item.trackingNumbers,inventoryLocations:item.inventoryLocations,sourceValues:item.raw};const saved=await tx.demoItem.upsert({where:{demoRequestId_sourceLineKey:{demoRequestId:request.id,sourceLineKey:item.sourceLineKey}},create:{demoRequestId:request.id,sourceLineKey:item.sourceLineKey,...lineData},update:{...lineData,retiredAt:null}});await reconcileDemoUnits(tx,saved.id,item.quantity,item.serialNumbers,item.inventoryLocations,group.status as 'PENDING'|'APPROVED'|'SHIPPED',group.shippedAt?new Date(group.shippedAt):null);}
      if(group.existingId){const prior=await tx.demoItem.findMany({where:{demoRequestId:request.id,retiredAt:null},select:{id:true,sourceLineKey:true}});for(const item of prior)if(!keys.has(item.sourceLineKey))await tx.demoItem.update({where:{id:item.id},data:{retiredAt:new Date()}});}
    }
    return {created,updated,skipped:plan.groups.length-created-updated};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
