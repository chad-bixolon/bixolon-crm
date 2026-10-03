import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(fileURLToPath(import.meta.url));
const originalLoad = Module._load;
Module._extensions['.tsx'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
const Link = ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children);
const actor = { id: 1, role: 'ADMIN' };
let opportunity;
let demos = [];
let demoOptions = [];
let history = { rows: [], total: 0 };
const pageMocks = {
  'next/link': Link,
  'next/navigation': { notFound: () => { throw new Error('Not found'); } },
  '@/components/shell': { Content: ({ children }) => React.createElement('main', null, children), PageHeader: ({ title }) => React.createElement('header', null, title) },
  '@/components/crm-state-control': { CrmStateControl: () => null },
  '@/lib/crm-validation': { forecastLabels: { PIPELINE: 'Pipeline', BEST_CASE: 'Best Case', COMMIT: 'Commit' }, opportunityPartyLabels: () => ({}) },
  '@/lib/configuration': { getLabels: async () => ({}) },
  '@/lib/opportunities': { lineTotal: () => 0, opportunityTotal: () => 0, weightedValue: () => 0 },
  '@/lib/prisma': { prisma: {
    opportunity: { findUnique: async () => opportunity },
    opportunityHistoryEvent: { findFirst: async () => null },
    opportunityHistoryArchive: { findFirst: async () => null },
    projectUpdate: { findMany: async () => [] },
    project: { findMany: async () => [] },
    demoRequest: { findMany: async query => query.where.opportunityId === null ? demoOptions : demos },
    activity: { findFirst: async () => null },
  } },
  '@/components/related-work': { RelatedWork: ({ kind }) => React.createElement('section', null, kind) },
  '@/components/project-updates': { ProjectUpdates: () => React.createElement('section', null, 'Project Updates') },
  '@/lib/projects': { projectReadWhere: () => ({}), canEditProject: () => true },
  '@/lib/engagement': { daysSince: () => null },
  '@/lib/display-format': { formatCurrency: value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value) },
  '@/lib/current-user': { currentUser: async () => actor },
  '@/lib/price-exception-visibility': { canViewPriceException: () => false },
  '@/components/save-success': { SaveSuccess: () => null },
  '@/lib/save-feedback': { saveFeedbackMessage: () => null },
  '@/components/documents-section': { DocumentsSection: ({ compact }) => React.createElement('section', { id: 'documents', 'data-compact': compact }, 'Documents') },
  '@/components/demo-list': { DemoList: ({ rows, empty, compact }) => React.createElement('div', { 'data-compact': compact }, rows.length ? rows.map(row => row.demoNumber).join(', ') : empty) },
  '@/lib/demo-operations': { demoSummary: () => ({ outstanding: 0 }) },
  '@/lib/demos': { demoLabel: row => row.demoNumber },
  '@/lib/authorization': { can: () => true },
  '@/lib/opportunity-history': { opportunityHistory: async () => history, stageStartedAt: () => null },
  '@/lib/marketing-attribution': { opportunityAttribution: async () => ({ leadSource: null, influences: [] }) },
  '@/components/marketing-attribution-card': { MarketingAttributionCard: () => null },
  '@/app/demos/actions': { linkDemoFromOpportunity: () => async () => {}, updateDemoContext: () => async () => {} },
};
Module._load = function(specifier, parent, isMain) { return specifier in pageMocks ? pageMocks[specifier] : originalLoad.call(this, specifier, parent, isMain); };
const OpportunityPage = require(path.join(root, 'app/opportunities/[id]/page.tsx')).default;
Module._load = originalLoad;

function fixture(projects = []) {
  return { id: 7, name: 'Expansion', ownerId: 1, owner: null, archivedAt: null, stage: { name: 'Open', probability: 50, isClosed: false },
    probability: null, products: [], projects, contacts: [], participants: [], competitor: null, originatingTradeShowLead: null,
    currencyCode: 'USD', forecastCategory: null, expectedCloseDate: null, description: null, currentProductBeingUsed: null, competitivePricing: null, customerPainPoints: null };
}
async function render() { return renderToStaticMarkup(await OpportunityPage({ params: Promise.resolve({ id: '7' }), searchParams: Promise.resolve({}) })); }

test('Customer Context shows saved model and pricing, and hides blank pricing', async () => {
  opportunity = { ...fixture(), currentProductBeingUsed: 'Zebra ZT411', competitivePricing: '$399 + service', customerPainPoints: 'Slow labels\nHigh maintenance' };
  const filled = await render();
  assert.match(filled, /<dt class="label">Competitive Model<\/dt><dd[^>]*>Zebra ZT411<\/dd>/);
  assert.match(filled, /<dt class="label">Competitive Pricing<\/dt><dd[^>]*>\$399 \+ service<\/dd>/);
  assert.match(filled, /<dt class="label">Customer Pain Points<\/dt><dd[^>]*>Slow labels\nHigh maintenance<\/dd>/);
  assert.doesNotMatch(filled, /Current Product Being Used/);
  opportunity = fixture();
  assert.doesNotMatch(await render(), /Competitive Pricing/);
});

test('Opportunity summary links every Project and shows a single unlinked field when empty', async () => {
  opportunity = fixture([{ projectId: 12, project: { name: 'North rollout' } }, { projectId: 13, project: { name: 'South rollout' } }]);
  const linked = await render();
  assert.match(linked, /<dt class="label">Project<\/dt><dd>.*href="\/projects\/12".*>North rollout<\/a>.*href="\/projects\/13".*>South rollout<\/a>/);
  assert.equal((linked.match(/<dt class="label">Project<\/dt>/g) ?? []).length, 1);
  opportunity = fixture();
  assert.match(await render(), /<dt class="label">Project<\/dt><dd>Not linked<\/dd>/);
});

test('supporting cards keep compact states, grid breakpoints, and Demo link actions', async () => {
  opportunity = fixture(); demos = []; demoOptions = [];
  const empty = await render();
  assert.equal((empty.match(/grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3/g) ?? []).length, 1);
  assert.match(empty, /grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3 \[&amp;&gt;section\]:h-full/);
  assert.match(empty, /Opportunity Contacts \(0\).*No contacts linked\./);
  assert.match(empty, /Demos \(0\).*No demos linked\./);
  assert.match(empty, /data-compact="true"/);
  assert.match(empty, /Opportunity Contacts \(0\).*Demos \(0\).*id="documents".*tasks.*activities.*notes/);
  demos = [{ id: 2, demoNumber: 'DEMO-2', requestedById: 1, project: null }];
  demoOptions = [{ id: 3, demoNumber: 'DEMO-3', account: { name: 'Customer' } }];
  const linked = await render();
  assert.match(linked, /Unlink DEMO-2 from Opportunity/);
  assert.match(linked, /Choose an existing Demo/);
  assert.match(linked, /Link Demo/);
  demos = []; demoOptions = [];
});

test('Opportunity History uses business labels and local time after working sections', async () => {
  opportunity = fixture();
  history = { rows: [
    { id: 2, eventType: 'FORECAST_CATEGORY', oldCategory: 'PIPELINE', newCategory: 'BEST_CASE', occurredAt: new Date('2026-10-03T13:39:00Z'), actorName: 'Blaise Collura' },
    { id: 1, eventType: 'BASELINE', newStageName: 'Demo / POC', newCategory: 'PIPELINE', newValue: 126000, newCurrencyCode: 'USD', occurredAt: new Date('2026-10-03T13:38:00Z'), actorName: 'Blaise Collura' },
  ], total: 21 };
  const html = await render();
  assert.match(html, /<details(?![^>]*\bopen\b)[^>]*><summary[^>]*><h2[^>]*>Opportunity History<\/h2> <span[^>]*>\(21\)<\/span><\/summary>/);
  assert.match(html, /<summary[^>]*>.*?<\/summary><ul[^>]*>.*?Starting point.*?<\/ul>.*?<\/details>/);
  assert.match(html, /Starting point<\/div><div>Demo \/ POC · Pipeline · \$126,000\.00/);
  assert.match(html, /Forecast changed<\/div><div>Pipeline → Best Case/);
  assert.match(html, /Oct 3, 2026 at 9:38 AM · Blaise Collura/);
  assert.ok(html.indexOf('Products</h2>') < html.indexOf('Opportunity History</h2>'));
  assert.ok(html.indexOf('Project Updates') < html.indexOf('Opportunity History</h2>'));
  assert.match(html, /href="\/opportunities\/7\?historyPage=2"[^>]*>Older<\/a>/);
  assert.doesNotMatch(html, /History \/ Forecast History|Initial captured state|PIPELINE/);
  history = { rows: [], total: 0 };
});

test('close-date history highlights quarter and year movement only when the period changes', async () => {
  opportunity = fixture();
  const closeEvent = (id, oldDate, newDate) => ({ id, eventType: 'EXPECTED_CLOSE_DATE', oldCloseDate: oldDate && new Date(oldDate), newCloseDate: newDate && new Date(newDate), occurredAt: new Date('2026-10-03T13:38:00Z'), actorName: 'Blaise Collura' });
  history = { rows: [
    closeEvent(4, '2026-12-31T00:00:00Z', '2027-01-01T00:00:00Z'),
    closeEvent(3, '2026-03-31T00:00:00Z', '2026-04-01T00:00:00Z'),
    closeEvent(2, '2026-10-03T00:00:00Z', '2026-11-15T00:00:00Z'),
    closeEvent(1, null, '2026-10-03T00:00:00Z'),
  ], total: 4 };
  const html = await render();
  assert.match(html, /Dec 31, 2026 → Jan 1, 2027<\/div><div>Quarter moved: Q4 2026 → Q1 2027<\/div>/);
  assert.match(html, /Mar 31, 2026 → Apr 1, 2026<\/div><div>Quarter moved: Q1 2026 → Q2 2026<\/div>/);
  assert.match(html, /Oct 3, 2026 → Nov 15, 2026<\/div><div class="text-slate-500">/);
  assert.match(html, /— → Oct 3, 2026<\/div><div class="text-slate-500">/);
  assert.equal((html.match(/Quarter moved:/g) ?? []).length, 2);
  history = { rows: [], total: 0 };
});

const documentMocks = {
  'next/link': Link,
  '@prisma/client': { DocumentType: { OTHER: 'OTHER' } },
  '@/lib/prisma': { prisma: { document: { findMany: async () => documentRows } } },
  '@/lib/documents': { assertDocumentParentAccess: async () => {}, documentTypeLabels: { OTHER: 'Other' }, documentWhere: (_, archived) => ({ archived }) },
  './document-controls': { DocumentArchive: ({ archived }) => React.createElement('button', null, archived ? 'Restore' : 'Archive'), DocumentFeedback: () => null, DocumentUpload: () => React.createElement('button', null, 'Add document') },
};
let documentRows = [];
Module._load = function(specifier, parent, isMain) { return specifier in documentMocks ? documentMocks[specifier] : originalLoad.call(this, specifier, parent, isMain); };
const { DocumentsSection } = require(path.join(root, 'components/documents-section.tsx'));
Module._load = originalLoad;
async function renderDocuments(view) { return renderToStaticMarkup(await DocumentsSection({ parentType: 'opportunity', parentId: 7, actor, view, basePath: '/opportunities/7', compact: true })); }

test('compact Documents preserves upload, filters, open/archive/restore, and concise empty states', async () => {
  documentRows = [];
  const empty = await renderDocuments();
  assert.match(empty, /No documents uploaded\./);
  assert.match(empty, /Add document/);
  assert.match(fs.readFileSync(path.join(root, 'components/document-controls.tsx'), 'utf8'), /className="btn-primary" type="button"[^\n]*'Add document'/);
  assert.match(empty, /href="\/opportunities\/7#documents"/);
  assert.match(empty, /href="\/opportunities\/7\?documentsView=archived#documents"/);
  assert.match(await renderDocuments('archived'), /No documents archived\./);
  documentRows = [{ id: 8, originalFileName: 'Quote.pdf', description: null, documentType: 'OTHER', uploadedBy: { firstName: 'Ada', lastName: 'Lovelace' }, archivedBy: null, createdAt: new Date('2026-09-01'), archivedAt: null, fileSize: 1024 }];
  const active = await renderDocuments();
  assert.match(active, /Quote.pdf.*?Type:.*?Other.*?Uploaded By:.*?Ada Lovelace/);
  assert.match(active, /href="\/api\/documents\/8\/download"/);
  assert.match(active, /Archive/);
  documentRows[0].archivedAt = new Date('2026-09-02');
  const archived = await renderDocuments('archived');
  assert.match(archived, /href="\/api\/documents\/8\/download\?view=archived"/);
  assert.match(archived, /Restore/);
});

const demoMocks = {
  'next/link': Link,
  '@/lib/demos': { demoLabel: row => row.demoNumber },
  '@/lib/demo-display': { demoDisplayDate: date => date.toISOString().slice(0, 10), demoStatusLabel: status => status },
  '@/lib/demo-operations': { demoSummary: () => ({ total: 2, deployed: 2, outstanding: 1, returned: 1, expected: new Date('2026-10-01'), overdue: true, recoveryAttention: true }), opportunityResult: () => 'Open' },
};
Module._load = function(specifier, parent, isMain) { return specifier in demoMocks ? demoMocks[specifier] : originalLoad.call(this, specifier, parent, isMain); };
const { DemoList } = require(path.join(root, 'components/demo-list.tsx'));
Module._load = originalLoad;

test('compact Demo list retains detail links, deployment and return indicators', () => {
  assert.match(renderToStaticMarkup(React.createElement(DemoList, { rows: [], empty: 'No demos linked.', compact: true })), /No demos linked\./);
  const row = { id: 2, demoNumber: 'DEMO-2', status: 'SHIPPED', shippedAt: new Date('2026-09-01'), requestedBy: { firstName: 'Ada', lastName: 'Lovelace' },
    items: [{ sourceSku: 'SKU-1', productSku: null, retiredAt: null }], project: null, opportunity: { id: 7, name: 'Expansion' } };
  const html = renderToStaticMarkup(React.createElement(DemoList, { rows: [row], compact: true }));
  assert.match(html, /href="\/demos\/2".*DEMO-2/);
  assert.match(html, /Requested 2 · Deployed 2 · Outstanding 1 · Returned 1/);
  assert.match(html, /Shipped 2026-09-01 · Expected return 2026-10-01/);
  assert.match(html, /Overdue.*Return attention/);
  assert.match(html, /href="\/opportunities\/7"/);
});
