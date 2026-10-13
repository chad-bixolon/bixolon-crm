import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const require = Module.createRequire(fileURLToPath(import.meta.url));
const { normalizeSavedQuery, savedQueryHref, isSavedViewRoute } = require(path.join(root, 'lib/saved-views.ts'));

test('route allowlists reject arbitrary URLs, page, and transient state', () => {
  assert.equal(isSavedViewRoute('opportunities'), true);
  assert.equal(isSavedViewRoute('/reports?next=https://example.com'), false);
  assert.deepEqual(normalizeSavedQuery('opportunities', { q: ' Commit ', forecastCategory: 'COMMIT', page: '4', cursor: 'abc', modal: 'open', redirect: 'https://example.com' }), { q: 'Commit', forecastCategory: 'COMMIT' });
  assert.equal(savedQueryHref('opportunities', { q: 'Commit', page: '4' }), '/opportunities?q=Commit');
});

test('default values and invalid IDs are omitted; deliberate sort remains', () => {
  assert.deepEqual(normalizeSavedQuery('tasks', { visibility: 'active', assignedToId: '-1', dueTo: '2026-10-12', q: 'overdue' }), { dueTo: '2026-10-12', q: 'overdue' });
  assert.deepEqual(normalizeSavedQuery('support-cases', { archive: 'active', sort: 'priority', accountId: '4' }), { sort: 'priority' });
  assert.deepEqual(normalizeSavedQuery('contacts', { sort: 'name', dir: 'desc', pageSize: '100', accountId: '7' }), { accountId: '7', sort: 'name', dir: 'desc' });
  assert.deepEqual(normalizeSavedQuery('opportunities', { stageId: 'none', projectId: 'none' }), { projectId: 'none' });
});

test('Opportunity views preserve relative and explicit periods and normalize legacy dates', () => {
  assert.deepEqual(normalizeSavedQuery('opportunities', { closePeriod: 'current-quarter', forecastCategory: 'COMMIT' }), { forecastCategory: 'COMMIT', closePeriod: 'current-quarter' });
  assert.deepEqual(normalizeSavedQuery('opportunities', { closePeriod: 'next-quarter', forecastCategory: 'PIPELINE' }), { forecastCategory: 'PIPELINE', closePeriod: 'next-quarter' });
  assert.deepEqual(normalizeSavedQuery('opportunities', { closePeriod: '2027-Q1' }), { closePeriod: '2027-Q1' });
  assert.deepEqual(normalizeSavedQuery('opportunities', { closePeriod: 'custom', closeFrom: '2027-01-10', closeTo: '2027-02-20' }), { closePeriod: 'custom', closeFrom: '2027-01-10', closeTo: '2027-02-20' });
  assert.deepEqual(normalizeSavedQuery('opportunities', { closeFrom: '2027-01-10', closeTo: '2027-02-20' }), { closeFrom: '2027-01-10', closeTo: '2027-02-20', closePeriod: 'custom' });
  assert.deepEqual(normalizeSavedQuery('opportunities', { closePeriod: '2027-Q1', closeFrom: '2027-01-10' }), { closePeriod: '2027-Q1' });
  assert.equal(savedQueryHref('opportunities', { closePeriod: 'current-quarter' }), '/opportunities?closePeriod=current-quarter');
});
