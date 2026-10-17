import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(import.meta.url);
const { NextRequest } = require('next/server');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const weekly = require(path.join(root, 'lib/weekly-snapshots.ts'));
let calls = [], fail = false;
const original = Module._load;
Module._load = function(name, parent, main) {
  if (name === '@/lib/prisma') return { prisma: {} };
  if (name === '@/lib/weekly-snapshots') return { ...weekly, runWeeklySnapshots: async (_, week) => {
    calls.push(week); if (fail) throw new Error('private DB URL and raw stack');
    return { id: 1, status: 'SUCCEEDED', snapshotWeek: new Date('2026-10-12'), opportunitySnapshotRunId: 2, forecastSnapshotRunId: 3 };
  } };
  return original.call(this, name, parent, main);
};
let POST;
try { ({ POST } = require(path.join(root, 'app/api/internal/snapshots/weekly/route.ts'))); } finally { Module._load = original; }
const request = (token, body = '') => new NextRequest('https://crm.example/api/internal/snapshots/weekly', { method: 'POST', headers: { authorization: `Bearer ${token}`, cookie: 'dev-impersonation=1' }, body });
test('weekly trigger fails closed for missing, short and wrong secrets regardless of user cookies', async () => {
  const prior = process.env.WEEKLY_SNAPSHOT_SECRET;
  try {
    for (const secret of ['', 'short', 's'.repeat(32)]) {
      process.env.WEEKLY_SNAPSHOT_SECRET = secret;
      assert.equal((await POST(request('wrong'))).status, 404);
    }
    assert.equal(calls.length, 0);
    process.env.WEEKLY_SNAPSHOT_SECRET = 's'.repeat(32);
    assert.equal((await POST(request(process.env.WEEKLY_SNAPSHOT_SECRET, '{}'))).status, 200);
    assert.equal(calls.length, 1);
  } finally { if (prior === undefined) delete process.env.WEEKLY_SNAPSHOT_SECRET; else process.env.WEEKLY_SNAPSHOT_SECRET = prior; }
});
test('trigger validates recovery scope, refuses request identity and exposes only safe errors', async () => {
  const prior = process.env.WEEKLY_SNAPSHOT_SECRET; process.env.WEEKLY_SNAPSHOT_SECRET = 's'.repeat(32);
  try {
    for (const body of ['{', '[]', 'null', '{"week":3}', '{"week":"2026-02-30"}', '{"week":"2099-01-05"}', '{"actor":{"role":"ADMIN"}}']) assert.equal((await POST(request(process.env.WEEKLY_SNAPSHOT_SECRET, body))).status, 400);
    const response = await POST(request(process.env.WEEKLY_SNAPSHOT_SECRET, '{"week":"2000-01-03"}'));
    assert.equal(response.status, 200); assert.equal(calls.at(-1), '2000-01-03');
    fail = true; const failed = await POST(request(process.env.WEEKLY_SNAPSHOT_SECRET));
    assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes('private DB'));
    const proxy = fs.readFileSync(path.join(root, 'proxy.ts'), 'utf8');
    assert.ok(proxy.includes('api/internal/snapshots/weekly$|'));
  } finally { if (prior === undefined) delete process.env.WEEKLY_SNAPSHOT_SECRET; else process.env.WEEKLY_SNAPSHOT_SECRET = prior; }
});
