import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(fileURLToPath(import.meta.url));
const { Prisma } = require('@prisma/client');
const { serializeProductPricing } = require(path.join(root, 'lib/product-serialization.ts'));

test('Product pricing crosses the client boundary as exact decimal strings', () => {
  const createdAt = new Date('2026-09-17T12:00:00.000Z');
  const product = {
    id: 1, sku: 'DX220', name: 'DX220', active: true, archivedAt: null, createdAt,
    skus: [{ id: 2, partNumber: 'DX220-STD', prices: [
      { id: 3, tier: 'STANDARD', currencyCode: 'USD', amount: new Prisma.Decimal('9999999999.99'), createdAt },
      { id: 4, tier: 'MSRP', currencyCode: 'USD', amount: new Prisma.Decimal('12.30'), createdAt },
    ] }],
  };

  const serialized = serializeProductPricing(product);
  assert.deepEqual(serialized.skus[0].prices.map(price => price.amount), ['9999999999.99', '12.30']);
  assert.equal(Object.getPrototypeOf(serialized.skus[0].prices[0]), Object.prototype);
  assert.equal(serialized.createdAt, createdAt);
  assert.equal(serialized.skus[0].prices[0].createdAt, createdAt);
  assert.equal(product.skus[0].prices[0].amount.toString(), '9999999999.99');
});
