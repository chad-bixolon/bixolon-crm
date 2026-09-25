import { Prisma, TradeShowLeadRouting, type PrismaClient } from '@prisma/client';
import { can, type Actor } from './authorization';
import { applyReviewedOverrides, inspectTradeShowWorkbook, mappingCompatibility, parseTradeShowWorkbook, validateMapping, validateReviewedOverrides, type MappingDefinition, type ParsedLead, type ParsedWorkbook } from './trade-show-import-parser';
import type { ReviewedOverrides } from './trade-show-import-fields';
import { PARTNER_ACCOUNT_ROLES } from './trade-show-routing';

export type ReviewedRow = { originalSourceKey:string; reviewedOverrides:ReviewedOverrides };
export type ImportChoice = ReviewedRow & { sourceKey: string; routing:TradeShowLeadRouting|null; repId: number | null; partnerAccountId:number|null; accountId: number | null; contactId: number | null; refresh: boolean };
export type CustomMappingSelection = { definition: MappingDefinition; id: number | null; name: string | null };
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
type ExistingLead={sourceKey:string;sourceOriginalKey?:string|null;rawSourceData:unknown;reviewedOverrides?:unknown};
const storedOverrides=(value:unknown):ReviewedOverrides=>value&&typeof value==='object'&&!Array.isArray(value)?validateReviewedOverrides(value):{};
async function previewParsedTradeShowImport(client:PrismaClient,showId:number,filename:string,parsed:ParsedWorkbook,mapping:CustomMappingSelection|null,reviews:ReviewedRow[]|null){
  const originalKeys=parsed.rows.map(row=>row.sourceKey);
  if(reviews&&(reviews.length!==parsed.rows.length||reviews.some((review,index)=>review.originalSourceKey!==originalKeys[index])))throw new Error('Reviewed corrections changed. Preview again.');
  const [originalExisting,accounts,contacts,reps,prior]=await Promise.all([
    client.tradeShowLead.findMany({where:{tradeShowId:showId,OR:[{sourceKey:{in:originalKeys}},{sourceOriginalKey:{in:originalKeys}}]},select:{sourceKey:true,sourceOriginalKey:true,rawSourceData:true,reviewedOverrides:true}}),
    client.account.findMany({where:{status:'ACTIVE',archivedAt:null},select:{id:true,name:true,website:true,businessRoles:{select:{role:true}}},take:10000}),
    client.contact.findMany({where:{active:true,archivedAt:null},select:{id:true,firstName:true,lastName:true,email:true,accountId:true,account:{select:{name:true}}},take:10000}),
    client.user.findMany({where:{active:true,archivedAt:null,role:{in:['SALES','SALES_MANAGER']}},select:{id:true,firstName:true,lastName:true},orderBy:[{firstName:'asc'},{lastName:'asc'}]}),
    client.tradeShowImport.count({where:{tradeShowId:showId,fileSha256:parsed.sha256}}),
  ]);
  const originalByKey=new Map<string,ExistingLead>();for(const lead of originalExisting as ExistingLead[]){originalByKey.set(lead.sourceKey,lead);if(lead.sourceOriginalKey)originalByKey.set(lead.sourceOriginalKey,lead);}
  const effectiveRows=parsed.rows.map((row,index)=>{const old=originalByKey.get(row.sourceKey),reviewedOverrides={...storedOverrides(old?.reviewedOverrides),...storedOverrides(reviews?.[index]?.reviewedOverrides)};return {...applyReviewedOverrides(showId,parsed.format,row,reviewedOverrides),originalSourceKey:row.sourceKey,reviewedOverrides};});
  const changedKeys=effectiveRows.filter(row=>row.sourceKey!==row.originalSourceKey).map(row=>row.sourceKey);
  const effectiveExisting=changedKeys.length?await client.tradeShowLead.findMany({where:{tradeShowId:showId,sourceKey:{in:changedKeys}},select:{sourceKey:true,sourceOriginalKey:true,rawSourceData:true,reviewedOverrides:true}}):[];
  const byKey=new Map<string,ExistingLead>();for(const lead of [...originalExisting,...effectiveExisting] as ExistingLead[]){byKey.set(lead.sourceKey,lead);if(lead.sourceOriginalKey)byKey.set(lead.sourceOriginalKey,lead);}
  const seen=new Set<string>();const emailCount=new Map<string,number>(),fallbackKeyCount=new Map<string,number>();
  effectiveRows.forEach(row=>{if(row.email)emailCount.set(row.email,(emailCount.get(row.email)??0)+1);if(row.identityStrategy==='ATTENDEE_FIELDS')fallbackKeyCount.set(row.sourceKey,(fallbackKeyCount.get(row.sourceKey)??0)+1)});
  const rows=effectiveRows.map(row=>{
    const old=byKey.get(row.sourceKey)??byKey.get(row.originalSourceKey);const repeated=seen.has(row.sourceKey);seen.add(row.sourceKey);
    const state=row.invalid?'INVALID':repeated?'ALREADY_IMPORTED':old?stableJson(old.rawSourceData)===stableJson(row.rawSourceData)?'ALREADY_IMPORTED':'SOURCE_CHANGED':'NEW';
    const oldRaw=(old?.rawSourceData&&typeof old.rawSourceData==='object'&&!Array.isArray(old.rawSourceData)?old.rawSourceData:{}) as Record<string,unknown>;
    const changedSourceFields=state==='SOURCE_CHANGED'?[...new Set([...Object.keys(oldRaw),...Object.keys(row.rawSourceData)])].filter(header=>String(oldRaw[header]??'')!==String(row.rawSourceData[header]??'')).map(header=>({header,before:String(oldRaw[header]??''),after:String(row.rawSourceData[header]??'')})):[];
    const matches=suggestMatches(row,accounts,contacts);
    const fallbackCollision=row.identityStrategy==='ATTENDEE_FIELDS'&&(fallbackKeyCount.get(row.sourceKey)??0)>1;
    const warnings=[...row.warnings];if(row.email&&(emailCount.get(row.email)??0)>1&&!fallbackCollision)warnings.push(`${emailCount.get(row.email)} scans share this email; each scan remains separate.`);
    if(fallbackCollision)warnings.push(`${fallbackKeyCount.get(row.sourceKey)} source rows have identical fallback identity fields. They are ambiguous, so only the first can be imported; review both preserved raw rows.`);
    if(matches.contactMatches.length>1)warnings.push('Multiple active Contacts have this email.');
    if(matches.exactAccounts.length>1||matches.domainAccounts.length>1)warnings.push('Account match is ambiguous.');
    return {...row,state,warnings,matches,changedSourceFields};
  });
  const summary={total:rows.length,new:rows.filter(r=>r.state==='NEW').length,alreadyImported:rows.filter(r=>r.state==='ALREADY_IMPORTED').length,changedSource:rows.filter(r=>r.state==='SOURCE_CHANGED').length,invalid:rows.filter(r=>r.state==='INVALID').length,needsReview:rows.filter(r=>r.warnings.length||r.matches.contactMatches.length>1||r.matches.exactAccounts.length>1).length,usableEmail:rows.filter(r=>r.email).length,duplicateEmailGroups:[...emailCount.values()].filter(n=>n>1).length,fallbackIdentityRows:rows.filter(r=>r.identityStrategy==='ATTENDEE_FIELDS').length,fallbackCollisionGroups:[...fallbackKeyCount.values()].filter(n=>n>1).length,unresolvedAccounts:rows.filter(r=>r.sourceCompany&&!r.matches.accountSuggestion).length,unresolvedContacts:rows.filter(r=>r.email&&!r.matches.contactSuggestion).length,placeholderRows:rows.filter(r=>r.warnings.some(w=>w.includes('placeholder'))).length};
  const partnerAccounts=accounts.filter(account=>account.businessRoles?.some(item=>PARTNER_ACCOUNT_ROLES.includes(item.role)));
  return {parsed:{...parsed,rows:effectiveRows},filename,rows,summary,reps,accounts,partnerAccounts,contacts,priorExactFile:prior>0,mapping};
}

export async function previewTradeShowImport(client:PrismaClient,showId:number,buffer:Buffer,filename:string,actor:Actor,mapping:CustomMappingSelection|null=null,reviews:ReviewedRow[]|null=null){
  if(!can(actor,'trade-shows.manage'))throw new Error('Access denied');
  const show=await client.tradeShow.findUnique({where:{id:showId},select:{timezone:true,archivedAt:true}});
  if(!show||show.archivedAt)throw new Error('Trade Show not found or archived.');
  const parsed=parseTradeShowWorkbook(buffer,filename,showId,show.timezone,mapping?.definition);
  return previewParsedTradeShowImport(client,showId,filename,parsed,mapping,reviews);
}

export async function reviewTradeShowImport(client:PrismaClient,showId:number,buffer:Buffer,filename:string,actor:Actor,mapping:CustomMappingSelection|null,reviews:ReviewedRow[]){return previewTradeShowImport(client,showId,buffer,filename,actor,mapping,reviews);}

function storedDefinition(value:Prisma.JsonValue):MappingDefinition{return value as unknown as MappingDefinition;}
export async function prepareTradeShowImport(client:PrismaClient,showId:number,buffer:Buffer,filename:string,actor:Actor){
  if(!can(actor,'trade-shows.manage'))throw new Error('Access denied');
  const inspected=inspectTradeShowWorkbook(buffer,filename);
  if(inspected.builtInFormat)return {plan:await previewTradeShowImport(client,showId,buffer,filename,actor),mappingRequired:null};
  const saved=await client.tradeShowImportMapping.findMany({where:{archivedAt:null},select:{id:true,name:true,headerFingerprint:true,mappings:true,lastUsedAt:true},orderBy:[{lastUsedAt:'desc'},{updatedAt:'desc'}]});
  const exact=saved.find(item=>item.headerFingerprint===inspected.headerFingerprint&&mappingCompatibility(inspected.headers,storedDefinition(item.mappings))==='COMPATIBLE');
  if(exact){const selection={id:exact.id,name:exact.name,definition:storedDefinition(exact.mappings)};return {plan:await previewTradeShowImport(client,showId,buffer,filename,actor,selection),mappingRequired:null};}
  const ranked=saved.map(item=>{const definition=storedDefinition(item.mappings);const status=mappingCompatibility(inspected.headers,definition);const current=new Set(inspected.headers.map(header=>header.toLowerCase().replace(/[^a-z0-9]/g,'')));const mapped=definition.columns.filter(column=>column.destination);const overlap=mapped.filter(column=>current.has(column.sourceHeader.toLowerCase().replace(/[^a-z0-9]/g,''))).length;return {id:item.id,name:item.name,status,overlap,definition};}).filter(item=>item.overlap>0).sort((a,b)=>b.overlap-a.overlap);
  const suggested=ranked[0]??null;
  const destinationByHeader=new Map(suggested?.definition.columns.map(column=>[column.sourceHeader.toLowerCase().replace(/[^a-z0-9]/g,''),column.destination])??[]);
  const definition:MappingDefinition={version:1,columns:inspected.headers.map(sourceHeader=>({sourceHeader,destination:destinationByHeader.get(sourceHeader.toLowerCase().replace(/[^a-z0-9]/g,''))??null}))};
  return {plan:null,mappingRequired:{title:'Column Mapping Required',helper:'This Trade Show export is not recognized yet. Map the spreadsheet columns to SalesHub fields, then preview the leads.',sheet:inspected.sheet,sha256:inspected.sha256,headerFingerprint:inspected.headerFingerprint,columns:inspected.columns,definition,suggested:suggested?{id:suggested.id,name:suggested.name,status:suggested.status}:null}};
}

export async function previewMappedTradeShowImport(client:PrismaClient,showId:number,buffer:Buffer,filename:string,actor:Actor,definition:MappingDefinition,saveName:string|null){
  if(!can(actor,'trade-shows.manage'))throw new Error('Access denied');
  const inspected=inspectTradeShowWorkbook(buffer,filename);if(inspected.builtInFormat)throw new Error('Built-in Trade Show formats do not use custom mappings.');validateMapping(inspected.headers,definition);
  const plan=await previewTradeShowImport(client,showId,buffer,filename,actor,{definition,id:null,name:null});
  if(saveName!==null){const name=saveName.trim();if(name.length<2||name.length>100)throw new Error('Enter a mapping name between 2 and 100 characters.');const record=await client.tradeShowImportMapping.create({data:{name,headerFingerprint:inspected.headerFingerprint,mappings:definition as unknown as Prisma.InputJsonValue,createdById:actor.id},select:{id:true,name:true}});plan.mapping={definition,id:record.id,name:record.name};}
  return plan;
}

export async function confirmTradeShowImport(client:PrismaClient,showId:number,buffer:Buffer,filename:string,actor:Actor,sha256:string,defaultRoutingOrRep:TradeShowLeadRouting|number,defaultRepOrChoices:number|null|ImportChoice[],defaultPartnerOrMapping:number|null|CustomMappingSelection,choicesArg?:ImportChoice[],mappingArg:CustomMappingSelection|null=null){
  const legacy=typeof defaultRoutingOrRep==='number';
  const defaultRouting:TradeShowLeadRouting=legacy?'BIXOLON_SALES':defaultRoutingOrRep;
  const defaultRepId=legacy?defaultRoutingOrRep:defaultRepOrChoices as number|null;
  const defaultPartnerAccountId=legacy?null:defaultPartnerOrMapping as number|null;
  const choices=(legacy?defaultRepOrChoices:choicesArg) as ImportChoice[];
  const mapping=(legacy?defaultPartnerOrMapping:mappingArg) as CustomMappingSelection|null;
  if(!can(actor,'trade-shows.manage'))throw new Error('Access denied');
  const show=await client.tradeShow.findUnique({where:{id:showId},select:{timezone:true,archivedAt:true}});
  if(!show||show.archivedAt)throw new Error('Trade Show not found or archived.');
  const parsed:ParsedWorkbook=parseTradeShowWorkbook(buffer,filename,showId,show.timezone,mapping?.definition);
  if(parsed.sha256!==sha256)throw new Error('Workbook changed. Preview again.');
  if(choices.length!==parsed.rows.length||choices.some((choice,index)=>(choice.originalSourceKey??parsed.rows[index].sourceKey)!==parsed.rows[index].sourceKey))throw new Error('Preview choices changed. Preview again.');
  const rows=parsed.rows.map((row,index)=>applyReviewedOverrides(showId,parsed.format,row,choices[index].reviewedOverrides??{}));
  if(choices.some((choice,index)=>choice.sourceKey!==rows[index].sourceKey))throw new Error('Preview choices changed. Preview again.');
  if(rows.some((row,index)=>Object.keys(choices[index].reviewedOverrides??{}).length&&row.correctionErrors.length))throw new Error('Correct invalid reviewed values before importing.');
  return client.$transaction(async tx=>{
    if(mapping?.id){const saved=await tx.tradeShowImportMapping.findFirst({where:{id:mapping.id,archivedAt:null},select:{name:true,mappings:true}});if(!saved||stableJson(saved.mappings)!==stableJson(mapping.definition))throw new Error('Saved mapping changed. Preview again.');mapping.name=saved.name;}
    const effective=choices.map(choice=>({routing:choice.routing??defaultRouting,repId:choice.repId??defaultRepId,partnerAccountId:choice.partnerAccountId??defaultPartnerAccountId}));
    const repIds=[...new Set(effective.map(item=>item.repId).filter((id):id is number=>id!==null))];
    const reps=repIds.length?await tx.user.findMany({where:{id:{in:repIds},active:true,archivedAt:null,role:{in:['SALES','SALES_MANAGER']}},select:{id:true}}):[];
    const validReps=new Set(reps.map(r=>r.id));
    if(effective.some(item=>item.routing==='BIXOLON_SALES'&&!item.repId))throw new Error('Select a Default Sales Rep before importing these leads.');
    if(repIds.some(id=>!validReps.has(id)))throw new Error('Choose active Sales reps.');
    const partnerIds=[...new Set(effective.filter(item=>item.routing==='REFERRED_TO_PARTNER').map(item=>item.partnerAccountId).filter((id):id is number=>id!==null))];
    if(effective.some(item=>item.routing==='REFERRED_TO_PARTNER'&&!item.partnerAccountId))throw new Error('Select a Partner Account before importing these leads.');
    const partners=partnerIds.length?await tx.account.findMany({where:{id:{in:partnerIds},status:'ACTIVE',archivedAt:null,businessRoles:{some:{role:{in:PARTNER_ACCOUNT_ROLES}}}},select:{id:true}}):[];
    const validPartners=new Set(partners.map(item=>item.id));if(partnerIds.some(id=>!validPartners.has(id)))throw new Error('Choose active Accounts with eligible partner Business Roles.');
    const accountIds=[...new Set(choices.map(c=>c.accountId).filter((id):id is number=>id!==null))];
    const contactIds=[...new Set(choices.map(c=>c.contactId).filter((id):id is number=>id!==null))];
    const [accounts,contacts]=await Promise.all([
      tx.account.findMany({where:{id:{in:accountIds},status:'ACTIVE',archivedAt:null},select:{id:true}}),
      tx.contact.findMany({where:{id:{in:contactIds},active:true,archivedAt:null,OR:[{accountId:null},{account:{is:{archivedAt:null,status:'ACTIVE'}}}]},select:{id:true,accountId:true}}),
    ]);
    const validAccounts=new Set(accounts.map(a=>a.id)),validContacts=new Map(contacts.map(c=>[c.id,c]));
    if(accountIds.some(id=>!validAccounts.has(id))||contactIds.some(id=>!validContacts.has(id)))throw new Error('Selected Account or Contact is unavailable.');
    for(const choice of choices){const contact=choice.contactId?validContacts.get(choice.contactId):null;if(contact?.accountId&&choice.accountId&&contact.accountId!==choice.accountId)throw new Error('Selected Contact belongs to a different Account.');}
    const record=await tx.tradeShowImport.create({data:{tradeShowId:showId,format:parsed.format,sourceFileName:filename,sourceSheet:parsed.sheet,fileSha256:parsed.sha256,uploadedById:actor.id,rowCount:rows.length,mappingId:mapping?.id??null,mappingName:mapping?.name??null}});
    let created=0,existing=0,skipped=0;const seen=new Set<string>();
    for(let i=0;i<rows.length;i++){
      const row=rows[i],rawRow=parsed.rows[i],choice=choices[i],reviewedOverrides=validateReviewedOverrides(choice.reviewedOverrides??{});if(row.invalid){skipped++;continue;}
      if(seen.has(row.sourceKey)){existing++;continue;}seen.add(row.sourceKey);
      let old=await tx.tradeShowLead.findUnique({where:{tradeShowId_sourceKey:{tradeShowId:showId,sourceKey:row.sourceKey}},select:{id:true,sourceKey:true,rawSourceData:true,reviewedOverrides:true}});
      if(!old&&row.sourceKey!==rawRow.sourceKey)old=await tx.tradeShowLead.findUnique({where:{tradeShowId_sourceKey:{tradeShowId:showId,sourceKey:rawRow.sourceKey}},select:{id:true,sourceKey:true,rawSourceData:true,reviewedOverrides:true}});
      if(!old&&row.sourceKey!==rawRow.sourceKey)old=await tx.tradeShowLead.findFirst({where:{tradeShowId:showId,sourceOriginalKey:rawRow.sourceKey},select:{id:true,sourceKey:true,rawSourceData:true,reviewedOverrides:true}});
      const correctionData={sourceKey:row.sourceKey,sourceOriginalKey:row.sourceKey===rawRow.sourceKey?null:rawRow.sourceKey,reviewedOverrides:Object.keys(reviewedOverrides).length?reviewedOverrides as Prisma.InputJsonValue:Prisma.DbNull};
      const source={rawSourceData:rawRow.rawSourceData,capturedAt:row.capturedAt?new Date(row.capturedAt):null,firstName:row.firstName,lastName:row.lastName,title:row.title,email:row.email,phone:row.phone,sourceCompany:row.sourceCompany,sourceCompanyWebsite:row.sourceCompanyWebsite,addressLine1:row.addressLine1,addressLine2:row.addressLine2,city:row.city,stateProvince:row.stateProvince,postalCode:row.postalCode,country:row.country,sourceNotes:row.sourceNotes,sourceLeadId:row.sourceLeadId,productInterest:row.productInterest,competitorSourceText:row.competitorSourceText,currentProductBeingUsed:row.currentProductBeingUsed,customerPainPoints:row.customerPainPoints,...correctionData};
      const correctionsChanged=old&&stableJson(storedOverrides(old.reviewedOverrides))!==stableJson(reviewedOverrides);
      if(old){existing++;if(correctionsChanged||choice.refresh&&stableJson(old.rawSourceData)!==stableJson(rawRow.rawSourceData))await tx.tradeShowLead.update({where:{id:old.id},data:source});continue;}
      const route=effective[i];
      await tx.tradeShowLead.create({data:{tradeShowId:showId,firstImportId:record.id,sourceFileName:filename,sourceSheet:parsed.sheet,sourceRow:row.sourceRow,...source,routing:route.routing,assignedSalesRepUserId:route.repId,routedPartnerAccountId:route.partnerAccountId,referralNotes:null,...(route.routing==='REFERRED_TO_PARTNER'?{referredAt:new Date(),referredByUserId:actor.id}:{}),accountId:choice.accountId,contactId:choice.contactId,status:'NEW'}});created++;
    }
    await tx.tradeShowImport.update({where:{id:record.id},data:{createdCount:created,existingCount:existing,skippedCount:skipped}});
    if(mapping?.id)await tx.tradeShowImportMapping.update({where:{id:mapping.id},data:{lastUsedAt:new Date()}});
    return {created,existing,skipped,importId:record.id};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
