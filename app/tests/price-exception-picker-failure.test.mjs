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
const originalTs = Module._extensions['.ts'];
let parsed = 0;
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
Module._load = function(request, parent, isMain) {
  if (request === 'next/cache') return { revalidatePath: () => {} };
  if (request === '@/lib/prisma') return { prisma: {} };
  if (request === '@/lib/current-user') return { requireMutation: async () => ({ id: 1, role: 'ADMIN' }), currentUser: async () => ({ id: 1, role: 'ADMIN' }) };
  if (request === '@/lib/price-exception-resolution') return { parsePriceExceptionAccountPatch: () => { parsed++; return { errors: {}, values: {}, patch: {} }; }, PriceExceptionAccountValidationError: class extends Error {}, updatePriceExceptionAccountLinks: async () => { throw new Error('Should not save'); }, parseAssignedSalesRepUserId: () => ({}) };
  if (request === '@/lib/price-exception-follow-up') return { parseFollowUpForm: () => ({}), updatePriceExceptionFollowUp: async () => ({}) };
  if (request === '@/lib/price-exception-lifecycle') return { markPriceExceptionExpired: async () => {} };
  return originalLoad.call(this, request, parent, isMain);
};
const { resolvePriceExceptionAccounts } = require(path.join(root, 'app/price-exceptions/[id]/actions.ts'));
Module._load = originalLoad;
Module._extensions['.ts'] = originalTs;

test('changing a Price Exception Account without choosing a suggestion never submits the old ID', async () => {
  const form = new FormData();
  form.set('varAccountId', '');
  form.set('varAccountIdSearching', 'true');
  const result = await resolvePriceExceptionAccounts(4, { errors: {} }, form);
  assert.equal(result.errors.varAccountId, 'Select an Account from the suggestions or cancel the search.');
  assert.equal(parsed, 0);
});
