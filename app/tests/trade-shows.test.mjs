import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(fileURLToPath(import.meta.url));
const shows = require(path.join(root, 'lib/trade-shows.ts'));
const leads = require(path.join(root, 'lib/trade-show-leads.ts'));
const { can, routeAccess } = require(path.join(root, 'lib/authorization.ts'));
const actor = (role, id = 7) => ({ id, role, active: true, archivedAt: null });
const form = entries => { const result = new FormData(); for (const [key, value] of entries) result.append(key, value); return result; };

test('Trade Show parser requires an approved US, Canadian, or Mexican timezone and preserves submitted values', () => {
  for (const timezone of ['America/New_York', 'America/Halifax', 'America/Mexico_City']) {
    const good = shows.parseTradeShow(form([['name','NRF 2026'],['startDate','2026-01-11'],['endDate','2026-01-13'],['timezone',timezone]]));
    assert.deepEqual(good.errors, {});
    assert.equal(good.value.name, 'NRF 2026');
    assert.equal(good.value.timezone, timezone);
  }
  const missing = shows.parseTradeShow(form([['name','No timezone'],['timezone','']]));
  assert.match(missing.errors.timezone, /required/);
  const bad = form([['name','  '],['startDate','2026-01-13'],['endDate','2026-01-11'],['timezone','Europe/London'],['location','New York']]);
  const parsed = shows.parseTradeShow(bad);
  assert.match(parsed.errors.name, /required/);
  assert.match(parsed.errors.endDate, /on or after/);
  assert.match(parsed.errors.timezone, /approved/);
  const failure = shows.tradeShowFailureState(bad, parsed.errors);
  assert.equal(failure.values.location, 'New York');
  assert.equal(failure.values.timezone, 'Europe/London');
});

test('Trade Show form uses the shared required timezone dropdown and safely represents historical nulls', () => {
  const component = fs.readFileSync(path.join(root, 'components/trade-show-form.tsx'), 'utf8');
  const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
  assert.match(component, /<select[^>]+id="timezone"[^>]+required/);
  assert.match(component, /initial\?\.timezone \?\? ''/);
  assert.match(component, /TRADE_SHOW_TIMEZONE_GROUPS\.map/);
  assert.match(component, /grid gap-4 sm:grid-cols-2[\s\S]*htmlFor="timezone"[\s\S]*htmlFor="marketingOwnerId"/);
  assert.match(component, /Used for imported lead timestamps\./);
  assert.match(schema, /timezone\s+String\?/);
});

test('Trade Show Event Leads uses compact responsive filters and six combined table columns', () => {
  const page = fs.readFileSync(path.join(root, 'app/trade-shows/[id]/page.tsx'), 'utf8');
  assert.match(page, /filter-panel/);
  assert.match(page, /filter-grid/);
  assert.match(page, /field filter-control/);
  assert.match(page, /btn-filter-primary/);
  assert.match(page, /TableScroll label="Trade Show leads"/);
  assert.match(page, /\['Lead','Company','Contact','Assigned Sales Rep','Status','CRM \/ Follow-Up'\]/);
  assert.match(page, /min-w-\[960px\][^"']*table-fixed/);
  assert.match(page, /even:bg-slate-50\/60[^"']*hover:bg-orange-50\/50[^"']*focus-within:bg-orange-50\/50/);
  assert.match(page, /title: true/);
  assert.match(page, /phone: true/);
});

test('Trade Show roles and row scopes preserve Marketing and Sales boundaries', () => {
  for (const role of ['ADMIN','MARKETING_MANAGER']) {
    assert.equal(can(actor(role), 'trade-shows.manage'), true);
    assert.equal(routeAccess('/trade-shows/new', actor(role)), 'allowed');
    assert.equal(routeAccess('/trade-shows/1/edit', actor(role)), 'allowed');
  }
  for (const role of ['SALES_MANAGER','SALES','READ_ONLY']) {
    assert.equal(can(actor(role), 'trade-shows.manage'), false);
    assert.equal(routeAccess('/trade-shows/new', actor(role)), 'denied');
  }
  assert.equal(can(actor('MARKETING_MANAGER'), 'sales.read'), false);
  assert.equal(routeAccess('/pipeline', actor('MARKETING_MANAGER')), 'denied');
  assert.equal(can(actor('SALES_MANAGER'), 'trade-shows.assign'), true);
  assert.equal(can(actor('READ_ONLY'), 'trade-shows.leads.write'), false);
  assert.deepEqual(shows.tradeShowLeadReadWhere(actor('SALES')), { assignedSalesRepUserId: 7 });
  assert.deepEqual(shows.tradeShowReadWhere(actor('SALES')), { leads: { some: { assignedSalesRepUserId: 7 } } });
  for (const role of ['ADMIN','SALES_MANAGER','MARKETING_MANAGER','READ_ONLY']) assert.deepEqual(shows.tradeShowReadWhere(actor(role)), {});
  assert.equal(shows.canEditTradeShowLead(actor('SALES'), { assignedSalesRepUserId: 8 }), false);
  assert.equal(shows.canEditTradeShowLead(actor('SALES'), { assignedSalesRepUserId: 7 }), true);
  assert.equal(routeAccess('/trade-shows/1/leads/2/edit', actor('SALES')), 'allowed');
  assert.equal(routeAccess('/trade-shows/1/leads/2/edit', actor('READ_ONLY')), 'denied');
  assert.equal(routeAccess('/trade-shows/1/import', actor('MARKETING_MANAGER')), 'allowed');
  assert.equal(routeAccess('/trade-shows/1/import', actor('SALES_MANAGER')), 'denied');
  assert.equal(routeAccess('/trade-shows/1/import', actor('SALES')), 'denied');
  assert.equal(routeAccess('/trade-shows/my-leads', actor('SALES')), 'allowed');
  assert.equal(routeAccess('/trade-shows/my-leads', actor('SALES_MANAGER')), 'allowed');
  assert.equal(routeAccess('/trade-shows/my-leads', actor('ADMIN')), 'allowed');
  assert.equal(routeAccess('/trade-shows/my-leads', actor('MARKETING_MANAGER')), 'denied');
  assert.equal(routeAccess('/trade-shows/my-leads', actor('READ_ONLY')), 'denied');
});
test('My Trade Show Leads uses one actionable internal-sales assignment scope for the page and widget',()=>{
  const own=leads.salesLeadQueueWhere(actor('SALES'));
  assert.equal(own.routing,'BIXOLON_SALES');
  assert.equal(own.assignedSalesRepUserId,7);
  assert.deepEqual(own.status.in,['NEW','CONTACTED','QUALIFIED']);
  assert.equal(own.tradeShow.archivedAt,null);
  assert.equal(leads.salesLeadQueueWhere(actor('SALES'),{view:'all'}).assignedSalesRepUserId,7);
  assert.deepEqual(leads.salesLeadQueueWhere(actor('SALES_MANAGER'),{view:'all'}).assignedSalesRepUserId,{not:null});
  assert.equal(leads.salesLeadQueueWhere(actor('ADMIN'),{status:'CONVERTED',tradeShowId:'12'}).status,'CONVERTED');
  assert.equal(leads.salesLeadQueueWhere(actor('ADMIN'),{status:'CONVERTED',tradeShowId:'12'}).tradeShowId,12);
  assert.deepEqual(leads.salesLeadQueueWhere(actor('MARKETING_MANAGER')),{id:-1});
});

test('Trade Show create/edit validates eligible owner and archive stays reversible', async () => {
  let saved = null, owner = { id: 8, role: 'MARKETING_MANAGER', active: true, archivedAt: null };
  const tx = {
    tradeShow: {
      findUnique: async () => saved,
      create: async ({ data }) => { saved = { id: 3, archivedAt: null, ...data }; return saved; },
      update: async ({ data }) => { saved = { ...saved, ...data }; return saved; },
    },
    user: { findFirst: async ({ where }) => owner?.id === where.id && owner.role === where.role && owner.active && !owner.archivedAt ? owner : null },
  };
  const client = { $transaction: async callback => callback(tx), tradeShow: tx.tradeShow };
  const input = shows.parseTradeShow(form([['name','MODEX 2026'],['timezone','America/Chicago'],['marketingOwnerId','8']])).value;
  assert.equal(await shows.saveTradeShow(client, input, actor('MARKETING_MANAGER')), 3);
  assert.equal(saved.createdById, 7);
  assert.equal(await shows.saveTradeShow(client, { ...input, location: 'Atlanta' }, actor('MARKETING_MANAGER'), 3), 3);
  assert.equal(saved.location, 'Atlanta');
  await assert.rejects(shows.saveTradeShow(client, { ...input, timezone: '' }, actor('ADMIN')), /approved event timezone/);
  await assert.rejects(shows.saveTradeShow(client, { ...input, timezone: '' }, actor('ADMIN'), 3), /approved event timezone/);
  await assert.rejects(shows.saveTradeShow(client, { ...input, timezone: 'Europe/London' }, actor('ADMIN'), 3), /approved event timezone/);
  owner = { ...owner, active: false };
  await assert.rejects(shows.saveTradeShow(client, input, actor('ADMIN'), 3), /active Marketing Manager/);
  await assert.rejects(shows.saveTradeShow(client, input, actor('READ_ONLY')), /Access denied/);
  await shows.setTradeShowArchived(client, 3, true, actor('MARKETING_MANAGER'));
  assert.ok(saved.archivedAt);
  assert.equal(saved.archivedById, 7);
  await assert.rejects(shows.saveTradeShow(client, { ...input, marketingOwnerId: null }, actor('ADMIN'), 3), /archived/);
  await shows.setTradeShowArchived(client, 3, false, actor('ADMIN'));
  assert.equal(saved.archivedAt, null);
  assert.equal(saved.archivedById, null);
  await assert.rejects(shows.setTradeShowArchived(client, 3, true, actor('READ_ONLY')), /Access denied/);
});

test('KPI counts are zero for empty shows and cumulative through conversion', () => {
  assert.deepEqual(shows.tradeShowKpis([]), { total: 0, assigned: 0, contacted: 0, qualified: 0, converted: 0, routing:{UNREVIEWED:0,BIXOLON_SALES:0,REFERRED_TO_PARTNER:0,MARKETING_FOLLOW_UP:0} });
  assert.deepEqual(shows.tradeShowKpis([
    { assignedSalesRepUserId: null, status: 'NEW' },
    { assignedSalesRepUserId: 7, status: 'CONTACTED' },
    { assignedSalesRepUserId: 7, status: 'QUALIFIED' },
    { assignedSalesRepUserId: 8, status: 'CONVERTED' },
    { assignedSalesRepUserId: null, status: 'DISQUALIFIED' },
  ]), { total: 5, assigned: 3, contacted: 3, qualified: 2, converted: 1, routing:{UNREVIEWED:5,BIXOLON_SALES:0,REFERRED_TO_PARTNER:0,MARKETING_FOLLOW_UP:0} });
});

test('schema reserves source ID but keeps Badge ID only in raw provenance', () => {
  const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
  const lead = schema.split('model TradeShowLead {')[1].split('\n}')[0];
  assert.match(lead, /@@unique\(\[tradeShowId, sourceKey\]\)/);
  assert.match(lead, /rawSourceData\s+Json/);
  assert.match(lead, /sourceLeadId\s+String\?/);
  assert.doesNotMatch(lead, /\bbadgeId\b/i);
  assert.doesNotMatch(lead, /@@unique\(\[email\]\)/);
});

test('lead update enforces assigned Sales scope and does not invent conversion', async () => {
  let stored = { id: 2, tradeShowId: 1, assignedSalesRepUserId: 7, convertedOpportunityId: null, accountId: null, contactId: null, competitorId: null, tradeShow: { archivedAt: null } };
  const tx = {
    tradeShowLead: { findFirst: async () => stored, update: async ({ data }) => { stored = { ...stored, ...data }; return stored; } },
    user: { findFirst: async () => ({ id: 7 }) },
    account: { findFirst: async () => null },
    contact: { findFirst: async () => null },
    competitorOption: { findFirst: async () => null },
  };
  const client = { $transaction: async callback => callback(tx) };
  const contacted = form([['status','CONTACTED'],['salesNotes','Called at show']]);
  assert.deepEqual(await leads.saveTradeShowLeadUpdate(client, 1, 2, contacted, actor('SALES')), { errors: {} });
  assert.equal(stored.status, 'CONTACTED');
  assert.equal(stored.assignedSalesRepUserId, 7);
  await assert.rejects(leads.saveTradeShowLeadUpdate(client, 1, 2, contacted, actor('SALES', 8)), /Access denied/);
  await assert.rejects(leads.saveTradeShowLeadUpdate(client, 1, 2, contacted, actor('READ_ONLY')), /Access denied/);
  await assert.rejects(leads.saveTradeShowLeadUpdate(client, 1, 2, form([['status','CONVERTED']]), actor('SALES')), /Only Opportunity conversion/);
  await assert.rejects(leads.saveTradeShowLeadUpdate(client, 1, 2, form([['status','CONTACTED'],['assignedSalesRepUserId','8']]), actor('SALES')), /Access denied to rep assignment/);
});
