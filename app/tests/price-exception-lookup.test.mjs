import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } },
).outputText, filename);
const require = Module.createRequire(fileURLToPath(import.meta.url));
const { activePriceExceptionLineWhere, priceExceptionLookupHref } = require(path.join(root, 'lib/price-exception-lookup.ts'));
const { productWhere, listProducts } = require(path.join(root, 'lib/products.ts'));
const actor = { id: 19, role: 'SALES', active: true };
const today = new Date('2026-09-27T15:00:00Z');

test('lookup only includes current priced SKU tiers visible to the rep', () => {
  const where = activePriceExceptionLineWhere(actor, { account: '  Acme  ', sku: ' DX ', productId: '7', catalogSource: 'PRICE_LIST' }, today);
  assert.equal(where.retiredAt, null);
  assert.deepEqual(where.approvedUnitPrice, { not: null });
  assert.deepEqual(where.sourceQuantity, { gt: 0 });
  assert.equal(where.productSku.productId, 7);
  assert.equal(where.productSku.catalogSource, 'PRICE_LIST');
  assert.equal(where.productSku.active, true);
  assert.deepEqual(where.productSku.product, { active: true, archivedAt: null });
  assert.equal(where.productSku.OR[0].partNumber.contains, 'DX');
  const parent = where.priceException.AND;
  assert.deepEqual(parent[0].OR, [
    { assignedSalesRepUserId: 19 },
    { assignedSalesRepUserId: null, sourceType: 'LEGACY_WORKBOOK' },
  ]);
  assert.equal(parent[1].status, 'ACTIVE');
  assert.equal(parent[1].archivedAt, null);
  assert.deepEqual(parent[1].OR[1].expirationDate, { gte: new Date('2026-09-27T00:00:00Z') });
  assert.equal(parent[1].AND[0].OR[0].distributorAccount.status, 'ACTIVE');
  assert.equal(parent[1].AND[1].OR[0].distributorAccount.name.contains, 'Acme');
  assert.equal(parent[1].AND[1].OR[0].distributorAccount.status, 'ACTIVE');
  assert.equal(activePriceExceptionLineWhere(actor, { skuId: 'bad' }, today).productSku.id, -1);
});

test('Products PE filter is separate from Catalog Source and scoped to visible active tiers', () => {
  const has = productWhere({ catalogSource: 'PRICE_LIST', priceException: 'has' }, actor, today);
  assert.equal(has.skus.some.catalogSource, 'PRICE_LIST');
  assert.equal(has.skus.some.priceExceptionLines.some.priceException.AND[1].status, 'ACTIVE');
  const none = productWhere({ catalogSource: 'PRICE_LIST', priceException: 'none' }, actor, today);
  assert.deepEqual(none.skus, { some: { catalogSource: 'PRICE_LIST' } });
  assert.equal(none.AND[0].skus.none.catalogSource, 'PRICE_LIST');
  assert.deepEqual(productWhere({ catalogSource: 'PRICE_LIST' }, actor, today).skus, { some: { catalogSource: 'PRICE_LIST' } });
});

test('Products indicator counts distinct PEs, with a lookup link retaining filters', async () => {
  let lineWhere;
  const client = {
    product: {
      count: async () => 1,
      findMany: async () => [{ id: 7, skus: [{ id: 11, catalogSource: 'PRICE_LIST' }, { id: 12, catalogSource: 'ODM' }] }],
    },
    priceExceptionLine: {
      findMany: async ({ where }) => {
        lineWhere = where;
        return [
          { productSkuId: 11, priceExceptionId: 3 },
          { productSkuId: 11, priceExceptionId: 3 },
          { productSkuId: 11, priceExceptionId: 4 },
        ];
      },
    },
  };
  const result = await listProducts(client, { catalogSource: 'PRICE_LIST' }, actor, today);
  assert.deepEqual(lineWhere.productSku.id.in, [11]);
  assert.deepEqual(result.priceExceptionsByProduct.get(7), [3, 4]);
  const link = new URL(priceExceptionLookupHref({ account: 'Acme & Sons', sku: 'DX', productId: '7' }, 2), 'http://localhost');
  assert.equal(link.searchParams.get('account'), 'Acme & Sons');
  assert.equal(link.searchParams.get('page'), '2');
});
