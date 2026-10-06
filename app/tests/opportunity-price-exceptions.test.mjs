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
const { priceExceptionMatchesParticipants, unrelatedPriceExceptionMessage } = require(path.join(root, 'lib/price-exception-account-match.ts'));
const { editLineUnitPrice } = require(path.join(root, 'lib/opportunity-draft.ts'));
const { parseOpportunity, saveOpportunity: saveOpportunityWithActor } = require(path.join(root, 'lib/opportunities.ts'));
const { can } = require(path.join(root, 'lib/authorization.ts'));
const saveOpportunity = (client, input, id) => saveOpportunityWithActor(client, input, id, { id: 1, role: 'ADMIN', active: true });

const parent = (overrides = {}) => ({ id: 40, peCode: 'SPAZ12102025', status: 'ACTIVE', archivedAt: null, expirationDate: new Date('2026-12-31T00:00:00Z'), distributorAccountId: 7, varAccountId: null, endUserAccountId: null, distributorSourceName: 'Blue Star', varSourceName: 'Legacy VAR', endUserSourceName: null, sourceDescription: 'Approved deal price', distributorAccount: { id: 7, name: 'Blue Star' }, varAccount: null, endUserAccount: null, ...overrides });
const line = (id, quantity, price, pe = parent()) => ({ id, priceExceptionId: pe.id, productSkuId: 9, approvedUnitPrice: new Prisma.Decimal(price), currencyCode: 'USD', sourceQuantity: new Prisma.Decimal(quantity), sourceQuantityRaw: quantity, sourceUnit: null, comments: null, sortOrder: id, priceException: pe });
const participants = [{ accountId: 7, roles: ['DISTRIBUTOR'] }];

test('candidate eligibility is exact resolved SKU, active/unarchived, unexpired, priced, and same currency', () => {
  const where = priceExceptionEligibilityWhere(9, 'USD', new Date('2026-09-20T15:00:00Z'));
  assert.equal(where.productSkuId, 9);
  assert.equal(where.retiredAt, null);
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
  const options = await findPriceExceptionCandidates(db, { skuId: 9, currencyCode: 'USD', opportunityParticipants: participants, relatedOnly: true, today: new Date('2026-09-20') });
  assert.deepEqual(options.map(option => [option.lineId, option.moq, option.unitPrice]), [[101, '100', '193.55'], [102, '1000', '189.00']]);
  assert.deepEqual(options.filter(option => moqEligibility(1000, option.moq) === 'ELIGIBLE').map(option => option.lineId), [101, 102]);
  assert.ok(options.every(option => !('selected' in option)));
  assert.deepEqual(options[0].matchedRoles, ['Distributor/OEM']);
  assert.ok(options.every(option => option.applicable));
  const accountClause = query.where.priceException.AND[1].OR;
  assert.ok(accountClause.every(condition => Object.values(condition)[0].id.in[0] === 7 && Object.values(condition)[0].archivedAt === null));
});

test('search-all returns an otherwise valid unrelated PE with warning context and never confirms raw party text', async () => {
  const unresolved = parent({ id: 41, distributorAccountId: null, distributorAccount: null, distributorSourceName: 'Possibly Blue Star' });
  const db = { priceExceptionLine: { findMany: async () => [line(103, '1000', '189.00', unresolved)] } };
  const [option] = await findPriceExceptionCandidates(db, { skuId: 9, currencyCode: 'USD', opportunityParticipants: participants, relatedOnly: false, query: '189' });
  assert.deepEqual(option.matchedRoles, []);
  assert.equal(option.parties[0].sourceName, 'Possibly Blue Star');
  assert.equal(option.parties[0].matchesOpportunity, false);
  assert.equal(option.applicable, false);
  assert.equal(priceExceptionMatchesParticipants(option.accountLinks, participants), false);
  assert.equal(moqEligibility(1000, option.moq), 'ELIGIBLE');
  const [wrongRole] = await findPriceExceptionCandidates({ priceExceptionLine: { findMany: async () => [line(104, '1000', '189.00')] } }, { skuId: 9, currencyCode: 'USD', opportunityParticipants: [{ accountId: 7, roles: ['END_USER'] }], relatedOnly: false });
  assert.equal(wrongRole.applicable, false);
  assert.deepEqual(wrongRole.matchedRoles, []);
});

test('PE selection requires a linked Account in the applicable deal role and becomes invalid after Account removal', () => {
  const links = { distributorAccountId: 7, varAccountId: 8, endUserAccountId: 9 };
  assert.equal(priceExceptionMatchesParticipants(links, participants), true);
  assert.equal(priceExceptionMatchesParticipants(links, [{ accountId: 7, roles: ['END_USER'] }]), false);
  assert.equal(priceExceptionMatchesParticipants(links, [{ accountId: 8, roles: ['ISV_PARTNER'] }]), true);
  assert.equal(priceExceptionMatchesParticipants(links, [{ accountId: 9, roles: ['END_USER'] }]), true);
  assert.equal(priceExceptionMatchesParticipants(links, []), false);
  assert.equal(priceExceptionMatchesParticipants(links, [{ accountId: 10, roles: ['DISTRIBUTOR'] }]), false);
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

test('Opportunity form parsing still validates source fields; the save path checks stored amounts', () => {
  const form = new FormData();
  for (const [key, value] of [['name','Deal'],['stageId','1'],['currencyCode','USD'],['accountId','7'],['participantRoles','DISTRIBUTOR'],['productId','3'],['skuId','9'],['quantity','500'],['price','185.00'],['priceSource','PRICE_EXCEPTION'],['catalogPriceTier',''],['priceExceptionLineId','102']]) form.append(key, value);
  const parsed = parseOpportunity(form);
  assert.deepEqual(parsed.errors, {});
  assert.equal(parsed.value.lines[0].price, '185.00');
  assert.equal(parsed.value.lines[0].priceSource, 'PRICE_EXCEPTION');
  assert.equal(parsed.value.lines[0].priceExceptionLineId, 102);
});
test('unselected product text is rejected by server parsing, while a selected SKU is accepted', () => {
  const form = new FormData();
  for (const [key, value] of [['name','Deal'],['stageId','1'],['currencyCode','USD'],['accountId','7'],['participantRoles','DISTRIBUTOR'],['productId',''],['skuId',''],['productSearchText','XT5-40NRFS'],['quantity','2'],['price','35.00'],['priceSource','MANUAL']]) form.append(key, value);
  assert.equal(parseOpportunity(form).errors.lines, 'Select a product from the suggestions.');
  form.set('productId', '3');
  form.set('skuId', '9');
  form.set('productSearchText', '');
  assert.deepEqual(parseOpportunity(form).errors, {});
});

function saveDb({ existingLine = null, selectedLines = [], catalogPrices = [], odmPrices = [] } = {}) {
  const writes = [];
  const tx = {
    opportunity: { findUnique: async () => existingLine ? { id: 5, archivedAt: null, stageId: 1, projects: [], participants: [], stage: { name: 'Open' }, owner: null, forecastCategory: 'PIPELINE', expectedCloseDate: null, ownerId: null, probability: null, currencyCode: 'USD' } : null, create: async () => ({ id: 5 }), update: async () => ({}) },
    opportunityProduct: { findMany: async () => existingLine ? [existingLine] : [], create: async ({ data }) => { writes.push(data); }, update: async ({ data }) => { writes.push(data); } },
    salesStage: { findUnique: async () => ({ id: 1, name: 'Open', active: true }) }, currency: { findUnique: async () => ({ code: 'USD', active: true }) },
    user: { findUnique: async () => null }, account: { findMany: async args => args.where.id.in.map(id => ({ id })) }, product: { findMany: async () => [{ id: 3 }] }, project: { findMany: async () => [] },
    productSku: { findMany: async () => [{ id: 9, productId: 3, active: true }] }, productPrice: { findMany: async () => catalogPrices }, priceExceptionLine: { findMany: async () => selectedLines }, productSkuOdmCustomerPrice: { findMany: async () => odmPrices },
    opportunityProject: { delete: async () => ({}), create: async () => ({}) }, opportunityAccount: { findMany: async () => [], delete: async () => ({}), upsert: async () => ({}) }, opportunityAccountRole: { deleteMany: async () => ({}), create: async () => ({}) },
    opportunityHistoryEvent: { createMany: async () => ({ count: 1 }) },
  };
  return { writes, client: { $transaction: async fn => fn(tx) } };
}
const input = lineInput => ({ name: 'Deal', description: null, ownerId: null, projectIds: [], stageId: 1, expectedCloseDate: null, probability: null, forecastCategory: null, currencyCode: 'USD', participants, lines: [lineInput] });
const selectedLine = (overrides = {}) => ({ id: 102, productSkuId: 9, approvedUnitPrice: new Prisma.Decimal('189.00'), currencyCode: 'USD', sourceQuantity: new Prisma.Decimal('1000'), sourceQuantityRaw: '1000', sourceUnit: null, priceException: parent(), ...overrides });

test('stale or invalid SKU ID fails before Opportunity writes', async () => {
  const db = saveDb();
  await assert.rejects(saveOpportunity(db.client, input({ productId: 3, skuId: 999, quantity: 2, price: '35.00' })), /Select a product from the suggestions/);
  assert.deepEqual(db.writes, []);
});

test('ODM customer source snapshots final price and preserves it after terms change',async()=>{
  const selected={id:201,skuId:9,accountId:7,customerPrice:new Prisma.Decimal('100'),tariffPercent:new Prisma.Decimal('10'),tariffAmount:new Prisma.Decimal('10'),finalUnitPrice:new Prisma.Decimal('110'),currencyCode:'USD',effectiveDate:new Date('2026-09-01'),archivedAt:null,odmCustomer:{archivedAt:null,sku:{catalogSource:'ODM',odmSubtype:'CUSTOMER_SPECIFIC'}}};
  const line={productId:3,skuId:9,quantity:1,price:'110.00',priceSource:'ODM_CUSTOMER',catalogPriceTier:null,priceExceptionLineId:null,odmCustomerPriceId:201,odmCustomerAccountId:7};
  const created=saveDb({odmPrices:[selected]});await saveOpportunity(created.client,input(line));
  assert.equal(created.writes[0].odmCustomerBasePrice.toString(),'100');assert.equal(created.writes[0].odmCustomerTariffAmount.toString(),'10');assert.equal(created.writes[0].odmCustomerFinalUnitPrice.toString(),'110');
  const special=saveDb({odmPrices:[{...selected,odmCustomer:{...selected.odmCustomer,sku:{catalogSource:'ODM',odmSubtype:'SPECIAL_CONFIGURATION'}}}]});
  await saveOpportunity(special.client,input(line));
  assert.equal(special.writes[0].odmCustomerFinalUnitPrice.toString(),'110');
  const existing={...created.writes[0],id:55,opportunityId:5,archivedAt:null,estimatedUnitPrice:new Prisma.Decimal('110')};
  const changed={...selected,customerPrice:new Prisma.Decimal('120'),tariffPercent:new Prisma.Decimal('25'),tariffAmount:new Prisma.Decimal('30'),finalUnitPrice:new Prisma.Decimal('150'),archivedAt:new Date()};
  const historical=saveDb({existingLine:existing,odmPrices:[changed]});await saveOpportunity(historical.client,input({...line,id:55}),5);
  assert.equal(historical.writes[0].odmCustomerFinalUnitPrice.toString(),'110');
  await assert.rejects(saveOpportunity(saveDb({odmPrices:[selected]}).client,input({...line,price:'109.00'})),/must equal/);
  await assert.rejects(saveOpportunity(saveDb({odmPrices:[{...selected,accountId:8}]}).client,input({...line,odmCustomerAccountId:8})),/participating Account/);
});

test('new and existing lines save zero and nonzero tariff Account prices and switch pricing sources', async () => {
  const customer = (price, tariff, amount, final) => ({ id: 201, skuId: 9, accountId: 7, customerPrice: new Prisma.Decimal(price), tariffPercent: new Prisma.Decimal(tariff), tariffAmount: new Prisma.Decimal(amount), finalUnitPrice: new Prisma.Decimal(final), currencyCode: 'USD', effectiveDate: null, archivedAt: null, odmCustomer: { archivedAt: null, sku: { catalogSource: 'PRICE_LIST', odmSubtype: null } } });
  const accountLine = (price, id) => ({ ...(id ? { id } : {}), productId: 3, skuId: 9, quantity: 1000, price, priceSource: 'ODM_CUSTOMER', catalogPriceTier: null, priceExceptionLineId: null, odmCustomerPriceId: 201, odmCustomerAccountId: 7 });
  const manualLine = id => ({ id, productId: 3, skuId: 9, quantity: 1000, price: '425.70', priceSource: 'MANUAL', catalogPriceTier: null, priceExceptionLineId: null });
  const old = (data, price) => ({ ...data, id: 55, opportunityId: 5, archivedAt: null, estimatedUnitPrice: new Prisma.Decimal(price) });
  const zero = customer('425.70', '0', '0', '425.70');
  const nonzero = customer('400', '10', '40', '440');

  for (const [selection, price] of [[zero, '425.70'], [nonzero, '440.00']]) {
    const created = saveDb({ odmPrices: [selection] });
    await saveOpportunity(created.client, input(accountLine(price)));
    assert.equal(created.writes[0].odmCustomerPriceId, 201);
    assert.equal(created.writes[0].odmCustomerAccountId, 7);
    assert.equal(created.writes[0].odmCustomerTariffAmount.toString(), selection.tariffAmount.toString());
    assert.equal(created.writes[0].odmCustomerFinalUnitPrice.toString(), selection.finalUnitPrice.toString());
    assert.equal(created.writes[0].odmCustomerCurrencyCode, 'USD');
    assert.equal(created.writes[0].priceExceptionLineId, null);
    const existing = saveDb({ existingLine: old(created.writes[0], price), odmPrices: [selection] });
    await saveOpportunity(existing.client, input(accountLine(price, 55)), 5);
    assert.equal(existing.writes[0].odmCustomerFinalUnitPrice.toString(), selection.finalUnitPrice.toString());
  }

  const manual = saveDb();
  await saveOpportunity(manual.client, input(manualLine()));
  const fromManual = saveDb({ existingLine: old(manual.writes[0], '425.70'), odmPrices: [zero] });
  await saveOpportunity(fromManual.client, input(accountLine('425.70', 55)), 5);
  assert.equal(fromManual.writes[0].odmCustomerPriceId, 201);

  const toManual = saveDb({ existingLine: old(fromManual.writes[0], '425.70') });
  await saveOpportunity(toManual.client, input(manualLine(55)), 5);
  assert.equal(toManual.writes[0].priceSource, 'MANUAL');
  assert.equal(toManual.writes[0].odmCustomerPriceId, null);
  assert.equal(toManual.writes[0].odmCustomerFinalUnitPrice, null);

  const peLine = { id: 55, productId: 3, skuId: 9, quantity: 1000, price: '189.00', priceSource: 'PRICE_EXCEPTION', catalogPriceTier: null, priceExceptionLineId: 102 };
  const toPe = saveDb({ existingLine: old(fromManual.writes[0], '425.70'), selectedLines: [selectedLine()] });
  await saveOpportunity(toPe.client, input(peLine), 5);
  assert.equal(toPe.writes[0].priceExceptionLineId, 102);
  assert.equal(toPe.writes[0].odmCustomerPriceId, null);
  const fromPe = saveDb({ existingLine: old(toPe.writes[0], '189.00'), odmPrices: [zero] });
  await saveOpportunity(fromPe.client, input(accountLine('425.70', 55)), 5);
  assert.equal(fromPe.writes[0].odmCustomerPriceId, 201);
  assert.equal(fromPe.writes[0].priceExceptionLineId, null);
  assert.equal(fromPe.writes[0].priceExceptionUnitPrice, null);
});

test('saving an eligible PE writes its approved price and snapshot; direct overrides are rejected', async () => {
  const db = saveDb({ selectedLines: [selectedLine()] });
  await saveOpportunity(db.client, input({ productId: 3, skuId: 9, quantity: 1000, price: '189.00', priceSource: 'PRICE_EXCEPTION', catalogPriceTier: null, priceExceptionLineId: 102 }));
  const saved = db.writes[0];
  assert.equal(saved.estimatedUnitPrice, '189.00');
  assert.equal(saved.priceExceptionLineId, 102);
  assert.equal(saved.priceExceptionCode, 'SPAZ12102025');
  assert.equal(saved.priceExceptionUnitPrice.toFixed(2), '189.00');
  assert.equal(saved.priceExceptionSourceQty, '1000');
  await assert.rejects(saveOpportunity(saveDb({ selectedLines: [selectedLine()] }).client, input({ productId: 3, skuId: 9, quantity: 1000, price: '185.00', priceSource: 'PRICE_EXCEPTION', catalogPriceTier: null, priceExceptionLineId: 102 })), /requires Manual price/);
});

test('unrelated or wrongly classified PE Account is rejected on save, including after Account removal', async () => {
  const peLine = { productId: 3, skuId: 9, quantity: 1000, price: '189.00', priceSource: 'PRICE_EXCEPTION', catalogPriceTier: null, priceExceptionLineId: 102 };
  for (const changedParticipants of [
    [{ accountId: 8, roles: ['DISTRIBUTOR'] }],
    [{ accountId: 7, roles: ['END_USER'] }],
  ]) {
    await assert.rejects(saveOpportunity(saveDb({ selectedLines: [selectedLine()] }).client, { ...input(peLine), participants: changedParticipants }), error => error.message === unrelatedPriceExceptionMessage);
  }
  const existing = { id: 55, opportunityId: 5, archivedAt: null, estimatedUnitPrice: new Prisma.Decimal('189'), ...peLine, priceExceptionCurrencyCode: 'USD' };
  await assert.rejects(saveOpportunity(saveDb({ existingLine: existing, selectedLines: [selectedLine()] }).client, { ...input({ ...peLine, id: 55 }), participants: [{ accountId: 8, roles: ['DISTRIBUTOR'] }] }, 5), error => error.message === unrelatedPriceExceptionMessage);
});

test('editing a PE or Price List amount switches to Manual and clears pricing provenance', async () => {
  const base = { id: 55, productId: 3, skuId: 9, quantity: '1000', price: '189.00', priceSource: 'PRICE_EXCEPTION', catalogPriceTier: null, priceExceptionLineId: 102, priceExceptionCode: 'SPAZ12102025', priceExceptionUnitPrice: '189.00', priceExceptionCurrencyCode: 'USD', priceExceptionSourceQty: '1000', priceExceptionAccountIds: [7], priceExceptionAccounts: { distributorAccountId: 7, varAccountId: null, endUserAccountId: null } };
  const manualPe = editLineUnitPrice(base, '185.00');
  assert.equal(manualPe.priceSource, 'MANUAL');
  assert.equal(manualPe.priceExceptionLineId, null);
  assert.equal(manualPe.priceExceptionCode, null);
  assert.equal(manualPe.priceExceptionAccounts, null);
  const savedManual = saveDb();
  await saveOpportunity(savedManual.client, input({ productId: 3, skuId: 9, quantity: 1000, price: manualPe.price, priceSource: manualPe.priceSource, catalogPriceTier: manualPe.catalogPriceTier, priceExceptionLineId: manualPe.priceExceptionLineId }));
  assert.equal(savedManual.writes[0].priceSource, 'MANUAL');
  assert.equal(savedManual.writes[0].priceExceptionLineId, null);
  const manualList = editLineUnitPrice({ ...base, priceSource: 'CATALOG', catalogPriceTier: 'STANDARD', priceExceptionLineId: null }, '180.00');
  assert.equal(manualList.priceSource, 'MANUAL');
  assert.equal(manualList.catalogPriceTier, null);
  assert.equal(editLineUnitPrice(base, '189.00').priceSource, 'PRICE_EXCEPTION');
});

test('unchanged historical Price List price is retained when the current published amount changes', async () => {
  const existing = { id: 55, opportunityId: 5, productId: 3, skuId: 9, quantity: 1, estimatedUnitPrice: new Prisma.Decimal('200'), archivedAt: null, priceSource: 'CATALOG', catalogPriceTier: 'STANDARD' };
  const db = saveDb({ existingLine: existing, catalogPrices: [{ skuId: 9, currencyCode: 'USD', tier: 'STANDARD', amount: new Prisma.Decimal('225') }] });
  await saveOpportunity(db.client, input({ id: 55, productId: 3, skuId: 9, quantity: 1, price: '200.00', priceSource: 'CATALOG', catalogPriceTier: 'STANDARD', priceExceptionLineId: null }), 5);
  assert.equal(db.writes[0].priceSource, 'CATALOG');
  assert.equal(db.writes[0].estimatedUnitPrice, '200.00');
});

test('changing PE updates its snapshot while changing to catalog clears all PE provenance', async () => {
  const existing = { id: 55, opportunityId: 5, productId: 3, skuId: 9, quantity: 500, estimatedUnitPrice: new Prisma.Decimal('185'), archivedAt: null, priceSource: 'PRICE_EXCEPTION', catalogPriceTier: null, priceExceptionLineId: 102, priceExceptionCode: 'OLD', priceExceptionUnitPrice: new Prisma.Decimal('189'), priceExceptionCurrencyCode: 'USD', priceExceptionSourceQty: '1000' };
  const changed = saveDb({ existingLine: existing, selectedLines: [selectedLine({ id: 103, approvedUnitPrice: new Prisma.Decimal('180'), sourceQuantity: new Prisma.Decimal('2000'), sourceQuantityRaw: '2000' })] });
  await saveOpportunity(changed.client, input({ id: 55, productId: 3, skuId: 9, quantity: 2000, price: '180.00', priceSource: 'PRICE_EXCEPTION', catalogPriceTier: null, priceExceptionLineId: 103 }), 5);
  assert.equal(changed.writes[0].priceExceptionLineId, 103);
  assert.equal(changed.writes[0].priceExceptionUnitPrice.toFixed(2), '180.00');
  assert.equal(changed.writes[0].priceExceptionSourceQty, '2000');
  const catalog = saveDb({ existingLine: existing, catalogPrices: [{ skuId: 9, currencyCode: 'USD', tier: 'STANDARD', amount: new Prisma.Decimal('225.00') }] });
  await saveOpportunity(catalog.client, input({ id: 55, productId: 3, skuId: 9, quantity: 500, price: '225.00', priceSource: 'CATALOG', catalogPriceTier: 'STANDARD', priceExceptionLineId: null }), 5);
  assert.equal(catalog.writes[0].priceSource, 'CATALOG');
  assert.equal(catalog.writes[0].catalogPriceTier, 'STANDARD');
  assert.equal(catalog.writes[0].priceExceptionLineId, null);
  assert.equal(catalog.writes[0].priceExceptionUnitPrice, null);
  await assert.rejects(saveOpportunity(saveDb({ catalogPrices: [{ skuId: 9, currencyCode: 'USD', tier: 'STANDARD', amount: new Prisma.Decimal('225.00') }] }).client, input({ productId: 3, skuId: 9, quantity: 500, price: '220.00', priceSource: 'CATALOG', catalogPriceTier: 'STANDARD', priceExceptionLineId: null })), /requires Manual price/);
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
  const [candidate] = await findPriceExceptionCandidates(db, { skuId: 9, currencyCode: 'USD', opportunityParticipants: [{ accountId: 7, roles: ['DISTRIBUTOR'] }], relatedOnly: false });
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
  assert.match(picker, /unrelatedPriceExceptionMessage/);
  assert.match(picker, /const selectable = state === "ELIGIBLE" && option\.applicable/);
  assert.match(picker, /Customer Pricing/);
  assert.match(picker, /Price List —/);
  assert.match(picker, /Eligible/);
  assert.match(picker, /Not eligible/);
  assert.match(picker, /Unknown MOQ/);
  assert.doesNotMatch(picker, /Source Qty|source quantity/);
  assert.match(peDetail, /minimum order quantity/);
  assert.doesNotMatch(peDetail, />Source quantity</);
  for (const role of ['ADMIN', 'SALES_MANAGER', 'SALES']) assert.equal(can({ id: 1, role, active: true }, 'sales.write'), true);
  assert.equal(can({ id: 1, role: 'READ_ONLY', active: true }, 'sales.write'), false);
});
