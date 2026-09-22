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
const originalLoad = Module._load;
let saveError;
let redirects = 0;

for (const ext of ['.ts', '.tsx']) Module._extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
Module._load = function(request, parent, isMain) {
  if (request === 'next/cache') return { revalidatePath: () => {} };
  if (request === 'next/navigation') return { redirect: () => { redirects++; throw new Error('Unexpected redirect'); } };
  if (request === '@/lib/prisma') return { prisma: {} };
  if (request === '@/lib/products') return {
    parseProduct: require(path.join(root, 'lib/products.ts')).parseProduct,
    saveProduct: async () => { throw saveError; },
  };
  if (request === '@/lib/current-user') return { requireMutation: async () => {} };
  if (request === '@/lib/crm-validation') return require(path.join(root, 'lib/crm-validation.ts'));
  if (request === '@/lib/odm-skus') return require(path.join(root, 'lib/odm-skus.ts'));
  if (request === '@/lib/product-labels') return require(path.join(root, 'lib/product-labels.ts'));
  if (request === '@/lib/odm-customer-selection') return require(path.join(root, 'lib/odm-customer-selection.ts'));
  return originalLoad.call(this, request, parent, isMain);
};
const { submitProduct } = require(path.join(root, 'app/products/actions.ts'));
const { OdmDetailsFields } = require(path.join(root, 'components/product-odm-fields.tsx'));
Module._load = originalLoad;

function odmForm(name = 'Custom Printer') {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    name, categoryId: '5', sku: 'ODM-NEW', catalogSource: 'ODM', active: 'false',
    odmSubtype: 'CUSTOMER_SPECIFIC', baseSkuId: '20', baseSkuLabel: 'BASE-20 · Base Printer',
    odmDescription: 'RFID customization',
  })) data.set(key, value);
  data.append('odmCustomerAccountIds', '7');
  data.append('odmCustomerNames', 'Alpha');
  data.append('odmCustomerAccountIds', '8');
  data.append('odmCustomerNames', 'Beta');
  return data;
}

const expectedValues = {
  name: 'Custom Printer', categoryId: '5', sku: 'ODM-NEW', catalogSource: 'ODM', active: 'false',
  odmSubtype: 'CUSTOMER_SPECIFIC', baseSkuId: '20', baseSkuLabel: 'BASE-20 · Base Printer',
  odmCustomerAccountIds: ['7', '8'], odmCustomerNames: ['Alpha', 'Beta'],
  odmDescription: 'RFID customization',
};

test('failed ODM Product validation returns every submitted form value without redirecting', async () => {
  redirects = 0;
  const result = await submitProduct(null, { errors: {} }, odmForm(''));
  assert.match(result.errors.name, /required/i);
  assert.deepEqual(result.values, { ...expectedValues, name: '' });
  assert.equal(redirects, 0);
});

test('failed ODM Product save retains selected Base SKU and Customers', async () => {
  redirects = 0;
  saveError = new Error('Base SKU must be an existing non-ODM SKU.');
  const result = await submitProduct(null, { errors: {} }, odmForm());
  assert.match(result.message, /Base SKU/);
  assert.deepEqual(result.values, expectedValues);
  assert.equal(redirects, 0);
});

test('restored ODM fields keep selected ids and labels ready for resubmission', () => {
  const html = renderToStaticMarkup(React.createElement(OdmDetailsFields, { values: expectedValues }));
  assert.match(html, /<option value="CUSTOMER_SPECIFIC" selected="">Customer-Specific<\/option>/);
  assert.match(html, /name="baseSkuId" value="20"/);
  assert.match(html, /name="baseSkuLabel" value="BASE-20 · Base Printer"/);
  assert.match(html, /name="odmCustomerAccountIds" value="7"/);
  assert.match(html, /name="odmCustomerAccountIds" value="8"/);
  assert.match(html, /name="odmCustomerNames" value="Alpha"/);
  assert.match(html, /name="odmCustomerNames" value="Beta"/);
  assert.match(html, /name="odmDescription" value="RFID customization"/);
});
