import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const require = Module.createRequire(fileURLToPath(import.meta.url));
const { contactDisplayName, contactDisplayContext } = require(path.join(root, 'lib/entity-display.ts'));
const { auditDisplayJson } = require(path.join(root, 'lib/audit-display.ts'));

test('Contact presentation prefers a name and business context, then email and a neutral fallback', () => {
  assert.equal(contactDisplayName({ firstName: 'Jane', lastName: 'Smith', email: 'jane@example.com' }), 'Jane Smith');
  assert.equal(contactDisplayContext({ account: { name: 'Stratix' }, email: 'jane@example.com' }), 'Stratix · jane@example.com');
  assert.equal(contactDisplayName({ email: 'jane@example.com' }), 'jane@example.com');
  assert.equal(contactDisplayName(null), 'Contact');
});

test('audit JSON displays relationship labels while preserving business identifiers', () => {
  const result = auditDisplayJson({ contactId: 99, ownerId: 3, selectedAccountId: 42, caseNumber: 'BXS-2026-000123', peCode: 'PE-2026-04', sku: 'XD5-40D' }, (key, id) => key === 'ownerId' && id === 3 ? 'Jane Smith' : undefined);
  assert.doesNotMatch(result, /99|42|ownerId": 3/);
  assert.match(result, /"contactId": "Contact"/);
  assert.match(result, /Jane Smith/);
  assert.match(result, /BXS-2026-000123|PE-2026-04|XD5-40D/);
});

test('operational UI does not compose surrogate IDs as entity labels', () => {
  const sources = [
    'app/contacts/[id]/page.tsx', 'components/activity-contact-picker.tsx', 'components/opportunity-form.tsx',
    'app/tasks/[id]/page.tsx', 'app/opportunities/[id]/page.tsx', 'app/accounts/[id]/page.tsx',
    'app/projects/[id]/page.tsx', 'app/calendar-matches/page.tsx', 'components/work-form.tsx',
    'app/support/cases/[id]/page.tsx', 'app/price-exceptions/[id]/page.tsx',
    'components/price-exception-follow-up-form.tsx', 'app/marketing/audiences/[id]/page.tsx',
  ];
  for (const source of sources) {
    const code = fs.readFileSync(path.join(root, source), 'utf8');
    assert.doesNotMatch(code, /(?:Contact|Task|Opportunity|Account|Project|Product|Activity|Support Case|User) #(?:\$\{|\{)/, source);
  }
  const support = fs.readFileSync(path.join(root, 'app/support/cases/[id]/page.tsx'), 'utf8');
  assert.match(support, /row\.caseNumber/);
  const priceException = fs.readFileSync(path.join(root, 'app/price-exceptions/[id]/page.tsx'), 'utf8');
  assert.match(priceException, /pe\.peCode/);
  assert.match(read('components/price-exception-follow-up-form.tsx'), /name="replacementPriceExceptionId"/);
  assert.match(read('components/audience-contact-picker.tsx'), /name="contactId"/);
});
