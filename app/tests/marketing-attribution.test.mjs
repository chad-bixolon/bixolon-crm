import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(import.meta.url);
const attribution = require(path.join(root, 'lib/marketing-attribution.ts'));
const actor = role => ({ id: 7, role, active: true, archivedAt: null });

test('only effective Marketing Manager and Admin actors manage attribution', () => {
  for (const role of ['ADMIN', 'MARKETING_MANAGER']) assert.equal(attribution.canManageAttribution(actor(role)), true);
  for (const role of ['SALES', 'SALES_MANAGER', 'READ_ONLY']) assert.equal(attribution.canManageAttribution(actor(role)), false);
  assert.equal(attribution.canManageAttribution({ ...actor('ADMIN'), active: false }), false);
});

test('Trade Show automation requires the active configurable Events value and an open linked Campaign', async () => {
  const tx = { leadSourceOption: { findUnique: async () => ({ id: 6, name: 'Trade Events', active: true }) }, tradeShow: { findUniqueOrThrow: async () => ({ name: 'FSTEC 2026', startDate: new Date('2026-10-03'), endDate: null, archivedAt: null }) }, marketingCampaign: { upsert: async payload => ({ id: 8, archivedAt: null, ...payload.create }) } };
  assert.equal((await attribution.eventsLeadSource(tx)).id, 6);
  const campaign = await attribution.ensureTradeShowCampaign(tx, 3, 7);
  assert.equal(campaign.tradeShowId, 3); assert.equal(campaign.name, 'FSTEC 2026');
  tx.leadSourceOption.findUnique = async () => ({ id: 6, active: false });
  await assert.rejects(attribution.eventsLeadSource(tx), /Activate the Events Lead Source/);
  tx.marketingCampaign.upsert = async () => ({ id: 8, archivedAt: new Date() });
  await assert.rejects(attribution.ensureTradeShowCampaign(tx, 3, 7), /Reactivate the linked Campaign/);
});

test('Trade Show touch is stable, preserves occurredAt, and leaves existing first touch alone', async () => {
  const capturedAt = new Date('2026-10-03T14:00:00Z');
  const writes = [], changes = [], touches = [], contactChanges = [];
  const tx = {
    tradeShowLead: { updateMany: async ({ where, data }) => { writes.push({ where, data }); return { count: 0 }; } },
    leadSourceChange: { create: async ({ data }) => changes.push(data) },
    campaignInfluence: { upsert: async payload => touches.push(payload) },
    contact: { updateMany: async payload => { contactChanges.push(payload); return { count: 0 }; } },
  };
  const lead = { id: 42, tradeShowId: 3, capturedAt, importedAt: new Date('2026-10-04'), contactId: 9 };
  await attribution.attachTradeShowInfluence(tx, lead, 8, 6, 7);
  await attribution.attachTradeShowInfluence(tx, lead, 8, 6, 7);
  assert.deepEqual(changes, []);
  assert.equal(touches.length, 2);
  assert.equal(touches[0].where.sourceKey, 'trade-show-lead:42');
  assert.deepEqual(touches[0].update, {});
  assert.equal(touches[0].create.occurredAt, capturedAt);
  assert.equal(writes[0].where.leadSourceId, null);
  assert.equal(contactChanges[0].where.leadSourceId, null);
});

test('first touch establishment and explicit correction are audited', async () => {
  const changes = [], updates = [];
  const tx = { contact: { updateMany: async query => { updates.push(query); return { count: 1 }; }, findUniqueOrThrow: async () => ({ leadSourceId: 2 }), update: async query => updates.push(query) }, leadSourceChange: { create: async ({ data }) => changes.push(data) }, leadSourceOption: { findFirst: async () => ({ id: 3 }) } };
  await attribution.establishContactSource(tx, 9, 6, 7);
  assert.equal(changes[0].newSourceId, 6);
  await attribution.correctLeadSource({ $transaction: async callback => callback(tx) }, { contactId: 9 }, 3, actor('MARKETING_MANAGER'), 'Reviewed original form');
  assert.deepEqual(changes[1], { contactId: 9, oldSourceId: 2, newSourceId: 3, actorId: 7, reason: 'Reviewed original form' });
  await assert.rejects(attribution.correctLeadSource({ $transaction: async callback => callback(tx) }, { contactId: 9 }, 3, actor('SALES'), 'No'), /Access denied/);
});

test('Contact and Opportunity queries follow the same lead touch without copying it', async () => {
  const query = [], touch = { id: 12, campaign: { name: 'FSTEC 2026', archivedAt: new Date() }, occurredAt: new Date('2026-10-03'), sourceContext: 'TRADE_SHOW_IMPORT' };
  const client = { contact: { findUniqueOrThrow: async () => ({ leadSource: { name: 'Events' } }), findMany: async () => [{ id: 9, leadSource: { name: 'Events' } }] }, tradeShowLead: { findUnique: async () => ({ leadSource: { name: 'Events' } }) }, campaignInfluence: { findMany: async payload => { query.push(payload); return [touch]; } } };
  const contact = await attribution.contactAttribution(client, 9);
  const opportunity = await attribution.opportunityAttribution(client, 20, [9], 42);
  assert.equal(contact.leadSource, 'Events'); assert.equal(opportunity.leadSource, 'Events');
  assert.equal(contact.influences[0], opportunity.influences[0]);
  assert.match(JSON.stringify(query[1].where), /tradeShowLeadId/);
  assert.match(JSON.stringify(query[1].where), /contactId/);
});

test('migration is additive, preserves archived campaigns, and avoids historical backfill', () => {
  const sql = fs.readFileSync(path.join(root, 'prisma/migrations/20261003120000_marketing_attribution_foundation/migration.sql'), 'utf8');
  assert.match(sql, /CampaignInfluence_sourceKey_key/);
  assert.match(sql, /CampaignInfluence_one_origin_check/);
  assert.match(sql, /INSERT INTO "LeadSourceOption"/);
  assert.doesNotMatch(sql, /UPDATE "Contact"|UPDATE "TradeShowLead"|DELETE FROM/);
  assert.match(sql, /"archivedAt" TIMESTAMP/);
});

test('Marketing actions create and archive Campaigns while Sales cannot mutate', async () => {
  const originalLoad = Module._load, changes = [];
  let role = 'MARKETING_MANAGER';
  const client = { marketingCampaign: {
    create: async ({ data }) => { changes.push(['create', data]); return { id: 5 }; },
    update: async ({ where, data }) => { changes.push(['update', where.id, data]); return { id: where.id }; },
  } };
  const mocks = {
    'next/cache': { revalidatePath: () => {} },
    'next/navigation': { redirect: pathname => { throw new Error(`REDIRECT:${pathname}`); } },
    '@/lib/prisma': { prisma: client },
    '@/lib/current-user': { currentUser: async () => actor(role) },
    '@/lib/marketing-attribution': attribution,
  };
  Module._load = function(specifier, parent, isMain) { return specifier in mocks ? mocks[specifier] : originalLoad.call(this, specifier, parent, isMain); };
  let actions;
  try { actions = require(path.join(root, 'app/marketing/attribution/actions.ts')); } finally { Module._load = originalLoad; }
  const form = entries => { const data = new FormData(); for (const [key, value] of entries) data.set(key, value); return data; };
  const create = form([['name', 'FSTEC 2026'], ['status', 'ACTIVE'], ['year', '2026']]);
  await assert.rejects(actions.saveCampaign(create), /REDIRECT:\/marketing\/campaigns\/5/);
  assert.equal(changes[0][0], 'create'); assert.equal(changes[0][1].createdById, 7);
  const archive = form([['id', '5'], ['archive', 'true']]);
  await assert.rejects(actions.setCampaignArchive(archive), /REDIRECT:\/marketing\/campaigns\/5/);
  assert.ok(changes[1][2].archivedAt instanceof Date);
  role = 'SALES';
  await assert.rejects(actions.saveCampaign(create), /Access denied/);
  await assert.rejects(actions.setCampaignArchive(archive), /Access denied/);
});
