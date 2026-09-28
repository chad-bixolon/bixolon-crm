import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(import.meta.url);
const contacts = [
  { id: 1, name: 'Ada Lovelace', email: 'ada@example.com', accountId: 10, accountName: 'Acme', active: true },
  { id: 2, name: 'Alex Smith', email: 'alex@example.com', accountId: null, accountName: null, active: true },
  { id: 3, name: 'Bea Jones', email: 'bea@example.com', accountId: 10, accountName: 'Acme', active: true },
];

function picker() {
  const slots = [];
  let cursor = 0;
  const hooks = { useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], value => { slots[index] = value; }];
  } };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const loaded = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    new Function('require', 'module', 'exports', code)(name => {
      if (name === 'react') return hooks;
      if (name.startsWith('@/')) return load(path.join(root, `${name.slice(2)}${name.includes('/lib/') ? '.ts' : '.tsx'}`));
      if (name.startsWith('./')) return load(path.resolve(path.dirname(file), `${name}.ts`));
      return require(name);
    }, loaded, loaded.exports);
    cache.set(file, loaded.exports);
    return loaded.exports;
  }
  const { ActivityContactPicker } = load(path.join(root, 'components/activity-contact-picker.tsx'));
  return { render() { cursor = 0; return ActivityContactPicker({ contacts, selectedIds: [], onChange() {}, accountSelected: true }); } };
}

function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
const content = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : Array.isArray(tree) ? tree.map(content).join('') : content(tree.props?.children);
const find = (tree, type) => nodes(tree, node => node.type === type);

test('Activity Contact search immediately shows match count and filtered dropdown label', () => {
  const subject = picker();
  find(subject.render(), 'input').find(node => node.props.type === 'search').props.onChange({ target: { value: 'Acme' } });
  const tree = subject.render();
  assert.equal(content(nodes(tree, node => node.props?.id === 'activityContactMatchCount')[0]), '2 contacts match');
  assert.equal(content(find(tree, 'option')[0]), 'Choose from filtered contacts');
  assert.deepEqual(find(tree, 'option').slice(1).map(content), ['Ada Lovelace — Acme', 'Bea Jones — Acme']);
  assert.equal(content(find(tree, 'button').find(node => content(node) === 'Clear search')), 'Clear search');
});

test('Activity Contact search shows no-match message and clearing restores all eligible options', () => {
  const subject = picker();
  find(subject.render(), 'input').find(node => node.props.type === 'search').props.onChange({ target: { value: 'missing' } });
  let tree = subject.render();
  assert.equal(content(nodes(tree, node => node.props?.id === 'activityContactMatchCount')[0]), 'No contacts match');
  assert.equal(find(tree, 'option').length, 1);
  find(tree, 'button').find(node => content(node) === 'Clear search').props.onClick();
  tree = subject.render();
  assert.equal(nodes(tree, node => node.props?.id === 'activityContactMatchCount').length, 0);
  assert.equal(content(find(tree, 'option')[0]), 'Choose Contact');
  assert.deepEqual(find(tree, 'option').slice(1).map(content), ['Ada Lovelace — Acme', 'Alex Smith — No Account', 'Bea Jones — Acme']);
});
