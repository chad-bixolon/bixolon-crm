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
const { adminAudit, auditDate, auditValue, auditConditions, normalizeAuditFilters } = require(path.join(root, 'lib/admin-audit.ts'));
const { ownershipWhere, ownershipCounts, ownershipRows } = require(path.join(root, 'lib/admin-ownership.ts'));
const { calendarConnectionHealth, databaseHealth } = require(path.join(root, 'lib/system-health.ts'));
const { recordMaintenance } = require(path.join(root, 'lib/admin-maintenance.ts'));
const admin = { id: 1, role: 'ADMIN', active: true };
test('all reporting services deny non-Admin and unavailable effective users before database access', async () => {
  const db = new Proxy({}, { get() { throw Error('Unexpected database access'); } });
  for (const actor of ['SALES', 'SALES_MANAGER', 'SUPPORT', 'READ_ONLY', 'MARKETING_MANAGER'].map(role => ({ ...admin, role })).concat([{ ...admin, active: false }, { ...admin, archivedAt: new Date() }])) {
    await assert.rejects(adminAudit(db, actor, {}), /Access denied/);
    await assert.rejects(ownershipCounts(db, actor), /Access denied/);
    await assert.rejects(ownershipRows(db, actor, 'Task', undefined, 1), /Access denied/);
  }
});
test('ownership predicates use eligibility and operational rules without inventing missing-owner requirements', () => {
  for (const type of ['Account', 'Opportunity', 'Project', 'Task', 'Support Case']) {
    const where = ownershipWhere(type, 42), user = where.owner ?? where.assignedTo ?? where.OR[0].assignedTo;
    assert.equal(user.is.NOT.active, true);
    assert.equal(user.is.NOT.archivedAt, null);
    assert.ok(user.is.NOT.role.in.includes('ADMIN'));
    assert.equal(where.ownerId ?? where.assignedToId, 42);
    assert.equal(JSON.stringify(where).includes('"ownerId":null'), false);
  }
  assert.equal(ownershipWhere('Opportunity').stage.isClosed, false);
  assert.deepEqual(ownershipWhere('Task').status.in, ['OPEN', 'IN_PROGRESS']);
  assert.ok(ownershipWhere('Contact').account.is.owner);
});
test('date/actor/entity/action filters are parameterized and report pagination is bounded and clamped', async () => {
  assert.equal(auditDate('2026-02-30'), null);
  assert.equal(auditDate('2026-10-15').toISOString(), '2026-10-15T00:00:00.000Z');
  assert.deepEqual(normalizeAuditFilters({ entity: ['Task', 'Account'], actor: null, action: '  Assignment  ' }), { action: 'Assignment' });
  const conditions = auditConditions({ from: '2026-10-01', to: '2026-10-15', actor: '9', entity: 'Task', action: 'Assignment' });
  assert.equal(conditions.values.includes(9), true);
  assert.equal(conditions.values.includes('Task'), true);
  assert.equal(conditions.values.includes('Assignment'), true);
  const queries = [];
  const tx = { $queryRaw: async query => { queries.push(query); return queries.length === 1 ? [{ count: 26n }] : []; } };
  const result = await adminAudit({ $transaction: fn => fn(tx) }, admin, { page: '999999' });
  assert.equal(result.page, 2); assert.equal(result.pages, 2);
  assert.match(queries[1].strings.join(' '), /LIMIT .* OFFSET /);
  assert.deepEqual(queries[1].values.slice(-2), [25, 25]);
  assert.equal(auditValue(null), 'Not recorded'); assert.equal(auditValue('0'), '0'); assert.equal(auditValue('Old owner'), 'Old owner');
});
test('health statuses never return provider secrets or exceptions', async () => {
  const now = new Date(), base = { connectionStatus: 'CONNECTED', lastSuccessfulSyncAt: now, lastSyncStartedAt: now, lastSyncCompletedAt: now, lastError: null };
  assert.equal(calendarConnectionHealth(base).status, 'Connected');
  assert.equal(calendarConnectionHealth({ ...base, lastSuccessfulSyncAt: null }).status, 'Awaiting first sync');
  assert.equal(calendarConnectionHealth({ ...base, lastSuccessfulSyncAt: new Date(0) }).status, 'Stale');
  const health = calendarConnectionHealth({ ...base, connectionStatus: 'NEEDS_REAUTH', lastError: 'Bearer SECRET postgres://password stack trace' });
  assert.equal(health.status, 'Reconnect required');
  assert.equal(JSON.stringify(health).includes('SECRET'), false);
  const db = await databaseHealth({ $queryRaw: async () => { throw Error('postgres://password'); } });
  assert.equal(db.connected, false); assert.equal(JSON.stringify(db).includes('password'), false);
});
test('maintenance stores only curated metadata and propagates failure so the transaction rolls back', async () => {
  const entries = [], tx = { adminMaintenanceEvent: { create: async ({ data }) => entries.push(data) } };
  await recordMaintenance(tx, 9, 'Task', 'Reassign', [1, 2]);
  assert.deepEqual(entries[0], { actorId: 9, entityType: 'Task', action: 'Reassign', recordIds: [1, 2], recordCount: 2 });
  await recordMaintenance(tx, 9, 'Task', 'Reassign', []); assert.equal(entries.length, 1);
  await assert.rejects(recordMaintenance({ adminMaintenanceEvent: { create: async () => { throw Error('write failed'); } } }, 9, 'Task', 'Reassign', [1]), /write failed/);
});

test('integration aggregation and job checks return safe selected fields and unavailable states', async () => {
  const { integrationHealth, scheduledJobHealth } = require(path.join(root, 'lib/system-health.ts'));
  const saved = process.env.SUPPORT_GMAIL_ENABLED;
  process.env.SUPPORT_GMAIL_ENABLED = 'false';
  const now = new Date(), queries = [];
  const connection = { id: 3, googleEmail: 'person@example.test', connectionStatus: 'CONNECTED', lastSuccessfulSyncAt: now, lastSyncStartedAt: now, lastSyncCompletedAt: now, lastError: 'refresh_token=SUPER_SECRET', user: { firstName: 'A', lastName: 'User', active: true, archivedAt: null } };
  const db = {
    user: { count: async () => 4 },
    googleCalendarConnection: { count: async () => 30, findMany: async query => { queries.push(query); return [connection]; } },
    scheduledJobRun: { findFirst: async query => { assert.equal(query.select.errorSummary, undefined); assert.equal(query.select.resultSummary, undefined); return null; } },
  };
  try {
    const health = await integrationHealth(db, 2);
    assert.equal(health.supportGmail.status, 'Disabled');
    assert.equal(health.disconnected, 4); assert.equal(health.connections[0].status, 'Problem');
    assert.equal(JSON.stringify(health).includes('SUPER_SECRET'), false);
    assert.equal(queries[0].take, 25); assert.equal(queries[0].skip, 25); assert.equal(queries[1].take, 10);
    for (const query of queries) { assert.equal(query.select.refreshTokenEncrypted, undefined); assert.equal(query.select.syncToken, undefined); }
    assert.equal((await scheduledJobHealth(db)).every(job => job.state === 'Stale'), true);
    const unavailable = await integrationHealth({ googleCalendarConnection: { count: async () => { throw Error('database secret'); }, findMany: async () => [] }, user: { count: async () => 0 } });
    assert.equal(unavailable.available, false); assert.equal(JSON.stringify(unavailable).includes('secret'), false);
  } finally { if (saved === undefined) delete process.env.SUPPORT_GMAIL_ENABLED; else process.env.SUPPORT_GMAIL_ENABLED = saved; }
});
