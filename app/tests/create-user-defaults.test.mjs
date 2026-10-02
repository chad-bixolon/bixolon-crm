import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(import.meta.url);
const { defaultEligibleUserId, eligibleUserWhere } = require(path.join(root, 'lib/assignment-eligibility.ts'));
const { parseNote, saveNote } = require(path.join(root, 'lib/work.ts'));

function eligibleIds(permission, people) {
  const filter = eligibleUserWhere(permission);
  return people.filter(person => person.active && !person.archivedAt && filter.role.in.includes(person.role)).map(person => ({ id: person.id }));
}
const people = [
  { id: 1, role: 'ADMIN', active: true, archivedAt: null },
  { id: 2, role: 'SALES_MANAGER', active: true, archivedAt: null },
  { id: 3, role: 'SALES', active: true, archivedAt: null },
  { id: 4, role: 'SALES', active: false, archivedAt: null },
  { id: 5, role: 'SALES', active: true, archivedAt: new Date() },
  { id: 6, role: 'READ_ONLY', active: true, archivedAt: null },
  { id: 7, role: 'MARKETING_MANAGER', active: true, archivedAt: null },
];

test('Sales, Sales Manager, and Admin create defaults use the effective eligible user', () => {
  for (const permission of ['accounts.write', 'projects.write', 'tasks.write', 'sales.write']) {
    const users = eligibleIds(permission, people);
    for (const id of [1, 2, 3]) assert.equal(defaultEligibleUserId(users, id), id, `${permission}: ${id}`);
    assert.equal(defaultEligibleUserId(users, 6), null);
    assert.equal(defaultEligibleUserId(users, 4), null);
    assert.equal(defaultEligibleUserId(users, 5), null);
  }
});

test('impersonation uses effective ID, context wins, and another eligible user remains selectable', () => {
  const users = eligibleIds('accounts.write', people);
  const realAdminId = 1, effectiveRyanId = 3;
  assert.equal(defaultEligibleUserId(users, effectiveRyanId), effectiveRyanId);
  assert.notEqual(defaultEligibleUserId(users, effectiveRyanId), realAdminId);
  assert.equal(defaultEligibleUserId(users, effectiveRyanId, 2), 2);
  assert.equal(defaultEligibleUserId(users, effectiveRyanId, 4), effectiveRyanId);
  assert.ok(users.some(user => user.id === 2));
});

test('Sales cannot default to an ineligible sales owner; Marketing Owner is marketing scoped', () => {
  const salesOwners = eligibleIds('sales.write', people);
  assert.equal(defaultEligibleUserId(salesOwners, 7), null);
  const marketingOwners = people.filter(person => person.role === 'MARKETING_MANAGER' && person.active && !person.archivedAt);
  assert.equal(defaultEligibleUserId(marketingOwners, 7), 7);
  assert.equal(defaultEligibleUserId(marketingOwners, 1), null);
});

test('Note author provenance uses the effective actor, not a submitted Author; edits retain the original author', async () => {
  const form = new FormData();
  form.set('body', 'Follow up'); form.set('accountId', '1'); form.set('createdById', '1');
  const input = parseNote(form).value;
  const created = { id: 10, createdById: 3 };
  const tx = {
    account: { findFirst: async () => ({ id: 1 }) },
    note: { create: async ({ data }) => { assert.equal(data.createdById, 3); return { ...created, ...data }; } },
  };
  const result = await saveNote({ $transaction: fn => fn(tx) }, input, undefined, 3);
  assert.equal(result.createdById, 3);
  const existing = { id: 10, accountId: 1, opportunityId: null, projectId: null, createdById: 2, archivedAt: null };
  tx.note.findFirst = async () => existing;
  tx.note.update = async ({ data }) => ({ ...existing, ...data });
  const edited = await saveNote({ $transaction: fn => fn(tx) }, input, 10, 3);
  assert.equal(edited.createdById, 2);
});
