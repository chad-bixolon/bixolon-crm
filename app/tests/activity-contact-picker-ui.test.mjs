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
  { id: 2, name: 'Jane Historical', email: null, accountId: 10, accountName: 'Acme', active: false, archivedAt: null },
];
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
function content(tree) { return tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : Array.isArray(tree) ? tree.map(content).join('') : content(tree.props?.children); }
function harness(selectedIds = []) {
  const slots = []; let cursor = 0;
  const hooks = { useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; } };
  const file = path.join(root, 'components/activity-contact-picker.tsx');
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mod = { exports: {} };
  const EntityPicker = () => null;
  new Function('require', 'module', 'exports', code)(name => name === 'react' ? hooks : name === './entity-picker' ? { EntityPicker } : require(name), mod, mod.exports);
  const { ActivityContactPicker } = mod.exports;
  return { render() { cursor = 0; return ActivityContactPicker({ contacts, selectedIds, onChange(ids) { selectedIds = ids; }, accountId: 10 }); }, EntityPicker, selected() { return selectedIds; } };
}

test('Activity Contact picker uses remote dependent Contact search and adds the selected result', () => {
  const subject = harness();
  let tree = subject.render();
  const picker = nodes(tree, node => node.type === subject.EntityPicker)[0];
  assert.deepEqual(picker.props.filters, { accountId: 10, includeUnassigned: true });
  assert.equal(nodes(tree, node => node.type === 'option').length, 0);
  picker.props.onChange({ id: 3, name: 'Bea Jones', accountId: 10, context: 'Acme', email: 'bea@example.com' });
  tree = subject.render();
  nodes(tree, node => node.type === 'button' && content(node) === 'Add Contact')[0].props.onClick();
  assert.deepEqual(subject.selected(), [3]);
  assert.match(content(subject.render()), /Bea Jones/);
});

test('Selected inactive Contact keeps its name and can be removed', () => {
  const subject = harness([2]);
  const tree = subject.render();
  assert.match(content(tree), /Jane Historical/);
  assert.match(content(tree), /Inactive/);
  nodes(tree, node => node.props?.['aria-label'] === 'Remove Jane Historical')[0].props.onClick();
  assert.deepEqual(subject.selected(), []);
});
