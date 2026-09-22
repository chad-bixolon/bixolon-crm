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
const { addOdmCustomer, removeOdmCustomer } = require(path.join(root, 'lib/odm-customer-selection.ts'));

test('ODM customer selection supports multiple ids, prevents duplicates, and removes by id', () => {
  const sevenEleven = { id: 7, label: '7-Eleven' };
  const bluestar = { id: 3, label: 'Bluestar' };
  const two = addOdmCustomer(addOdmCustomer([], sevenEleven), bluestar);
  assert.deepEqual(two.map(item => item.id), [7, 3]);
  assert.deepEqual(addOdmCustomer(two, { id: 7, label: '7-Eleven' }), two);
  assert.deepEqual(removeOdmCustomer(two, 7), [bluestar]);
});
