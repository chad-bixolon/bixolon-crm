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

test('Trade Show parser validates dates and IANA timezone while preserving submitted values', () => {
  const good = shows.parseTradeShow(form([['name','NRF 2026'],['startDate','2026-01-11'],['endDate','2026-01-13'],['timezone','America/New_York']]));
  assert.deepEqual(good.errors, {});
  assert.equal(good.value.name, 'NRF 2026');
  const bad = form([['name','  '],['startDate','2026-01-13'],['endDate','2026-01-11'],['timezone','Not/A_Zone'],['location','New York']]);
  const parsed = shows.parseTradeShow(bad);
  assert.match(parsed.errors.name, /required/);
  assert.match(parsed.errors.endDate, /on or after/);
  assert.match(parsed.errors.timezone, /IANA/);
  assert.equal(shows.tradeShowFailureState(bad, parsed.errors).values.location, 'New York');
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
  const input = shows.parseTradeShow(form([['name','MODEX 2026'],['marketingOwnerId','8']])).value;
  assert.equal(await shows.saveTradeShow(client, input, actor('MARKETING_MANAGER')), 3);
  assert.equal(saved.createdById, 7);
  assert.equal(await shows.saveTradeShow(client, { ...input, location: 'Atlanta' }, actor('MARKETING_MANAGER'), 3), 3);
  assert.equal(saved.location, 'Atlanta');
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
  assert.deepEqual(shows.tradeShowKpis([]), { total: 0, assigned: 0, contacted: 0, qualified: 0, converted: 0 });
  assert.deepEqual(shows.tradeShowKpis([
    { assignedSalesRepUserId: null, status: 'NEW' },
    { assignedSalesRepUserId: 7, status: 'CONTACTED' },
    { assignedSalesRepUserId: 7, status: 'QUALIFIED' },
    { assignedSalesRepUserId: 8, status: 'CONVERTED' },
    { assignedSalesRepUserId: null, status: 'DISQUALIFIED' },
  ]), { total: 5, assigned: 3, contacted: 3, qualified: 2, converted: 1 });
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
