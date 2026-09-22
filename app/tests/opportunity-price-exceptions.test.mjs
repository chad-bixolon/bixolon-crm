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
const { findPriceExceptionCandidates, moqEligibility, priceExceptionEligibilityWhere, priceExceptionSnapshot } = require(path.join(root, 'lib/opportunity-price-exceptions.ts'));
const { parseOpportunity, saveOpportunity: saveOpportunityWithActor } = require(path.join(root, 'lib/opportunities.ts'));
const { can } = require(path.join(root, 'lib/authorization.ts'));
const saveOpportunity = (client, input, id) => saveOpportunityWithActor(client, input, id, { id: 1, role: 'ADMIN', active: true });

const parent = (overrides = {}) => ({ id: 40, peCode: 'SPAZ12102025', status: 'ACTIVE', archivedAt: null, expirationDate: new Date('2026-12-31T00:00:00Z'), distributorAccountId: 7, varAccountId: null, endUserAccountId: null, distributorSourceName: 'Blue Star', varSourceName: 'Legacy VAR', endUserSourceName: null, sourceDescription: 'Approved deal price', distributorAccount: { id: 7, name: 'Blue Star' }, varAccount: null, endUserAccount: null, ...overrides });
const line = (id, quantity, price, pe = parent()) => ({ id, priceExceptionId: pe.id, productSkuId: 9, approvedUnitPrice: new Prisma.Decimal(price), currencyCode: 'USD', sourceQuantity: new Prisma.Decimal(quantity), sourceQuantityRaw: quantity, sourceUnit: null, comments: null, sortOrder: id, priceException: pe });

test('candidate eligibility is exact resolved SKU, active/unarchived, unexpired, priced, and same currency', () => {
  const where = priceExceptionEligibilityWhere(9, 'USD', new Date('2026-09-20T15:00:00Z'));
  assert.equal(where.productSkuId, 9);
  assert.deepEqual(where.approvedUnitPrice, { not: null });
  assert.equal(where.currencyCode, 'USD');
  assert.equal(where.priceException.status, 'ACTIVE');
  assert.equal(where.priceException.archivedAt, null);
  assert.equal(where.priceException.AND[0].OR[1].expirationDate.gte.toISOString(), '2026-09-20T00:00:00.000Z');
  assert.equal('sourceSku' in where, false);
});

test('related discovery uses resolved Opportunity Account IDs and keeps two MOQ lines separately discoverable', async () => {
  let query;
  const db = { priceExceptionLine: { findMany: async args => { query = args; return [line(101, '100', '193.55'), line(102, '1000', '189.00')]; } } };
  const options = await findPriceExceptionCandidates(db, { skuId: 9, currencyCode: 'USD', opportunityAccountIds: [7], relatedOnly: true, today: new Date('2026-09-20') });
  assert.deepEqual(options.map(option => [option.lineId, option.moq, option.unitPrice]), [[101, '100', '193.55'], [102, '1000', '189.00']]);
  assert.deepEqual(options.filter(option => moqEligibility(1000, option.moq) === 'ELIGIBLE').map(option => option.lineId), [101, 102]);
  assert.ok(options.every(option => !('selected' in option)));
  assert.deepEqual(options[0].matchedRoles, ['Distributor/OEM']);
  const accountClause = query.where.priceException.AND[1].OR;
  assert.ok(accountClause.every(condition => Object.values(condition)[0].in[0] === 7));
});

test('search-all returns an otherwise valid unrelated PE with warning context and never confirms raw party text', async () => {
  const unresolved = parent({ id: 41, distributorAccountId: null, distributorAccount: null, distributorSourceName: 'Possibly Blue Star' });
  const db = { priceExceptionLine: { findMany: async () => [line(103, '1000', '189.00', unresolved)] } };
  const [option] = await findPriceExceptionCandidates(db, { skuId: 9, currencyCode: 'USD', opportunityAccountIds: [7], relatedOnly: false, query: '189' });
  assert.deepEqual(option.matchedRoles, []);
  assert.equal(option.parties[0].sourceName, 'Possibly Blue Star');
  assert.equal(option.parties[0].matchesOpportunity, false);
  assert.equal(moqEligibility(1000, option.moq), 'ELIGIBLE');
});

test('MOQ eligibility follows the confirmed minimum-order rule without choosing a price', () => {
  assert.equal(moqEligibility(50, '100'), 'INELIGIBLE');
  assert.equal(moqEligibility(100, '100'), 'ELIGIBLE');
  assert.equal(moqEligibility(500, '100'), 'ELIGIBLE');
  assert.equal(moqEligibility(500, '1000'), 'INELIGIBLE');
  assert.deepEqual(['100', '1000'].map(moq => moqEligibility(1000, moq)), ['ELIGIBLE', 'ELIGIBLE']);
  assert.deepEqual(['100', '1000'].filter(moq => moqEligibility(1500, moq) === 'ELIGIBLE'), ['100', '1000']);
  assert.equal(moqEligibility(500, null), 'UNKNOWN');
  assert.equal(moqEligibility(500, 'not numeric'), 'UNKNOWN');
});

test('PE snapshot preserves the normalized MOQ and approved price independently of Opportunity price', () => {
  const snapshot = priceExceptionSnapshot({ ...line(102, '1000', '189.00'), sourceQuantityRaw: '1,000 units' });
  assert.equal(snapshot.priceExceptionLineId, 102);
  assert.equal(snapshot.priceExceptionCode, 'SPAZ12102025');
  assert.equal(snapshot.priceExceptionUnitPrice.toFixed(2), '189.00');
  assert.equal(snapshot.priceExceptionCurrencyCode, 'USD');
  assert.equal(snapshot.priceExceptionSourceQty, '1000');
});

test('Opportunity form parsing retains explicit PE provenance through a manual unit-price override', () => {
  const form = new FormData();
  for (const [key, value] of [['name','Deal'],['stageId','1'],['currencyCode','USD'],['accountId','7'],['participantRoles','DISTRIBUTOR'],['productId','3'],['skuId','9'],['quantity','500'],['price','185.00'],['priceSource','PRICE_EXCEPTION'],['catalogPriceTier',''],['priceExceptionLineId','102']]) form.append(key, value);
  const parsed = parseOpportunity(form);
  assert.deepEqual(parsed.errors, {});
  assert.equal(parsed.value.lines[0].price, '185.00');
  assert.equal(parsed.value.lines[0].priceSource, 'PRICE_EXCEPTION');
  assert.equal(parsed.value.lines[0].priceExceptionLineId, 102);
});

function saveDb({ existingLine = null, selectedLines = [], catalogPrices = [], odmPrices = [] } = {}) {
  const writes = [];
  const tx = {
    opportunity: { findUnique: async () => existingLine ? { id: 5, archivedAt: null, stageId: 1, projects: [] } : null, create: async () => ({ id: 5 }), update: async () => ({}) },
    opportunityProduct: { findMany: async () => existingLine ? [existingLine] : [], create: async ({ data }) => { writes.push(data); }, update: async ({ data }) => { writes.push(data); } },
    salesStage: { findUnique: async () => ({ id: 1, active: true }) }, currency: { findUnique: async () => ({ code: 'USD', active: true }) },
    user: { findUnique: async () => null }, account: { findMany: async () => [{ id: 7 }] }, product: { findMany: async () => [{ id: 3 }] }, project: { findMany: async () => [] },
    productSku: { findMany: async () => [{ id: 9, productId: 3, active: true }] }, productPrice: { findMany: async () => catalogPrices }, priceExceptionLine: { findMany: async () => selectedLines }, productSkuOdmCustomerPrice: { findMany: async () => odmPrices },
    opportunityProject: { delete: async () => ({}), create: async () => ({}) }, opportunityAccount: { findMany: async () => [], delete: async () => ({}), upsert: async () => ({}) }, opportunityAccountRole: { deleteMany: async () => ({}), create: async () => ({}) },
  };
  return { writes, client: { $transaction: async fn => fn(tx) } };
}
const input = lineInput => ({ name: 'Deal', description: null, ownerId: null, projectIds: [], stageId: 1, expectedCloseDate: null, probability: null, forecastCategory: null, currencyCode: 'USD', participants: [{ accountId: 7, roles: ['END_USER'] }], lines: [lineInput] });
const selectedLine = (overrides = {}) => ({ id: 102, productSkuId: 9, approvedUnitPrice: new Prisma.Decimal('189.00'), currencyCode: 'USD', sourceQuantity: new Prisma.Decimal('1000'), sourceQuantityRaw: '1000', sourceUnit: null, priceException: parent(), ...overrides });

test('ODM customer source snapshots final price and preserves it after terms change',async()=>{
  const selected={id:201,skuId:9,accountId:7,customerPrice:new Prisma.Decimal('100'),tariffPercent:new Prisma.Decimal('10'),tariffAmount:new Prisma.Decimal('10'),finalUnitPrice:new Prisma.Decimal('110'),currencyCode:'USD',effectiveDate:new Date('2026-09-01'),archivedAt:null,odmCustomer:{archivedAt:null,sku:{catalogSource:'ODM',odmSubtype:'CUSTOMER_SPECIFIC'}}};
  const line={productId:3,skuId:9,quantity:1,price:'110.00',priceSource:'ODM_CUSTOMER',catalogPriceTier:null,priceExceptionLineId:null,odmCustomerPriceId:201,odmCustomerAccountId:7};
  const created=saveDb({odmPrices:[selected]});await saveOpportunity(created.client,input(line));
  assert.equal(created.writes[0].odmCustomerBasePrice.toString(),'100');assert.equal(created.writes[0].odmCustomerTariffAmount.toString(),'10');assert.equal(created.writes[0].odmCustomerFinalUnitPrice.toString(),'110');
  const existing={...created.writes[0],id:55,opportunityId:5,archivedAt:null,estimatedUnitPrice:new Prisma.Decimal('110')};
  const changed={...selected,customerPrice:new Prisma.Decimal('120'),tariffPercent:new Prisma.Decimal('25'),tariffAmount:new Prisma.Decimal('30'),finalUnitPrice:new Prisma.Decimal('150'),archivedAt:new Date()};
  const historical=saveDb({existingLine:existing,odmPrices:[changed]});await saveOpportunity(historical.client,input({...line,id:55}),5);
  assert.equal(historical.writes[0].odmCustomerFinalUnitPrice.toString(),'110');
  await assert.rejects(saveOpportunity(saveDb({odmPrices:[selected]}).client,input({...line,price:'109.00'})),/must equal/);
  await assert.rejects(saveOpportunity(saveDb({odmPrices:[{...selected,accountId:8}]}).client,input({...line,odmCustomerAccountId:8})),/participating Account/);
});

test('saving an eligible PE price or manual override writes durable relationship and immutable MOQ snapshot', async () => {
  for (const opportunityPrice of ['189.00', '185.00']) {
    const db = saveDb({ selectedLines: [selectedLine()] });
    await saveOpportunity(db.client, input({ productId: 3, skuId: 9, quantity: 1000, price: opportunityPrice, priceSource: 'PRICE_EXCEPTION', catalogPriceTier: null, priceExceptionLineId: 102 }));
    const saved = db.writes[0];
    assert.equal(saved.estimatedUnitPrice, opportunityPrice);
    assert.equal(saved.priceExceptionLineId, 102);
    assert.equal(saved.priceExceptionCode, 'SPAZ12102025');
    assert.equal(saved.priceExceptionUnitPrice.toFixed(2), '189.00');
    assert.equal(saved.priceExceptionSourceQty, '1000');
  }
});

test('changing PE updates its snapshot while changing to catalog clears all PE provenance', async () => {
  const existing = { id: 55, opportunityId: 5, productId: 3, skuId: 9, quantity: 500, estimatedUnitPrice: new Prisma.Decimal('185'), archivedAt: null, priceSource: 'PRICE_EXCEPTION', catalogPriceTier: null, priceExceptionLineId: 102, priceExceptionCode: 'OLD', priceExceptionUnitPrice: new Prisma.Decimal('189'), priceExceptionCurrencyCode: 'USD', priceExceptionSourceQty: '1000' };
  const changed = saveDb({ existingLine: existing, selectedLines: [selectedLine({ id: 103, approvedUnitPrice: new Prisma.Decimal('180'), sourceQuantity: new Prisma.Decimal('2000'), sourceQuantityRaw: '2000' })] });
  await saveOpportunity(changed.client, input({ id: 55, productId: 3, skuId: 9, quantity: 2000, price: '180.00', priceSource: 'PRICE_EXCEPTION', catalogPriceTier: null, priceExceptionLineId: 103 }), 5);
  assert.equal(changed.writes[0].priceExceptionLineId, 103);
  assert.equal(changed.writes[0].priceExceptionUnitPrice.toFixed(2), '180.00');
  assert.equal(changed.writes[0].priceExceptionSourceQty, '2000');
  const catalog = saveDb({ existingLine: existing, catalogPrices: [{ skuId: 9, currencyCode: 'USD', tier: 'STANDARD' }] });
  await saveOpportunity(catalog.client, input({ id: 55, productId: 3, skuId: 9, quantity: 500, price: '225.00', priceSource: 'CATALOG', catalogPriceTier: 'STANDARD', priceExceptionLineId: null }), 5);
  assert.equal(catalog.writes[0].priceSource, 'CATALOG');
  assert.equal(catalog.writes[0].catalogPriceTier, 'STANDARD');
  assert.equal(catalog.writes[0].priceExceptionLineId, null);
  assert.equal(catalog.writes[0].priceExceptionUnitPrice, null);
});

test('expired or archived PEs cannot be newly selected, but an unchanged historical selection stays saveable with its old snapshot', async () => {
  const oldSnapshot = { id: 55, opportunityId: 5, productId: 3, skuId: 9, quantity: 500, estimatedUnitPrice: new Prisma.Decimal('185'), archivedAt: null, priceSource: 'PRICE_EXCEPTION', catalogPriceTier: null, priceExceptionLineId: 102, priceExceptionCode: 'HISTORICAL', priceExceptionUnitPrice: new Prisma.Decimal('189'), priceExceptionCurrencyCode: 'USD', priceExceptionSourceQty: '1000' };
  const expired = selectedLine({ approvedUnitPrice: new Prisma.Decimal('170'), priceException: parent({ expirationDate: new Date('2020-01-01T00:00:00Z') }) });
  await assert.rejects(saveOpportunity(saveDb({ selectedLines: [expired] }).client, input({ productId: 3, skuId: 9, quantity: 1000, price: '170.00', priceSource: 'PRICE_EXCEPTION', catalogPriceTier: null, priceExceptionLineId: 102 })), /no longer available/);
  const archived = selectedLine({ priceException: parent({ archivedAt: new Date(), status: 'ARCHIVED' }) });
  await assert.rejects(saveOpportunity(saveDb({ selectedLines: [archived] }).client, input({ productId: 3, skuId: 9, quantity: 1000, price: '189.00', priceSource: 'PRICE_EXCEPTION', catalogPriceTier: null, priceExceptionLineId: 102 })), /no longer available/);
  const historical = saveDb({ existingLine: oldSnapshot, selectedLines: [expired] });
  await saveOpportunity(historical.client, input({ id: 55, productId: 3, skuId: 9, quantity: 500, price: '185.00', priceSource: 'PRICE_EXCEPTION', catalogPriceTier: null, priceExceptionLineId: 102 }), 5);
  assert.equal(historical.writes[0].priceExceptionCode, 'HISTORICAL');
  assert.equal(historical.writes[0].priceExceptionUnitPrice.toFixed(2), '189.00');
  assert.equal(historical.writes[0].estimatedUnitPrice, '185.00');
  const sourceChanged = saveDb({ existingLine: oldSnapshot, selectedLines: [selectedLine({ productSkuId: null, approvedUnitPrice: null, currencyCode: 'EUR' })] });
  await saveOpportunity(sourceChanged.client, input({ id: 55, productId: 3, skuId: 9, quantity: 500, price: '185.00', priceSource: 'PRICE_EXCEPTION', catalogPriceTier: null, priceExceptionLineId: 102 }), 5);
  assert.equal(sourceChanged.writes[0].priceExceptionCurrencyCode, 'USD');
  assert.equal(sourceChanged.writes[0].priceExceptionUnitPrice.toFixed(2), '189.00');
});

test('new or modified PE pricing is blocked below MOQ while unchanged historical pricing is preserved', async () => {
  await assert.rejects(saveOpportunity(saveDb({ selectedLines: [selectedLine()] }).client, input({ productId: 3, skuId: 9, quantity: 500, price: '189.00', priceSource: 'PRICE_EXCEPTION', catalogPriceTier: null, priceExceptionLineId: 102 })), /does not meet.*MOQ/);
  const eligibleExisting = { id: 55, opportunityId: 5, productId: 3, skuId: 9, quantity: 1000, estimatedUnitPrice: new Prisma.Decimal('189'), archivedAt: null, priceSource: 'PRICE_EXCEPTION', catalogPriceTier: null, priceExceptionLineId: 102, priceExceptionCode: 'SPAZ12102025', priceExceptionUnitPrice: new Prisma.Decimal('189'), priceExceptionCurrencyCode: 'USD', priceExceptionSourceQty: '1000' };
  await assert.rejects(saveOpportunity(saveDb({ existingLine: eligibleExisting, selectedLines: [selectedLine()] }).client, input({ id: 55, productId: 3, skuId: 9, quantity: 500, price: '189.00', priceSource: 'PRICE_EXCEPTION', catalogPriceTier: null, priceExceptionLineId: 102 }), 5), /does not meet.*MOQ/);
  const historical = { ...eligibleExisting, quantity: 500 };
  const unchanged = saveDb({ existingLine: historical, selectedLines: [selectedLine()] });
  await saveOpportunity(unchanged.client, input({ id: 55, productId: 3, skuId: 9, quantity: 500, price: '189.00', priceSource: 'PRICE_EXCEPTION', catalogPriceTier: null, priceExceptionLineId: 102 }), 5);
  assert.equal(unchanged.writes[0].priceExceptionSourceQty, '1000');
  await assert.rejects(saveOpportunity(saveDb({ existingLine: historical, selectedLines: [selectedLine()] }).client, input({ id: 55, productId: 3, skuId: 9, quantity: 500, price: '185.00', priceSource: 'PRICE_EXCEPTION', catalogPriceTier: null, priceExceptionLineId: 102 }), 5), /does not meet.*MOQ/);
});

test('missing normalized MOQ remains discoverable but cannot be directly applied', async () => {
  const unknown = selectedLine({ sourceQuantity: null, sourceQuantityRaw: 'call for quantity' });
  const db = { priceExceptionLine: { findMany: async () => [unknown] } };
  const [candidate] = await findPriceExceptionCandidates(db, { skuId: 9, currencyCode: 'USD', opportunityAccountIds: [7], relatedOnly: false });
  assert.equal(candidate.moq, null);
  assert.equal(candidate.moqRaw, 'call for quantity');
  await assert.rejects(saveOpportunity(saveDb({ selectedLines: [unknown] }).client, input({ productId: 3, skuId: 9, quantity: 5000, price: '189.00', priceSource: 'PRICE_EXCEPTION', catalogPriceTier: null, priceExceptionLineId: 102 })), /no resolved numeric MOQ/);
});

test('schema, importer, detail UI, and authorization encode historical and read-only safety', () => {
  const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
  const migration = fs.readFileSync(path.join(root, 'prisma/migrations/20260920220000_opportunity_product_price_exception/migration.sql'), 'utf8');
  const importer = fs.readFileSync(path.join(root, 'lib/price-exception-import.ts'), 'utf8');
  const detail = fs.readFileSync(path.join(root, 'app/opportunities/[id]/page.tsx'), 'utf8');
  const picker = fs.readFileSync(path.join(root, 'components/product-picker.tsx'), 'utf8');
  const peDetail = fs.readFileSync(path.join(root, 'app/price-exceptions/[id]/page.tsx'), 'utf8');
  assert.match(schema, /priceExceptionLine\s+PriceExceptionLine\?.*onDelete: Restrict/);
  assert.match(migration, /DEFAULT 'MANUAL'/);
  assert.doesNotMatch(migration, /UPDATE\s+"OpportunityProduct"/i);
  assert.match(importer, /opportunityProducts:\{none:\{\}\}/);
  assert.match(detail, /manual override/);
  assert.match(detail, /price-exceptions\/\$\{line\.priceExceptionLine\.priceExceptionId\}/);
  assert.match(picker, /Search all Price Exceptions for this SKU/);
  assert.match(picker, /No linked Price Exception Account matches this Opportunity/);
  assert.match(picker, /Eligible/);
  assert.match(picker, /Not eligible/);
  assert.match(picker, /Unknown MOQ/);
  assert.doesNotMatch(picker, /Source Qty|source quantity/);
  assert.match(peDetail, /minimum order quantity/);
  assert.doesNotMatch(peDetail, />Source quantity</);
  for (const role of ['ADMIN', 'SALES_MANAGER', 'SALES']) assert.equal(can({ id: 1, role, active: true }, 'sales.write'), true);
  assert.equal(can({ id: 1, role: 'READ_ONLY', active: true }, 'sales.write'), false);
});
