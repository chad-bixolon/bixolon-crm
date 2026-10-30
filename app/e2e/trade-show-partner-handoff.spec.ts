import { PrismaClient, type TradeShowLead, type TradeShowLeadRouting } from '@prisma/client';
import * as XLSX from 'xlsx';
import { test, expect } from './fixtures';
import { databaseUrl, emails, baseURL } from './constants.mjs';
import { signInAs, uniqueName } from './helpers';
import { previewPartnerHandoff, finalizePartnerHandoff, historicalPartnerExport, loadPartnerHandoffs, loadPartnerBatch, PARTNER_BATCH_TASK_SOURCE } from '../lib/trade-show-partner-handoff';
import { saveTradeShowLeadUpdate } from '../lib/trade-show-leads';
import { bulkRouteTradeShowLeads } from '../lib/trade-show-routing';
import { convertTradeShowLead } from '../lib/trade-show-conversion';
import { parseOpportunity } from '../lib/opportunities';
import { setModuleVisibility } from '../lib/module-availability';

process.env.AUTH_SECRET = 'saleshub-e2e-auth-secret-local-only';
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const user = (role: keyof typeof emails) => db.user.findUniqueOrThrow({ where: { email: emails[role] } });
async function fixture(count = 2) {
  const admin = await user('admin'), marketing = await user('marketing');
  const name = uniqueName('Partner handoff');
  const partner = await db.account.create({ data: { name: `${name} partner`, businessRoles: { create: { role: 'PARTNER' } } } });
  const other = await db.account.create({ data: { name: `${name} other`, businessRoles: { create: { role: 'DISTRIBUTOR' } } } });
  const show = await db.tradeShow.create({ data: { name, timezone: 'America/New_York', startDate: new Date('2026-10-29T12:00:00Z'), createdById: admin.id, marketingOwnerId: marketing.id } });
  const imported = await db.tradeShowImport.create({ data: { tradeShowId: show.id, format: 'CUSTOM_MAPPING', sourceFileName: 'fixture.xlsx', sourceSheet: 'Leads', fileSha256: 'b'.repeat(64), uploadedById: admin.id } });
  const leads: TradeShowLead[] = [];
  for (let i=0;i<count;i++) leads.push(await db.tradeShowLead.create({ data: {
    tradeShowId: show.id, firstImportId: imported.id, sourceKey: `lead-${i}`, sourceFileName: 'fixture.xlsx', sourceSheet: 'Leads', sourceRow: i+1, rawSourceData: { private: 'DO NOT SHARE' },
    firstName: `Lead ${i}`, lastName: 'Partner', sourceCompany: '=HYPERLINK("malicious")', email: `lead-${i}@example.test`, sourceNotes: 'PRIVATE SOURCE', salesNotes: 'PRIVATE SALES', referralNotes: 'PRIVATE REFERRAL',
    partnerHandoffNotes: 'Approved partner context', routing:'REFERRED_TO_PARTNER', routedPartnerAccountId:partner.id,
    partnerHandoffStatus:'AWAITING_PARTNER_HANDOFF', partnerAssignmentVersion:1, partnerAwaitingAt: new Date(Date.now() - 8*86400000),
  } }));
  return { admin, marketing, partner, other, show, leads };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function route(f: Fixture, id: number, routing: TradeShowLeadRouting, partnerId: number | null, repId: number | null = null, status = 'NEW') {
  const lead = await db.tradeShowLead.findUniqueOrThrow({ where: { id } });
  const form = new FormData();
  for (const [key,value] of Object.entries({ editToken:lead.updatedAt.toISOString(), status, routing, routedPartnerAccountId: partnerId ? String(partnerId) : '', assignedSalesRepUserId: repId ? String(repId) : '', partnerHandoffNotes:lead.partnerHandoffNotes ?? '' })) form.set(key,value);
  await saveTradeShowLeadUpdate(db,f.show.id,id,form,f.admin);
  return db.tradeShowLead.findUniqueOrThrow({ where: { id } });
}
async function handoff(f: Fixture, partnerId = f.partner.id) {
  const preview = await previewPartnerHandoff(db,f.admin,f.show.id,partnerId);
  return finalizePartnerHandoff(db,f.admin,f.show.id,partnerId,preview.token);
}
async function counts(f: Fixture) {
  return { batches: await db.tradeShowPartnerHandoff.count({where:{tradeShowId:f.show.id}}), tasks: await db.task.count({where:{source:PARTNER_BATCH_TASK_SOURCE,accountId:f.partner.id}}) };
}
test.afterAll(async () => { await db.$disconnect(); });
// Batch/maintenance history is append-only. Synthetic fixtures remain only in the dedicated E2E database.

test('single-partner export whitelist, grouping, exact snapshot, one Task and transactional sent state', async () => {
  const f = await fixture(3);
  await route(f,f.leads[2].id,'REFERRED_TO_PARTNER',f.other.id);
  const grouped = await loadPartnerHandoffs(db,f.admin,f.show.id);
  expect(grouped.partners.find(p=>p.id===f.partner.id)).toMatchObject({awaiting:2,sent:0,aging:2});
  const preview = await previewPartnerHandoff(db,f.admin,f.show.id,f.partner.id);
  expect(preview.count).toBe(2);
  const result = await finalizePartnerHandoff(db,f.admin,f.show.id,f.partner.id,preview.token);
  expect(result.filename).toMatch(/^SalesHub_[A-Za-z0-9_]+_Leads_\d+_[a-f0-9]{8}\.xlsx$/);
  const rows = XLSX.utils.sheet_to_json<string[]>(XLSX.read(result.bytes,{type:'buffer'}).Sheets['Partner Leads'],{header:1});
  expect(rows).toHaveLength(3);expect(rows[1][2]).toMatch(/^'=HYPERLINK/);
  expect(JSON.stringify(rows)).not.toMatch(/PRIVATE|DO NOT SHARE|password|sourceKey/);
  expect(rows[1][13]).toBe('Approved partner context');
  const batch = await db.tradeShowPartnerHandoff.findUniqueOrThrow({where:{id:result.batchId},include:{leads:true,task:true}});
  expect(batch.leads).toHaveLength(2);expect(batch.leadCount).toBe(2);expect(batch.task.assignedToId).toBe(f.marketing.id);expect(batch.task.accountId).toBe(f.partner.id);expect(batch.task.tradeShowLeadId).toBeNull();
  expect(batch.task.subject).toContain('on 2');expect(batch.task.dueDate).not.toBeNull();
  expect(await counts(f)).toEqual({batches:1,tasks:1});
  expect((await db.tradeShowLead.findMany({where:{id:{in:f.leads.slice(0,2).map(l=>l.id)}}})).every(l=>l.partnerHandoffStatus==='SENT_TO_PARTNER'&&l.partnerSentAt)).toBe(true);
  expect((await db.tradeShowLead.findUniqueOrThrow({where:{id:f.leads[2].id}})).partnerHandoffStatus).toBe('AWAITING_PARTNER_HANDOFF');
  await expect(finalizePartnerHandoff(db,f.admin,f.show.id,f.partner.id,preview.token)).rejects.toThrow();
  expect(await counts(f)).toEqual({batches:1,tasks:1});
});

test('generation or Task failure leaves no partial handoff or notification', async () => {
  const f = await fixture();
  const p = await previewPartnerHandoff(db,f.admin,f.show.id,f.partner.id);
  await expect(finalizePartnerHandoff(db,f.admin,f.show.id,f.partner.id,p.token,()=>{throw new Error('Injected generation failure');})).rejects.toThrow(/Injected/);
  expect(await counts(f)).toEqual({batches:0,tasks:0});
  const failing = db.$extends({query:{task:{create(){throw new Error('Injected Task failure');}}}});
  await expect(finalizePartnerHandoff(failing as unknown as PrismaClient,f.admin,f.show.id,f.partner.id,p.token)).rejects.toThrow(/Injected Task/);
  expect(await counts(f)).toEqual({batches:0,tasks:0});
  expect((await db.tradeShowLead.findMany({where:{tradeShowId:f.show.id}})).every(l=>l.partnerHandoffStatus==='AWAITING_PARTNER_HANDOFF'&&!l.partnerSentAt)).toBe(true);
  expect(await db.notification.count({where:{entityType:'TASK',entityId:{in:(await db.task.findMany({where:{accountId:f.partner.id},select:{id:true}})).map(t=>t.id)}}})).toBe(0);
});

test('conditional sent failure rolls back batch, Task and all lead transitions', async () => {
  const f = await fixture(); const p = await previewPartnerHandoff(db,f.admin,f.show.id,f.partner.id);
  const failing=db.$extends({query:{tradeShowLead:{updateMany({args,query}){if(args.where?.id===f.leads[1].id)return Promise.resolve({count:0});return query(args);}}}});
  await expect(finalizePartnerHandoff(failing as unknown as PrismaClient,f.admin,f.show.id,f.partner.id,p.token)).rejects.toThrow(/changed/);
  expect(await counts(f)).toEqual({batches:0,tasks:0});
  expect(await db.tradeShowPartnerHandoffLead.count({where:{leadId:{in:f.leads.map(l=>l.id)}}})).toBe(0);
  expect((await db.tradeShowLead.findMany({where:{tradeShowId:f.show.id}})).every(l=>l.partnerHandoffStatus==='AWAITING_PARTNER_HANDOFF')).toBe(true);
});

test('concurrent identical handoffs have exactly one winner and one batch Task', async () => {
  const f = await fixture();const p=await previewPartnerHandoff(db,f.admin,f.show.id,f.partner.id);
  const results = await Promise.allSettled([finalizePartnerHandoff(db,f.admin,f.show.id,f.partner.id,p.token),finalizePartnerHandoff(db,f.admin,f.show.id,f.partner.id,p.token)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(await counts(f)).toEqual({batches:1,tasks:1});
});

test('stale preview rejects edits, new arrivals and partner changes; reassignment preserves prior disclosures', async () => {
  const f = await fixture(2), sales = await user('sales');
  const stale=await previewPartnerHandoff(db,f.admin,f.show.id,f.partner.id);
  await route(f,f.leads[0].id,'REFERRED_TO_PARTNER',f.other.id);
  await expect(finalizePartnerHandoff(db,f.admin,f.show.id,f.partner.id,stale.token)).rejects.toThrow(/changed/);
  expect(await counts(f)).toEqual({batches:0,tasks:0});
  await route(f,f.leads[0].id,'REFERRED_TO_PARTNER',f.partner.id);
  const sent=await handoff(f);
  const internal=await route(f,f.leads[0].id,'BIXOLON_SALES',null,sales.id);
  expect(internal.partnerHandoffStatus).toBeNull();
  expect(await db.task.count({where:{tradeShowLeadId:internal.id,source:'TRADE_SHOW_LEAD_FOLLOW_UP',status:'OPEN'}})).toBe(1);
  const changed=await route(f,f.leads[1].id,'REFERRED_TO_PARTNER',f.other.id);
  expect(changed.partnerHandoffStatus).toBe('AWAITING_PARTNER_HANDOFF');expect(changed.partnerAssignmentVersion).toBe(2);
  expect(await db.tradeShowPartnerHandoffLead.count({where:{batchId:sent.batchId}})).toBe(2);
  const back=await route(f,internal.id,'REFERRED_TO_PARTNER',f.partner.id);
  expect(back.partnerHandoffStatus).toBe('AWAITING_PARTNER_HANDOFF');
  expect(await db.task.count({where:{tradeShowLeadId:internal.id,status:'CANCELLED'}})).toBe(1);
  await handoff(f);expect(await counts(f)).toEqual({batches:2,tasks:2});
  expect(await db.tradeShowPartnerHandoffLead.count({where:{leadId:internal.id}})).toBe(2);
});

test('historical re-export preserves original fields and labels after edits, closure, conversion and renaming', async () => {
  const f = await fixture(); const result = await handoff(f);
  await db.account.update({where:{id:f.partner.id},data:{name:'Renamed partner'}});
  await db.tradeShowLead.update({where:{id:f.leads[0].id},data:{firstName:'Changed',partnerHandoffNotes:'Changed notes',accountId:f.other.id}});
  const stage=await db.salesStage.findFirstOrThrow({where:{active:true,isClosed:false}}), form=new FormData();
  for(const [k,v] of [['name','Converted partner lead'],['ownerId',String((await user('sales')).id)],['stageId',String(stage.id)],['currencyCode','USD'],['accountId',String(f.other.id)],['participantRoles','END_USER']])form.append(k,v);
  const input=parseOpportunity(form);expect(input.errors).toEqual({});
  await convertTradeShowLead(db,f.show.id,f.leads[0].id,input.value!,f.admin);
  await route(f,f.leads[1].id,'REFERRED_TO_PARTNER',f.partner.id,null,'DISQUALIFIED');
  const historical=await historicalPartnerExport(db,f.admin,f.show.id,result.batchId);
  expect(historical.filename).toMatch(/^Historical_/);
  const original=XLSX.utils.sheet_to_json(XLSX.read(result.bytes,{type:'buffer'}).Sheets['Partner Leads'],{header:1});
  expect(XLSX.utils.sheet_to_json(XLSX.read(historical.bytes,{type:'buffer'}).Sheets['Partner Leads'],{header:1})).toEqual(original);
  expect(await counts(f)).toEqual({batches:1,tasks:1});
  const detail=await loadPartnerBatch(db,f.admin,f.show.id,result.batchId);
  expect(detail.items.map(i=>i.lead.status).sort()).toEqual(['CONVERTED','DISQUALIFIED']);expect(detail.batch.partnerName).toBe(f.partner.name);
  expect(await db.adminMaintenanceEvent.count({where:{action:'Historical re-export',newValue:{startsWith:`Batch ${result.batchId};`}}})).toBe(1);
});

test('awaiting conversion and disqualification excluded; stale preview cannot finalize converted leads', async () => {
  const f=await fixture(2);const p=await previewPartnerHandoff(db,f.admin,f.show.id,f.partner.id);
  await route(f,f.leads[0].id,'REFERRED_TO_PARTNER',f.partner.id,null,'DISQUALIFIED');
  expect((await previewPartnerHandoff(db,f.admin,f.show.id,f.partner.id)).count).toBe(1);
  await expect(finalizePartnerHandoff(db,f.admin,f.show.id,f.partner.id,p.token)).rejects.toThrow(/changed/);
  await route(f,f.leads[0].id,'REFERRED_TO_PARTNER',f.partner.id);
  const reopened=await db.tradeShowLead.findUniqueOrThrow({where:{id:f.leads[0].id}});expect(reopened.partnerAssignmentVersion).toBe(2);
});

test('authorization, revoked actor, module disable and historical access are server enforced', async () => {
  const f=await fixture(2);const batch=await handoff(f);
  for(const role of ['readOnly','sales','executive'] as const){const actor=await user(role);await expect(previewPartnerHandoff(db,actor,f.show.id,f.partner.id)).rejects.toThrow(/Access denied/);await expect(historicalPartnerExport(db,actor,f.show.id,batch.batchId)).rejects.toThrow(/Access denied/);}
  const sales=await user('sales');expect((await loadPartnerHandoffs(db,sales,f.show.id)).partners).toHaveLength(0);
  await setModuleVisibility(db,f.admin,'TRADE_SHOWS',false);
  try {await expect(loadPartnerHandoffs(db,f.admin,f.show.id)).rejects.toThrow(/Module unavailable/);await expect(historicalPartnerExport(db,f.admin,f.show.id,batch.batchId)).rejects.toThrow(/Module unavailable/);await expect(previewPartnerHandoff(db,f.admin,f.show.id,f.partner.id)).rejects.toThrow(/Module unavailable/);}
  finally {await setModuleVisibility(db,f.admin,'TRADE_SHOWS',true);}
});

test('simultaneous routing and handoff cannot silently send the wrong assignment', async () => {
  const f=await fixture(1);const p=await previewPartnerHandoff(db,f.admin,f.show.id,f.partner.id);
  const req={records:f.leads.map(l=>({id:l.id,updatedAt:l.updatedAt.toISOString()})),action:'route',value:'',confirmed:true};
  const results=await Promise.allSettled([finalizePartnerHandoff(db,f.admin,f.show.id,f.partner.id,p.token),bulkRouteTradeShowLeads(db,f.show.id,req,'REFERRED_TO_PARTNER',null,f.other.id,null,f.admin,{where:{},page:1})]);
  expect(results.some(r=>r.status==='fulfilled')).toBe(true);
  const lead=await db.tradeShowLead.findUniqueOrThrow({where:{id:f.leads[0].id}});
  if(lead.routedPartnerAccountId===f.other.id)expect(lead.partnerHandoffStatus).toBe('AWAITING_PARTNER_HANDOFF');
  const batches=await db.tradeShowPartnerHandoff.findMany({where:{tradeShowId:f.show.id},include:{leads:true}});
  expect(batches.length).toBeLessThanOrEqual(1);for(const b of batches){expect(b.partnerAccountId).toBe(f.partner.id);expect(b.leads[0].assignmentVersion).toBe(1);}
});

test('browser Trade Show → Partner Handoffs → Partner → Export & Mark Sent → History', async ({page}) => {
  test.setTimeout(90000);const f=await fixture();
  await signInAs(page,'marketing');await page.goto(`/trade-shows/${f.show.id}`);
  await page.getByRole('link',{name:'Partner Handoffs',exact:true}).click();
  await page.getByRole('link',{name:f.partner.name,exact:true}).click();
  await page.getByRole('button',{name:'Export & Mark Sent',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Confirm Partner Handoff'});
  await expect(dialog).toContainText(f.partner.name);await expect(dialog).toContainText('2 awaiting leads');await expect(dialog).toContainText('Only unsent leads included');
  const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'Confirm Export & Mark Sent',exact:true}).click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
  await expect(page.getByRole('heading',{name:'Handoff Batch',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Included leads',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Open batch follow-up Task',exact:true}).click();await expect(page.locator('h1')).toContainText('on 2');
  await page.goBack();await page.getByRole('button',{name:'Historical Re-export',exact:true}).click();
  const historical=page.waitForEvent('download');await page.getByRole('button',{name:'Download Historical Export',exact:true}).click();expect((await historical).suggestedFilename()).toMatch(/^Historical_/);
  await page.getByRole('link',{name:'Partner Handoffs',exact:true}).click();await expect(page.getByRole('heading',{name:'Handoff History',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Export & Mark Sent',exact:true})).toHaveCount(0);
  expect(await counts(f)).toEqual({batches:1,tasks:1});
});

for(const width of [390,768])test(`partner handoff confirmation fits ${width}px and cancels without state change`,async({page})=>{
  const f=await fixture(1);await page.setViewportSize({width,height:900});await signInAs(page,'marketing');await page.goto(`/trade-shows/${f.show.id}/partner-handoffs?partner=${f.partner.id}`);
  await page.getByRole('button',{name:'Export & Mark Sent',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Confirm Partner Handoff'});await expect(dialog).toBeVisible();
  const b=await dialog.boundingBox();expect(b!.x).toBeGreaterThanOrEqual(0);expect(b!.x+b!.width).toBeLessThanOrEqual(width+1);await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();expect(await counts(f)).toEqual({batches:0,tasks:0});
});

test('direct route denies Read Only export and disabled module view/action',async({page})=>{
  const f=await fixture(1);const endpoint=`/trade-shows/${f.show.id}/partner-handoffs/export`;
  await signInAs(page,'readOnly');await page.goto(`/trade-shows/${f.show.id}/partner-handoffs?partner=${f.partner.id}`);await expect(page.getByRole('button',{name:'Export & Mark Sent',exact:true})).toHaveCount(0);
  expect((await page.request.post(endpoint,{headers:{origin:baseURL},data:{action:'preview',partnerId:f.partner.id}})).status()).toBe(403);
  await signInAs(page,'admin');expect((await page.request.post(endpoint,{data:{action:'preview',partnerId:f.partner.id}})).status()).toBe(403);
  await setModuleVisibility(db,f.admin,'TRADE_SHOWS',false);
  try {const hidden=await page.request.get(`/trade-shows/${f.show.id}/partner-handoffs`,{maxRedirects:0});expect(hidden.status()).toBe(307);expect(hidden.headers().location).toContain('/module-unavailable');const res=await page.request.post(endpoint,{maxRedirects:0,headers:{origin:baseURL},data:{action:'preview',partnerId:f.partner.id}});expect([400,403,404,307]).toContain(res.status());}
  finally{await setModuleVisibility(db,f.admin,'TRADE_SHOWS',true);}
});

test('stale row, added awaiting lead, forged token, revoked actor and owner fallback', async () => {
  const f=await fixture(2);
  let p=await previewPartnerHandoff(db,f.admin,f.show.id,f.partner.id);
  await db.tradeShowLead.update({where:{id:f.leads[0].id},data:{partnerHandoffNotes:'Reviewed new note'}});
  await expect(finalizePartnerHandoff(db,f.admin,f.show.id,f.partner.id,p.token)).rejects.toThrow(/changed/);
  await route(f,f.leads[1].id,'REFERRED_TO_PARTNER',f.other.id);
  p=await previewPartnerHandoff(db,f.admin,f.show.id,f.partner.id);
  await route(f,f.leads[1].id,'REFERRED_TO_PARTNER',f.partner.id);
  await expect(finalizePartnerHandoff(db,f.admin,f.show.id,f.partner.id,p.token)).rejects.toThrow(/changed/);
  p=await previewPartnerHandoff(db,f.admin,f.show.id,f.partner.id);
  await expect(finalizePartnerHandoff(db,f.admin,f.show.id,f.partner.id,p.token.slice(0,-1)+'z')).rejects.toThrow(/changed/);
  const temp=await db.user.create({data:{email:`handoff-${Date.now()}@example.test`,firstName:'Temporary',lastName:'Manager',role:'SALES_MANAGER'}});
  const tempPreview=await previewPartnerHandoff(db,temp,f.show.id,f.partner.id);
  await db.user.update({where:{id:temp.id},data:{active:false}});
  await expect(finalizePartnerHandoff(db,temp,f.show.id,f.partner.id,tempPreview.token)).rejects.toThrow(/Access denied/);
  await db.tradeShow.update({where:{id:f.show.id},data:{marketingOwnerId:null}});
  const result=await handoff(f);const batch=await db.tradeShowPartnerHandoff.findUniqueOrThrow({where:{id:result.batchId},include:{task:true}});
  expect(batch.task.assignedToId).toBe(f.admin.id);expect(await counts(f)).toEqual({batches:1,tasks:1});
});

test('actual Opportunity conversion racing export preserves a coherent original batch or rejects the stale handoff', async () => {
  const f=await fixture(1);await db.tradeShowLead.update({where:{id:f.leads[0].id},data:{accountId:f.other.id}});
  const stage=await db.salesStage.findFirstOrThrow({where:{active:true,isClosed:false}}),form=new FormData();
  for(const [k,v] of [['name','Concurrent converted partner lead'],['ownerId',String((await user('sales')).id)],['stageId',String(stage.id)],['currencyCode','USD'],['accountId',String(f.other.id)],['participantRoles','END_USER']])form.append(k,v);
  const input=parseOpportunity(form);expect(input.errors).toEqual({});
  const p=await previewPartnerHandoff(db,f.admin,f.show.id,f.partner.id);
  const results=await Promise.allSettled([finalizePartnerHandoff(db,f.admin,f.show.id,f.partner.id,p.token),convertTradeShowLead(db,f.show.id,f.leads[0].id,input.value!,f.admin)]);
  expect(results.some(r=>r.status==='fulfilled')).toBe(true);
  if(results[1].status==='rejected')await convertTradeShowLead(db,f.show.id,f.leads[0].id,input.value!,f.admin);
  const lead=await db.tradeShowLead.findUniqueOrThrow({where:{id:f.leads[0].id}});expect(lead.status).toBe('CONVERTED');
  const batches=await db.tradeShowPartnerHandoff.findMany({where:{tradeShowId:f.show.id},include:{leads:true}});
  expect(batches.length).toBe(results[0].status==='fulfilled'?1:0);
  if(batches.length){expect(batches[0].leads[0].exportRow).toEqual(expect.arrayContaining(['NEW']));expect(lead.partnerHandoffStatus).toBe('SENT_TO_PARTNER');}
  else expect(lead.partnerHandoffStatus).toBeNull();
});

for (const action of ['finalize','historical'] as const) test(`${action} rejects a module disable committed while awaiting the module lock`, async () => {
  const f = await fixture(1);
  const batch = action === 'historical' ? await handoff(f) : null;
  const preview = action === 'finalize' ? await previewPartnerHandoff(db, f.admin, f.show.id, f.partner.id) : null;
  const before = await counts(f);
  const auditBefore = await db.adminMaintenanceEvent.count({ where: { action: 'Historical re-export', newValue: { startsWith: `Batch ${batch?.batchId};` } } });
  let release!: () => void, updated!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const reached = new Promise<void>(resolve => { updated = resolve; });
  const paused = db.$extends({ query: { deploymentModuleVisibility: { async upsert({args, query}) {
    const result = await query(args); updated(); await gate; return result;
  } } } });
  const disabling = setModuleVisibility(paused as unknown as PrismaClient, f.admin, 'TRADE_SHOWS', false);
  // Keep both branches handled while the test controls the database lock interleaving.
  const disableResult = disabling.then(() => null, error => error);
  let pending: Promise<{status: string; error?: unknown}> | undefined;
  try {
    await reached;
    pending = (action === 'finalize'
      ? finalizePartnerHandoff(db, f.admin, f.show.id, f.partner.id, preview!.token)
      : historicalPartnerExport(db, f.admin, f.show.id, batch!.batchId))
      .then(() => ({status:'fulfilled'}), error => ({status:'rejected',error}));
    await expect.poll(async () => {
      const [row] = await db.$queryRaw<{waiting:number}[]>`SELECT count(*)::int AS waiting FROM pg_locks
        WHERE locktype = 'advisory' AND objid = 72341025 AND NOT granted
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`;
      return row.waiting;
    }, {timeout:3000,intervals:[20,50,100]}).toBe(1);
    release();
    expect(await disableResult).toBeNull();
    expect((await db.deploymentModuleVisibility.findUniqueOrThrow({where:{module:'TRADE_SHOWS'}})).enabled).toBe(false);
    const outcome = await pending;
    expect(outcome.status).toBe('rejected');
    expect(outcome.error).toMatchObject({name:'RecordChangedError'});
    expect(await counts(f)).toEqual(before);
    expect(await db.adminMaintenanceEvent.count({where:{action:'Historical re-export',newValue:{startsWith:`Batch ${batch?.batchId};`}}})).toBe(auditBefore);
    const lead = await db.tradeShowLead.findUniqueOrThrow({where:{id:f.leads[0].id}});
    expect(lead.partnerHandoffStatus).toBe(action === 'finalize' ? 'AWAITING_PARTNER_HANDOFF' : 'SENT_TO_PARTNER');
  } finally {
    release(); await disableResult; await pending;
    await setModuleVisibility(db, f.admin, 'TRADE_SHOWS', true);
  }
});
