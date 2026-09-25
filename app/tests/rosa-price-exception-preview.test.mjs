import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.tsx'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
const require = Module.createRequire(fileURLToPath(import.meta.url));
const { PreviewActions } = require(path.join(root, 'app/administration/imports/price-exceptions/rosa/preview-actions.tsx'));

function plan(readyTiers, excludedTiers = [], errors = []) {
  return {
    counts: { READY: readyTiers.length },
    groups: [
      ...readyTiers.map(count => ({ disposition: 'READY', tiers: Array(count).fill({}) })),
      ...excludedTiers.map(count => ({ disposition: 'REVIEW REQUIRED', tiers: Array(count).fill({}) })),
    ],
    errors,
  };
}

function render(preview, confirmed = false, busy = false) {
  return renderToStaticMarkup(React.createElement(PreviewActions, {
    plan: preview, confirmed, busy, onConfirm() {}, onApply() {},
  }));
}

test('zero-ready preview explains the next step and hides confirmation and import action', () => {
  const html = render(plan([], [2]));
  assert.match(html, /No Price Exceptions are ready to import yet\. Resolve the review items and errors above, then preview the file again\./);
  assert.doesNotMatch(html, /type="checkbox"|<button|PE headers|pricing lines/);
});

test('one-ready preview uses singular button text and accurate tier count', () => {
  const html = render(plan([2], [4]), true);
  assert.match(html, /This import will create 1 Price Exception with 2 pricing tiers\./);
  assert.match(html, /type="checkbox"[^>]*checked=""/);
  assert.match(html, /I confirm the 1 Price Exception ready to import/);
  assert.match(html, /<button[^>]*>Import 1 Price Exception<\/button>/);
  assert.doesNotMatch(html, /<button[^>]*disabled/);
});

test('multiple-ready preview uses plural button text and excludes review tiers from counts', () => {
  const html = render(plan([2, 3], [7]), true);
  assert.match(html, /This import will create 2 Price Exceptions with 5 pricing tiers\./);
  assert.match(html, /I confirm the 2 Price Exceptions ready to import/);
  assert.match(html, /<button[^>]*>Import 2 Price Exceptions<\/button>/);
  assert.doesNotMatch(html, /12 pricing tiers|PE headers/);
});

test('confirmation, busy state, and preview errors still disable apply', () => {
  for (const [preview, confirmed, busy] of [
    [plan([1]), false, false],
    [plan([1]), true, true],
    [plan([1], [], ['CSV error']), true, false],
  ]) {
    assert.match(render(preview, confirmed, busy), /<button[^>]*disabled=""[^>]*>Import 1 Price Exception<\/button>/);
  }
});
