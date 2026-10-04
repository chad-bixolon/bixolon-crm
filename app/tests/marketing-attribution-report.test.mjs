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
const report = require(path.join(root, 'lib/marketing-attribution-report.ts'));
const reporting = require(path.join(root, 'lib/reporting.ts'));
const authorization = require(path.join(root, 'lib/authorization.ts'));
const actor = role => ({ id: 7, role, active: true, archivedAt: null });

test('Marketing reports use effective Marketing permissions without granting Sales reports', () => {
  for (const role of ['MARKETING_MANAGER', 'ADMIN']) assert.equal(report.canViewMarketingReports(actor(role)), true);
  for (const role of ['SALES', 'SALES_MANAGER', 'READ_ONLY']) assert.equal(report.canViewMarketingReports(actor(role)), false);
  assert.equal(report.canViewMarketingReports({ ...actor('ADMIN'), active: false }), false);
  assert.equal(reporting.canRunReportType(actor('MARKETING_MANAGER'), 'TRADE_SHOW'), true);
  assert.equal(reporting.canRunReportType(actor('MARKETING_MANAGER'), 'PIPELINE'), false);
  assert.equal(reporting.canRunReportType(actor('MARKETING_MANAGER'), 'PRICE_EXCEPTION_USAGE'), false);
  assert.equal(reporting.canRunReportType(actor('SALES'), 'PIPELINE'), true);
  assert.equal(reporting.canRunReportType(actor('ADMIN'), 'PIPELINE'), true);
  assert.equal(authorization.routeAccess('/reports/marketing-attribution', actor('MARKETING_MANAGER')), 'allowed');
  assert.equal(authorization.routeAccess('/reports/marketing-attribution', actor('SALES')), 'denied');
});

test('Attribution filters, counts, voided detail, and pagination stay server side', async () => {
  const queries = [];
  const rows = Array.from({ length: 26 }, (_, index) => ({ id: index + 1, voidedAt: index === 0 ? new Date() : null }));
  const db = {
    marketingCampaign: { count: async query => { queries.push(['campaigns', query]); return 3; } },
    $queryRaw: async query => { queries.push(['aggregate', query]); return [{ influences: 10n, contacts: 4n, opportunities: 2n, leads: 5n }]; },
    campaignInfluence: { findMany: async query => { queries.push(['detail', query]); return rows; } },
  };
  const result = await report.marketingAttributionReport(db, actor('MARKETING_MANAGER'), { campaignId: '12', leadSourceId: '8', campaignStatus: 'ACTIVE', recordType: 'OPPORTUNITY', ownerId: '4', from: '2026-09-01', to: '2026-09-30', q: 'Fall', page: '2' });
  assert.deepEqual(result.summary, { influences: 10, contacts: 4, opportunities: 2, leads: 5 });
  assert.equal(result.activeCampaigns, 3);
  assert.equal(result.rows.length, 25);
  assert.ok(result.rows[0].voidedAt);
  assert.equal(result.hasNext, true);
  const detail = queries.find(([kind]) => kind === 'detail')[1];
  assert.equal(detail.skip, 25); assert.equal(detail.take, 26);
  assert.deepEqual(detail.orderBy, [{ occurredAt: 'desc' }, { id: 'desc' }]);
  assert.match(JSON.stringify(detail.where), /campaignId|leadSourceId|status|opportunityId|ownerId|occurredAt|Fall/);
  assert.equal(queries.filter(([kind]) => kind === 'aggregate').length, 1);
  await assert.rejects(report.marketingAttributionReport(db, actor('SALES'), {}), /Access denied/);
});

test('Contact, Opportunity, and Trade Show influence types remain distinct', async () => {
  const seen = [];
  const db = {
    marketingCampaign: { count: async () => 0 },
    $queryRaw: async () => [{ influences: 0n, contacts: 0n, opportunities: 0n, leads: 0n }],
    campaignInfluence: { findMany: async query => { seen.push(query.where); return []; } },
  };
  for (const recordType of ['CONTACT', 'OPPORTUNITY', 'TRADE_SHOW_LEAD']) await report.marketingAttributionReport(db, actor('MARKETING_MANAGER'), { recordType });
  assert.match(JSON.stringify(seen[0]), /contactId/);
  assert.match(JSON.stringify(seen[1]), /opportunityId/);
  assert.match(JSON.stringify(seen[2]), /tradeShowLeadId/);
});

test('Report landing page groups Marketing reports without Sales-only links for Marketing', () => {
  const landing = fs.readFileSync(path.join(root, 'app/reports/page.tsx'), 'utf8');
  const detail = fs.readFileSync(path.join(root, 'app/reports/marketing-attribution/page.tsx'), 'utf8');
  assert.match(landing, /marketingReports&&<section/);
  assert.match(landing, /Trade Show Report/);
  assert.match(landing, /Marketing Attribution/);
  assert.match(landing, /actor\.role==='MARKETING_MANAGER'&&group\.title==='Trade Shows'/);
  assert.match(detail, /canViewMarketingReports\(actor\)/);
  assert.match(detail, /Voided/);
  assert.match(detail, /do not represent attributed revenue/);
  assert.doesNotMatch(detail, /ROI|first-touch revenue|last-touch revenue/i);
});
