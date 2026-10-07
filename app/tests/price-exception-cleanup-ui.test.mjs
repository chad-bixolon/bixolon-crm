import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(fileURLToPath(import.meta.url));
const React = require('react');
const originalLoad = Module._load;
const originalTsx = Module._extensions['.tsx'];
let state = [];
let cursor = 0;
const hooks = {
  ...React,
  useState(initial) {
    const index = cursor++;
    if (!(index in state)) state[index] = initial;
    return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
  },
  useMemo: calculate => calculate(),
  useTransition: () => [false, callback => callback()],
};
Module._extensions['.tsx'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
Module._load = function(specifier, parent, isMain) {
  if (specifier === 'react') return hooks;
  if (specifier === 'next/link') return function Link() {};
  if (specifier === '@/lib/price-exception-cleanup-shared') return require(path.join(root, 'lib/price-exception-cleanup-shared.ts'));
  if (specifier === './actions') return { confirmCleanup() {}, previewCleanup() {} };
  if (specifier === './editor') return { CleanupEditor() {} };
  return originalLoad.call(this, specifier, parent, isMain);
};
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { CleanupWorkflow } = require(path.join(root, 'app/administration/price-exceptions/workflow.tsx'));
const { cleanupIssueKeys, cleanupIssues } = require(path.join(root, 'lib/price-exception-cleanup-shared.ts'));
Module._load = originalLoad;
Module._extensions['.tsx'] = originalTsx;

const eligible = { assignOwner: true, linkDistributor: true, linkVar: true, linkEndUser: true, expire: true, archive: true };
const rows = [
  { id: 2, code: 'PE-B', status: 'ACTIVE', sourceType: 'IMPORT', expiration: '2026-09-01', owner: 'Unassigned', parties: 'Beta', issues: ['missingOwner', 'activePastExpiration'], clues: [], creator: null, sourceRep: null, roles: [], lines: [], eligible },
  { id: 1, code: 'PE-A', status: 'ACTIVE', sourceType: 'IMPORT', expiration: '2026-09-01', owner: 'Unassigned', parties: 'Acme', issues: ['missingOwner'], clues: [], creator: null, sourceRep: null, roles: [], lines: [], eligible: { ...eligible, expire: false } },
];
const counts = Object.fromEntries(cleanupIssueKeys.map(key => [key, rows.filter(row => row.issues.includes(key)).length]));
const props = { rows, counts, salesReps: [{ id: 7, firstName: 'Sales', lastName: 'Rep' }], accounts: [{ id: 8, name: 'Acme' }], skus: [], accountOptions: { industries: [], territories: [] } };
function render() { cursor = 0; return CleanupWorkflow(props); }
function all(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(item => all(item, predicate));
  if (!node || typeof node !== 'object' || !node.props) return [];
  return [...(predicate(node) ? [node] : []), ...all(node.props.children, predicate)];
}
function label(node) { return all(node, item => item.type === 'label'); }
function text(node) { return Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' && node.props ? text(node.props.children) : String(node ?? ''); }
function control(tree, title) { return all(label(tree).find(item => text(item).startsWith(title)), item => item.type === 'select' || item.type === 'input')[0]; }
function button(tree, title) { return all(tree, item => item.type === 'button').find(item => text(item) === title); }
function peLinks(tree) { return all(tree, item => item.props.href?.startsWith('/price-exceptions/')).map(item => item.props.href); }
function reset() { state = []; cursor = 0; }

test('every issue card uses audit counts and the existing Issue filter', () => {
  reset();
  let tree = render();
  const cards = all(tree, item => item.type === 'button' && item.props['aria-label']?.startsWith('Filter by '));
  assert.equal(cards.length, cleanupIssueKeys.length);
  for (const key of cleanupIssueKeys) {
    const card = cards.find(item => item.props['aria-label'] === `Filter by ${cleanupIssues[key]}: ${counts[key]} records`);
    assert.ok(card, key);
    assert.equal(card.props['aria-pressed'], false);
    assert.match(card.props.className, counts[key] ? /pe-cleanup-issue-card/ : /pe-cleanup-issue-card-zero/);
  }
  cards.find(item => item.props['aria-label'].includes('Active past expiration')).props.onClick();
  tree = render();
  assert.equal(control(tree, 'Issue').props.value, 'activePastExpiration');
  assert.deepEqual(peLinks(tree), ['/price-exceptions/2']);
  assert.equal(all(tree, item => item.props['aria-pressed'] === true).length, 1);
  assert.match(all(tree, item => item.props['aria-pressed'] === true)[0].props.className, /pe-cleanup-issue-card-selected/);
});

test('Issue, search and sort retain their behavior and selection feedback updates', () => {
  reset();
  let tree = render();
  for (const title of ['Issue', 'Search PE or customer', 'Sort']) assert.match(control(tree, title).props.className, /pe-cleanup-control/);
  assert.deepEqual(peLinks(tree), ['/price-exceptions/2', '/price-exceptions/1']);
  control(tree, 'Sort').props.onChange({ target: { value: 'code' } });
  tree = render();
  assert.deepEqual(peLinks(tree), ['/price-exceptions/1', '/price-exceptions/2']);
  control(tree, 'Search PE or customer').props.onChange({ target: { value: 'Beta' } });
  tree = render();
  assert.deepEqual(peLinks(tree), ['/price-exceptions/2']);
  all(tree, item => item.props['aria-label'] === 'Select PE-B')[0].props.onChange({ target: { checked: true } });
  tree = render();
  assert.match(text(all(tree, item => item.props.className === 'pe-cleanup-selection-status')[0]), /1 shown · 1 selected/);
  control(tree, 'Issue').props.onChange({ target: { value: 'missingOwner' } });
  tree = render();
  assert.match(text(all(tree, item => item.props.className === 'pe-cleanup-selection-status')[0]), /0 selected/);
  assert.equal(control(tree, 'Search PE or customer').props.value, 'Beta');
  assert.equal(control(tree, 'Sort').props.value, 'code');
});

test('bulk fields and preview state follow action and eligible selection', () => {
  reset();
  let tree = render();
  assert.ok(control(tree, 'Salesperson'));
  assert.equal(button(tree, 'Preview updates').props.disabled, true);
  all(tree, item => item.props['aria-label'] === 'Select PE-B')[0].props.onChange({ target: { checked: true } });
  tree = render();
  assert.equal(button(tree, 'Preview updates').props.disabled, true);
  control(tree, 'Salesperson').props.onChange({ target: { value: '7' } });
  tree = render();
  assert.equal(button(tree, 'Preview updates').props.disabled, false);
  control(tree, 'Action').props.onChange({ target: { value: 'expire' } });
  tree = render();
  assert.equal(control(tree, 'Salesperson'), undefined);
  assert.equal(control(tree, 'Active Account'), undefined);
  assert.equal(button(tree, 'Preview updates').props.disabled, false);
  all(tree, item => item.props['aria-label'] === 'Select PE-A')[0].props.onChange({ target: { checked: true } });
  tree = render();
  assert.equal(button(tree, 'Preview updates').props.disabled, false);
  assert.match(text(tree), /1 selected records are ineligible for this action\. They will be skipped after preview\./);
  control(tree, 'Action').props.onChange({ target: { value: 'linkDistributor' } });
  tree = render();
  assert.ok(control(tree, 'Active Account'));
  assert.equal(control(tree, 'Salesperson'), undefined);
  assert.equal(button(tree, 'Preview updates').props.disabled, true);
});

test('cleanup CSS gives controls equal height and responsive compact layouts', () => {
  const css = fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8');
  assert.match(css, /\.field:not\(textarea\):not\(\[type="file"\]\)\s*\{\s*height: var\(--control-height\)/);
  assert.match(css, /\.pe-cleanup-control\s*\{[^}]*margin-top: \.25rem;/);
  assert.match(css, /\.pe-cleanup-issue-card\s*\{[^}]*min-height: 4rem;/);
  assert.match(css, /\.btn-primary:disabled/);
  assert.match(css, /min-width: 64rem\) \{ \.pe-cleanup-filter-grid/);
});
