import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const css = read('app/globals.css');

test('shared controls and button variants use the same sizing and visible states', () => {
  assert.match(css, /--control-height: 2\.5rem;/);
  assert.match(css, /--control-font-size: \.875rem;/);
  assert.match(css, /\.field:not\(textarea\):not\(\[type="file"\]\)\s*\{\s*height: var\(--control-height\)/);
  assert.match(css, /\.btn-primary, \.btn-filter-primary\s*\{[^}]*min-height: var\(--control-height\)/);
  assert.match(css, /\.btn-secondary, \.btn-filter-secondary\s*\{[^}]*min-height: var\(--control-height\)/);
  assert.match(css, /\.btn-danger\s*\{[^}]*min-height: var\(--control-height\)/);
  assert.match(css, /\.field:focus-visible/);
  assert.match(css, /\.btn-primary:disabled[^}]*background: #e2e8f0/);
});

test('integration, cleanup, and report controls use shared layout classes', () => {
  const integrations = read('app/my-integrations/page.tsx');
  assert.match(integrations, /action=\{saveMyTimeZone\} className="inline-field-action"/);
  assert.match(integrations, /className="form-action-row"/);
  const cleanup = read('app/administration/price-exceptions/workflow.tsx');
  assert.match(cleanup, /className="panel pe-cleanup-filter-grid filter-row"/);
  assert.match(cleanup, /className="field pe-cleanup-control"/);
  assert.match(cleanup, /className="btn-primary pe-cleanup-preview"/);
  const plan = read('app/reports/sales-plan/page.tsx');
  const sku = read('app/reports/sales-plan-sku/page.tsx');
  for (const source of [plan, sku]) {
    assert.match(source, /className="page-header-actions"/);
    assert.match(source, /filter-grid filter-row/);
    assert.match(source, /className="field filter-control"/);
    assert.match(source, /View report/);
  }
});

test('picker styling shares field typography while popover behavior remains covered separately', () => {
  assert.match(read('components/product-picker.tsx'), /role="combobox"/);
  assert.match(read('components/price-exception-account-picker.tsx'), /className="field min-w-0" role="combobox"/);
  assert.match(css, /\.search-results-option\s*\{[^}]*font-size: \.8125rem/);
  assert.match(read('components/search-results-popover.tsx'), /createPortal\(/);
});

test('save and filter actions use primary styling while close navigation is secondary', () => {
  assert.match(read('components/setting-form.tsx'), /<button className="btn-primary" disabled=\{pending\}>Save<\/button>/);
  assert.match(read('app/notifications/page.tsx'), /<button className="btn-primary">Apply<\/button>/);
  assert.match(read('app/price-exceptions/[id]/page.tsx'), /className=\{resolving\?'btn-secondary':'btn-primary'\}/);
});

test('System Settings keeps independent saves in compact labeled action rows', () => {
  const setting = read('components/setting-form.tsx');
  const page = read('app/administration/settings/page.tsx');
  assert.match(setting, /<form action=\{action\} className="py-3"/);
  assert.match(setting, /htmlFor=\{inputId\}/);
  assert.match(setting, /className="inline-field-action"/);
  assert.match(setting, /id=\{inputId\} className="field"/);
  assert.match(page, /className="panel max-w-3xl px-5 py-2"/);
});

test('import and product selects share control typography', () => {
  for (const file of ['app/administration/imports/workflow.tsx', 'app/administration/imports/products/workflow.tsx']) {
    assert.match(read(file), /<select className="field mt-1 max-w-xs"/);
  }
  assert.match(read('components/product-picker.tsx'), /id=\{`\$\{uid\}-tier`\} className="field max-w-full"/);
});

test('multi-action detail headers use the wrapping shared action group', () => {
  for (const file of ['app/accounts/[id]/page.tsx', 'app/contacts/[id]/page.tsx', 'app/projects/[id]/page.tsx', 'app/tasks/[id]/page.tsx', 'app/trade-shows/[id]/page.tsx']) {
    assert.match(read(file), /action=\{<div className="page-header-actions"/);
  }
});

test('product filters and mobile action groups use shared responsive structure', () => {
  const products = read('app/products/page.tsx');
  assert.match(products, /className="panel filter-panel filter-grid filter-row mb-4"/);
  assert.match(products, /className="field filter-control"/);
  assert.match(products, /className="filter-actions"/);
  assert.match(css, /\.page-header-actions \{ width: 100%; \}/);
  assert.match(css, /\.filter-actions \{ flex-wrap: wrap; width: 100%; \}/);
});
