import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkExpression, issues, report, target } from '../scripts/operations/audit-opportunity-price-provenance.mjs';

const migration = readFileSync(fileURLToPath(new URL('../prisma/migrations/20260927180000_opportunity_product_account_price_provenance/migration.sql', import.meta.url)), 'utf8');
const empty = { unitPrice: '425.70', catalogPriceTier: null, priceExceptionLineId: null, priceExceptionCode: null,
  priceExceptionUnitPrice: null, priceExceptionCurrencyCode: null, priceExceptionSourceQty: null,
  odmCustomerPriceId: null, odmCustomerAccountId: null, odmCustomerBasePrice: null,
  odmCustomerTariffPercent: null, odmCustomerTariffAmount: null, odmCustomerFinalUnitPrice: null,
  odmCustomerCurrencyCode: null, odmCustomerEffectiveDate: null };
const account = { ...empty, source: 'ODM_CUSTOMER', odmCustomerPriceId: 1, odmCustomerAccountId: 2,
  odmCustomerBasePrice: '425.70', odmCustomerTariffPercent: '0', odmCustomerTariffAmount: '0',
  odmCustomerFinalUnitPrice: '425.70', odmCustomerCurrencyCode: 'USD' };

test('preflight extracts the pending CHECK and diagnoses each supported source', () => {
  const expression = checkExpression(migration);
  assert.equal((migration.match(/ALTER TABLE "OpportunityProduct"/g) ?? []).length, 2);
  assert.equal((migration.match(/CONSTRAINT "OpportunityProduct_price_provenance_check"/g) ?? []).length, 2);
  assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE|INSERT|TRUNCATE)\b/i);
  assert.match(expression, /"priceSource" = 'ODM_CUSTOMER'/);
  assert.match(expression, /"unitPrice" = "odmCustomerFinalUnitPrice"/);
  assert.deepEqual(issues({ ...empty, source: 'MANUAL' }), []);
  assert.deepEqual(issues({ ...empty, source: 'CATALOG', catalogPriceTier: 'STANDARD' }), []);
  assert.deepEqual(issues({ ...empty, source: 'PRICE_EXCEPTION', priceExceptionLineId: 3, priceExceptionUnitPrice: '425.70', priceExceptionCurrencyCode: 'USD' }), []);
  assert.deepEqual(issues(account), []);
  assert.deepEqual(issues({ ...account, odmCustomerPriceId: null }), ['odmCustomerPriceId required']);
  assert.deepEqual(issues({ ...account, odmCustomerTariffAmount: '1' }), ['odmCustomerFinalUnitPrice must equal base price plus tariff amount']);
  assert.deepEqual(issues({ ...account, source: 'MANUAL' }).slice(0, 2), ['odmCustomerPriceId must be null', 'odmCustomerAccountId must be null']);
  assert.deepEqual(issues({ ...empty, source: 'PRICE_EXCEPTION' }), ['priceExceptionLineId required', 'priceExceptionUnitPrice required', 'priceExceptionCurrencyCode required']);
  assert.deepEqual(issues({ ...empty, source: null }), ['priceSource is null or unsupported']);
});

test('preflight reports counts, IDs, and field names without values', () => {
  const groups = report([{ id: 1, ...empty, source: 'MANUAL', valid: true },
    { id: 2, ...account, valid: true },
    { id: 3, ...account, odmCustomerPriceId: null, valid: false }]);
  assert.deepEqual(groups.ODM_CUSTOMER, { total: 2, valid: 1, violating: 1,
    failures: [{ id: 3, fields: ['odmCustomerPriceId required'] }] });
  assert.equal(groups.OTHER_OR_NULL.total, 0);
  assert.throws(() => report([{ id: 4, ...account, valid: false }]), /differ/);
});

test('production target is fixed and forces read-only sessions', () => {
  const productionUrl = 'postgresql://u:p@bixolon-crm-db-do-user-44410788-0.e.db.ondigitalocean.com:25060/bixolon_crm?sslmode=require';
  const safe = new URL(target({ NODE_ENV: 'production', DATABASE_URL: productionUrl }));
  assert.equal(safe.searchParams.get('connection_limit'), '1');
  assert.match(safe.searchParams.get('options'), /default_transaction_read_only=on/);
  for (const env of [
    { NODE_ENV: 'development', DATABASE_URL: productionUrl },
    { NODE_ENV: 'production', DATABASE_URL: productionUrl.replace('bixolon_crm?', 'other?') },
    { NODE_ENV: 'production', DATABASE_URL: productionUrl.replace('bixolon-crm-db-do-user-44410788-0.e.db.ondigitalocean.com', 'db') },
    { NODE_ENV: 'production', DATABASE_URL: 'invalid' },
  ]) assert.throws(() => target(env), /Expected production target/);
});
