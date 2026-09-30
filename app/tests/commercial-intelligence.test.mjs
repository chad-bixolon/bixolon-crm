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
const competitors = require(path.join(root, 'lib/competitors.ts'));
const opportunities = require(path.join(root, 'lib/opportunities.ts'));
const drafts = require(path.join(root, 'lib/opportunity-draft.ts'));
const reporting = require(path.join(root, 'lib/reporting.ts'));
const builder = require(path.join(root, 'lib/report-builder.ts'));
const { routeAccess } = require(path.join(root, 'lib/authorization.ts'));
const form = entries => { const result = new FormData(); for (const [key, value] of entries) result.append(key, value); return result; };

test('create and edit Customer Context uses a responsive two-column layout in field order', () => {
  const source = fs.readFileSync(path.join(root, 'components/opportunity-form.tsx'), 'utf8');
  const context = source.slice(source.indexOf('<section><h2 className="mb-3 text-lg font-semibold">Customer Context</h2>'), source.indexOf('<section><h2 className="mb-3 text-lg font-semibold">Projects</h2>'));
  assert.match(context, /grid min-w-0 gap-4 sm:grid-cols-2/);
  assert.match(context, /min-w-0 space-y-4/);
  assert.match(context, /flex min-w-0 flex-col/);
  assert.deepEqual([...context.matchAll(/<label className="label" htmlFor="([^"]+)">/g)].map(match => match[1]), ['competitorId', 'currentProductBeingUsed', 'competitivePricing', 'customerPainPoints']);
  assert.match(context, /htmlFor="currentProductBeingUsed">Competitive Model<\/label>/);
  assert.doesNotMatch(context, /Current Product Being Used/);
  assert.match(context, /field min-h-20 flex-1 resize-y/);
  for (const page of ['app/opportunities/new/page.tsx', 'app/opportunities/[id]/edit/page.tsx']) {
    assert.match(fs.readFileSync(path.join(root, page), 'utf8'), /<OpportunityForm/);
  }
});

test('admin competitor lifecycle trims, rejects blank and duplicate names, renames and deactivates without deleting', async () => {
  assert.throws(() => competitors.parseCompetitor(form([['name', '  '], ['sortOrder', '0']])), /Name is required/);
  const rows = [{ id: 1, name: 'Zebra', active: true, sortOrder: 0 }];
  const client = { competitorOption: {
    findFirst: async ({ where }) => rows.find(row => row.name.toLowerCase() === where.name.equals.toLowerCase() && row.id !== where.id?.not) ?? null,
    create: async ({ data }) => { const row = { ...data, id: rows.length + 1 }; rows.push(row); return row; },
    update: async ({ where, data }) => Object.assign(rows.find(row => row.id === where.id), data),
  } };
  await assert.rejects(competitors.saveCompetitor(client, { name: 'zebra', active: true, sortOrder: 0 }), /already exists/);
  const created = await competitors.saveCompetitor(client, competitors.parseCompetitor(form([['name', ' Epson '], ['sortOrder', '2'], ['active', 'on']])));
  assert.equal(created.name, 'Epson');
  await competitors.saveCompetitor(client, { name: 'Epson POS', active: true, sortOrder: 1 }, created.id);
  assert.equal(rows[1].name, 'Epson POS');
  await competitors.saveCompetitor(client, { name: 'Epson POS', active: false, sortOrder: 1 }, created.id);
  assert.equal(rows[1].active, false);
  assert.equal(routeAccess('/administration/competitors', { id: 4, role: 'SALES', active: true }), 'denied');
});

test('opportunity fields parse, clear, and filter without changing ownership scope', () => {
  const base = [['name', 'Fleet'], ['stageId', '1'], ['currencyCode', 'USD'], ['accountId', '11'], ['participantRoles', 'END_USER']];
  const filled = opportunities.parseOpportunity(form([...base, ['competitorId', '3'], ['currentProductBeingUsed', ' Zebra ZT411 '], ['competitivePricing', ' $399 + service '], ['customerPainPoints', 'Slow labels\nHigh maintenance']]));
  assert.equal(filled.value.competitorId, 3);
  assert.equal(filled.value.currentProductBeingUsed, 'Zebra ZT411');
  assert.equal(filled.value.competitivePricing, '$399 + service');
  assert.equal(filled.value.customerPainPoints, 'Slow labels\nHigh maintenance');
  const cleared = opportunities.parseOpportunity(form(base));
  assert.equal(cleared.value.competitorId, null);
  assert.equal(cleared.value.currentProductBeingUsed, null);
  assert.equal(cleared.value.competitivePricing, null);
  assert.equal(cleared.value.customerPainPoints, null);
  assert.equal(opportunities.parseOpportunity(form([...base, ['competitivePricing', ' '.repeat(501)]])).value.competitivePricing, null);
  assert.ok(opportunities.parseOpportunity(form([...base, ['competitivePricing', 'x'.repeat(501)]])).errors.competitivePricing);
  assert.equal(opportunities.parseOpportunity(form([...base, ['competitorId', 'bad']])).errors.competitorId, 'Choose a valid competitor.');
  assert.equal(opportunities.opportunityWhere({ competitorId: '3' }).competitorId, 3);
  assert.equal(opportunities.opportunityWhere({ competitorId: '3' }).ownerId, undefined);
});

test('new Opportunity options request only active competitors', async () => {
  let competitorQuery, stageQuery, currencyQuery;
  const client = {
    account: { findMany: async () => [] }, user: { findMany: async () => [] }, salesStage: { findMany: async query => { stageQuery = query; return []; } },
    currency: { findMany: async query => { currencyQuery = query; return []; } }, product: { count: async () => 0 }, project: { findMany: async () => [] },
    productCategory: { findMany: async () => [] }, competitorOption: { findMany: async query => { competitorQuery = query; return [{ id: 1, name: 'Zebra', active: true }]; } },
  };
  const options = await opportunities.opportunityOptions(client);
  assert.deepEqual(competitorQuery.where, { active: true });
  assert.deepEqual(options.competitors.map(option => option.name), ['Zebra']);
  assert.deepEqual(stageQuery.select, { id: true, name: true, probability: true, isClosed: true, isWon: true });
  assert.deepEqual(currencyQuery.select, { code: true, name: true });
});

test('new selection requires active competitor; an existing inactive selection can be retained or cleared', async () => {
  let saved;
  const existing = { id: 5, archivedAt: null, competitorId: 3, projects: [] };
  const tx = {
    opportunity: { findUnique: async () => existing, update: async ({ data }) => { saved = data; } },
    competitorOption: { findUnique: async ({ where }) => ({ id: where.id, active: false }) },
    salesStage: { findUnique: async () => ({ active: true, isClosed: false }) },
    currency: { findUnique: async () => ({ active: true }) },
    account: { findMany: async () => [{ id: 11 }] }, product: { findMany: async () => [] }, project: { findMany: async () => [] },
    opportunityAccount: { findMany: async () => [{ accountId: 11, roles: [{ role: 'END_USER' }] }], upsert: async () => {} }, opportunityAccountRole: { deleteMany: async () => {}, create: async () => {} }, opportunityProduct: { findMany: async () => [] },
  };
  const client = { $transaction: async fn => fn(tx) };
  const input = { name: 'Fleet', description: null, competitorId: 3, currentProductBeingUsed: 'ZT411', competitivePricing: 'Estimated $450–$500', customerPainPoints: 'Slow labels', ownerId: null, projectIds: [], stageId: 1, expectedCloseDate: null, probability: null, forecastCategory: null, currencyCode: 'USD', participants: [{ accountId: 11, roles: ['END_USER'] }], lines: [] };
  await opportunities.saveOpportunity(client, input, 5);
  assert.equal(saved.competitorId, 3);
  assert.equal(saved.currentProductBeingUsed, 'ZT411');
  assert.equal(saved.competitivePricing, 'Estimated $450–$500');
  assert.equal(saved.customerPainPoints, 'Slow labels');
  await opportunities.saveOpportunity(client, { ...input, competitorId: null }, 5);
  assert.equal(saved.competitorId, null);
  await opportunities.saveOpportunity(client, { ...input, competitivePricing: null }, 5);
  assert.equal(saved.competitivePricing, null);
  await assert.rejects(opportunities.saveOpportunity(client, input), /available competitor/);
});

test('draft and saved Pipeline report reopen with competitor selection and grouping', async () => {
  const blank = { name: '', description: '', competitorId: '', currentProductBeingUsed: '', competitivePricing: '', customerPainPoints: '', ownerId: '', stageId: '', expectedCloseDate: '', probability: '', forecastCategory: '', currencyCode: 'USD', projectIds: [], participants: [], lines: [] };
  const restored = drafts.readDraft(JSON.stringify({ ...blank, competitorId: '3', currentProductBeingUsed: 'ZT411', competitivePricing: '$425', customerPainPoints: 'Slow labels' }), blank);
  assert.equal(restored.competitorId, '3');
  assert.equal(restored.currentProductBeingUsed, 'ZT411');
  assert.equal(restored.competitivePricing, '$425');
  assert.equal(restored.customerPainPoints, 'Slow labels');
  const legacyDraft = { ...blank, currentProductBeingUsed: 'Existing model' };
  delete legacyDraft.competitivePricing;
  assert.equal(drafts.readDraft(JSON.stringify(legacyDraft), blank).currentProductBeingUsed, 'Existing model');
  assert.equal(drafts.readDraft(JSON.stringify(legacyDraft), blank).competitivePricing, '');
  assert.equal(drafts.readDraft(JSON.stringify({ ...blank, competitorId: 'bad' }), blank), blank);
  const config = builder.pipelineConfigFromParams({ configured: '1', competitorId: '3', groupBy: 'competitor' });
  assert.deepEqual(builder.pipelineConfigFromParams({}, JSON.parse(JSON.stringify(config))), config);
  let query;
  await reporting.executePipelineReport({ opportunity: { findMany: async args => { query = args; return []; } } }, { id: 7, role: 'SALES', active: true }, config);
  assert.equal(query.where.AND.some(clause => clause.competitorId === 3), true);
  assert.equal(query.where.AND.some(clause => clause.ownerId === 7), true);
  assert.equal(query.include.competitor, true);
  const deal = { id: 9, name: 'Fleet', currencyCode: 'USD', probability: null, stage: { probability: 40 }, competitorId: 3, competitor: { id: 3, name: 'Epson POS', active: false }, ownerId: 7, owner: null, participants: [], products: [], projects: [], expectedCloseDate: null };
  const grouped = await reporting.executePipelineReport({ opportunity: { findMany: async () => [deal] } }, { id: 7, role: 'SALES', active: true }, config);
  assert.equal(grouped.groups[0].label, 'Epson POS');
  assert.deepEqual(grouped.groups[0].opportunityIds, [9]);
  const project = builder.projectInitiativeConfigFromParams({ configured: '1', competitorId: '3' });
  const priceException = builder.priceExceptionUsageConfigFromParams({ configured: '1', competitorId: '3' });
  assert.equal(project.filters.find(filter => filter.field === 'competitorId').value, 3);
  assert.equal(priceException.filters.find(filter => filter.field === 'competitorId').value, 3);
  assert.deepEqual(builder.projectInitiativeConfigFromParams({}, JSON.parse(JSON.stringify(project))), project);
  assert.deepEqual(builder.priceExceptionUsageConfigFromParams({}, JSON.parse(JSON.stringify(priceException))), priceException);
});
