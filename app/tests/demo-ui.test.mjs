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
const queries = [];
let listRows = [];
let metricRows = [];
Module._extensions['.tsx'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
Module._load = function(request, parent, isMain) {
  if (request === 'next/link') return function Link({ href, children, ...props }) { return React.createElement('a', { href, ...props }, children); };
  if (request === '@/components/shell') return { Content: ({ children }) => React.createElement('main', null, children), PageHeader: ({ title, description, action }) => React.createElement('header', null, React.createElement('h1', null, title), React.createElement('p', null, description), action) };
  if (request === '@/lib/current-user') return { requirePermission: async permission => { assert.equal(permission, 'users.manage'); return { role: 'ADMIN' }; } };
  if (request === '@/lib/prisma') return { prisma: { demoRequest: { findMany: async query => { queries.push(query); return query.take ? listRows : metricRows; } } } };
  if (request === '@/lib/demo-operations') return { demoSummary: request => ({ open: request.open, overdue: request.overdue }) };
  return originalLoad.call(this, request, parent, isMain);
};
const DemosPage = require(path.join(root, 'app/demos/page.tsx')).default;
Module._load = originalLoad;

const row = (changes = {}) => ({ id: 1, demoNumber: 'DEMO092326-3', status: 'SHIPPED', account: { name: 'CoreGroup Displays' }, requestedBy: { firstName: 'Blaise', lastName: 'Collura' }, requestedAt: new Date('2026-09-23T00:00:00Z'), items: [{ sourceSku: 'BK3-31BA', quantity: 2 }], ...changes });
async function render(params = {}) { queries.length = 0; return renderToStaticMarkup(await DemosPage({ searchParams: Promise.resolve(params) })); }

test('Demo directory uses compact rows, source-neutral import copy, and friendly statuses', async () => {
  listRows = [row(), row({ id: 2, demoNumber: null, status: 'APPROVED', account: { name: 'DuraFast Label Company' }, requestedBy: { firstName: 'Amber', lastName: 'Zumbiel' }, requestedAt: new Date('2026-09-25T00:00:00Z'), items: [{ sourceSku: 'XD5-40dEK', quantity: 2 }, { sourceSku: 'XL5-40CtEG', quantity: 2 }] })];
  metricRows = [{ status: 'SHIPPED', open: true, overdue: true }, { status: 'APPROVED', open: false, overdue: false }];
  const html = await render({ q: '  BK3  ', status: 'APPROVED' });
  assert.match(html, /Track imported demo requests, shipment status, and deployed units/);
  assert.match(html, /href="\/administration\/imports\/demos"[^>]*>Import demos</);
  assert.match(html, /Search demo #, customer, requester, or SKU/);
  assert.match(html, /<span class="label">Status<\/span>/);
  assert.match(html, /Total demos.*?2.*?Open demos.*?1.*?Shipped.*?1.*?Overdue.*?1/);
  assert.match(html, /DEMO092326-3.*?CoreGroup Displays · Requested by Blaise Collura · Sep 23, 2026.*?BK3-31BA × 2.*?Shipped/);
  assert.match(html, /DuraFast Label Company.*?No demo number yet · Requested by Amber Zumbiel · Sep 25, 2026.*?XD5-40dEK × 2 · XL5-40CtEG × 2.*?Approved/);
  assert.match(html, /px-4 py-2\.5/);
  assert.doesNotMatch(html, /Pending Demo|Rosa|>SHIPPED<|>APPROVED</);
  assert.equal(queries[0].where.status, 'APPROVED');
  assert.equal(queries[0].where.OR[0].demoNumber.contains, 'BK3');
  assert.equal(queries[0].take, 200);
  assert.equal(queries[0].orderBy.requestedAt, 'desc');
});

test('Demo import headings and manual backfill copy omit Rosa while provenance remains', () => {
  const files = ['app/demos/page.tsx', 'app/administration/imports/page.tsx', 'app/administration/imports/demos/page.tsx', 'app/administration/imports/demos/backfill/page.tsx'];
  for (const file of files) assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /Rosa Demo|Rosa Request ID|Import Rosa|Rosa CSV|Rosa status|Rosa requester/);
  const backfill = fs.readFileSync(path.join(root, 'app/administration/imports/demos/backfill/page.tsx'), 'utf8');
  assert.match(backfill, /Source Request ID \*/);
  assert.match(backfill, /Use this only to add a Demo that already exists in the source system/);
  assert.match(fs.readFileSync(path.join(root, 'lib/demo-backfill.ts'), 'utf8'), /MANUAL_ROSA_BACKFILL/);
  assert.match(fs.readFileSync(path.join(root, 'app/demos/\[id\]/page.tsx'), 'utf8'), /Manual Rosa backfill/);
});
