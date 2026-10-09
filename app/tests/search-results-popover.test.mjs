import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(import.meta.url);
function load(file, mocks = {}) {
  const mod = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', code)(name => mocks[name] ?? require(name), mod, mod.exports);
  return mod.exports;
}
const popoverFile = path.join(root, 'components/search-results-popover.tsx');
const { resultPlacement } = load(popoverFile);
const css = fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8');

test('shared menu is a bounded internal scroll container with compact options', () => {
  assert.match(css, /\.search-results-popover\s*\{[^}]*position: fixed;[^}]*overflow-y: auto;/);
  assert.match(css, /\.search-results-option\s*\{[^}]*padding: \.375rem \.625rem;[^}]*font-size: \.8125rem;/);
  assert.match(css, /\.search-results-option-single\s*\{[^}]*text-overflow: ellipsis;/);
  const source = fs.readFileSync(popoverFile, 'utf8');
  assert.match(source, /createPortal\(/);
  assert.match(source, /menu\.scrollTop = option\.offsetTop \+ option\.offsetHeight - menu\.clientHeight/);
  assert.match(source, /event\.target !== menuRef\.current/);
});

test('menu flips upward near viewport bottom and stays within viewport edges', () => {
  const below = resultPlacement({ top: 80, bottom: 120, left: 20, width: 280 }, 400, 800);
  assert.deepEqual(below, { top: 124, left: 20, width: 280, maxHeight: 320 });
  const above = resultPlacement({ top: 700, bottom: 740, left: 350, width: 280 }, 400, 800);
  assert.deepEqual(above, { top: 376, left: 112, width: 280, maxHeight: 320 });
  assert.ok(above.top + above.maxHeight < 700);
  const mobile = resultPlacement({ top: 120, bottom: 160, left: 5, width: 380 }, 320, 500);
  assert.equal(mobile.width, 304);
  assert.equal(mobile.left, 8);
});

test('Price Exception Account picker uses shared remote EntityPicker', () => {
  const picker = fs.readFileSync(path.join(root, 'components/price-exception-account-picker.tsx'), 'utf8');
  assert.match(picker, /<EntityPicker/);
  assert.match(picker, /name=\{`\$\{name\}Searching`\}/);
  const route = fs.readFileSync(path.join(root, 'app/price-exceptions/account-search/route.ts'), 'utf8');
  assert.match(route, /searchEntities/);
  const form = fs.readFileSync(path.join(root, 'components/price-exception-resolution-form.tsx'), 'utf8');
  assert.match(form, /PriceExceptionAccountPicker name=\{party\.field\}/);
});
