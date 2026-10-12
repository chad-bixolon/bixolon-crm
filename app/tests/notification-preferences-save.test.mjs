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
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
let fail = false;
let operations = [];
let revalidated = [];
Module._load = function(specifier, parent, isMain) {
  if (specifier === 'next/cache') return { revalidatePath: value => revalidated.push(value) };
  if (specifier === 'next/navigation') return { redirect: () => {} };
  if (specifier === '@/lib/current-user') return { currentUser: async () => ({ id: 7 }) };
  if (specifier === '@/lib/prisma') return { prisma: {
    notificationPreference: { upsert: args => args },
    $transaction: async queries => { operations = queries; if (fail) throw new Error('Database unavailable'); },
  } };
  if (specifier === '@/lib/notifications') return {};
  if (specifier === '@/lib/notification-preferences') return { preferenceCategories: ['TASK', 'OPPORTUNITY', 'PRICE_EXCEPTION', 'SUPPORT_CASE'] };
  return originalLoad.call(this, specifier, parent, isMain);
};
const { saveNotificationPreferences } = require(path.join(root, 'app/notifications/actions.ts'));
Module._load = originalLoad;
Module._extensions['.ts'] = originalTs;

test('one save submits all categories in a transaction and confirms success', async () => {
  const form = new FormData();
  form.set('TASK', 'on');
  form.set('SUPPORT_CASE', 'on');
  assert.deepEqual(await saveNotificationPreferences({ status: '' }, form), { status: 'success' });
  assert.deepEqual(operations.map(({ create }) => [create.category, create.enabled]), [
    ['TASK', true], ['OPPORTUNITY', false], ['PRICE_EXCEPTION', false], ['SUPPORT_CASE', true],
  ]);
  assert(operations.every(({ create }) => create.userId === 7));
  assert.deepEqual(revalidated, ['/notifications/preferences', '/notifications', '/']);
});

test('failed save returns an error without claiming an update', async () => {
  fail = true;
  revalidated = [];
  const form = new FormData();
  form.set('OPPORTUNITY', 'on');
  assert.deepEqual(await saveNotificationPreferences({ status: '' }, form), { status: 'error' });
  assert.deepEqual(operations.map(({ create }) => create.enabled), [false, true, false, false]);
  assert.deepEqual(revalidated, []);
});
