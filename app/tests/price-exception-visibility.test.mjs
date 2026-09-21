import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(import.meta.url);
const { Prisma } = require('@prisma/client');
const { canViewPriceException, priceExceptionVisibilityWhere } = require(path.join(root, 'lib/price-exception-visibility.ts'));
const { accountPriceExceptionWhere } = require(path.join(root, 'lib/price-exceptions.ts'));
const { findPriceExceptionCandidates } = require(path.join(root, 'lib/opportunity-price-exceptions.ts'));
const { updatePriceExceptionSalesRep } = require(path.join(root, 'lib/price-exception-resolution.ts'));
const { saveOpportunity } = require(path.join(root, 'lib/opportunities.ts'));

const actor = (role, id = 10) => ({ id, role, active: true });
const pe = (assignedSalesRepUserId, sourceType = 'EXTERNAL_EXPORT') => ({ assignedSalesRepUserId, sourceType });

test('central visibility policy covers self, other rep, legacy fallback, and broad roles', () => {
  const sales = actor('SALES');
  assert.equal(canViewPriceException(sales, pe(10)), true);
  assert.equal(canViewPriceException(sales, pe(11)), false);
  assert.equal(canViewPriceException(sales, pe(null, 'LEGACY_WORKBOOK')), true);
  assert.equal(canViewPriceException(sales, pe(null, 'EXTERNAL_EXPORT')), false);
  for (const role of ['ADMIN', 'SALES_MANAGER', 'MARKETING_MANAGER', 'READ_ONLY']) {
    assert.equal(canViewPriceException(actor(role), pe(11)), true);
    assert.deepEqual(priceExceptionVisibilityWhere(actor(role)), {});
  }
  assert.deepEqual(priceExceptionVisibilityWhere(sales), { OR: [{ assignedSalesRepUserId: 10 }, { assignedSalesRepUserId: null, sourceType: 'LEGACY_WORKBOOK' }] });
});

test('Account context and both Opportunity candidate scopes embed the same SALES visibility predicate', async () => {
  const sales = actor('SALES');
  const accountWhere = accountPriceExceptionWhere(7, sales);
  assert.deepEqual(accountWhere.AND[0], priceExceptionVisibilityWhere(sales));
  let relatedQuery;
  let allQuery;
  const row = { id: 1, priceExceptionId: 2, productSkuId: 9, approvedUnitPrice: new Prisma.Decimal('10'), currencyCode: 'USD', sourceQuantity: new Prisma.Decimal('1'), sourceQuantityRaw: '1', sourceUnit: null, comments: null, sortOrder: 1, priceException: { id: 2, peCode: 'PE', status: 'ACTIVE', archivedAt: null, expirationDate: null, assignedSalesRepUserId: 10, sourceType: 'EXTERNAL_EXPORT', distributorAccountId: 7, varAccountId: null, endUserAccountId: null, distributorSourceName: null, varSourceName: null, endUserSourceName: null, sourceDescription: null, distributorAccount: { id: 7, name: 'Account' }, varAccount: null, endUserAccount: null } };
  const db = { priceExceptionLine: { findMany: async args => { if (args.where.priceException.AND.length === 3) relatedQuery = args.where; else allQuery = args.where; return [row]; } } };
  await findPriceExceptionCandidates(db, { skuId: 9, currencyCode: 'USD', opportunityAccountIds: [7], relatedOnly: true, actor: sales });
  await findPriceExceptionCandidates(db, { skuId: 9, currencyCode: 'USD', opportunityAccountIds: [7], relatedOnly: false, actor: sales });
  assert.deepEqual(relatedQuery.priceException.AND[1], priceExceptionVisibilityWhere(sales));
  assert.deepEqual(allQuery.priceException.AND[1], priceExceptionVisibilityWhere(sales));
});

function assignmentDb(initial = {}) {
  const record = { id: 44, assignedSalesRepUserId: null, sourceSalesRepName: 'Rosa source', sourceSalesRepEmail: 'rosa@example.com', distributorSalesRep: 'Wally DeBurgh', ...initial };
  const users = new Map([[10, { id: 10, role: 'SALES', active: true, archivedAt: null }], [11, { id: 11, role: 'SALES_MANAGER', active: true, archivedAt: null }]]);
  return { record, priceException: { findUnique: async () => ({ id: record.id }), update: async ({ data }) => Object.assign(record, data) }, user: { findUnique: async ({ where }) => users.get(where.id) ?? null } };
}

test('ADMIN can assign, change, and clear without touching source salesperson identity; non-Admin is rejected', async () => {
  const db = assignmentDb();
  await updatePriceExceptionSalesRep(db, 44, actor('ADMIN', 91), 10);
  assert.equal(db.record.assignedSalesRepUserId, 10);
  await updatePriceExceptionSalesRep(db, 44, actor('ADMIN', 91), 11);
  assert.equal(db.record.assignedSalesRepUserId, 11);
  await updatePriceExceptionSalesRep(db, 44, actor('ADMIN', 91), null);
  assert.equal(db.record.assignedSalesRepUserId, null);
  assert.deepEqual([db.record.sourceSalesRepName, db.record.sourceSalesRepEmail, db.record.distributorSalesRep], ['Rosa source', 'rosa@example.com', 'Wally DeBurgh']);
  await assert.rejects(updatePriceExceptionSalesRep(db, 44, actor('SALES_MANAGER'), 10), /Access denied/);
});

test('hidden PE line cannot be newly submitted, while an unchanged reassigned historical line keeps its snapshot', async () => {
  const hiddenParent = { id: 40, peCode: 'PE-HIDDEN', status: 'ACTIVE', archivedAt: null, expirationDate: null, assignedSalesRepUserId: 99, sourceType: 'EXTERNAL_EXPORT' };
  const selected = { id: 102, productSkuId: 9, approvedUnitPrice: new Prisma.Decimal('189'), currencyCode: 'USD', sourceQuantity: new Prisma.Decimal('1'), sourceQuantityRaw: '1', sourceUnit: null, priceException: hiddenParent };
  const old = { id: 55, opportunityId: 5, productId: 3, skuId: 9, quantity: 1, estimatedUnitPrice: new Prisma.Decimal('185'), archivedAt: null, priceSource: 'PRICE_EXCEPTION', catalogPriceTier: null, priceExceptionLineId: 102, priceExceptionCode: 'SNAPSHOT', priceExceptionUnitPrice: new Prisma.Decimal('189'), priceExceptionCurrencyCode: 'USD', priceExceptionSourceQty: '1' };
  const makeDb = existing => {
    const writes = [];
    const tx = { opportunity: { findUnique: async () => existing ? { id: 5, archivedAt: null, stageId: 1, projects: [] } : null, create: async () => ({ id: 5 }), update: async () => ({}) }, opportunityProduct: { findMany: async () => existing ? [old] : [], create: async ({ data }) => writes.push(data), update: async ({ data }) => writes.push(data) }, salesStage: { findUnique: async () => ({ id: 1, active: true }) }, currency: { findUnique: async () => ({ active: true }) }, user: { findUnique: async () => null }, account: { findMany: async () => [{ id: 7 }] }, product: { findMany: async () => [{ id: 3 }] }, project: { findMany: async () => [] }, productSku: { findMany: async () => [{ id: 9, productId: 3, active: true }] }, productPrice: { findMany: async () => [] }, priceExceptionLine: { findMany: async () => [selected] }, opportunityProject: { delete: async () => ({}), create: async () => ({}) }, opportunityAccount: { findMany: async () => [], delete: async () => ({}), upsert: async () => ({}) }, opportunityAccountRole: { deleteMany: async () => ({}), create: async () => ({}) } };
    return { writes, client: { $transaction: async fn => fn(tx) } };
  };
  const input = line => ({ name: 'Deal', description: null, ownerId: null, projectIds: [], stageId: 1, expectedCloseDate: null, probability: null, forecastCategory: null, currencyCode: 'USD', participants: [{ accountId: 7, roles: ['END_USER'] }], lines: [line] });
  const sales = actor('SALES');
  await assert.rejects(saveOpportunity(makeDb(false).client, input({ productId: 3, skuId: 9, quantity: 1, price: '189.00', priceSource: 'PRICE_EXCEPTION', catalogPriceTier: null, priceExceptionLineId: 102 }), undefined, sales), /not available to this user/);
  const historical = makeDb(true);
  await saveOpportunity(historical.client, input({ id: 55, productId: 3, skuId: 9, quantity: 1, price: '185.00', priceSource: 'PRICE_EXCEPTION', catalogPriceTier: null, priceExceptionLineId: 102 }), 5, sales);
  assert.equal(historical.writes[0].priceExceptionCode, 'SNAPSHOT');
  assert.equal(historical.writes[0].estimatedUnitPrice, '185.00');
});

test('direct detail authorization, historical link suppression, and legacy importer preservation are explicit', () => {
  const detail = fs.readFileSync(path.join(root, 'app/price-exceptions/[id]/page.tsx'), 'utf8');
  const opportunity = fs.readFileSync(path.join(root, 'app/opportunities/[id]/page.tsx'), 'utf8');
  const importer = fs.readFileSync(path.join(root, 'lib/price-exception-import.ts'), 'utf8');
  assert.match(detail, /findFirst\(\{where:scopedPriceExceptionWhere\(actor,\{id\}\)/);
  assert.match(opportunity, /canViewPriceException\(actor,line\.priceExceptionLine\.priceException\)/);
  const updateData = importer.slice(importer.indexOf('const data='), importer.indexOf('const pe='));
  assert.doesNotMatch(updateData, /assignedSalesRepUserId|sourceSalesRepName|sourceSalesRepEmail/);
  assert.match(updateData, /distributorSalesRep:item\.rep/);
  assert.doesNotMatch(importer, /assignedSalesRepUserId:item\.rep|sourceSalesRepName:item\.rep/);
});
