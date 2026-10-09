import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(import.meta.url);
const { parseContact, saveContactRecord } = require(path.join(root, 'lib/contacts.ts'));
const { effectiveContactAddress, usesAccountAddress, sourceAddressDiffersFromAccount } = require(path.join(root, 'lib/address.ts'));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const blank = { addressLine1: null, addressLine2: null, city: null, stateProvince: null, postalCode: null, country: null };
const form = values => Object.entries(values).reduce((result, [key, value]) => { result.append(key, String(value)); return result; }, new FormData());

test('linked create defaults to Account address without copying fields; standalone accepts its own address', () => {
  const linked = parseContact(form({ accountId: 4, firstName: 'Ada', lastName: 'Lovelace', addressLine1: 'Unsubmitted street' })).value;
  assert.equal(linked.useAccountAddress, true);
  assert.equal(linked.addressLine1, null);
  const standalone = parseContact(form({ firstName: 'Ada', lastName: 'Lovelace', addressLine1: 'Home street' })).value;
  assert.equal(standalone.useAccountAddress, false);
  assert.equal(standalone.addressLine1, 'Home street');
});

test('different address overrides Account; legacy saved address remains different', () => {
  const contact = { ...blank, accountId: 4, useAccountAddress: null, addressLine1: 'Branch' };
  const account = { ...blank, addressLine1: 'HQ' };
  assert.equal(usesAccountAddress(contact), false);
  assert.equal(effectiveContactAddress({ ...contact, account }).addressLine1, 'Branch');
  const parsed = parseContact(form({ accountId: 4, firstName: 'Ada', lastName: 'Lovelace', addressMode: 'different', addressLine1: 'Other' })).value;
  assert.equal(parsed.useAccountAddress, false);
  assert.equal(parsed.addressLine1, 'Other');
});

test('inherited address follows Account changes, and legacy blank linked Contact inherits', () => {
  const contact = { ...blank, accountId: 4, useAccountAddress: true };
  const account = { ...blank, addressLine1: 'Old HQ' };
  assert.equal(effectiveContactAddress({ ...contact, account }).addressLine1, 'Old HQ');
  account.addressLine1 = 'New HQ';
  assert.equal(effectiveContactAddress({ ...contact, account }).addressLine1, 'New HQ');
  assert.equal(usesAccountAddress({ ...contact, useAccountAddress: null }), true);
});

test('trade show source address is kept when different and uses Account when the source matches', () => {
  const account = { ...blank, addressLine1: 'HQ', city: 'Irving' };
  assert.equal(sourceAddressDiffersFromAccount({ ...blank, addressLine1: 'Branch' }, account), true);
  assert.equal(sourceAddressDiffersFromAccount({ ...blank, addressLine1: 'HQ' }, account), false);
  assert.equal(sourceAddressDiffersFromAccount(blank, account), false);
});

test('switching to Account address keeps saved Contact-specific address for later', async () => {
  let data;
  const existing = { ...blank, addressLine1: 'Branch', marketingPreference: 'UNKNOWN', archivedAt: null };
  const tx = { account: { findUnique: async () => ({ status: 'ACTIVE', archivedAt: null }) }, contact: { findUnique: async () => existing, update: async args => { data = args.data; return { id: 9 }; } } };
  const input = parseContact(form({ accountId: 4, firstName: 'Ada', lastName: 'Lovelace', addressMode: 'account' })).value;
  await saveContactRecord(tx, input, 9);
  assert.equal(data.useAccountAddress, true);
  assert.equal(data.addressLine1, 'Branch');
  assert.equal(effectiveContactAddress({ ...data, account: { ...blank, addressLine1: 'HQ' } }).addressLine1, 'HQ');
});

test('archived Account is rejected by Contact save', async () => {
  const input = parseContact(form({ accountId: 4, firstName: 'Ada', lastName: 'Lovelace' })).value;
  const tx = { account: { findUnique: async () => ({ status: 'ACTIVE', archivedAt: new Date() }) } };
  await assert.rejects(saveContactRecord(tx, input), /active account/);
});

test('Account launch keeps one form, validates context, returns to Contacts tab, and standalone path remains', () => {
  const newPage = read('app/contacts/new/page.tsx');
  const action = read('app/contacts/actions.ts');
  const ui = read('components/contact-form.tsx');
  assert.match(newPage, /!accounts\.length/);
  assert.match(action, /parsed\.value\.accountId !== originatingAccountId/);
  assert.match(action, /\/accounts\/\$\{originatingAccountId\}\?tab=contacts/);
  assert.match(action, /\/contacts\/\$\{contactId\}/);
  assert.match(ui, /accountId \? `\/accounts\/\$\{accountId\}\?tab=contacts` : "\/contacts"/);
  assert.match(ui, /Use Account address/);
  assert.match(ui, /Use different address/);
});

test('migration is additive and effective address is used on Contact detail', () => {
  assert.match(read('prisma/migrations/20261002120000_contact_account_address/migration.sql'), /ADD COLUMN "useAccountAddress" BOOLEAN/);
  assert.match(read('app/contacts/[id]/page.tsx'), /effectiveContactAddress\(c\)/);
});
