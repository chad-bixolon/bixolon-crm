import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(import.meta.url);
const { bulkQualityOwners } = require(path.join(root, 'lib/data-quality-bulk.ts'));
const admin = { id: 1, role: 'ADMIN', active: true };
const row = id => ({ id, updatedAt: '2026-10-19T12:00:00.000Z' });
const scope = { issue: 'account-owner', q: '', page: 1 };
const request = { records: [row(1)], action: 'assign', value: '2', confirmed: true };
const untouchedDb = new Proxy({}, { get() { throw Error('Unexpected database access'); } });

test('bulk quality owner assignment denies every non-Admin effective actor before database access', async () => {
  for (const actor of ['SALES', 'SALES_MANAGER', 'SUPPORT', 'READ_ONLY', 'MARKETING_MANAGER'].map(role => ({ ...admin, role })).concat([{ ...admin, active: false }, { ...admin, archivedAt: new Date() }])) {
    await assert.rejects(bulkQualityOwners(untouchedDb, actor, scope, request), /Access denied/);
  }
});

test('bulk quality assignment rejects unconfirmed, oversized, unsupported and malformed requests before a transaction', async () => {
  for (const [context, input, error] of [
    [scope, { ...request, confirmed: false }, /confirmation/],
    [scope, { ...request, records: Array.from({ length: 21 }, (_, i) => row(i + 1)) }, /between 1 and 20/],
    [{ ...scope, issue: 'account-owner-inactive' }, request, /individual review/],
    [scope, { ...request, action: 'archive' }, /individual review/],
    [{ ...scope, page: -1 }, request, /Refresh/],
    [{ ...scope, q: [] }, request, /Refresh/],
    [scope, { ...request, value: 'NaN' }, /eligible owner/],
  ]) await assert.rejects(bulkQualityOwners(untouchedDb, admin, context, input), error);
});
