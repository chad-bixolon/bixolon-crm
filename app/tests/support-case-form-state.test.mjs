import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(import.meta.url);
const originalLoad = Module._load;
let calls = [];
const existing = { id: 9, accountId: 11, customerNameText: 'ABC', contactId: 12, subject: 'Original', description: 'Details', status: 'NEW', priority: 'NORMAL', source: 'PHONE', categoryId: 13, assignedToId: 2, productSkuId: 14, serialNumber: 'SN', purchaseSourceText: 'CDW', purchasedFromAccountId: 21, nextFollowUpAt: null, resolutionSummary: null };
const prisma = { user: { findUnique: async () => ({ timeZone: 'America/New_York' }) }, supportCase: { findUnique: async () => existing } };
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
Module._load = function(request, parent, isMain) {
  if (request === 'next/cache') return { revalidatePath: () => {} };
  if (request === 'next/navigation') return { redirect: () => { throw new Error('Unexpected redirect'); } };
  if (request === '@/lib/current-user') return { requireMutation: async () => ({ id: 2, role: 'SUPPORT' }) };
  if (request === '@/lib/prisma') return { prisma };
  if (request === '@/lib/support-cases') return { createSupportCase: async (_db, _actor, input) => { calls.push({ mode: 'create', input }); throw new Error(input.status === 'RESOLVED' && !input.resolutionSummary ? 'Resolution Summary is required when resolving or closing a Support Case.' : 'Unrelated validation error.'); }, updateSupportCase: async (_db, _actor, id, patch) => { calls.push({ mode: 'edit', id, input: patch }); throw new Error('Unrelated validation error.'); } };
  if (request === '@/lib/calendar-time') return { calendarLocalToUtc: value => new Date(value + ':00Z') };
  if (request === '@/lib/user-time-zone') return { DEFAULT_USER_TIME_ZONE: 'America/New_York' };
  return originalLoad.call(this, request, parent, isMain);
};
const { saveSupportCase } = require(path.join(root, 'app/support/cases/actions.ts'));
Module._load = originalLoad;
const form = (overrides = {}) => { const data = new FormData(); for (const [key, value] of Object.entries({ customerNameText: 'ABC', accountId: '11', accountIdLabel: 'Customer', contactId: '12', contactIdLabel: 'Jane Smith', subject: 'Printer issue', description: 'Details', status: 'NEW', priority: 'HIGH', categoryId: '13', assignedToId: '2', productSkuId: '14', productSkuIdLabel: 'SKU-14', productSkuIdQuery: '', serialNumber: 'SN', purchaseSourceText: 'CDW', purchasedFromAccountId: '21', purchasedFromAccountIdLabel: 'CDW Corporation', source: 'PHONE', nextFollowUpAt: '2026-10-10T10:00', resolutionSummary: '', ...overrides })) data.set(key, value); return data; };

test('unrelated save error retains selected Support case values for create and edit', async () => {
  for (const id of [null, 9]) {
    const data = form(id ? { productSkuId: '15', productSkuIdLabel: 'SKU-15', contactId: '18', assignedToId: '3', purchasedFromAccountId: '22' } : {});
    const result = await saveSupportCase(id, {}, data);
    assert.equal(result.message, 'Unrelated validation error.');
    const submitted = calls.at(-1);
    assert.equal(submitted.mode, id ? 'edit' : 'create');
    assert.equal(submitted.input.productSkuId, id ? 15 : 14);
    assert.equal(submitted.input.purchasedFromAccountId, id ? 22 : 21);
    assert.equal(submitted.input.contactId, id ? 18 : 12);
    assert.equal(submitted.input.assignedToId, id ? 3 : 2);
    assert.equal(data.get('productSkuIdLabel'), id ? 'SKU-15' : 'SKU-14');
    assert.equal(data.get('accountIdLabel'), 'Customer');
    assert.equal(data.get('contactIdLabel'), 'Jane Smith');
    assert.equal(data.get('nextFollowUpAt'), '2026-10-10T10:00');
  }
});
test('direct Resolved create returns a field error while preserving every submitted value and picker label', async () => {
  const data = form({ status: 'RESOLVED', resolutionSummary: '' });
  const snapshot = [...data.entries()];
  const result = await saveSupportCase(null, {}, data);
  assert.deepEqual(result, { message: 'Resolution Summary is required when resolving or closing a Support Case.', field: 'resolutionSummary' });
  assert.deepEqual([...data.entries()], snapshot);
  assert.equal(calls.at(-1).input.status, 'RESOLVED');
  assert.equal(data.get('productSkuIdLabel'), 'SKU-14');
  assert.equal(data.get('contactIdLabel'), 'Jane Smith');
  assert.equal(data.get('purchasedFromAccountIdLabel'), 'CDW Corporation');
});
test('typed but unselected Product stays text and produces a field error', async () => {
  calls = [];
  const data = form({ productSkuId: '', productSkuIdLabel: '', productSkuIdQuery: 'SKU-14' });
  const result = await saveSupportCase(null, {}, data);
  assert.equal(result.message, 'Select a product from the suggestions.');
  assert.equal(result.field, 'productSkuId');
  assert.equal(data.get('productSkuIdQuery'), 'SKU-14');
  assert.equal(calls.length, 0);
});
test('customer and Account may both be blank only when rejected', async () => {
  const result = await saveSupportCase(null, {}, form({ customerNameText: '', accountId: '' }));
  assert.equal(result.field, 'customerNameText');
  assert.equal(result.message, 'Enter a customer/end user or link a CRM Account.');
});

test('typed but unselected related entities retain search text and receive field errors', async () => {
  for (const [query, field, message] of [
    ['accountIdQuery', 'accountId', 'Select an Account from the suggestions.'],
    ['contactIdQuery', 'contactId', 'Select a Contact from the suggestions.'],
    ['purchasedFromAccountIdQuery', 'purchasedFromAccountId', 'Select a Purchased From Account from the suggestions.'],
  ]) {
    const data = form({ [query]: 'Acme', [field]: '' });
    const result = await saveSupportCase(null, {}, data);
    assert.equal(result.field, field);
    assert.equal(result.message, message);
    assert.equal(data.get(query), 'Acme');
  }
});
