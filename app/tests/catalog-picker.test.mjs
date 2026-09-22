import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const { pricesForCurrency, defaultPrice, selectCatalogItem, odmCustomerWarning } = Module.createRequire(import.meta.url)(path.join(root, 'lib/catalog-picker.ts'));
const item = { id: 2, productId: 1, productName: 'SLP-DX220', partNumber: 'DX220-STD', description: 'Desktop printer', prices: [
  { tier: 'RESELLER', currencyCode: 'USD', amount: '80.00' },
  { tier: 'MSRP', currencyCode: 'USD', amount: '120.00' },
  { tier: 'STANDARD', currencyCode: 'USD', amount: '100.00' },
  { tier: 'DISTRIBUTOR', currencyCode: 'EUR', amount: '70.00' },
] };
test('catalog item prices use opportunity currency and STANDARD by default', () => {
  const prices = pricesForCurrency(item, 'USD');
  assert.deepEqual(prices.map(price => price.tier), ['STANDARD', 'MSRP', 'RESELLER']);
  assert.equal(defaultPrice(prices)?.amount, '100.00');
  assert.equal(pricesForCurrency(item, 'EUR')[0].tier, 'DISTRIBUTOR');
});
test('single non-standard tier defaults; multiple tiers and missing prices require manual choice', () => {
  assert.equal(defaultPrice(pricesForCurrency(item, 'EUR'))?.tier, 'DISTRIBUTOR');
  assert.equal(defaultPrice(pricesForCurrency({ ...item, prices: item.prices.filter(price => price.tier !== 'STANDARD') }, 'USD')), null);
  assert.equal(defaultPrice(pricesForCurrency(item, 'JPY')), null);
});

test('selecting an exact catalog item sets both IDs and suggested unit price', () => {
  assert.deepEqual(selectCatalogItem(item, 'USD'), { productId: 1, skuId: 2, tier: 'STANDARD', price: '100.00' });
  assert.deepEqual(selectCatalogItem(item, 'EUR'), { productId: 1, skuId: 2, tier: 'DISTRIBUTOR', price: '70.00' });
  assert.deepEqual(selectCatalogItem(item, 'JPY'), { productId: 1, skuId: 2, tier: '', price: '0.00' });
});
test('ODM customer warning uses participating Account IDs and never blocks pricing', () => {
  const odm={...item,catalogSource:'ODM',odmCustomers:[{accountId:7,name:'UPS'},{accountId:8,name:'Other'}]};
  assert.equal(odmCustomerWarning(odm,[7]),null);
  assert.equal(odmCustomerWarning(odm,[8]),null);
  assert.equal(odmCustomerWarning(odm,[9]),'This ODM SKU is not associated with any Account participating in this Opportunity.');
  assert.equal(odmCustomerWarning({...odm,odmCustomers:[]},[]),'This ODM SKU is not associated with any Account participating in this Opportunity.');
  assert.equal(odmCustomerWarning(item,[]),null);
  assert.deepEqual(selectCatalogItem(odm,'USD'),selectCatalogItem(item,'USD'));
});
