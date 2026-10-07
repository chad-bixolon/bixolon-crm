import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function pages(directory = 'app') {
  return readdirSync(new URL(`../${directory}/`, import.meta.url), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? pages(path) : entry.name === 'page.tsx' ? [path] : [];
  });
}
const categories = {
  accounts: 'crm', contacts: 'crm',
  opportunities: 'sales', pipeline: 'sales', 'sales-plan': 'sales', tasks: 'sales',
  'calendar-matches': 'sales', demos: 'sales', activities: 'sales', notes: 'sales',
  projects: 'programs',
  'trade-shows': 'marketing', marketing: 'marketing',
  products: 'catalogPricing', 'price-exceptions': 'catalogPricing',
  reports: 'reports', administration: 'administration',
};

test('primary module page headers use the sidebar category, including subpages', () => {
  const embeddedHeaders = [
    'app/products/[id]/product-details.tsx',
    ...readdirSync(new URL('../app/reports/new/', import.meta.url))
      .filter(name => name.endsWith('-builder.tsx'))
      .map(name => `app/reports/new/${name}`),
  ];
  for (const file of [...pages(), ...embeddedHeaders]) {
    const section = file.split('/')[1];
    const category = categories[section];
    if (!category) continue;
    const source = read(file);
    const headers = source.match(/<PageHeader\b/g) ?? [];
    if (!headers.length) continue;
    assert.equal((source.match(/eyebrow=/g) ?? []).length, headers.length, `${file} has a category on every header`);
    assert.ok(source.includes(`NAV_CATEGORIES.${category}`), `${file} uses ${category}`);
    assert.ok(!/eyebrow="/.test(source), `${file} has no separate literal category`);
  }
});

test('shared section labels match the primary sidebar and preserve personal exceptions', () => {
  const labels = read('lib/navigation-categories.ts');
  const shell = read('components/shell.tsx');
  for (const [key, value] of Object.entries({ crm: 'CRM', sales: 'Sales', programs: 'Programs', marketing: 'Marketing', catalogPricing: 'Catalog & Pricing', reports: 'Reports', administration: 'Administration' })) {
    assert.ok(labels.includes(`${key}: '${value}'`));
    assert.ok(shell.includes(`label: NAV_CATEGORIES.${key}`));
  }
  assert.match(read('app/page.tsx'), /eyebrow="BIXOLON SalesHub" title="Dashboard"/);
  assert.match(read('app/my-integrations/page.tsx'), /eyebrow="Personal integrations"/);
  assert.match(read('app/notifications/page.tsx'), /eyebrow="Personal attention queue"/);
});
