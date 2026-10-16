import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import ts from 'typescript';

const require = Module.createRequire(import.meta.url);
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { pipelineScope } = require('../lib/pipeline-scope.ts');
const { opportunityReadWhere, opportunityScope } = require('../lib/authorization.ts');
const { saveOpportunity, setOpportunityArchived } = require('../lib/opportunities.ts');
const sales = { id: 7, role: 'SALES', active: true };

test('record read permission and owned attribution are separate policies', () => {
  assert.deepEqual(opportunityReadWhere(sales), {});
  assert.deepEqual(opportunityScope(sales), { ownerId: 7 });
  assert.deepEqual(opportunityReadWhere({ ...sales, active: false }), { id: -1 });
  assert.deepEqual(opportunityReadWhere({ ...sales, role: 'SUPPORT' }), { id: -1 });
});

test('Sales Pipeline defaults to the effective user and allows an explicit eligible rep', () => {
  assert.deepEqual(pipelineScope(sales), { ownerId: 7 });
  assert.deepEqual(pipelineScope(sales, ''), { ownerId: 7 });
  assert.deepEqual(pipelineScope({ ...sales, id: 8 }), { ownerId: 8 });
  assert.deepEqual(pipelineScope(sales, '9'), { owner: { is: { id: 9, active: true, archivedAt: null, role: { in: ['SALES', 'SALES_MANAGER'] } } } });
  for (const value of ['all', '-1', '0', '999999999999999999999999']) {
    assert.equal(pipelineScope(sales, value).owner.is.id, 0);
  }
});

test('management Pipeline preserves all-owner defaults and explicit owner filters', () => {
  for (const role of ['ADMIN', 'SALES_MANAGER']) {
    assert.deepEqual(pipelineScope({ ...sales, role }), {});
    assert.deepEqual(pipelineScope({ ...sales, role }, '9'), { ownerId: 9 });
    assert.deepEqual(pipelineScope({ ...sales, role }, 'invalid'), { id: -1 });
  }
  assert.throws(() => pipelineScope({ ...sales, active: false }), /Access denied/);
});

test('cross-owner reading does not grant Opportunity edits, reassignment, or archive actions', async () => {
  let ownerId = 9, writes = 0;
  const tx = {
    opportunity: { findUnique: async () => ({ id: 1, ownerId, archivedAt: null, stageId: 1 }), update: async () => { writes++; } },
    opportunityProduct: { findMany: async () => [] },
    salesStage: { findUnique: async () => ({ id: 1, active: true }) },
    currency: { findUnique: async () => ({ active: true }) },
    user: { findUnique: async () => ({ active: true, role: 'SALES' }) },
    account: { findMany: async () => [] }, product: { findMany: async () => [] }, project: { findMany: async () => [] },
  };
  const db = { $transaction: fn => fn(tx) };
  const input = { name: 'Deal', stageId: 1, ownerId: 9, currencyCode: 'USD', contacts: [], lines: [], projectIds: [], participants: [] };
  await assert.rejects(saveOpportunity(db, input, 1, sales), /only their own/);
  await assert.rejects(saveOpportunity(db, { ...input, ownerId: 7 }, 1, sales), /only their own/);
  await assert.rejects(setOpportunityArchived(db, 1, true, sales), /only their own/);
  ownerId = 7;
  await assert.rejects(saveOpportunity(db, input, 1, sales), /only their own/);
  assert.equal(writes, 0);
});
