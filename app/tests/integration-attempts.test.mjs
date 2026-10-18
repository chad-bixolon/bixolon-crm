import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(import.meta.url);
const history = require(path.join(root, 'lib/integration-attempts.ts'));
const reports = require(path.join(root, 'lib/admin-integration-history.ts'));
const { Prisma } = require('@prisma/client');
const { SupportGmailHttpError } = require(path.join(root, 'lib/support-gmail-errors.ts'));
const admin = { id: 1, role: 'ADMIN', active: true };
function fixture() {
  const rows = [];
  return { rows, db: { scheduledJobRun: {
    create: async ({ data }) => { const row = { id: rows.length + 1, startedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }) => Object.assign(rows.find(row => row.id === where.id), data),
  } } };
}
test('Gmail success is awaited and stores only operational metadata', async () => {
  const f = fixture(), context = history.gmailContext('LINK_EMAIL', 'support@example.test', 'message-1', 7, 11);
  const result = await history.trackIntegrationAttempt(f.db, context, async () => ({ body: 'PRIVATE BODY', access_token: 'SECRET' }));
  assert.equal(result.body, 'PRIVATE BODY');
  assert.equal(f.rows[0].status, 'SUCCEEDED'); assert.ok(f.rows[0].completedAt instanceof Date);
  assert.equal(f.rows[0].actorId, 7); assert.equal(f.rows[0].supportCaseId, 11);
  assert.match(f.rows[0].contextKey, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(f.rows), /PRIVATE|SECRET|example|message-1/);
});
test('classified and unknown Gmail errors persist fixed safe categories and text only', async () => {
  for (const [error, category] of [[new SupportGmailHttpError('Bearer SECRET full provider body stack trace', 'quota'), 'QUOTA'], [new Error('secret password raw provider response'), 'UNKNOWN']]) {
    const f = fixture();
    await assert.rejects(history.trackIntegrationAttempt(f.db, history.gmailContext('INBOX_FETCH', 'mailbox', 'inbox', 7), async () => { throw error; }), error);
    assert.equal(f.rows[0].status, 'FAILED'); assert.equal(f.rows[0].failureCategory, category);
    assert.equal(f.rows[0].errorSummary, history.failureMessages[category]);
    assert.doesNotMatch(JSON.stringify(f.rows), /SECRET|password|stack trace|provider response/);
  }
  const categories = { 'invalid-token': 'AUTHENTICATION', 'invalid-grant': 'AUTHENTICATION', 'oauth-client': 'CONFIGURATION', 'insufficient-scope': 'PERMISSION', 'rate-limit': 'RATE_LIMIT', quota: 'QUOTA', 'domain-policy': 'PERMISSION', forbidden: 'PERMISSION', 'not-found': 'NOT_FOUND', transient: 'PROVIDER', network: 'NETWORK', timeout: 'NETWORK', 'request-failed': 'UNKNOWN' };
  for (const [category, expected] of Object.entries(categories)) assert.equal(history.gmailFailure(new SupportGmailHttpError('never persist', category)), expected);
  assert.equal(history.gmailFailure(new Error('Support Gmail is busy. Please try again in a moment.')), 'LOCAL_THROTTLE');
  assert.equal(history.gmailFailure(new Error('Support Gmail connection failed. Try again.')), 'NETWORK');
});
test('history start failure prevents unrecorded work; completion failure retains incomplete evidence', async () => {
  let called = false;
  const context = history.gmailContext('IGNORE', 'mailbox', 'message', 7);
  await assert.rejects(history.trackIntegrationAttempt({ scheduledJobRun: { create: async () => { throw Error('db unavailable'); } } }, context, async () => { called = true; }));
  assert.equal(called, false);
  const f = fixture(); f.db.scheduledJobRun.update = async () => { throw Error('private db detail'); };
  const original = console.error, logs = []; console.error = value => logs.push(value);
  try { assert.equal(await history.trackIntegrationAttempt(f.db, context, async () => 42), 42); }
  finally { console.error = original; }
  assert.equal(f.rows[0].status, 'RUNNING'); assert.equal(logs.length, 1); assert.doesNotMatch(logs[0], /private/);
});
test('history and durable health deny non-Admin, inactive and impersonated effective users before querying', async () => {
  const db = new Proxy({}, { get() { throw Error('unexpected db query'); } });
  for (const actor of ['SALES', 'SALES_MANAGER', 'SUPPORT', 'READ_ONLY', 'MARKETING_MANAGER'].map(role => ({ ...admin, role })).concat([{ ...admin, active: false }, { ...admin, archivedAt: new Date() }, { ...admin, role: 'SALES', realUser: admin }])) {
    await assert.rejects(reports.adminIntegrationHistory(db, actor, {}), /Access denied/);
    await assert.rejects(reports.durableIntegrationHealth(db, actor), /Access denied/);
  }
});
test('filters are parameterized and pagination uses a bounded consistent database read', async () => {
  const conditions = reports.integrationConditions({ integration: 'SUPPORT_GMAIL', status: 'Recovered', actor: '7', from: '2026-10-01', to: '2026-10-17' });
  assert.ok(conditions.values.includes('SUPPORT_GMAIL')); assert.ok(conditions.values.includes('Recovered')); assert.ok(conditions.values.includes(7));
  assert.ok(conditions.values.some(v => v instanceof Date && v.toISOString() === '2026-10-18T00:00:00.000Z'));
  assert.match(reports.integrationConditions({ actor: 'system' }).text, /IS NULL/);
  assert.deepEqual(reports.normalizeIntegrationFilters({ integration: ['SUPPORT_GMAIL'], page: ' 2 ', unrelated: 'secret' }), { page: '2' });
  const queries = []; let options;
  const db = { $transaction: async (fn, config) => { options = config; return fn({ $queryRaw: async (strings, ...values) => { const query = Prisma.sql(strings, ...values); queries.push(query); return queries.length === 1 ? [{ count: 27n }] : []; } }); } };
  const result = await reports.adminIntegrationHistory(db, admin, { page: '999' });
  assert.equal(result.page, 2); assert.equal(result.pages, 2); assert.equal(options.isolationLevel, 'RepeatableRead');
  assert.match(queries[1].text, /LIMIT 25 OFFSET/); assert.equal(queries[1].values.at(-1), 25);
  // Existing weekly history is read directly, never copied or unioned into another ledger.
  assert.match(queries[0].text, /FROM "ScheduledJobRun" h/); assert.doesNotMatch(queries[0].text, /errorSummary|resultSummary|UNION/);
  assert.match(queries[0].text, /s\."startedAt" >= h\."completedAt"/);
  assert.match(queries[0].text, /s\."isTest" = h\."isTest"/);
});
test('System Health reads stored attempts, last successes and unresolved failures without provider access', async () => {
  const queries = [];
  const db = { $queryRaw: async (strings, ...values) => { const query = Prisma.sql(strings, ...values); queries.push(query); return []; } };
  const previous = globalThis.fetch; globalThis.fetch = () => { throw Error('provider polling forbidden'); };
  try { const result = await reports.durableIntegrationHealth(db, admin); assert.equal(result.length, 3); assert.equal(result[0].latest, null); }
  finally { globalThis.fetch = previous; }
  assert.equal(queries.length, 9);
  for (const q of queries) { assert.match(q.text, /NOT "isTest"/); assert.match(q.text, /LIMIT 1/); assert.doesNotMatch(q.text, /errorSummary|resultSummary/); }
  assert.equal(reports.safeAttemptFailure('Bearer SECRET'), history.failureMessages.UNKNOWN);
  for (const category of ['constructor', '__proto__', 'toString']) {
    assert.equal(reports.safeAttemptFailure(category), history.failureMessages.UNKNOWN);
    assert.equal(reports.safeFailureLabel(category), 'Unknown failure');
    assert.equal(history.gmailFailure(new SupportGmailHttpError('raw secret', category)), 'UNKNOWN');
  }
  assert.equal(reports.safeFailureDetail('AUTHENTICATION'), 'Reconnect the integration and retry.');
});
