import { Prisma, type PrismaClient } from '@prisma/client';
import { can, type Actor } from './authorization';
import { parseTradeShowWorkbook, type ParsedLead, type ParsedWorkbook } from './trade-show-import-parser';

export type ImportChoice = { sourceKey: string; repId: number | null; accountId: number | null; contactId: number | null; refresh: boolean };
const clean = (value: string | null | undefined) => (value??'').trim().replace(/\s+/g,' ').toLowerCase();
function stableJson(value:unknown):string{return JSON.stringify(value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,item&&typeof item==='object'?JSON.parse(stableJson(item)):item])):value);}
function domain(value:string|null|undefined){if(!value)return null;try{const url=new URL(/^https?:\/\//i.test(value)?value:`https://${value}`);const host=url.hostname.toLowerCase().replace(/^www\./,'');return host.includes('.')?host:null;}catch{return null;}}
export function suggestMatches(row:ParsedLead, accounts:{id:number;name:string;website:string|null}[], contacts:{id:number;firstName:string;lastName:string;email:string|null;accountId:number|null}[]){
  const contactMatches=row.email?contacts.filter(c=>clean(c.email)===clean(row.email)):[];
  const exactAccounts=row.sourceCompany?accounts.filter(a=>clean(a.name)===clean(row.sourceCompany)):[];
  const websiteDomain=domain(row.sourceCompanyWebsite);
  const domainAccounts=websiteDomain?accounts.filter(a=>domain(a.website)===websiteDomain):[];
  const possibleAccounts=row.sourceCompany?accounts.filter(a=>!exactAccounts.some(x=>x.id===a.id)&&clean(a.name).includes(clean(row.sourceCompany!))&&clean(row.sourceCompany).length>=5).slice(0,5):[];
  return {contactMatches,exactAccounts,domainAccounts,possibleAccounts,contactSuggestion:contactMatches.length===1?contactMatches[0].id:null,accountSuggestion:exactAccounts.length===1?exactAccounts[0].id:!exactAccounts.length&&domainAccounts.length===1?domainAccounts[0].id:null};
}
export async function previewTradeShowImport(client:PrismaClient,showId:number,buffer:Buffer,filename:string,actor:Actor){
  if(!can(actor,'trade-shows.manage'))throw new Error('Access denied');
  const show=await client.tradeShow.findUnique({where:{id:showId},select:{timezone:true,archivedAt:true}});
  if(!show||show.archivedAt)throw new Error('Trade Show not found or archived.');
  const parsed=parseTradeShowWorkbook(buffer,filename,showId,show.timezone);
  const [existing,accounts,contacts,reps,prior]=await Promise.all([
    client.tradeShowLead.findMany({where:{tradeShowId:showId,sourceKey:{in:parsed.rows.map(r=>r.sourceKey)}},select:{sourceKey:true,rawSourceData:true}}),
    client.account.findMany({where:{status:'ACTIVE',archivedAt:null},select:{id:true,name:true,website:true},take:10000}),
    client.contact.findMany({where:{active:true,archivedAt:null},select:{id:true,firstName:true,lastName:true,email:true,accountId:true,account:{select:{name:true}}},take:10000}),
    client.user.findMany({where:{active:true,archivedAt:null,role:{in:['SALES','SALES_MANAGER']}},select:{id:true,firstName:true,lastName:true},orderBy:[{firstName:'asc'},{lastName:'asc'}]}),
    client.tradeShowImport.count({where:{tradeShowId:showId,fileSha256:parsed.sha256}}),
  ]);
  const byKey=new Map(existing.map(e=>[e.sourceKey,e]));const seen=new Set<string>();const emailCount=new Map<string,number>();
  parsed.rows.forEach(row=>{if(row.email)emailCount.set(row.email,(emailCount.get(row.email)??0)+1)});
  const rows=parsed.rows.map(row=>{
    const old=byKey.get(row.sourceKey);const repeated=seen.has(row.sourceKey);seen.add(row.sourceKey);
    const state=row.invalid?'INVALID':repeated?'ALREADY_IMPORTED':old?stableJson(old.rawSourceData)===stableJson(row.rawSourceData)?'ALREADY_IMPORTED':'SOURCE_CHANGED':'NEW';
    const oldRaw=(old?.rawSourceData&&typeof old.rawSourceData==='object'&&!Array.isArray(old.rawSourceData)?old.rawSourceData:{}) as Record<string,unknown>;
    const changedSourceFields=state==='SOURCE_CHANGED'?[...new Set([...Object.keys(oldRaw),...Object.keys(row.rawSourceData)])].filter(header=>String(oldRaw[header]??'')!==String(row.rawSourceData[header]??'')).map(header=>({header,before:String(oldRaw[header]??''),after:String(row.rawSourceData[header]??'')})):[];
    const matches=suggestMatches(row,accounts,contacts);
    const warnings=[...row.warnings];if(row.email&&(emailCount.get(row.email)??0)>1)warnings.push(`${emailCount.get(row.email)} scans share this email; each scan remains separate.`);
    if(matches.contactMatches.length>1)warnings.push('Multiple active Contacts have this email.');
    if(matches.exactAccounts.length>1||matches.domainAccounts.length>1)warnings.push('Account match is ambiguous.');
    return {...row,state,warnings,matches,changedSourceFields};
  });
  const summary={total:rows.length,new:rows.filter(r=>r.state==='NEW').length,alreadyImported:rows.filter(r=>r.state==='ALREADY_IMPORTED').length,changedSource:rows.filter(r=>r.state==='SOURCE_CHANGED').length,invalid:rows.filter(r=>r.state==='INVALID').length,needsReview:rows.filter(r=>r.warnings.length||r.matches.contactMatches.length>1||r.matches.exactAccounts.length>1).length,usableEmail:rows.filter(r=>r.email).length,duplicateEmailGroups:[...emailCount.values()].filter(n=>n>1).length,unresolvedAccounts:rows.filter(r=>r.sourceCompany&&!r.matches.accountSuggestion).length,unresolvedContacts:rows.filter(r=>r.email&&!r.matches.contactSuggestion).length,placeholderRows:rows.filter(r=>r.warnings.some(w=>w.includes('placeholder'))).length};
  return {parsed,filename,rows,summary,reps,accounts,contacts,priorExactFile:prior>0};
}
export async function confirmTradeShowImport(client:PrismaClient,showId:number,buffer:Buffer,filename:string,actor:Actor,sha256:string,defaultRepId:number,choices:ImportChoice[]){
  if(!can(actor,'trade-shows.manage'))throw new Error('Access denied');
  const show=await client.tradeShow.findUnique({where:{id:showId},select:{timezone:true,archivedAt:true}});
  if(!show||show.archivedAt)throw new Error('Trade Show not found or archived.');
  const parsed:ParsedWorkbook=parseTradeShowWorkbook(buffer,filename,showId,show.timezone);
  if(parsed.sha256!==sha256)throw new Error('Workbook changed. Preview again.');
  if(choices.length!==parsed.rows.length||choices.some((c,i)=>c.sourceKey!==parsed.rows[i].sourceKey))throw new Error('Preview choices changed. Preview again.');
  return client.$transaction(async tx=>{
    const reps=await tx.user.findMany({where:{id:{in:[defaultRepId,...choices.map(c=>c.repId).filter((id):id is number=>id!==null)]},active:true,archivedAt:null,role:{in:['SALES','SALES_MANAGER']}},select:{id:true}});
    const validReps=new Set(reps.map(r=>r.id));if(!validReps.has(defaultRepId)||choices.some(c=>c.repId!==null&&!validReps.has(c.repId)))throw new Error('Choose active Sales reps.');
    const accountIds=[...new Set(choices.map(c=>c.accountId).filter((id):id is number=>id!==null))];
    const contactIds=[...new Set(choices.map(c=>c.contactId).filter((id):id is number=>id!==null))];
    const [accounts,contacts]=await Promise.all([
      tx.account.findMany({where:{id:{in:accountIds},status:'ACTIVE',archivedAt:null},select:{id:true}}),
      tx.contact.findMany({where:{id:{in:contactIds},active:true,archivedAt:null},select:{id:true,accountId:true}}),
    ]);
    const validAccounts=new Set(accounts.map(a=>a.id)),validContacts=new Map(contacts.map(c=>[c.id,c]));
    if(accountIds.some(id=>!validAccounts.has(id))||contactIds.some(id=>!validContacts.has(id)))throw new Error('Selected Account or Contact is unavailable.');
    for(const choice of choices){const contact=choice.contactId?validContacts.get(choice.contactId):null;if(contact?.accountId&&choice.accountId&&contact.accountId!==choice.accountId)throw new Error('Selected Contact belongs to a different Account.');}
    const record=await tx.tradeShowImport.create({data:{tradeShowId:showId,format:parsed.format,sourceFileName:filename,sourceSheet:parsed.sheet,fileSha256:parsed.sha256,uploadedById:actor.id,rowCount:parsed.rows.length}});
    let created=0,existing=0,skipped=0;const seen=new Set<string>();
    for(let i=0;i<parsed.rows.length;i++){
      const row=parsed.rows[i],choice=choices[i];if(row.invalid){skipped++;continue;}
      if(seen.has(row.sourceKey)){existing++;continue;}seen.add(row.sourceKey);
      const old=await tx.tradeShowLead.findUnique({where:{tradeShowId_sourceKey:{tradeShowId:showId,sourceKey:row.sourceKey}},select:{id:true,rawSourceData:true}});
      const source={rawSourceData:row.rawSourceData,capturedAt:row.capturedAt?new Date(row.capturedAt):null,firstName:row.firstName,lastName:row.lastName,title:row.title,email:row.email,phone:row.phone,sourceCompany:row.sourceCompany,sourceCompanyWebsite:row.sourceCompanyWebsite,addressLine1:row.addressLine1,addressLine2:row.addressLine2,city:row.city,stateProvince:row.stateProvince,postalCode:row.postalCode,country:row.country,sourceNotes:row.sourceNotes};
      if(old){existing++;if(choice.refresh&&stableJson(old.rawSourceData)!==stableJson(row.rawSourceData))await tx.tradeShowLead.update({where:{id:old.id},data:source});continue;}
      await tx.tradeShowLead.create({data:{tradeShowId:showId,firstImportId:record.id,sourceKey:row.sourceKey,sourceFileName:filename,sourceSheet:parsed.sheet,sourceRow:row.sourceRow,...source,assignedSalesRepUserId:choice.repId??defaultRepId,accountId:choice.accountId,contactId:choice.contactId,status:'NEW'}});created++;
    }
    await tx.tradeShowImport.update({where:{id:record.id},data:{createdCount:created,existingCount:existing,skippedCount:skipped}});
    return {created,existing,skipped,importId:record.id};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
