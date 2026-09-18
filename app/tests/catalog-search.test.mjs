import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const require = Module.createRequire(import.meta.url);
const { catalogRank, rankCatalogResults, searchCatalog } = require(path.join(root, 'lib/catalog-search.ts'));
const { selectedProductFitsCategory, selectCatalogItem, pricesForCurrency } = require(path.join(root, 'lib/catalog-picker.ts'));
const row = (id, name, partNumber, description = '', sku = partNumber, categoryId = 1) => ({ id, productId: id, partNumber, description, product: { name, sku, categoryId } });
const rows = [row(1, 'Ribbon', 'RIBBON-1', 'Compatible with XT5'), row(2, 'XT5', 'PRINTER-2'), row(3, 'Printer', 'XT5'), row(4, 'XT5-40', 'PRINTER-4'), row(5, 'Printer', 'XT5-50'), row(6, 'BIXOLON XT5', 'PRINTER-6'), row(7, 'Printer', 'BLACK-XT5-RIBBON'), row(8, 'Printer', 'OTHER', 'XT5 compatible ribbon', 'OTHER', 2)];
test('XT5 ranking follows model, SKU, prefix, contains, then description', () => {
  assert.deepEqual(rankCatalogResults(rows, 'xt5').map(item => item.id), [2, 3, 4, 5, 6, 7, 8, 1]);
  assert.equal(catalogRank(rows[2], 'XT5'), 1);
  assert.equal(catalogRank(rows[3], 'XT5'), 2);
  assert.equal(catalogRank(rows[0], 'XT5'), 6);
});
test('result limit is applied after ranking', () => {
  const ribbons = Array.from({ length: 30 }, (_, i) => row(100 + i, 'Ribbon', `R-${i}`, 'XT5 ribbon'));
  assert.equal(rankCatalogResults([...ribbons, rows[1]], 'XT5')[0].id, 2);
  assert.equal(rankCatalogResults([...ribbons, rows[1]], 'XT5').length, 25);
});
function mockClient() {
  const calls = [];
  return { calls, productSku: { findMany: async args => {
    calls.push(args);
    if (args.where.id) return rows.filter(item => args.where.id.in.includes(item.id)).map(item => ({ ...item, prices: [{ tier: 'STANDARD', currencyCode: 'USD', amount: { toFixed: () => '12.34' } }] }));
    return rows.filter(item => args.where.product.categoryId === undefined || item.product.categoryId === args.where.product.categoryId);
  } } };
}
test('All categories and restricted search preserve ranking and pricing', async () => {
  const client = mockClient();
  const all = await searchCatalog(client, 'XT5', null, 'USD');
  assert.equal(client.calls[0].where.product.categoryId, undefined);
  assert.deepEqual(all.map(item => item.id), [2, 3, 4, 5, 6, 7, 8, 1]);
  assert.deepEqual(selectCatalogItem(all[0], 'USD'), { productId: 2, skuId: 2, tier: 'STANDARD', price: '12.34' });
  assert.equal(pricesForCurrency(all[0], 'USD')[0].amount, '12.34');
  client.calls.length = 0;
  const restricted = await searchCatalog(client, 'XT5', 2, 'USD');
  assert.equal(client.calls[0].where.product.categoryId, 2);
  assert.deepEqual(restricted.map(item => item.id), [8]);
});
test('category change preserves compatible selection and clears incompatible selection', () => {
  assert.equal(selectedProductFitsCategory(null, 1), true);
  assert.equal(selectedProductFitsCategory(1, 1), true);
  assert.equal(selectedProductFitsCategory(2, 1), false);
  assert.equal(selectedProductFitsCategory(2, null), false);
});
