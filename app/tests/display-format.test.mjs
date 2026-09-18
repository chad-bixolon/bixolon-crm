import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const require = Module.createRequire(fileURLToPath(import.meta.url));
const { formatCurrency, formatCloseMonth } = require(path.join(root, 'lib/display-format.ts'));

test('pipeline and Dashboard USD values use grouped currency formatting', () => {
  assert.equal(formatCurrency(45000, 'USD'), '$45,000.00');
  assert.equal(formatCurrency({ toNumber: () => 1234.5 }, 'USD'), '$1,234.50');
});

test('non-USD and mixed currency values show codes without converting amounts', () => {
  assert.equal(formatCurrency(45000, 'EUR'), 'EUR 45,000.00');
  assert.equal(formatCurrency(45000, 'JPY'), 'JPY 45,000');
  assert.equal(formatCurrency(218.9, 'USD', true), 'USD 218.90');
});

test('close month labels are friendly without changing group keys', () => {
  assert.equal(formatCloseMonth('2026-10'), 'October 2026');
  assert.equal(formatCloseMonth('Unscheduled'), 'Unscheduled');
});
