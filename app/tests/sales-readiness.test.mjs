import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filename = path.join(root, 'lib/sales-readiness.ts');
const source = fs.readFileSync(filename, 'utf8');
const mod = new Module(filename);
mod.filename = filename;
mod.paths = Module._nodeModulePaths(path.dirname(filename));
mod._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const { accountDuplicateMatches, findAccountDuplicates, accountSaveReview, opportunityDuplicateMatches, missingForecastFields, opportunitySaveReview, reviewFingerprint } = mod.exports;
const account = (id, name, extra = {}) => ({ id, name, website: null, addressLine1: null, postalCode: null, archivedAt: null, ...extra });
const opportunity = (extra = {}) => ({ name: 'Printer rollout', ownerId: 9, expectedCloseDate: new Date('2026-12-01T12:00:00Z'), participants: [{ accountId: 2 }], projectIds: [7], lines: [{ productId: 1, quantity: 2, price: '50.00' }], ...extra });
const deal = (id, extra = {}) => ({ id, name: 'Printer rollout', ownerId: 9, expectedCloseDate: new Date('2026-11-01T12:00:00Z'), participants: [{ accountId: 2 }], projects: [{ projectId: 7 }], ...extra });
test('exact normalized Account name warns and links the existing record', async () => {
  const input = { name: ' ACME, Inc. ', website: null, addressLine1: null, postalCode: null };
  const matches = await findAccountDuplicates({ account: { findMany: async () => [account(4, 'acme inc')] } }, input);
  assert.deepEqual(matches.map(match => [match.id, match.exact, match.reason]), [[4, true, 'Same normalized name']]);
});
test('fuzzy Account match warns by company suffix, domain or address', () => {
  const input = { name: 'Acme LLC', website: 'https://acme.example', addressLine1: '12 Main St', postalCode: '10001' };
  const matches = accountDuplicateMatches(input, [account(1, 'Acme Incorporated'), account(2, 'Unrelated', { website: 'https://www.acme.example' }), account(3, 'Different', { addressLine1: '12 main st', postalCode: '10001' })]);
  assert.deepEqual(matches.map(match => match.id), [1, 2, 3]);
  assert(matches.every(match => !match.exact));
});
test('distinct Account can proceed without a duplicate review', () => {
  assert.deepEqual(accountDuplicateMatches({ name: 'New Buyer', website: 'https://new.example', addressLine1: null, postalCode: null }, [account(1, 'Acme LLC')]), []);
});
test('Account review is required on first save and Save anyway remains possible', async () => {
  const input = { name: 'Acme', website: null, addressLine1: null, postalCode: null };
  const client = { account: { findMany: async () => [account(4, 'ACME')] } };
  const first = await accountSaveReview(client, input, new FormData());
  assert.equal(first.matches[0].exact, true);
  const reviewed = new FormData(); reviewed.set('reviewedDuplicates', first.reviewToken);
  assert.equal(await accountSaveReview(client, input, reviewed), null);
  assert.notEqual(await accountSaveReview(client, { ...input, name: 'Acme Inc' }, reviewed), null);
  assert.equal(await accountSaveReview({ account: { findMany: async () => [] } }, input, new FormData()), null);
});
test('likely duplicate Opportunity warns and distinct deals can proceed', () => {
  assert.equal(opportunityDuplicateMatches(opportunity(), [deal(5)])[0].id, 5);
  assert.deepEqual(opportunityDuplicateMatches(opportunity(), [deal(6, { name: 'Printer rollout phase two', projects: [], ownerId: 3, expectedCloseDate: new Date('2027-05-01T12:00:00Z') }), deal(7, { participants: [{ accountId: 99 }] })]), []);
});
test('server Opportunity review shows likely matches and allows a reviewed separate deal', async () => {
  const input = opportunity();
  const client = { opportunity: { findMany: async () => [deal(5)] } };
  const first = await opportunitySaveReview(client, input, new FormData());
  assert.equal(first.matches[0].id, 5);
  const reviewed = new FormData(); reviewed.set('reviewedOpportunity', first.reviewToken);
  assert.equal(await opportunitySaveReview(client, input, reviewed), null);
});
test('missing forecast fields are individually reminded, and reviewed save can proceed', async () => {
  assert.deepEqual(missingForecastFields(opportunity({ expectedCloseDate: null })), ['closeDate']);
  assert.deepEqual(missingForecastFields(opportunity({ ownerId: null })), ['owner']);
  assert.deepEqual(missingForecastFields(opportunity({ lines: [] })), ['products']);
  assert.deepEqual(missingForecastFields(opportunity({ lines: [{ productId: 1, quantity: 1, price: '0.00' }] })), ['products']);
  const input = opportunity({ expectedCloseDate: null, ownerId: null, lines: [] });
  const client = { opportunity: { findMany: async () => [] } };
  const first = await opportunitySaveReview(client, input, new FormData());
  assert.deepEqual(first.missing, ['closeDate', 'owner', 'products']);
  const reviewed = new FormData(); reviewed.set('reviewedOpportunity', first.reviewToken);
  assert.equal(await opportunitySaveReview(client, input, reviewed), null);
  assert.notEqual(await opportunitySaveReview(client, { ...input, name: 'Changed' }, reviewed), null);
  assert.equal(reviewFingerprint(input), first.reviewToken);
});
test('complete valid Opportunity needs no review', async () => {
  assert.equal(await opportunitySaveReview({ opportunity: { findMany: async () => [] } }, opportunity(), new FormData()), null);
});
test('sales helper text and terminology are present in the forms', () => {
  const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
  const opp = read('components/opportunity-form.tsx');
  for (const phrase of ['Companies in this deal', 'Role in this deal', 'Used to place the Opportunity in a forecast quarter.', 'Commit is an explicit forecast choice', 'Weighted Pipeline uses this override', 'Expected close date — determines forecast quarter', 'Owner — determines rep ownership/reporting', 'Products/value — determines deal value', 'Save anyway', 'Continue editing']) assert(opp.includes(phrase), phrase);
  const odm = read('components/product-odm-fields.tsx');
  for (const phrase of ['Type of custom SKU', 'This custom SKU is intended for a specific customer.', 'This custom SKU may be used for more than one customer.', 'Its price is not inherited.']) assert(odm.includes(phrase), phrase);
  assert(read('components/product-form.tsx').includes('Product = model/family. SKU = exact part number.'));
  assert(read('lib/product-labels.ts').includes('ODM / Custom SKU'));
  const work = read('components/work-form.tsx');
  assert(work.includes('Record work that already happened, such as a call, meeting, or email.'));
  assert(work.includes('Track work that still needs to be done.'));
});
