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
Module._extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { assertPermission } = require(path.join(root, 'lib/authorization.ts'));
const { recordChangedMessage } = require(path.join(root, 'lib/stale-edit.ts'));
let actor = { id: 7, role: 'ADMIN', active: true, archivedAt: null }, mutations = 0;
const current = new Date('2026-10-21T12:00:01.000Z'), old = '2026-10-21T12:00:00.000Z';
const row = { id: 1, accountId: 2, firstName: 'Latest', lastName: 'Person', email: null, ownerId: 7, projectId: null, primaryAccount: null, archivedAt: null, updatedAt: current, participants: [] };
const model = { findUnique: async () => row, findFirst: async () => row, update: async () => { mutations++; throw new Error('Unexpected mutation'); } };
const tx = { contact: model, project: model, activity: model, note: model, account: model };
const prisma = { ...tx, $transaction: async fn => fn(tx) };
Module._load = function(name, parent, isMain) {
  if (name === 'next/cache') return { revalidatePath: () => {} };
  if (name === 'next/navigation') return { redirect: () => { throw new Error('Unexpected redirect'); } };
  if (name === '@/lib/prisma') return { prisma };
  if (name === '@/lib/current-user') return {
    currentUser: async () => actor,
    requireMutation: async permission => { assertPermission(actor, permission); return actor; },
  };
  if (name === '@/lib/contact-duplicates') return { contactSaveReview: async () => null };
  if (name === '@/lib/support-work') return { assertWorkPermission: user => assertPermission(user, 'tasks.write'), caseWorkContext: async () => {} };
  if (name.startsWith('@/lib/')) return require(path.join(root, `${name.slice(2)}.ts`));
  return originalLoad.call(this, name, parent, isMain);
};
let actions;
try {
  const { submitContact } = require(path.join(root, 'app/contacts/actions.ts'));
  const { submitProject } = require(path.join(root, 'app/projects/actions.ts'));
  const { submitActivity } = require(path.join(root, 'app/activities/actions.ts'));
  const { submitNote } = require(path.join(root, 'app/notes/actions.ts'));
  actions = {
    Contact: form => submitContact(1, null, { errors: {} }, form),
    Project: form => submitProject(1, { errors: {} }, form),
    Activity: form => submitActivity(1, { errors: {} }, form),
    Note: form => submitNote(1, { errors: {} }, form),
  };
} finally { Module._load = originalLoad; Module._extensions['.ts'] = originalTs; }
function formFor(kind, submitted) {
  const form = new FormData();
  const fields = kind === 'Contact' ? { firstName: 'My draft', lastName: 'Person', accountId: '2', marketingPreference: 'OPTED_IN', isPrimary: 'on' }
    : kind === 'Project' ? { name: 'My draft', status: 'ACTIVE', ownerId: '7', accountId: '3', participantRoles: 'OEM' }
      : kind === 'Activity' ? { subject: 'My draft', type: 'CALL', accountId: '2', userId: '7', activityDate: '2026-01-01T12:00', direction: 'NA' }
        : { body: 'My draft', accountId: '2' };
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  if (submitted !== null) form.set('editToken', submitted);
  return form;
}
for (const [kind, action] of Object.entries(actions)) test(`${kind} direct action: stale, missing, invalid and duplicate tokens preserve values without writes; role checks remain`, async () => {
  for (const role of ['ADMIN', 'SALES_MANAGER', 'SALES']) {
    actor = { ...actor, role };
    for (const submitted of [null, '', 'invalid', '2026-02-30T12:00:00.000Z', old, old]) {
      const result = await action(formFor(kind, submitted));
      assert.equal(result.recordChanged, true, `${role} / ${submitted}`);
      assert.equal(result.message, recordChangedMessage);
      assert.ok(Object.values(result.values).includes('My draft'));
      if (kind === 'Contact') { assert.equal(result.values.isPrimary, 'true'); assert.equal(result.values.marketingPreference, 'OPTED_IN'); }
      if (kind === 'Project') { assert.equal(result.values.accountId, '3'); assert.equal(result.values.participantRoles, 'OEM'); }
    }
    const duplicate = formFor(kind, current.toISOString()); duplicate.append('editToken', old);
    assert.equal((await action(duplicate)).recordChanged, true);
  }
  actor = { ...actor, role: 'READ_ONLY' };
  if (kind === 'Contact' || kind === 'Project') await assert.rejects(action(formFor(kind, current.toISOString())), /Access denied/);
  else assert.match((await action(formFor(kind, current.toISOString()))).message, /Access denied/);
  assert.equal(mutations, 0);
});
