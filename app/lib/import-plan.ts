import { AccountBusinessRoleCode, AccountStatus, Prisma, type PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { parseImportCsv, type CsvRow, type ImportHeader } from './import-csv';

type Db = PrismaClient | Prisma.TransactionClient;
type Account = Prisma.AccountGetPayload<{include:{businessRoles:true}}>;
type Contact = Prisma.ContactGetPayload<object>;
export type ImportItem = { line:number; type:'Account'|'Contact'; label:string; status:'NEW'|'UPDATE'|'UNCHANGED'|'WARNING'|'ERROR'; before:string; after:string; messages:string[]; id?:number; accountRef?:number|string; data:Record<string,unknown>; roles?:AccountBusinessRoleCode[]; primaryTransferId?:number };
export type ImportPlan = { items:ImportItem[]; errors:string[]; counts:Record<'newAccounts'|'updatedAccounts'|'unchangedAccounts'|'newContacts'|'updatedContacts'|'unchangedContacts'|'skippedRows'|'warnings'|'errors',number>; digest:string };
const accountFields: Partial<Record<ImportHeader,keyof Account>> = {account_name:'name',account_status:'status',website:'website',phone:'phone',territory_code:'territory',industry_code:'industry',strategic_account:'strategicAccount',address_line_1:'addressLine1',address_line_2:'addressLine2',city:'city',state_province:'stateProvince',postal_code:'postalCode',country:'country'};
const contactFields: Partial<Record<ImportHeader,keyof Contact>> = {contact_first_name:'firstName',contact_last_name:'lastName',contact_title:'title',contact_email:'email',contact_phone:'phone',contact_mobile:'mobile',contact_active:'active',contact_primary:'isPrimary',address_line_1:'addressLine1',address_line_2:'addressLine2',city:'city',state_province:'stateProvince',postal_code:'postalCode',country:'country'};
const norm = (s:string) => s.trim().replace(/\s+/g,' ').toLowerCase();
export const normalizeAccountName = norm;
export const normalizeDomain = (s:string) => { try { return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase().replace(/^www\./,''); } catch { return ''; } };
const email = (s:string) => s.trim().toLowerCase();
const bool = (s:string) => /^(true|false|yes|no|1|0)$/i.test(s) ? /^(true|yes|1)$/i.test(s) : null;
const has = (row:CsvRow,key:ImportHeader) => !!row.values[key]?.trim();
const v = (row:CsvRow,key:ImportHeader) => row.values[key]?.trim() ?? '';
const diff = (before:Record<string,unknown>, after:Record<string,unknown>) => Object.entries(after).filter(([k,value]) => JSON.stringify(before[k]) !== JSON.stringify(value)).map(([k,value]) => `${k}: ${String(before[k] ?? '—')} → ${String(value)}`);
const describe = (data:Record<string,unknown>) => Object.entries(data).map(([k,val])=>`${k}: ${String(val ?? '—')}`).join('; ');
const validEmail = (s:string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;

export async function planImport(db:Db, csv:string):Promise<ImportPlan> {
  const parsed = parseImportCsv(csv);
  const counts:ImportPlan['counts'] = {newAccounts:0,updatedAccounts:0,unchangedAccounts:0,newContacts:0,updatedContacts:0,unchangedContacts:0,skippedRows:0,warnings:0,errors:0};
  if (parsed.errors.length) return {items:[],errors:parsed.errors,counts:{...counts,errors:parsed.errors.length},digest:''};
  const [accounts,contacts,users,territories,industries] = await Promise.all([
    db.account.findMany({include:{businessRoles:true}}), db.contact.findMany(), db.user.findMany(), db.territory.findMany(), db.industry.findMany(),
  ]);
  const items:ImportItem[] = [], seenAccounts = new Set<string>(), seenContacts = new Set<string>();
  const proposedAccounts = new Map<string,ImportItem>();
  for (const row of parsed.rows.filter(r => norm(v(r,'record_type')) === 'account')) {
    const name = v(row,'account_name'), messages:string[] = [];
    if (!name) messages.push('Account name is required.');
    if (name.length > 200) messages.push('Account name exceeds 200 characters.');
    const key = norm(name), domain = has(row,'website') ? normalizeDomain(v(row,'website')) : '';
    if (has(row,'website') && (!domain.includes('.') || !/^https?:\/\//i.test(v(row,'website')))) messages.push('Website must be a full http or https URL.');
    const byName = accounts.filter(a => norm(a.name) === key);
    const byDomain = domain ? accounts.filter(a => a.website && normalizeDomain(a.website) === domain) : [];
    const candidates = new Set([...byName,...byDomain].map(a=>a.id));
    if (candidates.size > 1) messages.push('Ambiguous Account match: name and/or website identify multiple records.');
    const match = candidates.size === 1 ? accounts.find(a=>a.id === [...candidates][0]) : undefined;
    if (match?.archivedAt) messages.push('Matched Account is archived. Review it in CRM first.');
    if (seenAccounts.has(key) || (domain && seenAccounts.has(`domain:${domain}`))) messages.push('Duplicate Account row in this CSV.');
    seenAccounts.add(key); if (domain) seenAccounts.add(`domain:${domain}`);
    const data:Record<string,unknown> = {};
    for (const [header,field] of Object.entries(accountFields) as [ImportHeader,keyof Account][]) if (has(row,header)) data[field] = v(row,header);
    for (const [field,limit] of Object.entries({website:500,phone:50,territory:100,industry:100,addressLine1:200,addressLine2:200,city:100,stateProvince:100,postalCode:30,country:100})) if (typeof data[field] === 'string' && (data[field] as string).length > limit) messages.push(`${field} exceeds ${limit} characters.`);
    if (has(row,'account_status')) { const status = v(row,'account_status').toUpperCase(); if (!['ACTIVE','INACTIVE'].includes(status)) messages.push('Account status must be ACTIVE or INACTIVE.'); else data.status = status as AccountStatus; }
    if (has(row,'strategic_account')) { const value = bool(v(row,'strategic_account')); if (value === null) messages.push('Strategic account must be true or false.'); else data.strategicAccount = value; }
    if (has(row,'owner_email')) { const matches = users.filter(u => email(u.email) === email(v(row,'owner_email')) && u.active && !u.archivedAt); if (matches.length !== 1) messages.push('Owner email must match one active CRM user.'); else data.ownerId = matches[0].id; }
    if (has(row,'territory_code') && !territories.some(t => t.code === v(row,'territory_code') && t.active)) messages.push('Unknown or inactive Territory code.');
    if (has(row,'industry_code') && !industries.some(i => i.code === v(row,'industry_code') && i.active)) messages.push('Unknown or inactive Industry code.');
    let roles:AccountBusinessRoleCode[]|undefined;
    if (has(row,'business_roles')) { const values = v(row,'business_roles').split('|').map(x=>x.trim()).filter(Boolean); const invalid = values.filter(x=>!Object.values(AccountBusinessRoleCode).includes(x as AccountBusinessRoleCode)); if (invalid.length) messages.push(`Unknown business role: ${invalid.join(', ')}.`); else roles = [...new Set(values)] as AccountBusinessRoleCode[]; }
    const before = match ? Object.fromEntries(Object.keys(data).map(k=>[k,(match as unknown as Record<string,unknown>)[k]])) : {};
    const changes = diff(before,data);
    const oldRoles = match?.businessRoles.map(x=>x.role).sort() ?? [];
    if (roles && JSON.stringify(oldRoles) !== JSON.stringify([...roles].sort())) changes.push(`businessRoles: ${oldRoles.join('|') || '—'} → ${roles.join('|')}`);
    const status = messages.length ? 'ERROR' : !match ? 'NEW' : changes.length ? 'UPDATE' : 'UNCHANGED';
    const item:ImportItem = {line:row.line,type:'Account',label:name || '(missing name)',status,before:match ? describe(before) : 'New record',after:changes.join('; ') || (match ? 'No changes' : describe(data)),messages,id:match?.id,data,roles};
    items.push(item); if (name && !proposedAccounts.has(key)) proposedAccounts.set(key,item);
  }
  for (const row of parsed.rows.filter(r => norm(v(r,'record_type')) === 'contact')) {
    const messages:string[] = [], first = v(row,'contact_first_name'), last = v(row,'contact_last_name'), mail = v(row,'contact_email');
    if (!first || !last) messages.push('Contact first and last name are required.');
    if (first.length > 100 || last.length > 100) messages.push('Contact name exceeds 100 characters.');
    if (mail && !validEmail(mail)) messages.push('Invalid Contact email address.');
    const matches = mail ? contacts.filter(c => c.email && email(c.email) === email(mail)) : [];
    if (matches.length > 1) messages.push('Ambiguous Contact email match.');
    const match = matches.length === 1 ? matches[0] : undefined;
    if (match?.archivedAt) messages.push('Matched Contact is archived. Review it in CRM first.');
    if (mail && seenContacts.has(email(mail))) messages.push('Duplicate Contact email in this CSV.');
    if (mail) seenContacts.add(email(mail));
    const data:Record<string,unknown> = {};
    for (const [header,field] of Object.entries(contactFields) as [ImportHeader,keyof Contact][]) if (has(row,header)) data[field] = v(row,header);
    for (const [field,limit] of Object.entries({title:200,phone:50,mobile:50,addressLine1:200,addressLine2:200,city:100,stateProvince:100,postalCode:30,country:100})) if (typeof data[field] === 'string' && (data[field] as string).length > limit) messages.push(`${field} exceeds ${limit} characters.`);
    if (mail) data.email = email(mail);
    if (has(row,'contact_active')) { const value = bool(v(row,'contact_active')); if (value === null) messages.push('Contact active must be true or false.'); else data.active = value; }
    if (has(row,'contact_primary')) { const value = bool(v(row,'contact_primary')); if (value === null) messages.push('Contact primary must be true or false.'); else data.isPrimary = value; }
    const accountName = v(row,'contact_account_name') || v(row,'account_name');
    let accountRef:number|string|undefined;
    if (accountName) {
      const accountMatches = accounts.filter(a=>norm(a.name) === norm(accountName));
      const proposed = proposedAccounts.get(norm(accountName));
      if (accountMatches.length > 1 || (proposed?.status === 'ERROR')) messages.push('Ambiguous or invalid Contact Account mapping.');
      else if (accountMatches.length === 1) { const proposedStatus = proposed?.data.status; if ((proposedStatus ?? accountMatches[0].status) !== 'ACTIVE' || accountMatches[0].archivedAt) messages.push('Contact Account must be active.'); else accountRef = accountMatches[0].id; }
      else if (proposed) { if (proposed.data.status === 'INACTIVE') messages.push('Contact Account must be active.'); else accountRef = proposed.id ?? norm(accountName); }
      else messages.push('Contact Account name does not match an existing or imported Account.');
    }
    if (accountRef !== undefined) data.accountId = accountRef;
    const active = (data.active as boolean|undefined) ?? match?.active ?? true;
    const primary = (data.isPrimary as boolean|undefined) ?? match?.isPrimary ?? false;
    const target = accountRef ?? match?.accountId;
    if (!mail) { const key = `name:${norm(first)}:${norm(last)}:${String(target ?? '')}`; if (seenContacts.has(key)) messages.push('Duplicate Contact without email in this CSV.'); seenContacts.add(key); }
    if (primary && !active) messages.push('Primary Contact must be active.');
    if (primary && !target) messages.push('Primary Contact must have an Account.');
    if (match?.isPrimary && accountRef !== undefined && accountRef !== match.accountId && data.isPrimary === undefined) messages.push('Moving a Primary Contact requires an explicit contact_primary value.');
    if (!mail && !match && contacts.some(c=>norm(c.firstName)===norm(first) && norm(c.lastName)===norm(last) && c.accountId === (typeof target === 'number' ? target : null) && !c.archivedAt)) messages.push('Contact without email resembles an existing Contact; add an email or review manually.');
    let primaryTransferId:number|undefined;
    if (primary && typeof target === 'number') { const prior = contacts.find(c=>c.accountId === target && c.active && c.isPrimary && !c.archivedAt && c.id !== match?.id); if (prior) primaryTransferId = prior.id; }
    const before = match ? Object.fromEntries(Object.keys(data).map(k=>[k,(match as unknown as Record<string,unknown>)[k]])) : {};
    const changes = diff(before,data);
    if (primaryTransferId) changes.push(`Primary Contact: #${primaryTransferId} → ${first} ${last}`);
    const status = messages.length ? 'ERROR' : primaryTransferId ? 'WARNING' : !match ? 'NEW' : changes.length ? 'UPDATE' : 'UNCHANGED';
    items.push({line:row.line,type:'Contact',label:`${first} ${last}`.trim() || '(missing name)',status,before:match ? describe(before) : 'New record',after:changes.join('; ') || (match ? 'No changes' : describe(data)),messages:primaryTransferId ? [...messages,`Existing Primary Contact #${primaryTransferId} will lose Primary status.`] : messages,id:match?.id,accountRef,data,primaryTransferId});
  }
  for (const row of parsed.rows.filter(r => !['account','contact'].includes(norm(v(r,'record_type'))))) items.push({line:row.line,type:'Account',label:v(row,'record_type') || '(blank type)',status:'ERROR',before:'',after:'',messages:['record_type must be account or contact.'],data:{}});
  const primaryTargets = new Map<string,ImportItem>();
  for (const item of items.filter(i=>i.type === 'Contact' && i.data.isPrimary === true)) { const key=String(item.accountRef ?? contacts.find(c=>c.id===item.id)?.accountId ?? ''); if (!key) continue; if (primaryTargets.has(key)) { item.status='ERROR'; item.messages.push('Multiple imported Primary Contacts for one Account.'); } else primaryTargets.set(key,item); }
  for (const item of items) { if (item.status === 'ERROR') counts.errors++; else if (item.status === 'WARNING') { counts.warnings++; if (item.id) counts.updatedContacts++; else counts.newContacts++; } else { const key = `${item.status.toLowerCase()}${item.type}s` as keyof typeof counts; counts[key]++; } }
  const digest = createHash('sha256').update(JSON.stringify(items)).digest('hex');
  return {items,errors:[],counts,digest};
}

export async function applyImport(db:PrismaClient,csv:string,expectedDigest:string,actorId:number) {
  return db.$transaction(async tx => {
    const plan = await planImport(tx,csv);
    if (!expectedDigest || plan.digest !== expectedDigest || plan.errors.length || plan.counts.errors) throw new Error('Preview changed or contains errors. Preview the CSV again before confirming.');
    const created = new Map<string,number>();
    for (const item of plan.items.filter(i=>i.type==='Account' && i.status!=='UNCHANGED')) {
      const {name,...other} = item.data;
      const data = {name:String(name),...other,updatedById:actorId} as Prisma.AccountUncheckedCreateInput;
      const record = item.id ? await tx.account.update({where:{id:item.id},data:{...item.data,updatedById:actorId} as Prisma.AccountUncheckedUpdateInput}) : await tx.account.create({data:{...data,createdById:actorId}});
      if (!item.id) created.set(norm(String(name)),record.id);
      if (item.roles) { await tx.accountBusinessRole.deleteMany({where:{accountId:record.id}}); if (item.roles.length) await tx.accountBusinessRole.createMany({data:item.roles.map(role=>({accountId:record.id,role}))}); }
    }
    for (const item of plan.items.filter(i=>i.type==='Contact' && i.status!=='UNCHANGED')) {
      const data:Record<string,unknown> = {...item.data,updatedById:actorId};
      if (typeof item.accountRef === 'string') data.accountId = created.get(item.accountRef);
      if (item.primaryTransferId) await tx.contact.update({where:{id:item.primaryTransferId},data:{isPrimary:false,updatedById:actorId}});
      if (item.id) await tx.contact.update({where:{id:item.id},data:data as Prisma.ContactUncheckedUpdateInput});
      else await tx.contact.create({data:{...data,firstName:String(data.firstName),lastName:String(data.lastName),createdById:actorId} as Prisma.ContactUncheckedCreateInput});
    }
    return plan.counts;
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
