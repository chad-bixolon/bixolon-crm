import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(fileURLToPath(import.meta.url));
const originalTs = Module._extensions['.ts'];
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { eligibleUserWhere } = require(path.join(root, 'lib/assignment-eligibility.ts'));
const { routeAccess } = require(path.join(root, 'lib/authorization.ts'));
const { qualityIssues, qualityWhere, qualityPage, qualityCounts, qualityRows, qualityBulkSupported, qualityPageSizeFor } = require(path.join(root, 'lib/data-quality.ts'));
Module._extensions['.ts'] = originalTs;

test('Data Quality routes are Admin only, including inactive Admin denial', () => {
  for (const role of ['SALES', 'SALES_MANAGER', 'MARKETING_MANAGER', 'READ_ONLY', 'SUPPORT']) assert.equal(routeAccess('/administration/data-quality', { id: 1, role, active: true }), 'denied');
  assert.equal(routeAccess('/administration/data-quality', { id: 1, role: 'ADMIN', active: false }), 'denied');
  assert.equal(routeAccess('/administration/data-quality', { id: 1, role: 'ADMIN', active: true }), 'allowed');
});

test('only the three owner checks support bulk corrections and their entire page fits the shared limit', () => {
  assert.deepEqual(qualityIssues.filter(issue => qualityBulkSupported(issue.key)).map(issue => issue.key), ['account-owner', 'account-owner-inactive', 'opportunity-owner']);
  for (const issue of qualityIssues) assert.equal(qualityPageSizeFor(issue.key), qualityBulkSupported(issue.key) ? 20 : 25);
});

test('issue predicates respect active records, open stages, and relationship status', () => {
  assert.deepEqual(qualityWhere('account-owner'), { status: 'ACTIVE', archivedAt: null, ownerId: null });
  assert.deepEqual(qualityWhere('account-owner-inactive'), { status: 'ACTIVE', archivedAt: null, owner: { is: { NOT: eligibleUserWhere('accounts.write') } } });
  assert.deepEqual(qualityWhere('contact-account'), { active: true, archivedAt: null, accountId: null });
  assert.deepEqual(qualityWhere('contact-account-inactive').account.OR[0].status, { not: 'ACTIVE' });
  assert.deepEqual(qualityWhere('opportunity-account').participants, { none: {} });
  assert.deepEqual(qualityWhere('opportunity-account-inactive').participants.some.account.OR[0].status, { not: 'ACTIVE' });
  assert.equal(qualityWhere('opportunity-account').stage.isClosed, false);
  assert.equal(qualityWhere('opportunity-close').expectedCloseDate, null);
  assert.deepEqual(qualityWhere('project-account').primaryAccountId, null);
  assert.equal(qualityWhere('task-archived-link').OR.length, 4);
  assert.equal(qualityWhere('activity-archived-link').OR.length, 3);
  assert.equal(qualityWhere('no-such-issue'), null);
  assert.equal(qualityPage('-5'), 1);
  assert.equal(qualityPage('2'), 2);
});

test('counts use database aggregates and drill-down uses bounded queries', async () => {
  const calls = [];
  const entity = name => ({
    count: async ({ where }) => { calls.push([name, 'count', where]); return 2; },
    findMany: async args => { calls.push([name, 'rows', args]); return name === 'contact' ? [{ id: 7, firstName: 'Ada', lastName: 'Lovelace', account: null }] : [{ id: 4, name: 'Acme', owner: null }]; },
  });
  const db = { account: entity('account'), contact: entity('contact'), opportunity: entity('opportunity'), project: entity('project'), task: entity('task'), activity: entity('activity'), $queryRaw: async query => { calls.push(['duplicate', 'raw', query]); return [{ count: 3n }]; } };
  const counts = await qualityCounts(db);
  assert.equal(Object.keys(counts).length, qualityIssues.length);
  assert.equal(counts['duplicate-account'], 3);
  assert.equal(counts['account-owner'], 2);
  const result = await qualityRows(db, 'contact-account', 'Ada', 2);
  assert.deepEqual(result.rows, [{ id: 7, name: 'Ada Lovelace', detail: 'No Account', href: '/contacts/7' }]);
  const rowCall = calls.find(call => call[0] === 'contact' && call[1] === 'rows');
  assert.equal(rowCall[2].take, 25);
  assert.equal(rowCall[2].skip, 25);
  assert.equal(rowCall[2].where.accountId, null);
  assert.equal(rowCall[2].where.OR.length, 3);
  assert.equal(calls.filter(call => call[1] === 'raw').length, 2);
});

test('duplicate review uses normalized Account names and nonblank Contact emails', async () => {
  const sql = [];
  const db = { $queryRaw: async query => { const text = query.strings.join('?'); sql.push(text); return text.startsWith('SELECT count(*)') ? [{ count: 2n }] : [{ id: 9, name: 'Acme', detail: null }]; } };
  const result = await qualityRows(db, 'duplicate-account', '', 1);
  assert.equal(result.count, 2);
  assert.equal(result.rows[0].href, '/accounts/9');
  assert.match(sql[0], /regexp_replace/);
  assert.match(sql[0], /\[\[:space:\]\]\+/);
  await qualityRows(db, 'duplicate-contact', '', 1);
  assert.match(sql[2], /lower\(btrim\(email\)\)/);
  assert.match(sql[2], /nullif\(btrim\(email\), ''\) IS NOT NULL/);
  assert.match(sql[2], /"archivedAt" IS NULL/);
});
