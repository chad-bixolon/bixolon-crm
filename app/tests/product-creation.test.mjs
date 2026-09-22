import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(import.meta.url);
const { parseProduct, saveProduct } = require(path.join(root, 'lib/products.ts'));
const { parseSkuMetadataForm, DuplicateSkuError } = require(path.join(root, 'lib/odm-skus.ts'));

function form(fields = {}, customers = []) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ sku: 'ODM-NEW', name: 'Custom Printer', categoryId: '5', active: 'true', ...fields })) data.set(key, value);
  for (const id of customers) data.append('odmCustomerAccountIds', String(id));
  return data;
}

function fixture(existing = []) {
  const state = { products: [], skus: [...existing], links: [] };
  let commits = 0;
  const db = { $transaction: async callback => {
    const staged = { products: [...state.products], skus: [...state.skus], links: [...state.links] };
    const tx = {
      product: {
        findUnique: async ({ where }) => staged.products.find(row => row.id === where.id) ?? null,
        create: async ({ data }) => { const row = { id: 100 + staged.products.length, archivedAt: null, ...data }; staged.products.push(row); return row; },
      },
      productCategory: { count: async ({ where }) => Number(where.id === 5) },
      productSku: {
        findUnique: async ({ where }) => where.normalizedPartNumber ? staged.skus.find(row => row.normalizedPartNumber === where.normalizedPartNumber) ?? null : staged.skus.find(row => row.id === where.id) ?? null,
        create: async ({ data }) => { const row = { id: 200 + staged.skus.length, product: { name: 'Custom Printer' }, ...data }; staged.skus.push(row); return row; },
      },
      account: { count: async ({ where }) => where.id.in.filter(id => [7, 8].includes(id)).length },
      productSkuOdmCustomer: { upsert: async ({ create }) => { staged.links.push(create); } },
    };
    const result = await callback(tx);
    Object.assign(state, staged);
    commits++;
    return result;
  } };
  return { db, state, commits: () => commits };
}

async function create(db, data) {
  const parsed = parseProduct(data);
  assert.deepEqual(parsed.errors, {});
  return saveProduct(db, parsed.value, undefined, parseSkuMetadataForm(data, 'sku'));
}

test('standard Product creation still creates one initial SKU', async () => {
  const { db, state, commits } = fixture();
  await create(db, form({ sku: 'STD-1', catalogSource: '' }));
  assert.equal(commits(), 1);
  assert.equal(state.products[0].categoryId, 5);
  assert.equal(state.skus[0].partNumber, 'STD-1');
  assert.equal(state.skus[0].catalogSource, null);
  assert.equal(state.skus[0].active, true);
  assert.deepEqual(state.links, []);
});

test('new Customer-Specific ODM Product creates SKU and multiple Account links atomically', async () => {
  const { db, state, commits } = fixture([{ id: 20, catalogSource: 'PRICE_LIST' }]);
  await create(db, form({ catalogSource: 'ODM', odmSubtype: 'CUSTOMER_SPECIFIC', baseSkuId: '20', odmDescription: 'RFID customization' }, [7, 8]));
  assert.equal(commits(), 1);
  assert.equal(state.products.length, 1);
  assert.equal(state.skus[1].catalogSource, 'ODM');
  assert.equal(state.skus[1].odmSubtype, 'CUSTOMER_SPECIFIC');
  assert.equal(state.skus[1].baseSkuId, 20);
  assert.equal(state.skus[1].odmDescription, 'RFID customization');
  assert.deepEqual(state.links.map(link => link.accountId), [7, 8]);
  assert.ok(state.links.every(link => link.skuId === state.skus[1].id));
});

test('Customer-Specific without Account rolls back the Product and SKU', async () => {
  const { db, state, commits } = fixture();
  await assert.rejects(create(db, form({ catalogSource: 'ODM', odmSubtype: 'CUSTOMER_SPECIFIC' })), /at least one active Account/);
  assert.equal(commits(), 0);
  assert.deepEqual(state.products, []);
  assert.deepEqual(state.skus, []);
});

test('other new ODM subtypes allow no Account', async () => {
  for (const subtype of ['SPECIAL_CONFIGURATION', 'CABLE_PACKAGING_ACCESSORY', 'OTHER']) {
    const { db, state } = fixture();
    await create(db, form({ catalogSource: 'ODM', odmSubtype: subtype }));
    assert.equal(state.skus[0].odmSubtype, subtype);
    assert.deepEqual(state.links, []);
  }
});

test('Legacy Special SKU cannot be used for a new Product', async () => {
  const { db, state } = fixture();
  await assert.rejects(create(db, form({ catalogSource: 'ODM', odmSubtype: 'LEGACY_SPECIAL_SKU' })), /reserved for migrated records/);
  assert.deepEqual(state.products, []);
});

test('normalized duplicate initial SKU blocks Product creation and identifies the existing SKU', async () => {
  const existing = { id: 44, productId: 9, partNumber: 'ODM-NEW', normalizedPartNumber: 'ODM-NEW', catalogSource: 'ODM', product: { name: 'Existing Printer' } };
  const { db, state } = fixture([existing]);
  await assert.rejects(create(db, form({ sku: ' odm-new ', catalogSource: 'ODM', odmSubtype: 'OTHER' })), error => error instanceof DuplicateSkuError && error.existing.id === 44 && error.existing.productName === 'Existing Printer');
  assert.deepEqual(state.products, []);
  assert.deepEqual(state.skus, [existing]);
});

test('invalid or ODM Base SKU rolls back Product creation', async () => {
  for (const baseSkuId of ['999', '21']) {
    const { db, state } = fixture([{ id: 21, catalogSource: 'ODM' }]);
    await assert.rejects(create(db, form({ catalogSource: 'ODM', odmSubtype: 'OTHER', baseSkuId })), /non-ODM SKU/);
    assert.deepEqual(state.products, []);
    assert.equal(state.skus.length, 1);
  }
});
