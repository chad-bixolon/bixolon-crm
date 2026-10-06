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

function pickerHarness() {
  const slots = [];
  let cursor = 0;
  const hooks = {
    useId: () => 'pe',
    useRef: () => ({ current: null }),
    useEffect() {},
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
  };
  const { PriceExceptionAccountPicker } = load(path.join(root, 'components/price-exception-account-picker.tsx'), {
    react: hooks,
    './search-results-popover': { SearchResultsPopover: () => null },
  });
  const props = { name: 'distributorAccountId', label: 'Linked CRM Account', initial: null };
  return { slots, render() { cursor = 0; return PriceExceptionAccountPicker(props); } };
}
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}

test('PE picker navigates beyond the first visible rows and Enter selects without changing the form value format', () => {
  const h = pickerHarness();
  let tree = h.render();
  const input = nodes(tree, node => node.props?.role === 'combobox')[0];
  input.props.onFocus();
  h.slots[2] = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, name: `Account ${i + 1}`, status: 'ACTIVE', archivedAt: null }));
  for (let i = 0; i < 30; i++) nodes(h.render(), node => node.props?.role === 'combobox')[0].props.onKeyDown({ key: 'ArrowDown', preventDefault() {} });
  tree = h.render();
  assert.equal(nodes(tree, node => node.props?.role === 'combobox')[0].props['aria-activedescendant'], 'pe-option-30');
  const menu = nodes(tree, node => node.type?.name === 'SearchResultsPopover')[0];
  assert.equal(menu.props.activeIndex, 30);
  assert.equal(nodes(menu, node => node.props?.role === 'option').length, 40);
  nodes(tree, node => node.props?.role === 'combobox')[0].props.onKeyDown({ key: 'Enter', preventDefault() {} });
  tree = h.render();
  assert.equal(nodes(tree, node => node.props?.name === 'distributorAccountId')[0].props.value, 31);
  assert.equal(nodes(tree, node => node.type?.name === 'SearchResultsPopover').length, 0);
});

test('PE lookup returns every active matching Account, while the resolution form keeps its save action', () => {
  const route = fs.readFileSync(path.join(root, 'app/price-exceptions/account-search/route.ts'), 'utf8');
  assert.match(route, /status:'ACTIVE',archivedAt:null/);
  assert.doesNotMatch(route, /take:\s*20/);
  const form = fs.readFileSync(path.join(root, 'components/price-exception-resolution-form.tsx'), 'utf8');
  assert.match(form, /PriceExceptionAccountPicker name=\{party\.field\}/);
  assert.match(form, /Save Account Links/);
});
