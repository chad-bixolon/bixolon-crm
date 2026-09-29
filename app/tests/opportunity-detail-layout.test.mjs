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
const pageMocks = {
  'next/link': Link,
  'next/navigation': { notFound: () => { throw new Error('Not found'); } },
  '@/components/shell': { Content: ({ children }) => React.createElement('main', null, children), PageHeader: ({ title }) => React.createElement('header', null, title) },
  '@/components/crm-state-control': { CrmStateControl: () => null },
  '@/lib/crm-validation': { forecastLabels: {}, opportunityPartyLabels: () => ({}) },
  '@/lib/configuration': { getLabels: async () => ({}) },
  '@/lib/opportunities': { lineTotal: () => 0, opportunityTotal: () => 0, weightedValue: () => 0 },
  '@/lib/prisma': { prisma: {
    opportunity: { findUnique: async () => opportunity },
    demoRequest: { findMany: async query => query.where.opportunityId === null ? demoOptions : demos },
    activity: { findFirst: async () => null },
  } },
  '@/components/related-work': { RelatedWork: ({ kind }) => React.createElement('section', null, kind) },
  '@/lib/engagement': { daysSince: () => null },
  '@/lib/display-format': { formatCurrency: () => '$0' },
  '@/lib/current-user': { currentUser: async () => actor },
  '@/lib/price-exception-visibility': { canViewPriceException: () => false },
  '@/components/save-success': { SaveSuccess: () => null },
  '@/lib/save-feedback': { saveFeedbackMessage: () => null },
  '@/components/documents-section': { DocumentsSection: ({ compact }) => React.createElement('section', { id: 'documents', 'data-compact': compact }, 'Documents') },
  '@/components/demo-list': { DemoList: ({ rows, empty, compact }) => React.createElement('div', { 'data-compact': compact }, rows.length ? rows.map(row => row.demoNumber).join(', ') : empty) },
  '@/lib/demo-operations': { demoSummary: () => ({ outstanding: 0 }) },
  '@/lib/demos': { demoLabel: row => row.demoNumber },
  '@/lib/authorization': { can: () => true },
  '@/app/demos/actions': { linkDemoFromOpportunity: () => async () => {}, updateDemoContext: () => async () => {} },
};
Module._load = function(specifier, parent, isMain) { return specifier in pageMocks ? pageMocks[specifier] : originalLoad.call(this, specifier, parent, isMain); };
const OpportunityPage = require(path.join(root, 'app/opportunities/[id]/page.tsx')).default;
Module._load = originalLoad;

function fixture(projects = []) {
  return { id: 7, name: 'Expansion', ownerId: 1, owner: null, archivedAt: null, stage: { name: 'Open', probability: 50, isClosed: false },
    probability: null, products: [], projects, contacts: [], participants: [], competitor: null, originatingTradeShowLead: null,
    currencyCode: 'USD', forecastCategory: null, expectedCloseDate: null, description: null, currentProductBeingUsed: null, customerPainPoints: null };
}
async function render() { return renderToStaticMarkup(await OpportunityPage({ params: Promise.resolve({ id: '7' }), searchParams: Promise.resolve({}) })); }

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
  assert.match(empty, /grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3/);
  assert.match(empty, /Opportunity Contacts \(0\).*No contacts linked\./);
  assert.match(empty, /Demos \(0\).*No demos linked\./);
  assert.match(empty, /data-compact="true"/);
  assert.match(empty, /tasks.*activities.*notes/);
  demos = [{ id: 2, demoNumber: 'DEMO-2', requestedById: 1, project: null }];
  demoOptions = [{ id: 3, demoNumber: 'DEMO-3', account: { name: 'Customer' } }];
  const linked = await render();
  assert.match(linked, /Unlink DEMO-2 from Opportunity/);
  assert.match(linked, /Choose an existing Demo/);
  assert.match(linked, /Link Demo/);
  demos = []; demoOptions = [];
});

const documentMocks = {
  'next/link': Link,
  '@prisma/client': { DocumentType: { OTHER: 'OTHER' } },
  '@/lib/prisma': { prisma: { document: { findMany: async () => documentRows } } },
  '@/lib/documents': { assertDocumentParentAccess: async () => {}, documentTypeLabels: { OTHER: 'Other' }, documentWhere: (_, archived) => ({ archived }) },
  './document-controls': { DocumentArchive: ({ archived }) => React.createElement('button', null, archived ? 'Restore' : 'Archive'), DocumentFeedback: () => null, DocumentUpload: () => React.createElement('button', null, 'Upload Document') },
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
  assert.match(empty, /Upload Document/);
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
