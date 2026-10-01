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
const { opportunityWhere, listOpportunities } = require(path.join(root, 'lib/opportunities.ts'));

test('Opportunity search uses case-insensitive partial name, related competitor name, and Competitive Model', () => {
  for (const q of ['Zebra', 'ZT411', 'ZT41', 'Honeywell', 'PM45']) {
    const where = opportunityWhere({ q });
    const contains = { contains: q, mode: 'insensitive' };
    assert.deepEqual(where.OR, [{ name: contains }, { competitor: { is: { name: contains } } }, { currentProductBeingUsed: contains }]);
    assert.equal(where.archivedAt, null);
    assert.equal(where.stage, undefined);
  }
  assert.equal(opportunityWhere({ q: ' zebra ' }).OR[1].competitor.is.name.contains, 'zebra');
  assert.equal(opportunityWhere({ q: 'ZT41' }).OR[2].currentProductBeingUsed.contains, 'ZT41');
  assert.equal(opportunityWhere({ q: 'pricing' }).OR.some(clause => 'competitivePricing' in clause), false);
});

test('search keeps stage, competitor, owner, account, project, date, and archive filters', () => {
  const where = opportunityWhere({ q: 'zebra', stageId: '2', competitorId: '3', ownerId: '7', accountId: '11', projectId: 'none', closeFrom: '2026-01-01', closeTo: '2026-12-31', archived: 'all' });
  assert.equal(where.OR.length, 3);
  assert.equal(where.stageId, 2);
  assert.equal(where.competitorId, 3);
  assert.equal(where.ownerId, 7);
  assert.deepEqual(where.participants, { some: { accountId: 11 } });
  assert.deepEqual(where.projects, { none: {} });
  assert.equal(where.expectedCloseDate.gte.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(where.expectedCloseDate.lte.toISOString(), '2026-12-31T23:59:59.999Z');
  assert.equal('archivedAt' in where, false);
  assert.deepEqual(opportunityWhere({ q: 'ZT41', archived: 'yes' }).archivedAt, { not: null });
});

test('list search applies the same permission scope to count and rows, including closed stages and inactive competitors', async () => {
  const calls = [];
  const client = { opportunity: {
    count: async args => { calls.push(['count', args]); return 1; },
    findMany: async args => { calls.push(['rows', args]); return [{ id: 12, name: 'Past fleet', competitor: { name: 'Zebra', active: false }, currentProductBeingUsed: 'ZT411', competitivePricing: '$425', stage: { isClosed: true, isWon: false } }]; },
  } };
  const actor = { id: 7, role: 'SALES', active: true, archivedAt: null };
  const result = await listOpportunities(client, { q: 'zEbRa', stageId: '4' }, actor);
  assert.equal(result.opportunities[0].competitor.active, false);
  assert.equal(result.opportunities[0].stage.isClosed, true);
  assert.equal(result.opportunities[0].competitivePricing, '$425');
  assert.deepEqual(calls[0][1].where, calls[1][1].where);
  assert.deepEqual(calls[0][1].where.AND[1], { ownerId: 7 });
  assert.equal(calls[0][1].where.AND[0].stageId, 4);
  assert.deepEqual(calls[0][1].where.AND[0].OR[1], { competitor: { is: { name: { contains: 'zEbRa', mode: 'insensitive' } } } });
  assert.deepEqual(calls[1][1].include.competitor, true);
  assert.equal(calls[1][1].take, 20);
  await assert.rejects(listOpportunities(client, { q: 'Zebra' }, { ...actor, active: false }), /Access denied/);
  assert.equal(calls.length, 2);
});

test('Opportunity results keep links and expose historical competitive context and search empty state', () => {
  const page = fs.readFileSync(path.join(root, 'app/opportunities/page.tsx'), 'utf8');
  assert.match(page, /href={`\/opportunities\/\$\{o\.id\}`}/);
  assert.match(page, /Competitor:<\/span> \{o\.competitor\.name\}/);
  assert.match(page, /Competitive Model:<\/span> \{o\.currentProductBeingUsed\}/);
  assert.match(page, /Competitive Pricing:<\/span> \{o\.competitivePricing\}/);
  assert.match(page, /No opportunities match this search\./);
  assert.match(page, /name="q"/);
  assert.match(page, /linkFor\(page \+ 1\)/);
});
