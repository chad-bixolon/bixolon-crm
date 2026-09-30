import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const require = Module.createRequire(fileURLToPath(import.meta.url));
const drafts = require(path.join(root, 'lib/opportunity-draft.ts'));
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const blank = { name: '', description: '', competitorId: '', currentProductBeingUsed: '', competitivePricing: '', customerPainPoints: '', ownerId: '7', stageId: '', expectedCloseDate: '', probability: '', forecastCategory: 'PIPELINE', currencyCode: 'USD', projectIds: [], participants: [], contacts: [], lines: [] };
function storage() {
  const items = new Map();
  return { items, getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value), removeItem: key => items.delete(key) };
}

test('a New Opportunity starts clean and only offers recovery for its user and context', () => {
  const store = storage();
  const key = drafts.draftKey(7);
  assert.equal(drafts.readStoredDraft(store, key, blank), null);
  const oldLine = { id: 0, productId: 22, skuId: 31, quantity: '15', price: '42.50', priceSource: 'PRICE_EXCEPTION', catalogPriceTier: null, priceExceptionLineId: 19, priceExceptionCode: 'PE-93', priceExceptionUnitPrice: '42.50', priceExceptionCurrencyCode: 'USD', priceExceptionSourceQty: '10', priceExceptionAccountIds: [3], priceExceptionAccounts: { distributorAccountId: 3, varAccountId: null, endUserAccountId: null }, odmCustomerPriceId: null, odmCustomerAccountId: null, odmCustomerBasePrice: null, odmCustomerTariffPercent: null, odmCustomerTariffAmount: null, odmCustomerFinalUnitPrice: null };
  const customerPriceLine = { ...oldLine, id: 0, productId: 23, skuId: 32, quantity: '4', price: '17.00', priceSource: 'ODM_CUSTOMER', priceExceptionLineId: null, priceExceptionCode: null, priceExceptionUnitPrice: null, priceExceptionCurrencyCode: null, priceExceptionSourceQty: null, priceExceptionAccountIds: [], priceExceptionAccounts: null, odmCustomerPriceId: 81, odmCustomerAccountId: 3, odmCustomerBasePrice: '15.00', odmCustomerTariffPercent: '10', odmCustomerTariffAmount: '2.00', odmCustomerFinalUnitPrice: '17.00' };
  const saved = { ...blank, name: 'Old pursuit', description: 'Sensitive context', projectIds: [9], participants: [{ accountId: 3, roles: ['END_USER'] }], contacts: [{ contactId: 8, isPrimary: true }], lines: [oldLine, customerPriceLine] };
  assert.equal(drafts.persistDraft(store, key, saved, key, 12345), true);
  const pending = drafts.readStoredDraft(store, key, blank);
  assert.deepEqual(blank.participants, []);
  assert.deepEqual(blank.contacts, []);
  assert.deepEqual(blank.projectIds, []);
  assert.deepEqual(blank.lines, []);
  assert.deepEqual(pending, { draft: saved, savedAt: 12345 });
  assert.equal(drafts.readStoredDraft(store, drafts.draftKey(8), blank), null);
  assert.equal(drafts.readStoredDraft(store, drafts.draftKey(7, 12), blank), null);
  assert.equal(drafts.readStoredDraft(store, drafts.draftKey(7, undefined, 12), blank), null);
  assert.deepEqual(drafts.restoreDraft(store, key, blank), saved); // Resume only
  drafts.clearDraft(store, key); // Discard or successful create
  assert.equal(drafts.readStoredDraft(store, key, blank), null);
  assert.deepEqual(drafts.restoreDraft(store, key, blank), blank); // subsequent New Opportunity
});

test('discard and save clear only the current draft; edit drafts remain separate', () => {
  const store = storage();
  const newKey = drafts.draftKey(7);
  const editKey = drafts.draftKey(7, 12);
  const otherEditKey = drafts.draftKey(7, 13);
  const otherUserKey = drafts.draftKey(8);
  for (const key of [newKey, editKey, otherEditKey, otherUserKey]) drafts.persistDraft(store, key, { ...blank, name: key }, key);
  drafts.clearDraft(store, newKey);
  assert.equal(drafts.readStoredDraft(store, newKey, blank), null);
  for (const key of [editKey, otherEditKey, otherUserKey]) assert.equal(drafts.readStoredDraft(store, key, blank).draft.name, key);
  drafts.clearDraft(store, editKey);
  assert.equal(drafts.readStoredDraft(store, editKey, blank), null);
  assert.equal(drafts.readStoredDraft(store, otherEditKey, blank).draft.name, otherEditKey);
});

test('legacy unscoped browser drafts cannot appear for any user', () => {
  const store = storage();
  store.setItem('opportunity-draft:new', JSON.stringify({ ...blank, name: 'Unknown owner' }));
  assert.equal(drafts.readStoredDraft(store, drafts.draftKey(7), blank), null);
  assert.equal(drafts.readStoredDraft(store, drafts.draftKey(8), blank), null);
});

test('form wiring requires explicit recovery and keeps Cancel and successful-save cleanup', () => {
  const form = source('components/opportunity-form.tsx');
  assert.match(form, /readStoredDraft\(localStorage, draftKey, original\.current\)/);
  assert.doesNotMatch(form, /setDraft\(restored\)/);
  assert.match(form, /if \(recovery\) \{/);
  assert.match(form, /Resume draft/);
  assert.match(form, /Discard draft/);
  assert.match(form, /setDraft\(recovery\.draft\)/);
  assert.match(form, /clearDraft\(localStorage, draftKey\); setDraft\(original\.current\)/);
  assert.match(form, /onClick=\{\(\) => \{ clearDraft\(localStorage, draftKey\); setHydratedKey\(null\); \}\}>Cancel/);
  assert.match(form, /if \(state\.redirectTo\) \{ clearDraft\(localStorage, draftKey\)/);
  assert.match(form, /JSON\.stringify\(draft\) === JSON\.stringify\(original\.current\)/);
  assert.match(form, /Unfinished Opportunity draft saved on this device/);
  assert.match(source('app/opportunities/new/page.tsx'), /<OpportunityForm key="new" userId=\{actor\.id\}/);
  assert.match(source('app/opportunities/[id]/edit/page.tsx'), /<OpportunityForm key=\{id\} id=\{id\} userId=\{actor\.id\} initial=\{initial\}/);
  assert.match(source('app/trade-shows/[id]/leads/[leadId]/convert/page.tsx'), /<OpportunityForm userId=\{actor\.id\}/);
});

test('normal New Opportunity has no Account, Project, or pricing context prefill', () => {
  const page = source('app/opportunities/new/page.tsx');
  assert.doesNotMatch(page, /initial=|accountId=|projectId=|priceExceptionLineId=/);
  const form = source('components/opportunity-form.tsx');
  assert.match(form, /participants: initial\?\.participants \?\? \[\]/);
  assert.match(form, /contacts: initial\?\.contacts \?\? \[\]/);
  assert.match(form, /projectIds: initial\?\.projectIds \?\? \[\]/);
  assert.match(form, /lines: initial\?\.lines\.map/);
});
