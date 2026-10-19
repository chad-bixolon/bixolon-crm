import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(import.meta.url);
Module._extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const load = name => require(path.join(root, `lib/${name}.ts`));
const { requireEditToken, assertEditToken, nextUpdatedAt, RecordChangedError } = load('stale-edit');
const { saveOpportunity } = load('opportunities');
const { saveAccount } = load('accounts');
const { saveTask } = load('work');
const { updateSupportCase } = load('support-cases');
const old = '2026-10-19T12:00:00.000Z', current = new Date('2026-10-19T12:00:01.000Z');
const actor = role => ({ id: 7, role, active: true, archivedAt: null });

test('missing, repeated, malformed, and noncanonical submitted tokens require review', () => {
  for (const value of [null, '', 'invalid', '2026-02-30T12:00:00.000Z', '2026-10-19', '2026-10-19T12:00:00Z']) {
    const form = new FormData(); if (value !== null) form.set('editToken', value);
    assert.throws(() => requireEditToken(form), RecordChangedError);
  }
  const form = new FormData(); form.set('editToken', current.toISOString());
  assert.equal(requireEditToken(form), current.toISOString());
  const repeated = new FormData(); repeated.append('editToken', old); repeated.append('editToken', current.toISOString());
  assert.throws(() => requireEditToken(repeated), RecordChangedError);
  assert.doesNotThrow(() => assertEditToken(current, requireEditToken(form)));
  for (let n = 0; n < 2; n++) assert.throws(() => assertEditToken(current, old), RecordChangedError);
});

test('successful writes advance a millisecond token even with a fixed or backwards server clock', () => {
  const now = Date.now;
  try {
    Date.now = () => current.getTime();
    const next = nextUpdatedAt(current);
    assert.equal(next.getTime(), current.getTime() + 1);
    Date.now = () => 1;
    assert.equal(nextUpdatedAt(next).getTime(), next.getTime() + 1);
  } finally { Date.now = now; }
});

const saves = {
  Opportunity: (db, role) => saveOpportunity(db, { ownerId: 7, lines: [], contacts: [] }, 1, actor(role), old),
  Account: db => saveAccount(db, { roles: [] }, 1, 7, old),
  Task: db => saveTask(db, { accountId: null, opportunityId: null, projectId: null }, 1, undefined, 7, old),
  'Support Case': (db, role) => updateSupportCase(db, actor(role), 1, { subject: 'My unsaved subject' }, old),
};
for (const [kind, save] of Object.entries(saves)) test(`${kind}: older form cannot mutate or write history, including repeated Admin submissions`, async () => {
  let mutations = 0;
  const row = { id: 1, ownerId: 7, archivedAt: null, updatedAt: current, subject: 'Newer work' };
  const model = { findUnique: async () => row, update: async () => { mutations++; } };
  const history = { create: async () => { mutations++; }, createMany: async () => { mutations++; } };
  const tx = { $queryRaw: async () => [], opportunity: model, account: model, task: model, supportCase: model, opportunityHistoryEvent: history, supportCaseLifecycleEvent: history };
  const db = { $transaction: async fn => fn(tx) };
  for (const role of kind === 'Support Case' ? ['ADMIN', 'SUPPORT'] : ['ADMIN', 'SALES_MANAGER', 'SALES']) {
    for (let n = 0; n < 2; n++) await assert.rejects(save(db, role), RecordChangedError);
  }
  assert.equal(row.subject, 'Newer work');
  assert.equal(row.updatedAt, current);
  assert.equal(mutations, 0);
});
