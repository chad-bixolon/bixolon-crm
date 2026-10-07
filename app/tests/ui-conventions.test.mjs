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
