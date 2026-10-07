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
const { formatCurrency, formatCurrencyOrDash, formatCloseMonth, formatCoveragePercent } = require(path.join(root, 'lib/display-format.ts'));

test('pipeline and Dashboard USD values use grouped currency formatting', () => {
  assert.equal(formatCurrency(45000, 'USD'), '$45,000.00');
  assert.equal(formatCurrency({ toNumber: () => 1234.5 }, 'USD'), '$1,234.50');
});

test('non-USD and mixed currency values show codes without converting amounts', () => {
  assert.equal(formatCurrency(45000, 'EUR'), 'EUR 45,000.00');
  assert.equal(formatCurrency(45000, 'JPY'), 'JPY 45,000');
  assert.equal(formatCurrency(218.9, 'USD', true), 'USD 218.90');
});

test('missing Project currency renders a dash without passing a placeholder to Intl', () => {
  assert.equal(formatCurrencyOrDash(0, null, true), '—');
  assert.equal(formatCurrencyOrDash(100, 'USD', true), 'USD 100.00');
  assert.equal(formatCurrencyOrDash(100, 'EUR', true), 'EUR 100.00');
});

test('close month labels are friendly without changing group keys', () => {
  assert.equal(formatCloseMonth('2026-10'), 'October 2026');
  assert.equal(formatCloseMonth('Unscheduled'), 'Unscheduled');
});

test('target-based coverage ratios display as concise percentages', () => {
  assert.deepEqual(['0.62', '0.38', '0.04', '1.45', '0.624'].map(formatCoveragePercent), ['62%', '38%', '4%', '145%', '62.4%']);
  assert.equal(formatCoveragePercent(null), '—');
  for (const file of ['app/page.tsx', 'app/reports/forecast/page.tsx']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, /formatCoveragePercent\(.*pipelineCoverage\)/);
    assert.match(source, /formatCoveragePercent\(.*weightedCoverage\)/);
    assert.match(source, /formatCoveragePercent\(.*commitCoverage\)/);
    assert.match(source, /Weighted Pipeline Coverage/);
    assert.doesNotMatch(source, /Weighted Coverage|Coverage',.*}x/);
  }
});
