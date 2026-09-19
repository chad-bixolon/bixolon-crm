import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(import.meta.url);
// Exercise component event handlers and rerenders without a DOM or external services.
function harness(filename, props, overrides = {}) {
  const slots = [];
  let cursor = 0;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { return hooks.useState(() => ({ current: initial }))[0]; },
    useId: () => 'picker', useEffect() {},
    useActionState: () => [{ errors: {} }, () => {}, false],
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    new Function('require', 'module', 'exports', code)(name => {
      if (name === 'react') return hooks;
      if (name in overrides) return overrides[name];
      if (name.startsWith('./')) return load(path.resolve(path.dirname(file), `${name}.ts`));
      if (name.startsWith('@/')) return load(path.join(root, `${name.slice(2)}.ts`));
      return require(name);
    }, mod, mod.exports);
    cache.set(file, mod.exports);
    return mod.exports;
  }
  const Component = Object.values(load(path.join(root, filename)))[0];
  return { props, slots, render() { cursor = 0; return Component(props); } };
}
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
const by = (tree, key, value) => nodes(tree, node => node.props?.[key] === value);
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : Array.isArray(tree) ? tree.map(text).join('') : text(tree.props?.children);
const button = (tree, label) => nodes(tree, n => n.type === 'button' && text(n) === label)[0];
const item = { id: 9, productId: 3, productName: 'XT5', partNumber: 'XT5-40NRFS', categoryId: 1, description: 'A very long catalog description '.repeat(30), prices: [{ tier: 'STANDARD', currencyCode: 'USD', amount: '990.22' }, { tier: 'RESELLER', currencyCode: 'USD', amount: '800.00' }] };
function picker(product = item, price = '990.22') {
  const props = { index: 0, productId: product?.productId ?? 0, skuId: product?.id ?? 0, categories: [{ id: 1, name: 'Printers' }], currencyCode: 'USD', price, onChange(productId, skuId, nextPrice) { Object.assign(props, { productId, skuId, price: nextPrice ?? props.price }); } };
  const h = harness('components/product-picker.tsx', props);
  h.render();
  h.slots[2] = product; // Catalog detail that the existing fetch effect supplies.
  return h;
}
test('selected product hides selection controls; Change and replacement restore compact display', () => {
  const h = picker();
  let tree = h.render();
  assert.equal(by(tree, 'role', 'combobox').length, 0);
  assert.equal(by(tree, 'id', 'picker-category').length, 0);
  assert.equal(nodes(tree, n => n.type === 'details')[0].props.open, undefined);
  assert.match(text(tree), /XT5SKU: XT5-40NRFS/);
  button(tree, 'Change').props.onClick();
  tree = h.render();
  assert.equal(by(tree, 'id', 'picker-category')[0].props.value, '');
  assert.equal(by(tree, 'role', 'combobox').length, 1);
  assert.equal(h.props.price, '990.22');
  const replacement = { ...item, id: 10, productId: 4, partNumber: 'REPLACEMENT' };
  h.slots[1] = [replacement];
  by(h.render(), 'role', 'option')[0].props.onClick();
  tree = h.render();
  assert.equal(h.props.skuId, 10);
  assert.equal(h.props.productId, 4);
  assert.equal(by(tree, 'role', 'combobox').length, 0);
  assert.equal(by(tree, 'id', 'picker-category').length, 0);
  assert.equal(by(tree, 'id', 'picker-tier')[0].props.value, 'STANDARD');
});
test('price tiers, manual overrides and reopened prices retain existing semantics', () => {
  const h = picker();
  by(h.render(), 'id', 'picker-tier')[0].props.onChange({ target: { value: 'RESELLER' } });
  assert.equal(h.props.price, '800.00');
  assert.equal(by(h.render(), 'id', 'picker-tier')[0].props.value, 'RESELLER');
  h.props.price = '777.00';
  assert.match(text(h.render()), /Manual price override/);
  assert.equal(by(h.render(), 'id', 'picker-tier')[0].props.value, 'RESELLER');
  const reopened = picker(item, '800.00');
  assert.equal(by(reopened.render(), 'id', 'picker-tier')[0].props.value, 'RESELLER');
  assert.equal(by(picker(item, '777.00').render(), 'id', 'picker-tier')[0].props.value, '');
  const legacy = picker(null, '18.50');
  legacy.props.productId = 3;
  assert.match(text(legacy.render()), /Historical product line/);
  assert.equal(by(legacy.render(), 'role', 'combobox').length, 0);
});
const Picker = () => null;
function form(lines) {
  return harness('components/opportunity-form.tsx', { initial: { name: 'Deal', projectIds: [], participants: [], lines, stageId: 1, currencyCode: 'USD' }, accounts: [], projects: [], productCategories: [], owners: [], stages: [], currencies: [], productCount: 5 }, {
    '@/lib/submit-guard': { useSubmitGuard: () => () => {} },
    'next/navigation': { useRouter: () => ({}) },
    '@/app/opportunities/actions': { submitOpportunity() {} },
    '@/components/product-picker': { ProductPicker: Picker },
  });
}
test('five lines keep values, totals and identities when adding, changing and removing neighbors', () => {
  const h = form(Array.from({ length: 5 }, (_, i) => ({ id: 0, productId: i + 1, skuId: i + 10, quantity: 1000, price: '990.22' })));
  let tree = h.render();
  const rows = tree => nodes(tree, n => n.type === 'div' && n.props.className?.includes('sm:grid-cols-[minmax'));
  const originalKeys = rows(tree).map(n => n.key);
  assert.equal(rows(tree).length, 5);
  assert.equal(text(tree).split('$990,220.00').length - 1, 5);
  by(tree, 'aria-label', 'Quantity 2')[0].props.onChange({ target: { value: '2' } });
  tree = h.render();
  by(tree, 'aria-label', 'Estimated unit price 2')[0].props.onChange({ target: { value: '800.00' } });
  tree = h.render();
  assert.match(text(tree), /\$1,600.00/);
  button(tree, 'Add product').props.onClick();
  tree = h.render();
  let pickers = nodes(tree, n => n.type === Picker);
  assert.equal(pickers.length, 6);
  assert.equal(pickers[5].props.productId, 0);
  assert.deepEqual(rows(tree).slice(0, 5).map(n => n.key), originalKeys);
  pickers[1].props.onChange(20, 30); // Change preserves quantity and price.
  tree = h.render();
  assert.equal(by(tree, 'aria-label', 'Quantity 2')[0].props.value, '2');
  assert.equal(by(tree, 'aria-label', 'Estimated unit price 2')[0].props.value, '800.00');
  button(tree, 'Remove').props.onClick();
  tree = h.render();
  assert.deepEqual(rows(tree).slice(0, 4).map(n => n.key), originalKeys.slice(1));
  pickers = nodes(tree, n => n.type === Picker);
  assert.equal(pickers[0].props.skuId, 30);
  assert.equal(pickers[1].props.skuId, 12);
  assert.equal(by(tree, 'aria-label', 'Quantity 1')[0].props.value, '2');
});
