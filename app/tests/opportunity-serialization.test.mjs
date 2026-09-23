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
const { serializeOpportunityForForm } = require(path.join(root, 'lib/opportunity-serialization.ts'));

const decimal = value => new Prisma.Decimal(value);
const actor = { id: 7, role: 'SALES', active: true, archivedAt: null };
const line = (id, overrides = {}) => ({
  id,
  productId: id + 100,
  skuId: id + 200,
  quantity: 2,
  estimatedUnitPrice: decimal('425.70'),
  priceSource: 'MANUAL',
  catalogPriceTier: null,
  priceExceptionLineId: null,
  priceExceptionCode: null,
  priceExceptionUnitPrice: null,
  priceExceptionCurrencyCode: null,
  priceExceptionSourceQty: null,
  odmCustomerPriceId: null,
  odmCustomerAccountId: null,
  odmCustomerBasePrice: null,
  odmCustomerTariffPercent: null,
  odmCustomerTariffAmount: null,
  odmCustomerFinalUnitPrice: null,
  priceExceptionLine: null,
  archivedAt: null,
  createdAt: new Date('2026-09-01T12:00:00.000Z'),
  updatedAt: new Date('2026-09-02T12:00:00.000Z'),
  ...overrides,
});
const opportunity = products => ({
  id: 11,
  name: 'Serialization test',
  description: null,
  competitorId: null,
  currentProductBeingUsed: null,
  customerPainPoints: null,
  ownerId: 7,
  stageId: 2,
  expectedCloseDate: new Date('2026-12-31T12:00:00.000Z'),
  probability: 75,
  forecastCategory: 'COMMIT',
  currencyCode: 'USD',
  projects: [{ projectId: 9, createdAt: new Date('2026-09-01T00:00:00.000Z') }],
  contacts: [{ contactId: 10, isPrimary: true, createdAt: new Date('2026-09-01T00:00:00.000Z') }],
  participants: [{ accountId: 12, roles: [{ role: 'END_USER', createdAt: new Date('2026-09-01T00:00:00.000Z') }] }],
  products,
  archivedAt: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
});

function assertNoNonPlainValues(value) {
  assert.equal(value instanceof Prisma.Decimal, false);
  assert.equal(value instanceof Date, false);
  if (Array.isArray(value)) return value.forEach(assertNoNonPlainValues);
  if (value && typeof value === 'object') {
    assert.equal(Object.getPrototypeOf(value), Object.prototype);
    Object.values(value).forEach(assertNoNonPlainValues);
  }
}

test('Opportunity edit props serialize manual, catalog, PE, and ODM snapshots as exact plain values', () => {
  const peParent = {
    distributorAccountId: 12,
    varAccountId: 13,
    endUserAccountId: null,
    assignedSalesRepUserId: 7,
    sourceType: 'EXTERNAL_EXPORT',
    expirationDate: new Date('2027-01-01T00:00:00.000Z'),
  };
  const input = opportunity([
    line(1),
    line(2, { estimatedUnitPrice: decimal('399.90'), priceSource: 'CATALOG', catalogPriceTier: 'DISTRIBUTOR' }),
    line(3, {
      estimatedUnitPrice: decimal('410.25'),
      priceSource: 'PRICE_EXCEPTION',
      priceExceptionLineId: 44,
      priceExceptionCode: 'PE-SNAPSHOT',
      priceExceptionUnitPrice: decimal('400.10'),
      priceExceptionCurrencyCode: 'USD',
      priceExceptionSourceQty: '1000',
      priceExceptionLine: { approvedUnitPrice: decimal('999.99'), priceException: peParent },
    }),
    line(4, {
      estimatedUnitPrice: decimal('121.00'),
      priceSource: 'ODM_CUSTOMER',
      odmCustomerPriceId: 55,
      odmCustomerAccountId: 12,
      odmCustomerBasePrice: decimal('100'),
      odmCustomerTariffPercent: decimal('10'),
      odmCustomerTariffAmount: decimal('10.50'),
      odmCustomerFinalUnitPrice: decimal('110.50'),
      odmCustomerEffectiveDate: new Date('2026-09-15T00:00:00.000Z'),
    }),
  ]);

  const initial = serializeOpportunityForForm(input, actor);

  assert.equal(initial.expectedCloseDate, '2026-12-31');
  assert.equal(initial.lines[0].price, '425.70');
  assert.equal(initial.lines[1].price, '399.90');
  assert.equal(initial.lines[1].priceSource, 'CATALOG');
  assert.equal(initial.lines[1].catalogPriceTier, 'DISTRIBUTOR');
  assert.equal(initial.lines[2].price, '410.25');
  assert.equal(initial.lines[2].priceExceptionUnitPrice, '400.10');
  assert.deepEqual(initial.lines[2].priceExceptionAccountIds, [12, 13]);
  assert.equal('priceExceptionLine' in initial.lines[2], false);
  assert.equal(initial.lines[3].odmCustomerBasePrice, '100.00');
  assert.equal(initial.lines[3].odmCustomerTariffPercent, '10.0000');
  assert.equal(initial.lines[3].odmCustomerTariffAmount, '10.50');
  assert.equal(initial.lines[3].odmCustomerFinalUnitPrice, '110.50');
  assert.equal('odmCustomerEffectiveDate' in initial.lines[3], false);
  assertNoNonPlainValues(initial);
  assert.deepEqual(JSON.parse(JSON.stringify(initial)), initial);
  assert.doesNotMatch(JSON.stringify(initial), /createdAt|updatedAt|archivedAt|999\.99/);
});

test('Opportunity edit props remain plain with zero product lines and no close date', () => {
  const initial = serializeOpportunityForForm({ ...opportunity([]), expectedCloseDate: null }, actor);
  assert.deepEqual(initial.lines, []);
  assert.equal(initial.expectedCloseDate, null);
  assertNoNonPlainValues(initial);
  assert.deepEqual(JSON.parse(JSON.stringify(initial)), initial);
});
