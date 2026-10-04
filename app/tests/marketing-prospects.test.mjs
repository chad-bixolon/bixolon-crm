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
const { leadSourcesReport, parseProspectFilters, canonicalProspects } = require(path.join(root, 'lib/marketing-prospects.ts'));
const { routeAccess } = require(path.join(root, 'lib/authorization.ts'));
const actor = role => ({ id: 7, role, active: true, archivedAt: null });
const sqlText = sql => sql.strings.join(' ');

test('canonical identity collapses linked leads before campaign and opportunity joins', () => {
  const sql = sqlText(canonicalProspects);
  assert.match(sql, /FROM "Contact" c/);
  assert.match(sql, /FROM "TradeShowLead" l[\s\S]*?WHERE l\."contactId" IS NULL/);
  assert.match(sql, /GROUP BY l\."contactId"/);
  assert.match(sql, /COUNT\(DISTINCT opportunity_id\)/);
  assert.match(sql, /BOOL_OR\(l\."leadSourceId" IS DISTINCT FROM c\."leadSourceId"\)/);
  assert.match(sql, /c\."leadSourceId" AS lead_source_id/);
  assert.match(sql, /COALESCE\(l\."capturedAt", l\."importedAt"\)/);
  assert.doesNotMatch(sql, /FROM "CampaignInfluence"/);
});

test('filters keep dates, canonical state, and page bounded', () => {
  const filters = parseProspectFilters({ from: '2026-09-01', to: '2026-09-30', leadSourceId: 'none', state: 'CONTACT', opportunity: 'YES', page: '999999' });
  assert.equal(filters.from.toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(filters.to.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(filters.noSource, true);
  assert.equal(filters.page, 10000);
  assert.equal(parseProspectFilters({ page: '-2', state: 'OPPORTUNITY' }).state, null);
});

test('group totals are independent of detail page and distinct influences or Opportunities', async () => {
  const seen = [];
  const db = { $queryRaw: async query => {
    seen.push(query);
    if (seen.length % 2 === 1) return [
      { lead_source_id: 1, lead_source: 'Events', unique_prospects: 3n, resolved_contacts: 1n, contact_only: 1n, unresolved_leads: 1n, with_opportunities: 1n, source_conflicts: 1n },
      { lead_source_id: null, lead_source: null, unique_prospects: 1n, resolved_contacts: 0n, contact_only: 1n, unresolved_leads: 0n, with_opportunities: 1n, source_conflicts: 0n },
    ];
    return Array.from({ length: 26 }, (_, index) => ({ canonical_id: index + 1 }));
  } };
  const result = await leadSourcesReport(db, actor('MARKETING_MANAGER'), { page: '2', campaignId: '5', opportunity: 'YES' });
  assert.deepEqual(result.summary, { uniqueProspects: 4, resolvedContacts: 1, contactOnly: 2, unresolvedLeads: 1, withOpportunities: 2, sourceConflicts: 1 });
  assert.equal(result.rows.length, 25);
  assert.equal(result.hasNext, true);
  assert.equal(result.groups[1].leadSource, 'Unspecified');
  const groupSql = sqlText(seen[0]), detailSql = sqlText(seen[1]);
  assert.match(groupSql, /COUNT\(\*\)::bigint AS unique_prospects/);
  assert.match(groupSql, /EXISTS \([\s\S]*?"CampaignInfluence" i/);
  assert.match(groupSql, /i\."voidedAt" IS NULL/);
  assert.match(detailSql, /LIMIT 26 OFFSET/);
  assert.match(detailSql, /STRING_AGG\(DISTINCT c\.name/);
  await leadSourcesReport(db, actor('ADMIN'), { page: '1' });
  assert.equal(seen.length, 4);
});

test('report remains confined to existing Marketing read scope', async () => {
  const db = { $queryRaw: async () => { throw new Error('should not query'); } };
  for (const role of ['MARKETING_MANAGER', 'ADMIN']) assert.equal(routeAccess('/reports/lead-sources', actor(role)), 'allowed');
  for (const role of ['SALES', 'SALES_MANAGER', 'READ_ONLY']) {
    assert.equal(routeAccess('/reports/lead-sources', actor(role)), 'denied');
    await assert.rejects(leadSourcesReport(db, actor(role), {}), /Access denied/);
  }
  assert.equal(routeAccess('/reports/lead-sources', { ...actor('ADMIN'), active: false }), 'denied');
  const page = fs.readFileSync(path.join(root, 'app/reports/lead-sources/page.tsx'), 'utf8');
  assert.match(page, /canViewMarketingReports\(actor\)/);
  assert.match(page, /Prospect detail/);
  assert.match(fs.readFileSync(path.join(root, 'app/reports/page.tsx'), 'utf8'), /href="\/reports\/lead-sources"/);
});

test('canonical SQL counts linked people and distinct Opportunities on read-only fixtures', { skip: !process.env.RUN_PROSPECT_SQL_TEST }, async () => {
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  const fixture = `WITH
    "Contact" AS (SELECT * FROM (VALUES
      (1, 'Ada', 'Lovelace', 2, TIMESTAMP '2026-09-10', NULL::integer, NULL::timestamp),
      (2, 'Grace', 'Hopper', 1, TIMESTAMP '2026-09-11', NULL::integer, NULL::timestamp)
    ) v(id, "firstName", "lastName", "leadSourceId", "createdAt", "accountId", "archivedAt")),
    "Account" AS (SELECT NULL::integer AS id, NULL::text AS name WHERE false),
    "TradeShowLead" AS (SELECT * FROM (VALUES
      (10, NULL::integer, 1, TIMESTAMP '2026-09-01', TIMESTAMP '2026-09-02', NULL::integer, NULL::integer, 'Unresolved', 'Person', NULL::text, NULL::integer),
      (11, 1, 1, TIMESTAMP '2026-09-03', TIMESTAMP '2026-09-04', NULL::integer, 100, 'Ada', 'Lovelace', NULL::text, NULL::integer),
      (12, 1, 2, TIMESTAMP '2026-09-05', TIMESTAMP '2026-09-06', NULL::integer, NULL::integer, 'Ada', 'Lovelace', NULL::text, NULL::integer),
      (13, 1, 2, TIMESTAMP '2026-09-07', TIMESTAMP '2026-09-08', NULL::integer, NULL::integer, 'Ada', 'Lovelace', NULL::text, NULL::integer)
    ) v(id, "contactId", "leadSourceId", "capturedAt", "importedAt", "assignedSalesRepUserId", "convertedOpportunityId", "firstName", "lastName", "sourceCompany", "accountId")),
    "Opportunity" AS (SELECT * FROM (VALUES (100, NULL::timestamp), (101, NULL::timestamp)) v(id, "archivedAt")),
    "OpportunityContact" AS (SELECT * FROM (VALUES (1, 100), (1, 101)) v("contactId", "opportunityId")),
    ${sqlText(canonicalProspects).replace(/^\s*WITH\s+/, '')}
    SELECT canonical_type, canonical_id, lead_source_id, source_conflict, opportunity_count, linked_leads
    FROM prospects ORDER BY canonical_type, canonical_id`;
  try {
    const rows = await db.$queryRawUnsafe(fixture);
    assert.deepEqual(rows.map(row => [row.canonical_type, row.canonical_id, row.lead_source_id, row.source_conflict, row.opportunity_count, row.linked_leads]), [
      ['CONTACT', 1, 2, true, 2, 3],
      ['CONTACT', 2, 1, false, 0, 0],
      ['UNRESOLVED_LEAD', 10, 1, false, 0, 0],
    ]);
  } finally { await db.$disconnect(); }
});
