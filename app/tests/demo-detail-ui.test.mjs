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
const compile = (mod, filename, jsx) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx, esModuleInterop: true },
}).outputText, filename);
Module._extensions['.ts'] = (mod, filename) => compile(mod, filename, ts.JsxEmit.ReactJSX);
Module._extensions['.tsx'] = (mod, filename) => compile(mod, filename, ts.JsxEmit.ReactJSX);
const operations = require(path.join(root, 'lib/demo-operations.ts'));
const display = require(path.join(root, 'lib/demo-display.ts'));
let request;
let actor = { id: 1, role: 'SALES' };
Module._load = function(specifier, parent, isMain) {
  if (specifier === 'next/link') return function Link({ href, children, ...props }) { return React.createElement('a', { href, ...props }, children); };
  if (specifier === 'next/navigation') return { notFound: () => { throw new Error('Not found'); } };
  if (specifier === '@/components/shell') return { Content: ({ children }) => React.createElement('main', null, children), PageHeader: ({ title, action }) => React.createElement('header', null, React.createElement('h1', null, title), action) };
  if (specifier === '@/components/recoverable-action-form') return { RecoverableActionForm: ({ children, action, ...props }) => { void action; return React.createElement('form', props, children); } };
  if (specifier === '@/lib/current-user') return { requirePermission: async () => actor };
  if (specifier === '@/lib/prisma') return { prisma: { demoRequest: { findFirst: async () => request } } };
  if (specifier === '@/lib/authorization') return { can: () => false };
  if (specifier === '@/lib/demos') return { demoContextChoices: async () => ({ projects: [], opportunities: [] }), demoLabel: () => 'DEMO092326-3', demoReadWhere: () => ({}) };
  if (specifier === '@/lib/demo-display') return display;
  if (specifier === '@/lib/audit-display') return require(path.join(root, 'lib/audit-display.ts'));
  if (specifier === '@/lib/demo-operations') return operations;
  if (specifier === '../actions') return { deployDemoUnits() {}, recordDemoReturn() {}, updateDemoContext() {}, updateDemoExpectedReturn() {}, updateDemoNotes() {} };
  return originalLoad.call(this, specifier, parent, isMain);
};
const DemoPage = require(path.join(root, 'app/demos/[id]/page.tsx')).default;
const DemoList = require(path.join(root, 'components/demo-list.tsx')).DemoList;
Module._load = originalLoad;

const date = value => new Date(`${value}T00:00:00Z`);
const person = (firstName, lastName) => ({ firstName, lastName });
function fixture(changes = {}) {
  return {
    id: 1, accountId: 10, requestedById: 1, status: 'SHIPPED', account: { id: 10, name: 'CoreGroup' },
    project: null, opportunity: null, projectId: null, opportunityId: null,
    requestedAt: date('2026-09-23'), requestedBy: person('Blaise', 'Collura'),
    reviewedAt: date('2026-09-23'), reviewedBy: person('Mark', 'Hernandez'),
    shippedAt: date('2026-09-23'), shippedBy: null,
    durationValue: 6, durationUnit: 'month', shippingCarrier: 'UPS', carrierAccountNumber: '123',
    shippingAddress: '1 Main St', approvalComments: null, notes: null,
    expectedReturnOverrideAt: null, expectedReturnOverrideRecordedAt: null, expectedReturnOverrideBy: null, expectedReturnOverrideReason: null,
    sourceRequestId: 'source-1', sourceMethod: 'ROSA_CSV_IMPORT',
    items: [{ id: 1, sourceSku: 'BK3-L31bA', productSku: { partNumber: 'BK3-L31bA', product: { name: 'BK3-L31bA' } },
      quantity: 2, retiredAt: null, serialNumbers: ['USANNBKA26060001'], trackingNumbers: ['1Z123'], inventoryLocations: ['ERP-A'],
      units: [{ id: 1, ordinal: 1, serialNumber: 'USANNBKA26060001', status: 'DEPLOYED', deployedAt: date('2026-09-23'), returnedAt: null, inventoryLocation: 'ERP-A', returnEvents: [] },
        { id: 2, ordinal: 2, serialNumber: 'USANNBKA26060002', status: 'DEPLOYED', deployedAt: date('2026-09-23'), returnedAt: null, inventoryLocation: 'ERP-B', returnEvents: [] }] }],
    revisions: [{ id: 1, sourceFileName: 'demo.csv', createdAt: date('2026-09-23'), sourceTimestamp: date('2026-09-23'),
      contentHash: 'hash', sourceRowNumbers: [1], sourceRows: [{ 'Inventory Location': 'ERP-A' }],
      reviewedMappings: {}, resolvedHeader: {}, resolvedItems: [{ inventoryLocations: ['ERP-A'] }], recordedBy: person('Admin', 'User') }],
    ...changes,
  };
}
async function render(changes = {}, role = 'SALES') {
  actor = { id: 1, role };
  request = fixture(changes);
  return renderToStaticMarkup(await DemoPage({ params: Promise.resolve({ id: '1' }) }));
}

test('normal detail uses friendly dates, status, duration, and compact units without ERP locations', async () => {
  const html = await render();
  assert.match(html, /Status:<\/b> Shipped/);
  assert.match(html, /Project:<\/b> Not linked/);
  assert.match(html, /Opportunity:<\/b> Not linked/);
  assert.match(html, /Requested:<\/b> Sep 23, 2026 · Blaise Collura/);
  assert.match(html, /Reviewed:<\/b> Sep 23, 2026 · Mark Hernandez/);
  assert.match(html, /Shipped:<\/b> Sep 23, 2026<\/p>/);
  assert.match(html, /Duration:<\/b> 6 months/);
  assert.match(html, /Deployment status/);
  assert.match(html, /Requested.*?2.*?Deployed.*?2.*?Outstanding.*?2.*?Returned.*?0/);
  assert.match(html, /Expected return:<\/b> Mar 23, 2027/);
  assert.match(html, /BK3-L31bA.*?USANNBKA26060001 · Deployed Sep 23, 2026/);
  assert.match(html, /Serials: USANNBKA26060001/);
  assert.match(html, /Tracking: 1Z123/);
  assert.doesNotMatch(html, /Inventory locations|ERP-A|ERP-B|Originally calculated|Calculated expected return|Effective expected return|Approval comments|Opportunity result|by —|Not linked yet|6 month</);
  assert.doesNotMatch(html, /BK3-L31bA · BK3-L31bA/);
});

test('override, return, linked result, and populated comments display selectively', async () => {
  const base = fixture();
  const items = structuredClone(base.items);
  items[0].units[0].returnedAt = date('2026-09-30');
  items[0].units[0].status = 'RETURNED';
  const html = await render({ items, status: 'APPROVED', durationValue: 1, expectedReturnOverrideAt: date('2027-04-15'),
    opportunity: { id: 4, name: 'Renewal', stage: { isClosed: true, isWon: true } }, approvalComments: 'Looks good.' });
  assert.match(html, /Status:<\/b> Approved/);
  assert.match(html, /Duration:<\/b> 1 month/);
  assert.match(html, /Expected return:<\/b> Apr 15, 2027/);
  assert.match(html, /Originally calculated: Oct 23, 2026/);
  assert.match(html, /Opportunity result: Won/);
  assert.match(html, /Approval comments:<\/b> Looks good/);
  assert.match(html, /USANNBKA26060001 · Returned Sep 30, 2026/);
  assert.doesNotMatch(html, /ERP-A|ERP-B/);
});

test('admin source evidence retains inventory location while normal detail omits it', async () => {
  const html = await render({}, 'ADMIN');
  const [normal, evidence] = html.split('Source method:');
  assert.doesNotMatch(normal, /ERP-A|ERP-B|Inventory locations/);
  assert.match(evidence, /Inventory Location/);
  assert.match(evidence, /ERP-A/);
});

test('shared Account, Project, and Opportunity Demo list uses friendly wording without ERP locations', () => {
  const row = fixture();
  const html = renderToStaticMarkup(React.createElement(DemoList, { rows: [row] }));
  assert.match(html, /Shipped/);
  assert.match(html, /Sep 23, 2026/);
  assert.doesNotMatch(html, />SHIPPED<|ERP-A|ERP-B|Inventory locations/);
});

test('duration grammar covers weeks and plural months', () => {
  assert.equal(display.demoDuration(1, 'week'), '1 week');
  assert.equal(display.demoDuration(2, 'week'), '2 weeks');
  assert.equal(display.demoDuration(6, 'month'), '6 months');
});
