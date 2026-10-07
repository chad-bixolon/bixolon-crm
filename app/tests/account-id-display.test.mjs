import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Account detail and list identify accounts by name while retaining ID routes', () => {
  const detail = read('app/accounts/[id]/page.tsx');
  const list = read('app/accounts/page.tsx');
  assert.match(detail, /<PageHeader eyebrow=\{NAV_CATEGORIES\.crm\} title=\{account\.name\} action=/);
  assert.match(list, /href=\{`\/accounts\/\$\{a\.id\}`\}>\{a\.name\}<\/Link>/);
  assert.match(detail, /href=\{`\/accounts\/\$\{id\}\/edit`\}/);
  assert.match(detail, /<RelatedWork accountId=\{id\}/);
});

test('business facing Account views have no numeric Account label', () => {
  const directories = ['app', 'components'];
  function visit(directory) {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (file.endsWith('.tsx')) {
        assert.doesNotMatch(read(file), /Account\s*#\s*\$?\{|Account\s*#\s*\d+|Account ID/, file);
      }
    }
  }
  for (const directory of directories) visit(directory);
  for (const file of ['lib/reporting.ts', 'lib/activity-contact-picker.ts']) {
    assert.doesNotMatch(read(file), /Account\s*#\s*\$?\{|Account\s*#\s*\d+/, file);
  }
});

test('Account relationship forms keep numeric values internal and show linked inactive Account names', () => {
  const opportunity = read('components/opportunity-form.tsx');
  const project = read('components/project-form.tsx');
  assert.match(opportunity, /type="hidden" name="accountId" value=\{p\.accountId\}/);
  assert.match(project, /type="hidden" name="accountId" value=\{p\.accountId\}/);
  for (const file of ['app/opportunities/[id]/edit/page.tsx', 'app/projects/[id]/edit/page.tsx']) {
    const source = read(file);
    assert.match(source, /linkedAccountIds/);
    assert.match(source, /select: \{ id: true, name: true \}/);
    assert.match(source, /account\.name/);
  }
});
