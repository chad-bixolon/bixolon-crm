import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const originalLoad = Module._load;
const originalTs = Module._extensions['.ts'];
const originalTsx = Module._extensions['.tsx'];
const compile = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
Module._extensions['.ts'] = compile;
Module._extensions['.tsx'] = compile;
const require = Module.createRequire(import.meta.url);
const authorization = require(path.join(root, 'lib/authorization.ts'));
const attribution = { campaignStatuses: ['PLANNED', 'ACTIVE', 'COMPLETED'], canManageAttribution: actor => authorization.can(actor, 'marketing.write') && ['ADMIN', 'MARKETING_MANAGER'].includes(actor.role) };
const tradeShows = { tradeShowLeadReadWhere: actor => actor.role === 'SALES' ? { assignedSalesRepUserId: actor.id } : {} };
let effectiveRole = 'ADMIN';
const actor = () => ({ id: 7, role: effectiveRole, active: true, archivedAt: null });
const campaign = { id: 5, name: 'FSTEC 2026', status: 'ACTIVE', year: 2026, category: 'Trade Show', startDate: new Date('2026-10-03'), endDate: null, description: 'A regional event', archivedAt: null, tradeShow: { id: 3, name: 'FSTEC' } };
const touch = { id: 10, occurredAt: new Date('2026-10-03T14:00:00Z'), sourceContext: 'TRADE_SHOW_IMPORT', tradeShowLead: { id: 11, tradeShowId: 3, firstName: 'Ada', lastName: 'Lovelace' }, contact: null, opportunity: null, capturedBy: { firstName: 'Mia', lastName: 'Chen' }, voidedAt: null };
let queryLog = [];
let rows = [touch];
let listRows = [];
let campaignTotal = 0;
let count = { lead: 1, contact: 0, opportunity: 0, active: 1 };
const prisma = {
  marketingCampaign: { findUnique: async () => campaign, findMany: async q => { queryLog.push(['campaignList', q]); return listRows; }, count: async () => campaignTotal },
  tradeShowLead: { count: async q => { queryLog.push(['leadCount', q]); return count.lead; }, findMany: async q => { queryLog.push(['leads', q]); return count.lead ? [touch.tradeShowLead] : []; } },
  contact: { count: async q => { queryLog.push(['contactCount', q]); return count.contact; }, findMany: async q => { queryLog.push(['contacts', q]); return []; } },
  opportunity: { count: async q => { queryLog.push(['opportunityCount', q]); return count.opportunity; }, findMany: async q => { queryLog.push(['opportunities', q]); return []; } },
  campaignInfluence: { count: async q => { queryLog.push(['activeCount', q]); return count.active; }, findMany: async q => { queryLog.push(['influences', q]); return rows; } },
};
const Shell = { Content: ({ children }) => React.createElement('main', null, children), PageHeader: ({ title, description, action }) => React.createElement('header', null, React.createElement('h1', null, title), description, action) };
const mocks = {
  'next/link': ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children),
  'next/navigation': { notFound: () => { throw new Error('NOT_FOUND'); } },
  '@/components/shell': Shell,
  '@/lib/current-user': { currentUser: async () => actor() },
  '@/lib/authorization': authorization,
  '@/lib/marketing-attribution': attribution,
  '@/lib/trade-shows': tradeShows,
  '@/lib/prisma': { prisma },
  '@/app/marketing/attribution/actions': { saveCampaign: async () => {}, setCampaignArchive: async () => {} },
};
Module._load = function(request, parent, isMain) { return request in mocks ? mocks[request] : originalLoad.call(this, request, parent, isMain); };
const campaignView = require(path.join(root, 'lib/campaign-view.ts'));
mocks['@/lib/campaign-view'] = campaignView;
mocks['@/lib/display-format'] = require(path.join(root, 'lib/display-format.ts'));
const CampaignForm = require(path.join(root, 'components/campaign-form.tsx')).CampaignForm;
mocks['@/components/campaign-form'] = { CampaignForm };
const Detail = require(path.join(root, 'app/marketing/campaigns/[id]/page.tsx')).default;
const Edit = require(path.join(root, 'app/marketing/campaigns/[id]/edit/page.tsx')).default;
const New = require(path.join(root, 'app/marketing/campaigns/new/page.tsx')).default;
const List = require(path.join(root, 'app/marketing/campaigns/page.tsx')).default;
Module._load = originalLoad;
Module._extensions['.ts'] = originalTs;
Module._extensions['.tsx'] = originalTsx;
const detail = async role => { effectiveRole = role; queryLog = []; return renderToStaticMarkup(await Detail({ params: Promise.resolve({ id: '5' }), searchParams: Promise.resolve({}) })); };
const list = async (role, filters = {}) => { effectiveRole = role; queryLog = []; return renderToStaticMarkup(await List({ searchParams: Promise.resolve(filters) })); };

test('Campaign list has compact responsive filters and preserves filter inputs', async () => {
  listRows = [{ ...campaign, _count: { influences: 2 } }];
  const html = await list('ADMIN', { q: 'FSTEC', status: 'ACTIVE', year: '2026', archived: 'true' });
  assert.match(html, /filter-grid campaign-filter-grid/);
  assert.match(html, /name="q"[^>]*value="FSTEC"/);
  assert.match(html, /name="status"[^>]*>.*?<option value="ACTIVE" selected="">Active<\/option>/);
  assert.match(html, /name="year"[^>]*value="2026"/);
  assert.match(html, /name="archived"[^>]*checked=""/);
  assert.match(html, /btn-filter-secondary campaign-filter-submit/);
  const where = queryLog.find(([name]) => name === 'campaignList')[1].where;
  assert.deepEqual(where, { archivedAt: { not: null }, name: { contains: 'FSTEC', mode: 'insensitive' }, status: 'ACTIVE', year: 2026 });
});

test('Campaign rows show friendly status, optional context, dates, and manager influence count', async () => {
  listRows = [
    { ...campaign, startDate: new Date('2026-10-05T00:00:00Z'), endDate: new Date('2026-10-30T00:00:00Z'), _count: { influences: 2 } },
    { ...campaign, id: 6, name: 'Archived campaign', status: 'COMPLETED', year: null, category: null, startDate: null, endDate: null, tradeShow: null, archivedAt: new Date('2026-11-01T00:00:00Z'), _count: { influences: 0 } },
  ];
  const html = await list('MARKETING_MANAGER');
  assert.match(html, /href="\/marketing\/campaigns\/5"[^>]*>FSTEC 2026<\/a>/);
  assert.match(html, /2026/); assert.match(html, />Active<\/span>/); assert.match(html, />Trade Show<\/span>/);
  assert.match(html, /Oct 5, 2026 – Oct 30, 2026/);
  assert.match(html, /2 active influences/);
  assert.match(html, /Archived<\/span>/);
  assert.doesNotMatch(html.slice(html.indexOf('<ul class="panel')), /\bACTIVE\b|\bCOMPLETED\b/);
  const archivedRow = [...html.matchAll(/<li[^>]*>[\s\S]*?<\/li>/g)].map(match => match[0]).find(row => row.includes('Archived campaign'));
  assert.ok(archivedRow);
  assert.doesNotMatch(archivedRow, /Trade Show:|Oct|2026 –|undefined|null/);
  const viewerHtml = await list('READ_ONLY');
  assert.doesNotMatch(viewerHtml, /active influences|New Campaign|Lead Sources/);
});

test('Campaign list empty states and management actions respect the effective user', async () => {
  listRows = []; campaignTotal = 1;
  assert.match(await list('ADMIN', { q: 'missing' }), /No Campaigns match the current filters/);
  campaignTotal = 0;
  const manager = await list('MARKETING_MANAGER');
  assert.match(manager, /Create the first Campaign to begin tracking Marketing influence/);
  assert.match(manager, /New Campaign/); assert.match(manager, /Lead Sources/);
  for (const role of ['SALES', 'SALES_MANAGER', 'READ_ONLY']) {
    const html = await list(role);
    assert.match(html, /No Campaigns yet/);
    assert.doesNotMatch(html, /Create the first Campaign|New Campaign|Lead Sources/);
  }
});

test('saved Campaign detail is read-only; only Marketing and Admin can edit', async () => {
  for (const role of ['ADMIN', 'MARKETING_MANAGER', 'SALES', 'SALES_MANAGER', 'READ_ONLY']) {
    const html = await detail(role);
    assert.match(html, /FSTEC 2026/);
    assert.match(html, /Campaign Details/);
    assert.match(html, /Active/);
    assert.doesNotMatch(html, /<input[^>]*name="name"|<textarea/);
    assert.equal(html.includes('Edit Campaign'), ['ADMIN', 'MARKETING_MANAGER'].includes(role));
    assert.equal(html.includes('Archive Campaign'), ['ADMIN', 'MARKETING_MANAGER'].includes(role));
  }
});

test('summary, related Trade Show, influence context, voided state, and empty states render without raw values', async () => {
  let html = await detail('ADMIN');
  assert.match(html, /Trade Show Leads.*1/); assert.match(html, /Active Influences.*1/);
  assert.match(html, /href="\/trade-shows\/3"/);
  assert.match(html, /Ada Lovelace/); assert.match(html, /Trade Show import/); assert.match(html, /Captured by Mia Chen/);
  assert.doesNotMatch(html, /TRADE_SHOW_IMPORT|\bACTIVE\b|rawSourceData|metadata/);
  rows = [{ ...touch, voidedAt: new Date('2026-10-04T12:00:00Z') }];
  html = await detail('ADMIN'); assert.match(html, /Voided/);
  rows = []; count = { lead: 0, contact: 0, opportunity: 0, active: 0 };
  html = await detail('READ_ONLY');
  assert.match(html, /No Campaign Influences have been recorded yet/);
  assert.match(html, /No Contacts are currently influenced by this Campaign/);
  assert.match(html, /No Opportunities are currently influenced by this Campaign/);
});

test('influence and related record queries are bounded and respect Sales scope', async () => {
  rows = [touch]; count = { lead: 1, contact: 0, opportunity: 0, active: 1 };
  await detail('SALES');
  const influence = queryLog.find(([name]) => name === 'influences')[1];
  assert.equal(influence.take, 21);
  assert.match(JSON.stringify(influence.where), /assignedSalesRepUserId/);
  assert.match(JSON.stringify(queryLog.find(([name]) => name === 'leadCount')[1]), /assignedSalesRepUserId/);
  assert.match(JSON.stringify(queryLog.find(([name]) => name === 'opportunityCount')[1]), /ownerId/);
  await detail('READ_ONLY');
  assert.doesNotMatch(JSON.stringify(queryLog.find(([name]) => name === 'influences')[1]), /assignedSalesRepUserId/);
});

test('Marketing Manager can follow Campaign Contact and Opportunity influences', async () => {
  rows = [
    { ...touch, id: 21, tradeShowLead: null, contact: { id: 21, firstName: 'Ada', lastName: 'Lovelace' } },
    { ...touch, id: 22, tradeShowLead: null, opportunity: { id: 12, name: 'New rollout', ownerId: 8 } },
  ];
  count = { lead: 0, contact: 1, opportunity: 1, active: 2 };
  const html = await detail('MARKETING_MANAGER');
  assert.match(html, /href="\/contacts\/21"/);
  assert.match(html, /href="\/opportunities\/12"/);
  assert.ok(queryLog.some(([name]) => name === 'opportunities'));
});

test('create and edit forms stay editable with friendly labels and edit Cancel returns to detail', async () => {
  effectiveRole = 'MARKETING_MANAGER';
  const editHtml = renderToStaticMarkup(await Edit({ params: Promise.resolve({ id: '5' }) }));
  assert.match(editHtml, /name="name"/); assert.match(editHtml, /name="category"/);
  assert.match(editHtml, /<option value="ACTIVE" selected="">Active<\/option>/);
  assert.match(editHtml, /href="\/marketing\/campaigns\/5"[^>]*>Cancel/);
  const newHtml = renderToStaticMarkup(await New());
  assert.match(newHtml, /Create Campaign/); assert.match(newHtml, /name="description"/);
  effectiveRole = 'SALES';
  await assert.rejects(Edit({ params: Promise.resolve({ id: '5' }) }), /NOT_FOUND/);
  await assert.rejects(New(), /NOT_FOUND/);
});

test('Campaign routes expose read pages without granting mutations', () => {
  for (const role of ['ADMIN', 'MARKETING_MANAGER', 'SALES', 'SALES_MANAGER', 'READ_ONLY']) {
    const viewer = { id: 7, role, active: true, archivedAt: null };
    assert.equal(authorization.routeAccess('/marketing/campaigns', viewer), 'allowed');
    assert.equal(authorization.routeAccess('/marketing/campaigns/5', viewer), 'allowed');
    assert.equal(authorization.routeAccess('/marketing/campaigns/5/edit', viewer), ['ADMIN', 'MARKETING_MANAGER'].includes(role) ? 'allowed' : 'denied');
    assert.equal(authorization.routeAccess('/marketing/campaigns/new', viewer), ['ADMIN', 'MARKETING_MANAGER'].includes(role) ? 'allowed' : 'denied');
  }
});
