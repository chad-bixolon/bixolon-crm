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
const { serializeProductSku } = require(path.join(root, 'lib/product-serialization.ts'));

test('existing Product SKU form props contain exact decimal strings and plain data', () => {
  const createdAt = new Date('2026-09-17T12:00:00.000Z');
  const sku = {
    id: 2, partNumber: 'DX220-STD', description: null, active: true,
    catalogSource: 'ODM', odmSubtype: 'CUSTOMER_SPECIFIC', odmDescription: null,
    odmCustomers: [{ account: { id: 5, name: 'Example' }, prices: [], createdAt }],
    baseSku: { id: 1, partNumber: 'DX220', product: { name: 'DX220', createdAt }, createdAt },
    createdAt, prices: [
      { id: 3, tier: 'STANDARD', currencyCode: 'USD', amount: new Prisma.Decimal('9999999999.99'), createdAt },
      { id: 4, tier: 'MSRP', currencyCode: 'USD', amount: new Prisma.Decimal('12.30'), createdAt },
    ],
  };

  const initial = serializeProductSku(sku);
  assert.equal(initial.partNumber, 'DX220-STD');
  assert.equal(initial.odmCustomers[0].account.name, 'Example');
  assert.equal(initial.baseSku?.partNumber, 'DX220');
  assert.deepEqual(initial.prices.map(price => price.amount), ['9999999999.99', '12.30']);
  assert.ok(initial.prices.every(price => typeof price.amount === 'string' && !(price.amount instanceof Prisma.Decimal)));
  assert.equal(Object.getPrototypeOf(initial.prices[0]), Object.prototype);
  assert.doesNotMatch(JSON.stringify(initial), /createdAt|updatedAt/);
  assert.deepEqual(JSON.parse(JSON.stringify(initial)), initial);
  assert.equal(sku.prices[0].amount.toString(), '9999999999.99');
});
