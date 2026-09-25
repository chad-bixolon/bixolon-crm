#!/usr/bin/env node
// Read-only CRM metadata audit. No object-storage client or write-capable Prisma call is used.
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CUTOVER = '2026-09-25';
const cutoff = new Date(`${CUTOVER}T00:00:00.000Z`);
const synthetic = /\b(test|testing|demo|sample|dummy|fake|sandbox|training)\b/i;
const pilot = /\bpilot\b/i;
const placeholderEmail = /(^test(?:[.+_-]|@)|@(example\.(?:com|org|net)|test\.|invalid\.|localhost$)|fake|dummy)/i;
const date = value => value ? new Date(value).toISOString() : '';
const norm = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const userLabel = user => user ? `#${user.id} ${user.firstName} ${user.lastName} (${user.role})` : '';
const creatorLabel = (id, users) => id == null ? 'Unknown / legacy' : users.has(id) ? userLabel(users.get(id)) : `User #${id}`;
const keyPrefix = key => String(key ?? '').split('/').slice(0, 2).join('/') || '(none)';
const rowsFor = (map, id) => id == null ? [] : map.get(id) ?? [];
function index(rows, field) {
  const result = new Map();
  for (const row of rows) {
    const id = row[field];
    if (id == null) continue;
    if (!result.has(id)) result.set(id, []);
    result.get(id).push(row);
  }
  return result;
}
function domain(value) {
  if (!value) return '';
  try { return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return ''; }
}
function address(row) {
  const parts = [row.addressLine1, row.city, row.stateProvince, row.postalCode, row.country].map(norm);
  return parts[0] && parts.filter(Boolean).length >= 3 ? parts.join('|') : '';
}
function groupsFor(rows, kind, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups].filter(([, members]) => members.length > 1).map(([key, members]) => ({ entity: kind, matchRule: keyFn.rule, normalizedKey: key, ids: members.map(row => row.id).sort((a, b) => a - b).join('|'), count: members.length }));
}
function duplicateGroups(data, opportunityAccounts, projectAccounts) {
  const accountName = row => norm(row.name); accountName.rule = 'normalized name';
  const accountDomain = row => domain(row.website); accountDomain.rule = 'same website domain';
  const accountAddress = row => address(row); accountAddress.rule = 'same complete address';
  const contactEmail = row => norm(row.email); contactEmail.rule = 'normalized email';
  const contactName = row => row.accountId && norm(row.firstName) && norm(row.lastName) ? `${row.accountId}|${norm(row.firstName)}|${norm(row.lastName)}` : ''; contactName.rule = 'same name and Account';
  const projectName = row => { const ids = projectAccounts.get(row.id) ?? []; return norm(row.name) && ids.length ? `${norm(row.name)}|${ids.join('|')}` : ''; }; projectName.rule = 'same name and Account set';
  const opportunityName = row => { const ids = opportunityAccounts.get(row.id) ?? []; const month = row.expectedCloseDate ? date(row.expectedCloseDate).slice(0, 7) : ''; return norm(row.name) && ids.length && month ? `${norm(row.name)}|${ids.join('|')}|${month}` : ''; }; opportunityName.rule = 'same name, Account set, and close month';
  return [
    ...groupsFor(data.accounts, 'Account', accountName), ...groupsFor(data.accounts, 'Account', accountDomain), ...groupsFor(data.accounts, 'Account', accountAddress),
    ...groupsFor(data.contacts, 'Contact', contactEmail), ...groupsFor(data.contacts, 'Contact', contactName),
    ...groupsFor(data.projects, 'Project', projectName), ...groupsFor(data.opportunities, 'Opportunity', opportunityName),
  ];
}
function signals(record, { text = [], email = '', phone = '', creatorRole = '', isolated = false, duplicate = false, extra = [] } = {}) {
  const reasons = [];
  let score = 0;
  const words = text.filter(Boolean).join(' ');
  if (synthetic.test(words)) { reasons.push('explicit synthetic term'); score += 3; }
  if (placeholderEmail.test(email)) { reasons.push('placeholder-style email'); score += 3; }
  if (/^(?:\+?1[- .]?)?555[- .]?01\d{2}$/.test(String(phone ?? '').trim())) { reasons.push('fictional 555-01xx phone'); score += 2; }
  if (pilot.test(words)) { reasons.push('pilot term; may be legitimate'); score += 1; }
  if (duplicate) { reasons.push('deterministic duplicate group'); score += 2; }
  for (const item of extra) { reasons.push(item.reason); score += item.points; }
  const hasClue = synthetic.test(words) || placeholderEmail.test(email) || /^(?:\+?1[- .]?)?555[- .]?01\d{2}$/.test(String(phone ?? '').trim()) || pilot.test(words) || duplicate || extra.some(item => item.points >= 2);
  if (hasClue && record.createdAt && new Date(record.createdAt) < cutoff) { reasons.push('created before live cutoff (context only)'); score += 1; }
  if (hasClue && creatorRole === 'ADMIN') { reasons.push('created by Admin (context only)'); score += 1; }
  if (hasClue && isolated) { reasons.push('no meaningful relationships'); score += 1; }
  return { score, reasons, candidate: hasClue, confidence: score >= 6 ? 'HIGH' : score >= 3 ? 'MEDIUM' : 'LOW' };
}
function classify({ record, name, category, users, relations = {}, text = [], email, phone, duplicate, extra = [], highRisk = false, mediumRisk = false, details = {} }) {
  const relationCount = Object.values(relations).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const creatorRole = users.get(record.createdById)?.role ?? '';
  const signal = signals(record, { text: [name, ...text], email, phone, creatorRole, isolated: relationCount === 0, duplicate, extra });
  if (!signal.candidate) return null;
  const risk = highRisk ? 'HIGH' : mediumRisk || relationCount > 0 ? 'MEDIUM' : 'LOW';
  const review = risk === 'HIGH' || duplicate || signal.confidence === 'LOW' ? 'Manual review' : signal.confidence === 'HIGH' && risk === 'LOW' ? 'Archive candidate' : 'Manual review';
  return { category, id: record.id, name, confidence: signal.confidence, cleanupRisk: risk, suggestedReview: review, score: signal.score,
    reasons: signal.reasons.join('; '), createdAt: date(record.createdAt), updatedAt: date(record.updatedAt), createdBy: creatorLabel(record.createdById, users),
    archivedAt: date(record.archivedAt), relationshipCount: relationCount, relationships: JSON.stringify(relations), ...details };
}
const duplicateKey = (entity, id) => `${entity}:${id}`;
function duplicateIndex(groups) {
  const found = new Set();
  for (const group of groups) for (const id of group.ids.split('|')) found.add(duplicateKey(group.entity, id));
  return found;
}
export function analyze(data, onStage = () => {}) {
  onStage('relationships');
  const users = new Map(data.users.map(row => [row.id, row]));
  const userNames = new Map(data.users.map(row => [row.id, userLabel(row)]));
  const accounts = new Map(data.accounts.map(row => [row.id, row]));
  const projects = new Map(data.projects.map(row => [row.id, row]));
  const opportunities = new Map(data.opportunities.map(row => [row.id, row]));
  const reports = new Map(data.reports.map(row => [row.id, row]));
  const oppMembers = index(data.opportunityAccounts, 'accountId');
  const projectMembers = index(data.projectAccounts, 'accountId');
  const oppProjects = index(data.opportunityProjects, 'opportunityId');
  const projectOpps = index(data.opportunityProjects, 'projectId');
  const oppContacts = index(data.opportunityContacts, 'opportunityId');
  const contactOpps = index(data.opportunityContacts, 'contactId');
  const activityContacts = index(data.activityContacts, 'activityId');
  const contactActivities = index(data.activityContacts, 'contactId');
  const audienceOverrides = index(data.audienceOverrides, 'audienceId');
  const contactOverrides = index(data.audienceOverrides, 'contactId');
  const peLines = index(data.priceExceptionLines, 'priceExceptionId');
  const skuPeLines = index(data.priceExceptionLines, 'productSkuId');
  const odmCustomers = index(data.odmCustomers, 'skuId');
  const odmPrices = index(data.odmPrices, 'skuId');
  const skuPrices = index(data.productPrices, 'skuId');
  const oppProducts = index(data.opportunityProducts, 'opportunityId');
  const productOpps = index(data.opportunityProducts, 'productId');
  const skuOpps = index(data.opportunityProducts, 'skuId');
  const imports = index(data.tradeShowImports, 'tradeShowId');
  const leads = index(data.tradeShowLeads, 'tradeShowId');
  const accountLeads = index(data.tradeShowLeads, 'accountId');
  const contactLeads = index(data.tradeShowLeads, 'contactId');
  const convertedLeads = index(data.tradeShowLeads, 'convertedOpportunityId');
  const referredLeads = index(data.tradeShowLeads, 'routedPartnerAccountId');
  const accountPEs = new Map();
  for (const pe of data.priceExceptions) for (const id of [pe.distributorAccountId, pe.varAccountId, pe.endUserAccountId]) {
    if (id == null) continue;
    if (!accountPEs.has(id)) accountPEs.set(id, new Set());
    accountPEs.get(id).add(pe.id);
  }
  const oppMemberByOpportunity=index(data.opportunityAccounts,'opportunityId');
  const projectMemberByProject=index(data.projectAccounts,'projectId');
  const opportunityAccounts = new Map(data.opportunities.map(row => [row.id, [...new Set([...rowsFor(oppMemberByOpportunity, row.id).map(link => link.accountId), row.legacyAccountId].filter(id => id != null))].sort((a, b) => a - b)]));
  const projectAccounts = new Map(data.projects.map(row => [row.id, [...new Set([...rowsFor(projectMemberByProject, row.id).map(link => link.accountId), row.primaryAccountId].filter(id => id != null))].sort((a, b) => a - b)]));
  onStage('duplicate detection');
  const duplicates = duplicateGroups(data, opportunityAccounts, projectAccounts);
  onStage('candidate scoring: accounts');
  const dup = duplicateIndex(duplicates);
  const cachedIndexes=new WeakMap();
  const by = (rows, field, id) => {if(!cachedIndexes.has(rows))cachedIndexes.set(rows,new Map());const fields=cachedIndexes.get(rows);if(!fields.has(field))fields.set(field,index(rows,field));return rowsFor(fields.get(field),id);};
  const linkedAccountNames = ids => ids.map(id => `#${id} ${accounts.get(id)?.name ?? '(missing)'}`).join(' | ');
  const buckets = Object.fromEntries(['accounts','contacts','projects','opportunities','tasks','activities','tradeShows','tradeShowImports','tradeShowLeads','audiences','reports','priceExceptions','products','skus','documents'].map(key => [key, []]));
  const add = (bucket, row) => { if (row) buckets[bucket].push(row); };
  const accountRelations = row => ({ contacts: by(data.contacts,'accountId',row.id).length, projects: new Set([...rowsFor(projectMembers,row.id).map(x=>x.projectId),...by(data.projects,'primaryAccountId',row.id).map(x=>x.id)]).size,
    opportunities: new Set([...rowsFor(oppMembers,row.id).map(x=>x.opportunityId),...by(data.opportunities,'legacyAccountId',row.id).map(x=>x.id)]).size,
    tasks: by(data.tasks,'accountId',row.id).length, activities: by(data.activities,'accountId',row.id).length, notes: by(data.notes,'accountId',row.id).length,
    documents: by(data.documents,'accountId',row.id).length, tradeShowLeads: rowsFor(accountLeads,row.id).length, referredLeads: rowsFor(referredLeads,row.id).length,
    priceExceptions: accountPEs.get(row.id)?.size ?? 0, odmSkus: by(data.odmCustomers,'accountId',row.id).length });
  for (const row of data.accounts) {
    const rel = accountRelations(row);
    const associated = rel.documents || rel.priceExceptions || rel.opportunities || rel.activities || rel.tasks || rel.tradeShowLeads || rel.odmSkus;
    add('accounts', classify({record:row,name:row.name,category:'Account',users,relations:rel,text:[row.website],phone:row.phone,duplicate:dup.has(duplicateKey('Account',row.id)),
      highRisk:!!associated || (row.createdAt >= cutoff && users.get(row.createdById)?.role !== 'ADMIN'), mediumRisk:!!rel.contacts || !!rel.projects,
      details:{status:row.status,owner:userNames.get(row.ownerId)??'',websiteDomain:domain(row.website),territory:row.territory??'',linkedAccounts:'',address:address(row)}}));
  }
  const accountCandidates = new Map(buckets.accounts.map(row=>[row.id,row]));
  const realAccount = id => id != null && (!accountCandidates.has(id) || accountCandidates.get(id).confidence !== 'HIGH');
  const testAccountContext = ids => ids.some(id=>accountCandidates.get(id)?.confidence==='HIGH')?[{reason:'linked to high-confidence test Account; relationship needs review',points:2}]:[];
  onStage('candidate scoring: contacts');
  for (const row of data.contacts) {
    const rel = {opportunities:rowsFor(contactOpps,row.id).length,activities:rowsFor(contactActivities,row.id).length,tradeShowLeads:rowsFor(contactLeads,row.id).length,audienceOverrides:rowsFor(contactOverrides,row.id).length};
    add('contacts',classify({record:row,name:`${row.firstName} ${row.lastName}`,category:'Contact',users,relations:rel,email:row.email,phone:row.phone,
      duplicate:dup.has(duplicateKey('Contact',row.id)),extra:testAccountContext([row.accountId]),highRisk:realAccount(row.accountId)||!!rel.opportunities||!!rel.activities||!!rel.audienceOverrides,
      mediumRisk:!!row.accountId||!!rel.tradeShowLeads,details:{accountId:row.accountId??'',accountName:accounts.get(row.accountId)?.name??'',email:row.email??'',active:row.active,isPrimary:row.isPrimary,marketingPreference:row.marketingPreference}}));
  }
  onStage('candidate scoring: projects');
  for (const row of data.projects) {
    const accountIds=projectAccounts.get(row.id)??[]; const rel={accounts:accountIds.length,opportunities:rowsFor(projectOpps,row.id).length,tasks:by(data.tasks,'projectId',row.id).length,activities:by(data.activities,'projectId',row.id).length,notes:by(data.notes,'projectId',row.id).length,documents:by(data.documents,'projectId',row.id).length};
    add('projects',classify({record:row,name:row.name,category:'Project',users,relations:rel,text:[row.description],duplicate:dup.has(duplicateKey('Project',row.id)),extra:testAccountContext(accountIds),
      highRisk:accountIds.some(realAccount)||!!rel.opportunities||!!rel.documents||!!rel.activities||!!rel.tasks,details:{status:row.status,owner:userNames.get(row.ownerId)??'',accountIds:accountIds.join('|'),linkedAccounts:linkedAccountNames(accountIds)}}));
  }
  onStage('candidate scoring: opportunities');
  for (const row of data.opportunities) {
    const accountIds=opportunityAccounts.get(row.id)??[]; const products=rowsFor(oppProducts,row.id); const rel={accounts:accountIds.length,projects:rowsFor(oppProjects,row.id).length,contacts:rowsFor(oppContacts,row.id).length,productLines:products.length,activities:by(data.activities,'opportunityId',row.id).length,tasks:by(data.tasks,'opportunityId',row.id).length,documents:by(data.documents,'opportunityId',row.id).length,notes:by(data.notes,'opportunityId',row.id).length,tradeShowLeads:rowsFor(convertedLeads,row.id).length,priceExceptionSnapshots:products.filter(x=>x.priceExceptionLineId||x.priceExceptionCode||x.priceExceptionUnitPrice).length};
    const amount=products.reduce((sum,line)=>sum+Number(line.quantity)*Number(line.estimatedUnitPrice),0);
    const closeYear=row.expectedCloseDate?new Date(row.expectedCloseDate).getUTCFullYear():null;
    const extra=[]; if (products.length && amount===0) extra.push({reason:'zero calculated product-line amount',points:1}); if (closeYear && (closeYear<2020||closeYear>2040)) extra.push({reason:'implausible close year',points:2});
    add('opportunities',classify({record:row,name:row.name,category:'Opportunity',users,relations:rel,text:[row.description,row.currentProductBeingUsed],duplicate:dup.has(duplicateKey('Opportunity',row.id)),extra:[...extra,...testAccountContext(accountIds)],
      highRisk:accountIds.some(realAccount)||!!rel.productLines||!!rel.documents||!!rel.activities||!!rel.tasks||!!rel.priceExceptionSnapshots||!!rel.tradeShowLeads,
      details:{stageId:row.stageId,forecastCategory:row.forecastCategory,owner:userNames.get(row.ownerId)??'',closeDate:date(row.expectedCloseDate),calculatedAmount:amount,currency:row.currencyCode,accountIds:accountIds.join('|'),linkedAccounts:linkedAccountNames(accountIds),productNames:products.map(x=>`#${x.productId} ${data.products.find(p=>p.id===x.productId)?.name??''}`).join(' | ')}}));
  }
  onStage('candidate scoring: tasks');
  for (const row of data.tasks) add('tasks',classify({record:row,name:row.subject,category:'Task',users,relations:{account:row.accountId?1:0,project:row.projectId?1:0,opportunity:row.opportunityId?1:0},text:[row.description],
    extra:testAccountContext([row.accountId]),
    highRisk:realAccount(row.accountId)||!!row.projectId||!!row.opportunityId,details:{status:row.status,priority:row.priority,completedAt:date(row.completedAt),dueDate:date(row.dueDate),assignedTo:userNames.get(row.assignedToId)??'',accountId:row.accountId??'',projectId:row.projectId??'',opportunityId:row.opportunityId??''}}));
  onStage('candidate scoring: activities');
  for (const row of data.activities) add('activities',classify({record:row,name:row.subject,category:'Activity',users,relations:{account:row.accountId?1:0,project:row.projectId?1:0,opportunity:row.opportunityId?1:0,contacts:rowsFor(activityContacts,row.id).length},text:[row.description],
    extra:testAccountContext([row.accountId]),
    highRisk:realAccount(row.accountId)||!!row.projectId||!!row.opportunityId||!!rowsFor(activityContacts,row.id).length,
    details:{type:row.type,activityDate:date(row.activityDate),followUpDate:date(row.followUpDate),responsibleUser:userNames.get(row.userId)??'',accountId:row.accountId??'',projectId:row.projectId??'',opportunityId:row.opportunityId??'',contactIds:rowsFor(activityContacts,row.id).map(x=>x.contactId).join('|')}}));
  onStage('candidate scoring: trade shows');
  for (const row of data.tradeShows) {
    const showLeads=rowsFor(leads,row.id); const rel={imports:rowsFor(imports,row.id).length,leads:showLeads.length,convertedOpportunities:showLeads.filter(x=>x.convertedOpportunityId).length,resolvedContacts:showLeads.filter(x=>x.contactId).length,resolvedAccounts:showLeads.filter(x=>x.accountId).length,referredPartners:showLeads.filter(x=>x.routedPartnerAccountId).length};
    add('tradeShows',classify({record:row,name:row.name,category:'Trade Show',users,relations:rel,text:[row.description,row.location],highRisk:!!rel.convertedOpportunities||!!rel.resolvedContacts||!!rel.resolvedAccounts||!!rel.referredPartners,
      details:{startDate:date(row.startDate),endDate:date(row.endDate),marketingOwner:userNames.get(row.marketingOwnerId)??'',assignedRepIds:[...new Set(showLeads.map(x=>x.assignedSalesRepUserId).filter(Boolean))].join('|')}}));
  }
  const showCandidates=new Map(buckets.tradeShows.map(x=>[x.id,x]));
  onStage('candidate scoring: trade show imports');
  for (const row of data.tradeShowImports) add('tradeShowImports',classify({record:row,name:row.sourceFileName,category:'Trade Show Import',users,relations:{leads:by(data.tradeShowLeads,'firstImportId',row.id).length},
    text:[row.sourceSheet],highRisk:showCandidates.has(row.tradeShowId)&&showCandidates.get(row.tradeShowId).cleanupRisk==='HIGH',details:{tradeShowId:row.tradeShowId,tradeShowName:data.tradeShows.find(x=>x.id===row.tradeShowId)?.name??'',uploadedBy:userNames.get(row.uploadedById)??'',rowCount:row.rowCount,uploadedAt:date(row.uploadedAt)}}));
  onStage('candidate scoring: trade show leads');
  for (const row of data.tradeShowLeads) add('tradeShowLeads',classify({record:row,name:`${row.firstName} ${row.lastName}`,category:'Trade Show Lead',users,relations:{account:row.accountId?1:0,contact:row.contactId?1:0,convertedOpportunity:row.convertedOpportunityId?1:0,referredPartner:row.routedPartnerAccountId?1:0},
    text:[row.sourceCompany],email:row.email,phone:row.phone,extra:testAccountContext([row.accountId]),highRisk:realAccount(row.accountId)||!!row.contactId||!!row.convertedOpportunityId||!!row.routedPartnerAccountId,
    details:{tradeShowId:row.tradeShowId,firstImportId:row.firstImportId,status:row.status,routing:row.routing,assignedRep:userNames.get(row.assignedSalesRepUserId)??'',accountId:row.accountId??'',contactId:row.contactId??'',convertedOpportunityId:row.convertedOpportunityId??'',referredPartnerAccountId:row.routedPartnerAccountId??'',importedAt:date(row.importedAt)}}));
  onStage('candidate scoring: marketing audiences');
  for (const row of data.audiences) add('audiences',classify({record:row,name:row.name,category:'Marketing Audience',users,relations:{contactOverrides:rowsFor(audienceOverrides,row.id).length},text:[row.description],highRisk:row.visibility==='SHARED'||!!rowsFor(audienceOverrides,row.id).length,
    details:{owner:userNames.get(row.ownerId)??'',visibility:row.visibility,recentUse:'Not tracked by schema',overrideContactIds:rowsFor(audienceOverrides,row.id).map(x=>x.contactId).join('|')}}));
  onStage('relationships: dashboard layouts');
  const dashboardLayouts=[...data.roleLayouts.map(row=>({layoutType:'ROLE',layoutId:String(row.role),owner:'Role default',role:row.role,createdAt:date(row.createdAt),updatedAt:date(row.updatedAt),configuration:row.configuration})),...data.userLayouts.map(row=>({layoutType:'USER',layoutId:String(row.userId),owner:userNames.get(row.userId)??'',role:row.role,createdAt:date(row.createdAt),updatedAt:date(row.updatedAt),configuration:row.configuration}))];
  const reportRefs=new Map(); const dashboardRows=[];
  for (const layout of dashboardLayouts) {
    const ids=(Array.isArray(layout.configuration?.items)?layout.configuration.items:[]).filter(item=>item?.kind==='SAVED_REPORT').map(item=>Number(item.reportId)).filter(Number.isSafeInteger);
    for (const id of ids) reportRefs.set(id,(reportRefs.get(id)??0)+1);
    dashboardRows.push({layoutType:layout.layoutType,layoutId:layout.layoutId,owner:layout.owner,role:layout.role,createdAt:layout.createdAt,updatedAt:layout.updatedAt,pinnedReportIds:ids.join('|'),staleOrArchivedReportIds:ids.filter(id=>!reports.has(id)||reports.get(id).archivedAt).join('|')});
  }
  onStage('candidate scoring: reports');
  for (const row of data.reports) add('reports',classify({record:row,name:row.name,category:'Saved Report',users,relations:{dashboardReferences:reportRefs.get(row.id)??0},text:[row.description],highRisk:row.visibility==='SHARED'||!!reportRefs.get(row.id),
    details:{reportType:row.reportType,owner:userNames.get(row.ownerId)??'',visibility:row.visibility,recentUse:'Not tracked by schema'}}));
  onStage('candidate scoring: price exceptions');
  for (const row of data.priceExceptions) {
    const lines=rowsFor(peLines,row.id); const uses=data.opportunityProducts.filter(x=>lines.some(line=>line.id===x.priceExceptionLineId)||x.priceExceptionCode&&x.priceExceptionCode===row.peCode);
    const rel={lines:lines.length,opportunityUses:new Set(uses.map(x=>x.opportunityId)).size,linkedAccounts:[row.distributorAccountId,row.varAccountId,row.endUserAccountId].filter(Boolean).length};
    add('priceExceptions',classify({record:row,name:row.peCode??row.sourceKey,category:'Price Exception',users,relations:rel,text:[row.sourceFileName,...(/\b(test|dummy|fake|sandbox|training)\b/i.test(row.sourceDescription??'')?[row.sourceDescription]:[])],highRisk:!!rel.opportunityUses||[row.distributorAccountId,row.varAccountId,row.endUserAccountId].some(realAccount),
      details:{status:row.status,sourceType:row.sourceType,sourceKey:row.sourceKey,assignedRep:userNames.get(row.assignedSalesRepUserId)??'',accountIds:[row.distributorAccountId,row.varAccountId,row.endUserAccountId].filter(Boolean).join('|'),opportunityIds:[...new Set(uses.map(x=>x.opportunityId))].join('|')}}));
  }
  onStage('candidate scoring: products');
  for (const row of data.products) {
    const skus=by(data.skus,'productId',row.id); const uses=rowsFor(productOpps,row.id); const rel={skus:skus.length,opportunityLines:uses.length,priceExceptionLines:skus.reduce((n,sku)=>n+rowsFor(skuPeLines,sku.id).length,0),odmCustomers:skus.reduce((n,sku)=>n+rowsFor(odmCustomers,sku.id).length,0)};
    add('products',classify({record:row,name:row.name,category:'Product',users,relations:rel,text:[row.sku],highRisk:!!rel.opportunityLines||!!rel.priceExceptionLines||!!rel.odmCustomers,
      details:{sku:row.sku,active:row.active,categoryId:row.categoryId??'',opportunityIds:[...new Set(uses.map(x=>x.opportunityId))].join('|')}}));
  }
  onStage('candidate scoring: product SKUs');
  for (const row of data.skus) {
    const uses=rowsFor(skuOpps,row.id); const rel={opportunityLines:uses.length,priceExceptionLines:rowsFor(skuPeLines,row.id).length,odmCustomers:rowsFor(odmCustomers,row.id).length,odmPrices:rowsFor(odmPrices,row.id).length,prices:rowsFor(skuPrices,row.id).length,derivedOdmSkus:by(data.skus,'baseSkuId',row.id).length};
    add('skus',classify({record:row,name:row.partNumber,category:'Product SKU',users,relations:rel,text:[row.odmCustomerSourceName],highRisk:!!rel.opportunityLines||!!rel.priceExceptionLines||!!rel.odmCustomers||!!rel.odmPrices,
      details:{productId:row.productId,productName:data.products.find(x=>x.id===row.productId)?.name??'',active:row.active,catalogSource:row.catalogSource??'',odmSubtype:row.odmSubtype??'',baseSkuId:row.baseSkuId??'',opportunityIds:[...new Set(uses.map(x=>x.opportunityId))].join('|')}}));
  }
  onStage('candidate scoring: documents');
  for (const row of data.documents) {
    const parentType=row.accountId?'Account':row.projectId?'Project':'Opportunity'; const parentId=row.accountId??row.projectId??row.opportunityId;
    const parentName=parentType==='Account'?accounts.get(parentId)?.name:parentType==='Project'?projects.get(parentId)?.name:opportunities.get(parentId)?.name;
    add('documents',classify({record:row,name:row.originalFileName,category:'Document',users,relations:{parent:1},text:[row.description],highRisk:true,
      details:{parentType,parentId,parentName:parentName??'',documentType:row.documentType,uploader:userNames.get(row.uploadedByUserId)??'',storageKeyPrefix:keyPrefix(row.storageKey),fileSize:row.fileSize}}));
  }
  onStage('report preparation');
  const candidates=Object.values(buckets).flat();
  const documentInventory=data.documents.map(row=>{const parentType=row.accountId?'Account':row.projectId?'Project':'Opportunity';const parentId=row.accountId??row.projectId??row.opportunityId;return {id:row.id,originalFileName:row.originalFileName,parentType,parentId,parentName:parentType==='Account'?accounts.get(parentId)?.name??'':parentType==='Project'?projects.get(parentId)?.name??'':opportunities.get(parentId)?.name??'',documentType:row.documentType,uploader:userNames.get(row.uploadedByUserId)??'',createdAt:date(row.createdAt),archivedAt:date(row.archivedAt),storageKeyPrefix:keyPrefix(row.storageKey),candidate:buckets.documents.some(x=>x.id===row.id)};});
  const flaggedShowIds=new Set(buckets.tradeShows.map(row=>row.id));
  const tradeShowImportContext=data.tradeShowImports.filter(row=>flaggedShowIds.has(row.tradeShowId)).map(row=>({id:row.id,tradeShowId:row.tradeShowId,tradeShowName:data.tradeShows.find(show=>show.id===row.tradeShowId)?.name??'',sourceFileName:row.sourceFileName,sourceSheet:row.sourceSheet,uploadedBy:userNames.get(row.uploadedById)??'',uploadedAt:date(row.uploadedAt),rowCount:row.rowCount,leadCount:by(data.tradeShowLeads,'firstImportId',row.id).length,note:'Parent Trade Show is a candidate; import not automatically classified'}));
  const tradeShowLeadContext=data.tradeShowLeads.filter(row=>flaggedShowIds.has(row.tradeShowId)).map(row=>({id:row.id,tradeShowId:row.tradeShowId,firstImportId:row.firstImportId,name:`${row.firstName} ${row.lastName}`,sourceCompany:row.sourceCompany??'',status:row.status,routing:row.routing,assignedRep:userNames.get(row.assignedSalesRepUserId)??'',accountId:row.accountId??'',contactId:row.contactId??'',convertedOpportunityId:row.convertedOpportunityId??'',referredPartnerAccountId:row.routedPartnerAccountId??'',importedAt:date(row.importedAt),note:'Parent Trade Show is a candidate; lead not automatically classified'}));
  const relationshipRisk=candidates.map(row=>({category:row.category,id:row.id,name:row.name,confidence:row.confidence,cleanupRisk:row.cleanupRisk,suggestedReview:row.suggestedReview,relationshipCount:row.relationshipCount,relationships:row.relationships,reasons:row.reasons}));
  const pilotContext=data.accounts.filter(row=>new Date(row.createdAt)<cutoff&&!accountCandidates.has(row.id)).map(row=>({id:row.id,name:row.name,createdAt:date(row.createdAt),createdBy:creatorLabel(row.createdById,users),status:row.status,relationships:JSON.stringify(accountRelations(row)),note:'Pre-cutover context only; no explicit test signal'}));
  const major={Users:data.users,Accounts:data.accounts,Contacts:data.contacts,Projects:data.projects,Opportunities:data.opportunities,Tasks:data.tasks,Activities:data.activities,TradeShows:data.tradeShows,TradeShowImports:data.tradeShowImports,TradeShowLeads:data.tradeShowLeads,MarketingAudiences:data.audiences,Reports:data.reports,RoleLayouts:data.roleLayouts,UserLayouts:data.userLayouts,PriceExceptions:data.priceExceptions,Products:data.products,ProductSkus:data.skus,Documents:data.documents};
  const totals=Object.fromEntries(Object.entries(major).map(([name,rows])=>[name,{total:rows.length,beforeCutover:rows.filter(row=>row.createdAt&&new Date(row.createdAt)<cutoff).length,onOrAfterCutover:rows.filter(row=>row.createdAt&&new Date(row.createdAt)>=cutoff).length,unknownDate:rows.filter(row=>!row.createdAt).length}]));
  return {buckets,duplicates,relationshipRisk,dashboardRows,pilotContext,documentInventory,tradeShowImportContext,tradeShowLeadContext,totals,candidates};
}

const selects = {
  users:{id:true,firstName:true,lastName:true,role:true,createdAt:true},
  accounts:{id:true,name:true,status:true,website:true,phone:true,addressLine1:true,city:true,stateProvince:true,postalCode:true,country:true,ownerId:true,territory:true,archivedAt:true,createdById:true,createdAt:true,updatedAt:true},
  contacts:{id:true,accountId:true,firstName:true,lastName:true,email:true,phone:true,active:true,isPrimary:true,marketingPreference:true,archivedAt:true,createdById:true,createdAt:true,updatedAt:true},
  projects:{id:true,name:true,description:true,primaryAccountId:true,ownerId:true,status:true,archivedAt:true,createdById:true,createdAt:true,updatedAt:true},
  opportunities:{id:true,name:true,description:true,currentProductBeingUsed:true,legacyAccountId:true,ownerId:true,stageId:true,forecastCategory:true,expectedCloseDate:true,currencyCode:true,archivedAt:true,createdById:true,createdAt:true,updatedAt:true},
  tasks:{id:true,subject:true,description:true,accountId:true,projectId:true,opportunityId:true,assignedToId:true,status:true,priority:true,dueDate:true,completedAt:true,archivedAt:true,createdById:true,createdAt:true,updatedAt:true},
  activities:{id:true,subject:true,description:true,accountId:true,projectId:true,opportunityId:true,userId:true,type:true,activityDate:true,followUpDate:true,archivedAt:true,createdById:true,createdAt:true,updatedAt:true},
  tradeShows:{id:true,name:true,description:true,location:true,startDate:true,endDate:true,marketingOwnerId:true,archivedAt:true,createdById:true,createdAt:true,updatedAt:true},
  tradeShowImports:{id:true,tradeShowId:true,sourceFileName:true,sourceSheet:true,uploadedById:true,rowCount:true,uploadedAt:true,createdAt:true},
  tradeShowLeads:{id:true,tradeShowId:true,firstImportId:true,firstName:true,lastName:true,email:true,phone:true,sourceCompany:true,assignedSalesRepUserId:true,status:true,routing:true,accountId:true,contactId:true,convertedOpportunityId:true,routedPartnerAccountId:true,importedAt:true,createdAt:true,updatedAt:true},
  audiences:{id:true,name:true,description:true,ownerId:true,visibility:true,archivedAt:true,createdById:true,createdAt:true,updatedAt:true},
  audienceOverrides:{audienceId:true,contactId:true,kind:true},
  reports:{id:true,name:true,description:true,reportType:true,ownerId:true,visibility:true,archivedAt:true,createdById:true,createdAt:true,updatedAt:true},
  roleLayouts:{role:true,configuration:true,updatedById:true,createdAt:true,updatedAt:true},
  userLayouts:{userId:true,role:true,configuration:true,createdAt:true,updatedAt:true},
  priceExceptions:{id:true,peCode:true,sourceKey:true,sourceType:true,sourceDescription:true,sourceFileName:true,status:true,distributorAccountId:true,varAccountId:true,endUserAccountId:true,assignedSalesRepUserId:true,archivedAt:true,createdById:true,createdAt:true,updatedAt:true},
  priceExceptionLines:{id:true,priceExceptionId:true,productSkuId:true},
  products:{id:true,sku:true,name:true,categoryId:true,active:true,archivedAt:true,createdAt:true,updatedAt:true},
  skus:{id:true,productId:true,partNumber:true,description:true,catalogSource:true,odmSubtype:true,odmCustomerSourceName:true,baseSkuId:true,active:true,createdAt:true,updatedAt:true},
  odmCustomers:{skuId:true,accountId:true}, odmPrices:{skuId:true,accountId:true}, productPrices:{skuId:true},
  documents:{id:true,originalFileName:true,storageKey:true,fileSize:true,documentType:true,description:true,uploadedByUserId:true,createdAt:true,archivedAt:true,accountId:true,projectId:true,opportunityId:true},
  opportunityProducts:{id:true,opportunityId:true,productId:true,skuId:true,quantity:true,estimatedUnitPrice:true,priceExceptionLineId:true,priceExceptionCode:true,priceExceptionUnitPrice:true},
  opportunityAccounts:{opportunityId:true,accountId:true},projectAccounts:{projectId:true,accountId:true},opportunityProjects:{opportunityId:true,projectId:true},opportunityContacts:{opportunityId:true,contactId:true},activityContacts:{activityId:true,contactId:true},
  notes:{id:true,accountId:true,projectId:true,opportunityId:true},
};
const models={users:'user',accounts:'account',contacts:'contact',projects:'project',opportunities:'opportunity',tasks:'task',activities:'activity',tradeShows:'tradeShow',tradeShowImports:'tradeShowImport',tradeShowLeads:'tradeShowLead',audiences:'marketingAudience',audienceOverrides:'marketingAudienceContactOverride',reports:'reportDefinition',roleLayouts:'roleDashboardLayout',userLayouts:'userDashboardLayout',priceExceptions:'priceException',priceExceptionLines:'priceExceptionLine',products:'product',skus:'productSku',odmCustomers:'productSkuOdmCustomer',odmPrices:'productSkuOdmCustomerPrice',productPrices:'productPrice',documents:'document',opportunityProducts:'opportunityProduct',opportunityAccounts:'opportunityAccount',projectAccounts:'projectAccount',opportunityProjects:'opportunityProject',opportunityContacts:'opportunityContact',activityContacts:'activityContact',notes:'note'};
export const emptySnapshot = () => Object.fromEntries(Object.keys(models).map(key=>[key,[]]));
export async function readSnapshot(db, onStage = () => {}) {
  const data={};
  for (const [key, model] of Object.entries(models)) {
    onStage(`query: ${key} (${model}.findMany)`);
    data[key]=await db[model].findMany({select:selects[key]});
  }
  return data;
}
function csvCell(value) {
  const text=value == null ? '' : typeof value === 'boolean' ? String(value) : String(value);
  // Spreadsheet formula injection is possible in review files; prefix dangerous cells.
  const safe=/^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"','""')}"`;
}
function csv(rows, columns) { return [columns.map(csvCell).join(','),...rows.map(row=>columns.map(key=>csvCell(row[key])).join(','))].join('\n')+'\n'; }
async function writePrivate(file, body) { await fs.writeFile(file,body,{mode:0o600,flag:'wx'}); }
export async function writeReport(result, outputDir, target, onStage = () => {}) {
  onStage('report generation: directory');
  await fs.mkdir(outputDir,{recursive:true,mode:0o700});
  await fs.chmod(outputDir,0o700);
  const files=[];
  const emit=async(name,rows,columns)=>{onStage(`report generation: ${name}`);await writePrivate(path.join(outputDir,name),csv(rows,columns));files.push(name);};
  const common=['category','id','name','confidence','cleanupRisk','suggestedReview','score','reasons','createdAt','updatedAt','createdBy','archivedAt','relationshipCount','relationships'];
  const mappings={accounts:'accounts-candidates.csv',contacts:'contacts-candidates.csv',projects:'projects-candidates.csv',opportunities:'opportunities-candidates.csv',tasks:'tasks-candidates.csv',activities:'activities-candidates.csv',tradeShows:'trade-show-candidates.csv',tradeShowImports:'trade-show-imports-candidates.csv',tradeShowLeads:'trade-show-leads-candidates.csv',audiences:'marketing-audiences-candidates.csv',reports:'reports-candidates.csv',priceExceptions:'price-exception-candidates.csv',products:'product-candidates.csv',skus:'product-sku-candidates.csv',documents:'document-candidates.csv'};
  for(const [key,name] of Object.entries(mappings)) await emit(name,result.buckets[key],[...new Set([...common,...result.buckets[key].flatMap(row=>Object.keys(row))])]);
  await emit('duplicate-groups.csv',result.duplicates,['entity','matchRule','normalizedKey','ids','count']);
  await emit('relationship-risk.csv',result.relationshipRisk,['category','id','name','confidence','cleanupRisk','suggestedReview','relationshipCount','relationships','reasons']);
  await emit('dashboard-layouts.csv',result.dashboardRows,['layoutType','layoutId','owner','role','createdAt','updatedAt','pinnedReportIds','staleOrArchivedReportIds']);
  await emit('pilot-context-accounts.csv',result.pilotContext,['id','name','createdAt','createdBy','status','relationships','note']);
  await emit('document-inventory.csv',result.documentInventory,['id','originalFileName','parentType','parentId','parentName','documentType','uploader','createdAt','archivedAt','storageKeyPrefix','candidate']);
  await emit('trade-show-imports-context.csv',result.tradeShowImportContext,['id','tradeShowId','tradeShowName','sourceFileName','sourceSheet','uploadedBy','uploadedAt','rowCount','leadCount','note']);
  await emit('trade-show-leads-context.csv',result.tradeShowLeadContext,['id','tradeShowId','firstImportId','name','sourceCompany','status','routing','assignedRep','accountId','contactId','convertedOpportunityId','referredPartnerAccountId','importedAt','note']);
  const confidence=['HIGH','MEDIUM','LOW'].map(level=>`${level}: ${result.candidates.filter(row=>row.confidence===level).length}`).join(', ');
  const highRisk=result.candidates.filter(row=>row.cleanupRisk==='HIGH');
  const priority=result.candidates.filter(row=>row.cleanupRisk==='HIGH'||row.confidence==='HIGH');
  const noSuspicion=Object.entries(result.buckets).filter(([,rows])=>rows.length===0).map(([key])=>key);
  const totals=Object.entries(result.totals).map(([entity,info])=>`| ${entity} | ${info.total} | ${info.beforeCutover} | ${info.onOrAfterCutover} | ${info.unknownDate} |`).join('\n');
  const perCategory=Object.entries(result.buckets).map(([entity,rows])=>`| ${entity} | ${rows.length} | ${rows.filter(row=>row.cleanupRisk==='HIGH').length} |`).join('\n');
  const manual=priority.slice(0,50).map(row=>`- ${row.category} #${row.id}: ${row.name} — ${row.reasons}; ${row.relationships}`).join('\n')||'- None identified by these rules.';
  const summary=`# SalesHub production cleanup audit\n\nRead-only metadata report. Generated ${new Date().toISOString()} from ${target.host}/${target.database}. Cutover context: ${CUTOVER} UTC. The cutoff is never sufficient by itself to classify a record. No record has been changed.\n\n## Population\n\n| Entity | Total | Before cutoff | On/after cutoff | Unknown date |\n| --- | ---: | ---: | ---: | ---: |\n${totals}\n\n## Candidates\n\nConfidence: ${confidence}. High-risk candidates: ${highRisk.length}. Document candidates: ${result.buckets.documents.length} of ${result.documentInventory.length} document metadata rows. Suspected duplicate groups: ${result.duplicates.length}. Context rows under flagged Trade Shows: ${result.tradeShowImportContext.length} imports and ${result.tradeShowLeadContext.length} leads; these are not automatically classified as test data.\n\n| Category | Candidates | High risk |\n| --- | ---: | ---: |\n${perCategory}\n\nCategories with no suspicious data: ${noSuspicion.join(', ')||'None'}.\n\n## Manual review priorities\n\n${manual}\n\n## Recommended cleanup sequence\n\n1. Review duplicate groups and pre-cutover context with the record owners; confirm customer identity and provenance.\n2. Review high-risk candidates and their linked Accounts, Projects, Opportunities, Tasks, Activities, Documents, Trade Show conversions, and price snapshots.\n3. Review document metadata and Trade Show context with uploaders and assigned reps; no file bodies or full object keys were read into this report.\n4. Decide any future archive or deletion action record by record under a separate approval and backup process. This audit makes no deletion decision.\n\n## Limits\n\nKeyword matches, zero use, and pre-cutover dates are signals, not proof. The schema does not track last use for saved Reports or Marketing Audiences. Opportunity amount is calculated from product lines, not a stored amount. Duplicate matching is deterministic and may include legitimate names or domains. This report is a snapshot; relationships may change after it runs.\n`;
  onStage('report generation: production-cleanup-summary.md');
  await writePrivate(path.join(outputDir,'production-cleanup-summary.md'),summary);files.push('production-cleanup-summary.md');
  return files;
}
function targetFromEnvironment() {
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; no target was queried.');
  const url=new URL(process.env.DATABASE_URL);
  if(!['postgresql:','postgres:'].includes(url.protocol)) throw new Error('Only PostgreSQL DATABASE_URL is supported.');
  return {url,host:url.hostname,database:decodeURIComponent(url.pathname.slice(1))};
}
function readOnlyUrl(url) {
  const safe=new URL(url);
  const prior=safe.searchParams.get('options')??'';
  safe.searchParams.set('options',`${prior} -c default_transaction_read_only=on`.trim());
  safe.searchParams.set('connection_limit','1');
  return safe.toString();
}
const safeErrorNames=new Set(['Error','TypeError','RangeError','PrismaClientKnownRequestError','PrismaClientUnknownRequestError','PrismaClientValidationError','PrismaClientInitializationError','PrismaClientRustPanicError']);
const safeDescriptions={P1000:'Database authentication failed.',P1001:'Database server could not be reached.',P1002:'Database server timed out.',P1014:'A required database object is missing.',P2010:'A raw database query failed.',P2021:'A queried table does not exist.',P2022:'A queried column does not exist.',P2023:'A database value could not be decoded.',P2030:'A required database index is missing.'};
export function safeDiagnostic(error, stage) {
  // Prisma messages and meta fields can contain URLs, SQL values, and server details.
  // Only fixed descriptions and strictly validated error identifiers are emitted.
  const name=safeErrorNames.has(error?.name)?error.name:'Error';
  const code=typeof error?.code==='string'&&/^P\d{4}$/.test(error.code)?error.code:null;
  const pgCode=[error?.meta?.code,error?.meta?.sqlstate].find(value=>typeof value==='string'&&/^[0-9A-Z]{5}$/.test(value)&&!/^P\d{4}$/.test(value));
  const details=[`stage=${stage}`,`name=${name}`];
  if(code) details.push(`prismaCode=${code}`);
  if(pgCode) details.push(`postgresCode=${pgCode}`);
  details.push(`message=${safeDescriptions[code]??'Details withheld to protect connection credentials.'}`);
  return `Audit failed: ${details.join('; ')}`;
}
async function main() {
  const args=process.argv.slice(2);
  const debugSafe=args.includes('--debug-safe');
  let stage='configuration';
  const onStage=value=>{stage=value;if(debugSafe) console.error(`[audit] ${value}`);};
  try {
  if(args.includes('--inspect-target')) { const target=targetFromEnvironment();console.log(`Database target: ${target.host}/${target.database} (credentials hidden). No query run.`);return; }
  const get=flag=>{const i=args.indexOf(flag);return i<0?null:args[i+1];};
  const target=targetFromEnvironment();
  const expected=get('--expect-host');
  if(!expected||expected!==target.host) throw new Error(`Target host mismatch or missing --expect-host. Actual host: ${target.host}. No query run.`);
  if(args.some(arg=>arg.startsWith('--')&&!['--expect-host','--output','--debug-safe'].includes(arg))) throw new Error('Unsupported argument. No query run.');
  const output=get('--output')??path.join(os.tmpdir(),`saleshub-production-cleanup-audit-${new Date().toISOString().replace(/[:.]/g,'-')}`);
  if(!path.isAbsolute(output)) throw new Error('Output path must be absolute. No query run.');
  const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
  if(!(output.startsWith(`${os.tmpdir()}/`)||output.startsWith(`${appRoot}/reports/`))) throw new Error('Output must be under /tmp or app/reports. No query run.');
  const existing=await fs.stat(output).catch(error=>error.code==='ENOENT'?null:Promise.reject(error));
  if(existing) throw new Error('Output directory already exists; choose a new path to avoid overwrites. No query run.');
  const client=new PrismaClient({datasources:{db:{url:readOnlyUrl(target.url)}}});
  try {
    onStage('connect');
    await client.$connect();
    const data=await readSnapshot(client,onStage);
    const result=analyze(data,onStage);
    onStage('report generation');
    const files=await writeReport(result,output,target,onStage);
    console.log(`Read-only audit completed for ${target.host}/${target.database}. ${result.candidates.length} candidates; ${result.duplicates.length} duplicate groups. ${files.length} private files in ${output}.`);
  } finally { await client.$disconnect(); }
  } catch(error) {
    console.error(debugSafe?safeDiagnostic(error,stage):'Audit failed: Error. Details withheld to protect connection credentials.');
    process.exitCode=1;
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main();
