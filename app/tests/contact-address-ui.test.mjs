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
const require = Module.createRequire(import.meta.url);
for (const ext of ['.ts', '.tsx']) Module._extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'next/link') return function Link({ href, children, ...props }) { return React.createElement('a', { href, ...props }, children); };
  if (request === '@/lib/submit-guard') return { useSubmitGuard: () => () => {} };
  if (request === '@/app/contacts/actions') return { submitContact: async () => ({ errors: {} }) };
  if (request === '@/app/trade-shows/[id]/leads/[leadId]/resolve/actions') return { createContactForTradeShowLead: async () => ({ errors: {} }) };
  if (request === '@/app/trade-shows/[id]/contact-resolution/actions') return { createResolutionContactAction: async () => ({ errors: {} }) };
  if (request === '@/components/address-fields') return require(path.join(root, 'components/address-fields.tsx'));
  if (request === '@/lib/address') return require(path.join(root, 'lib/address.ts'));
  return originalLoad.call(this, request, parent, isMain);
};
const { ContactForm } = require(path.join(root, 'components/contact-form.tsx'));
Module._load = originalLoad;
const blank = { addressLine1: null, addressLine2: null, city: null, stateProvince: null, postalCode: null, country: null };
const account = { ...blank, id: 4, name: 'Acme', addressLine1: '10 Upper Pond Rd', city: 'Parsippany', stateProvince: 'NJ', postalCode: '07054', country: 'United States' };
const initial = { ...blank, accountId: 4, useAccountAddress: true, firstName: 'Ada', lastName: 'Lovelace', title: null, email: null, phone: null, mobile: null, active: true, isPrimary: false };
const render = props => renderToStaticMarkup(React.createElement(ContactForm, { id: 9, initial, accounts: [account], ...props }));

test('Account option uses compact accessible cards and shows the current address', () => {
  const html = render();
  assert.match(html, /<legend[^>]*>Address<\/legend>/);
  assert.doesNotMatch(html, /Location \/ Address/);
  assert.match(html, /type="radio" name="addressMode" checked="" value="account"/);
  assert.match(html, /10 Upper Pond Rd\nParsippany, NJ 07054\nUnited States/);
  assert.match(html, /Enter a separate address for this contact\./);
  assert.match(html, /focus-within:outline-orange-600/);
  assert.doesNotMatch(html, /name="addressLine1"/);
});

test('different-address selection reveals preserved Contact fields below the cards', () => {
  const html = render({ initial: { ...initial, useAccountAddress: false, addressLine1: 'Branch Road' } });
  assert.match(html, /type="radio" name="addressMode" checked="" value="different"/);
  assert.match(html, /Enter a separate address for this contact\.[\s\S]*name="addressLine1"[^>]*value="Branch Road"/);
  assert.match(html, /name="city"/);
  assert.doesNotMatch(html, /Saved Contact address is kept/);
  const accountMode = render({ initial: { ...initial, addressLine1: 'Branch Road' } });
  assert.doesNotMatch(accountMode, /name="addressLine1"/);
  assert.match(accountMode, /Saved Contact address is kept/);
});

test('empty Account address gets a clear fallback without changing radio choice', () => {
  const html = render({ accounts: [{ ...blank, id: 4, name: 'Acme' }] });
  assert.match(html, /No Account address available/);
  assert.match(html, /type="radio" name="addressMode" checked="" value="account"/);
});

test('native radio names, values, and switching handlers remain intact', () => {
  const source = fs.readFileSync(path.join(root, 'components/contact-form.tsx'), 'utf8');
  assert.match(source, /onChange=\{\(\) => setAddressMode\("account"\)\}/);
  assert.match(source, /onChange=\{\(\) => setAddressMode\("different"\)\}/);
  assert.match(source, /effectiveMode === "different" && <AddressFields embedded initial=/);
  assert.match(source, /effectiveMode === "account" && initial && hasAddress\(initial\)/);
});
