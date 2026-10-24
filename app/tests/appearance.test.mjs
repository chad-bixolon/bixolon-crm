import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import ts from 'typescript';

const require = Module.createRequire(import.meta.url);
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { isAppearancePreference, saveOwnAppearance } = require('../lib/appearance.ts');

test('appearance accepts exactly System, Light, and Dark', () => {
  for (const choice of ['SYSTEM', 'LIGHT', 'DARK']) assert.equal(isAppearancePreference(choice), true);
  for (const choice of [null, '', 'dark', 'AUTO', 'HIGH_CONTRAST', 1, {}, new FormData()]) assert.equal(isAppearancePreference(choice), false);
});

test('only the real active authenticated user can save a persistent preference', async () => {
  const users = new Map([[1, 'LIGHT'], [2, 'SYSTEM']]);
  const calls = [];
  const client = { user: { updateMany: async ({ where, data }) => {
    calls.push({ where, data });
    if (!users.has(where.id)) return { count: 0 };
    users.set(where.id, data.appearancePreference);
    return { count: 1 };
  } } };
  const real = { id: 1, active: true, archivedAt: null };
  for (const choice of ['DARK', 'SYSTEM', 'LIGHT']) {
    assert.equal(await saveOwnAppearance(client, real, choice), choice);
    assert.equal(users.get(1), choice);
    assert.equal(users.get(2), 'SYSTEM');
  }
  assert.ok(calls.every(call => JSON.stringify(call.where) === JSON.stringify({ id: 1, active: true, archivedAt: null })));
  await assert.rejects(saveOwnAppearance(client, real, 'dark'), /Choose System/);
  await assert.rejects(saveOwnAppearance(client, null, 'DARK'), /Sign in/);
  await assert.rejects(saveOwnAppearance(client, { id: 1, active: false }, 'DARK'), /Sign in/);
  await assert.rejects(saveOwnAppearance(client, { id: 1, active: true, archivedAt: new Date() }, 'DARK'), /Sign in/);
  assert.equal(calls.length, 3);
});
