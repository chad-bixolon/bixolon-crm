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
const { can } = require(path.join(root, 'lib/authorization.ts'));
const { saveOpportunity } = require(path.join(root, 'lib/opportunities.ts'));
const source = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Account Opportunities card offers create only with sales write on an eligible Account', () => {
  const page = source('app/accounts/[id]/page.tsx');
  assert.match(page, /can\(actor, 'sales\.write'\) && account\.status === 'ACTIVE' && !account\.archivedAt && <Link className="btn-primary" href=\{`\/opportunities\/new\?accountId=\$\{id\}`\}>New Opportunity<\/Link>/);
  assert.match(page, /opportunityMemberships: \{ where: \{ opportunity: operationalOpportunityWhere \}/);
  assert.equal(can({ id: 1, role: 'SALES', active: true, archivedAt: null }, 'sales.write'), true);
  assert.equal(can({ id: 1, role: 'READ_ONLY', active: true, archivedAt: null }, 'sales.write'), false);
});

test('new route checks Account context against eligible server options and uses the shared form', () => {
  const page = source('app/opportunities/new/page.tsx');
  assert.match(page, /!options\.accounts\.some\(account => account\.id === accountContextId\)\)\) notFound\(\)/);
  assert.match(page, /<OpportunityForm[^>]+accountContextId=\{accountContextId\}/);
  assert.match(source('lib/opportunities.ts'), /client\.account\.findMany\(\{ where: operationalAccountWhere/);
  assert.match(source('lib/operational-where.ts'), /operationalAccountWhere: Prisma\.AccountWhereInput = \{ archivedAt: null, status: 'ACTIVE' \}/);
});

test('save rejects an Account that became ineligible after the page loaded', async () => {
  let wrote = false;
  const tx = {
    salesStage: { findUnique: async () => ({ active: true }) },
    currency: { findUnique: async () => ({ active: true }) },
    account: { findMany: async ({ where }) => {
      assert.deepEqual(where, { id: { in: [11] }, status: 'ACTIVE', archivedAt: null });
      return [];
    } },
    product: { findMany: async () => [] },
    project: { findMany: async () => [] },
    opportunity: { create: async () => { wrote = true; return { id: 5 }; } },
    opportunityProduct: { findMany: async () => [] },
  };
  const client = { $transaction: async fn => fn(tx) };
  const input = { name: 'Deal', description: null, ownerId: null, stageId: 1, expectedCloseDate: null, probability: null, forecastCategory: null, currencyCode: 'USD', projectIds: [], participants: [{ accountId: 11, roles: ['END_USER'] }], contacts: [], lines: [] };
  await assert.rejects(saveOpportunity(client, input), /Choose active accounts for all participants/);
  assert.equal(wrote, false);
});

test('shared save destination remains Opportunity detail', () => {
  assert.match(source('app/opportunities/actions.ts'), /redirectTo: saveFeedbackPath\(`\/opportunities\/\$\{opportunityId\}`/);
});
