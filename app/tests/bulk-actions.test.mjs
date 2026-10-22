import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(fileURLToPath(import.meta.url));
const { validateBulkRequest, BULK_SELECTION_LIMIT } = require(path.join(root, 'lib/bulk-action-contract.ts'));
const { bulkTasks, bulkSupportCases } = require(path.join(root, 'lib/bulk-actions.ts'));
const row = id => ({ id, updatedAt: '2026-10-15T12:00:00.000Z' });
const request = records => ({ records, action: 'complete', value: '', confirmed: true });
test('bulk selection requires explicit confirmation, unique positive IDs, versions and a bounded payload', () => {
  assert.equal(BULK_SELECTION_LIMIT, 20);
  assert.deepEqual(validateBulkRequest(request([row(2), row(1)])), [1, 2]);
  assert.equal(validateBulkRequest(request(Array.from({ length: 20 }, (_, i) => row(i + 1)))).length, 20);
  for (const input of [null, {}, request([]), request(Array.from({ length: 21 }, (_, i) => row(i + 1))), request([row(1), row(1)]), request([row(-1)]), request([row(1.5)]), request([null]), request([{ id: 1, updatedAt: 'invalid' }]), { ...request([row(1)]), confirmed: false }, { ...request([row(1)]), value: 'x'.repeat(101) }]) {
    assert.throws(() => validateBulkRequest(input));
  }
});
test('unauthorized effective actors fail before touching the database, independently of the UI', async () => {
  const db = new Proxy({}, { get() { throw new Error('Database must not be accessed'); } });
  for (const role of ['READ_ONLY', 'SUPPORT']) await assert.rejects(bulkTasks(db, { id: 1, role, active: true }, request([row(1)])), /Access denied/);
  for (const role of ['READ_ONLY', 'SUPPORT', 'SALES', 'SALES_MANAGER', 'MARKETING_MANAGER']) await assert.rejects(bulkSupportCases(db, { id: 1, role, active: true }, request([row(1)])), /Access denied/);
  for (const actor of [{ id: 1, role: 'ADMIN', active: false }, { id: 1, role: 'ADMIN', active: true, archivedAt: new Date() }]) {
    await assert.rejects(bulkTasks(db, actor, request([row(1)])), /Access denied/);
    await assert.rejects(bulkSupportCases(db, actor, request([row(1)])), /Access denied/);
  }
});
