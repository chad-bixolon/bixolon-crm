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
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const actor = role => ({ id: 1, role, active: true, archivedAt: null });
const { can, routeAccess } = require(path.join(root, 'lib/authorization.ts'));
let effective = actor('ADMIN');
const product = { id: 5, name: 'Printer', sku: 'P5', active: true, archivedAt: null, category: null, categoryId: null, skus: [{ id: 8, partNumber: 'P5-8', description: null, active: true, catalogSource: null, odmSubtype: null, odmCustomers: [], baseSku: null, prices: [] }] };
const originalLoad = Module._load;
const originalTsx = Module._extensions['.tsx'];
const originalCss = Module._extensions['.css'];
Module._extensions['.tsx'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
Module._extensions['.css'] = mod => { mod.exports = new Proxy({}, { get: (_, key) => String(key) }); };
Module._load = function(request, parent, isMain) {
  if (request === 'next/link') return function Link({ href, children, ...props }) { return React.createElement('a', { href, ...props }, children); };
  if (request === 'next/navigation') return { notFound: () => { throw new Error('not found'); }, redirect: href => { throw new Error(`redirect ${href}`); } };
  if (request === '@/components/shell') return { Content: ({ children }) => React.createElement('main', null, children), PageHeader: ({ title, action }) => React.createElement('header', null, React.createElement('h1', null, title), action) };
  if (request === '@/lib/current-user') return { requirePermission: async permission => { if (!can(effective, permission)) throw new Error('Access denied'); return effective; } };
  if (request === '@/lib/authorization') return { can };
  if (request === '@/lib/prisma') return { prisma: { product: { findUnique: async () => product } } };
  if (request === '@/lib/products') return { catalogSourceLabels: {}, listProducts: async () => ({ products: [product], count: 1, page: 1, pages: 1, priceExceptionsByProduct: new Map() }), productCategoryChoices: async () => [], productHref: () => '/products' };
  if (request === '@/lib/product-labels') return { odmSubtypeLabels: {} };
  if (request === '@/lib/price-exception-lookup') return { priceExceptionLookupHref: () => '/price-exceptions/lookup' };
  if (request === '@/lib/display-format') return { formatCurrency: value => String(value) };
  if (request === '@/components/crm-state-control') return { CrmStateControl: () => React.createElement('button', null, 'Deactivate'), ArchiveCrmControl: () => React.createElement('button', null, 'Archive') };
  if (request === '@/components/product-form') return { ProductForm: () => React.createElement('form', null, 'Save product') };
  if (request === '@/components/product-sku-form') return { ProductSkuForm: () => React.createElement('form', null, 'Save SKU') };
  if (request === '@/lib/product-serialization') return { serializeProductSku: sku => sku };
  if (request === './product-table-row' && parent?.filename.endsWith('/products/page.tsx')) return { ProductTableRow: ({ children }) => React.createElement('tr', null, children) };
  return originalLoad.call(this, request, parent, isMain);
};
const ProductsPage = require(path.join(root, 'app/products/page.tsx')).default;
const ProductPage = require(path.join(root, 'app/products/[id]/page.tsx')).default;
const EditPage = require(path.join(root, 'app/products/[id]/edit/page.tsx')).default;
const NewPage = require(path.join(root, 'app/products/new/page.tsx')).default;
const { ProductDetails } = require(path.join(root, 'app/products/[id]/product-details.tsx'));
Module._load = originalLoad;
Module._extensions['.tsx'] = originalTsx;
Module._extensions['.css'] = originalCss;

async function list(role) { effective = actor(role); return renderToStaticMarkup(await ProductsPage({ searchParams: Promise.resolve({}) })); }
async function detail(role) { effective = actor(role); await ProductPage({ params: Promise.resolve({ id: '5' }) }); return renderToStaticMarkup(await ProductDetails({ id: 5, manage: false })); }
async function edit(role) { effective = actor(role); await EditPage({ params: Promise.resolve({ id: '5' }) }); return renderToStaticMarkup(await ProductDetails({ id: 5, manage: true })); }

test('Product readers can open the list and detail without management actions', async () => {
  for (const role of ['SALES', 'SALES_MANAGER', 'READ_ONLY', 'MARKETING_MANAGER']) {
    const listHtml = await list(role);
    assert.match(listHtml, /Products/);
    assert.match(listHtml, /href="\/products\/5"/);
    assert.doesNotMatch(listHtml, /New product|Deactivate|>Action<|\/products\/5\/edit/);
    const detailHtml = await detail(role);
    assert.match(detailHtml, /Printer/);
    assert.doesNotMatch(detailHtml, /Save product|Add SKU|Edit SKU|Deactivate|Archive/);
  }
});

test('Admin keeps Product and SKU actions', async () => {
  assert.match(await list('ADMIN'), /New product/);
  assert.match(await list('ADMIN'), /Deactivate/);
  const html = await edit('ADMIN');
  assert.match(html, /Save product|Add SKU/);
  assert.match(html, /Edit SKU/);
  assert.match(html, /Deactivate/);
  assert.match(html, /Archive/);
});

test('create and edit routes and mutations retain Product write gates', async () => {
  for (const role of ['SALES', 'SALES_MANAGER', 'READ_ONLY', 'MARKETING_MANAGER']) {
    effective = actor(role);
    assert.equal(routeAccess('/products/new', effective), 'denied');
    assert.equal(routeAccess('/products/5/edit', effective), 'denied');
    await assert.rejects(NewPage(), /Access denied/);
    await assert.rejects(EditPage({ params: Promise.resolve({ id: '5' }) }), /Access denied/);
  }
  effective = actor('ADMIN');
  assert.equal(routeAccess('/products/new', effective), 'allowed');
  assert.equal(routeAccess('/products/5/edit', effective), 'allowed');
  const actions = fs.readFileSync(path.join(root, 'app/products/actions.ts'), 'utf8');
  assert.equal((actions.match(/await requireMutation\('products\.write'\)/g) || []).length, 3);
});

test('development impersonation uses the effective Sales permission', async () => {
  const { resolveUserContext } = require(path.join(root, 'lib/dev-impersonation.ts'));
  const real = { ...actor('ADMIN'), name: 'Admin', email: 'admin@example.com' };
  const client = { user: { findUnique: async () => ({ ...actor('SALES'), firstName: 'Sales', lastName: 'Rep', email: 'sales@example.com' }) } };
  const context = await resolveUserContext(real, '1', client, { NODE_ENV: 'development', ENABLE_DEV_IMPERSONATION: 'true' });
  assert.equal(context.impersonating, true);
  effective = context.effective;
  assert.doesNotMatch(renderToStaticMarkup(await ProductsPage({ searchParams: Promise.resolve({}) })), /New product|Deactivate/);
});
