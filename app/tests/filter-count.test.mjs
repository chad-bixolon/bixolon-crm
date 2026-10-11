import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const require = Module.createRequire(fileURLToPath(import.meta.url));
const { countActiveFilters } = require(path.join(root, 'lib/filter-count.ts'));

test('only non-default business filters are counted', () => {
  assert.equal(countActiveFilters({ active: '', q: '', page: '2', sort: 'name' }), 0);
  assert.equal(countActiveFilters({ active: 'archived', q: 'Ada', salesRepId: '7', page: '3' }), 3);
  assert.equal(countActiveFilters({ archive: 'active', sort: 'current', q: '' }, { archive: 'active', sort: 'current' }), 0);
  assert.equal(countActiveFilters({ archive: 'all', sort: 'current' }, { archive: 'active', sort: 'current' }), 1);
  assert.equal(countActiveFilters({}, { visibility: 'active' }), 0);
  assert.equal(countActiveFilters({ visibility: '' }, { visibility: 'active' }), 0);
  assert.equal(countActiveFilters({ expiration: 'all' }, { expiration: 'all' }), 0);
  assert.equal(countActiveFilters({ year: '2027', currencyCode: 'EUR', userId: '7' }, { year: '2026', currencyCode: 'USD' }), 3);
  assert.equal(countActiveFilters({ archived: 'true' }), 1);
});
