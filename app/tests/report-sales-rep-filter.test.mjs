import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.tsx'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(fileURLToPath(import.meta.url));
const { ReportSalesRepFilter } = require(path.join(root, 'components/report-sales-rep-filter.tsx'));
const reps = [{ id: 7, firstName: 'Ryan', lastName: 'Persaud' }, { id: 8, firstName: 'Mark', lastName: 'Hernandez' }];
const render = (role, options = reps, selected = '') => renderToStaticMarkup(React.createElement(ReportSalesRepFilter, { actor: { id: 7, role, active: true }, reps: options, selected }));

test('Sales and impersonated Sales have no redundant rep selector', () => {
  assert.equal(render('SALES', reps.slice(0, 1)), '');
  assert.equal(render('SALES', reps), '');
  assert.equal(render('SALES', reps, '7'), '<input type="hidden" name="ownerId" value="7"/>');
});
test('management, Read Only, and permitted Marketing see multiple rep choices', () => {
  for (const role of ['SALES_MANAGER', 'ADMIN', 'READ_ONLY', 'MARKETING_MANAGER']) {
    const html = render(role);
    assert.match(html, /All available Sales Reps/);
    assert.match(html, /Ryan Persaud/);
    assert.match(html, /Mark Hernandez/);
    assert.doesNotMatch(html, /All permitted/);
  }
});
test('a single available rep does not produce an all/self selector', () => {
  assert.equal(render('READ_ONLY', reps.slice(0, 1)), '');
  assert.equal(render('ADMIN', reps.slice(0, 1)), '');
});
