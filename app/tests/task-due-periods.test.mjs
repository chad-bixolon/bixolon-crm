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
const { taskWhere, dayBounds, taskTiming } = require(path.join(root, 'lib/work.ts'));
const { selectedTaskDuePeriod } = require(path.join(root, 'lib/task-due-period.ts'));
const { businessWeekBounds } = require(path.join(root, 'lib/business-date.ts'));
const { normalizeSavedQuery, savedQueryHref, canUseSavedViews } = require(path.join(root, 'lib/saved-views.ts'));
const { countTaskFilters } = require(path.join(root, 'lib/filter-count.ts'));
const { taskScope, can } = require(path.join(root, 'lib/authorization.ts'));
const { resolveUserContext } = require(path.join(root, 'lib/dev-impersonation.ts'));
const now = new Date('2026-10-14T16:00:00Z'); // Wednesday in New York
const date = value => new Date(`${value}T00:00:00Z`);
const range = (period, at = now, extra = {}) => taskWhere({ duePeriod: period, ...extra }, at).dueDate;

test('relative periods use date-only ranges, with today plus seven days and Monday–Sunday week', () => {
  assert.deepEqual(range('overdue'), { lt: date('2026-10-14') });
  assert.deepEqual(range('today'), { gte: date('2026-10-14'), lt: date('2026-10-15') });
  assert.deepEqual(range('next-7-days'), { gte: date('2026-10-14'), lt: date('2026-10-22') });
  assert.deepEqual(range('this-week'), { gte: date('2026-10-12'), lt: date('2026-10-19') });
  for (const period of ['overdue', 'today', 'next-7-days', 'this-week']) {
    assert.deepEqual(taskWhere({ duePeriod: period }, now).status, { not: 'COMPLETED' });
    // SQL comparisons exclude NULL due dates, without an application-side pass.
    assert.ok(range(period).lt instanceof Date);
    assert.equal(taskWhere({ duePeriod: period, status: 'COMPLETED' }, now).status, 'COMPLETED');
    for (const status of ['OPEN', 'IN_PROGRESS', 'CANCELLED']) assert.equal(taskWhere({ duePeriod: period, status }, now).status, status);
  }
});

test('relative criteria compose with assignee, relationships, priority, search, and archive visibility', () => {
  const base = { assignedToId: '7', accountId: '11', opportunityId: '13', priority: 'HIGH', q: 'call', visibility: 'all' };
  const plain = taskWhere(base, now), relative = taskWhere({ ...base, duePeriod: 'today' }, now);
  assert.deepEqual(relative, { ...plain, status: { not: 'COMPLETED' }, dueDate: range('today') });
  assert.equal(relative.assignedToId, 7);
  assert.equal(taskWhere({ ...base, duePeriod: 'today', status: 'garbage' }, now).status.not, 'COMPLETED');
  assert.deepEqual(taskWhere({ duePeriod: 'overdue', visibility: 'archived' }, now).archivedAt, { not: null });
});

test('legacy/custom absolute dates stay inclusive and retain completed/undated default behavior', () => {
  const absolute = { dueFrom: '2026-10-01', dueTo: '2026-10-31' };
  assert.deepEqual(taskWhere(absolute, now).dueDate, { gte: date('2026-10-01'), lt: date('2026-11-01') });
  assert.deepEqual(taskWhere({ ...absolute, duePeriod: 'custom' }, now), taskWhere(absolute, now));
  assert.deepEqual(taskWhere({ dueFrom: '2026-10-14', dueTo: '2026-10-14' }, now).dueDate, range('today'));
  assert.equal(taskWhere(absolute, now).status, undefined);
  assert.equal(taskWhere({}, now).dueDate, undefined); // undated and completed still available
  assert.equal(taskWhere({}, now).status, undefined);
  assert.deepEqual(taskWhere({ dueTo: '2026-10-14' }, now).dueDate, { lt: date('2026-10-15') });
  assert.equal(taskWhere({ dueFrom: '2026-02-30' }, now).dueDate, undefined);
  assert.deepEqual(range('today', now, absolute), range('today'));
  assert.equal(taskWhere({ ...absolute, duePeriod: '' }, now).dueDate, undefined);
  assert.equal(selectedTaskDuePeriod(absolute), 'custom');
  assert.equal(selectedTaskDuePeriod({ duePeriod: 'invalid' }), '');
});

test('Saved Views persist meaning, recalculate six months later, and leave absolute views unchanged', () => {
  for (const period of ['overdue', 'today', 'next-7-days', 'this-week']) {
    const stored = normalizeSavedQuery('tasks', { duePeriod: period, assignedToId: '7', dueFrom: '2026-01-01', dueTo: '2026-01-02', page: '9' });
    assert.deepEqual(stored, { assignedToId: '7', duePeriod: period });
    const reloaded = normalizeSavedQuery('tasks', JSON.parse(JSON.stringify(stored)));
    assert.deepEqual(reloaded, stored);
    assert.match(savedQueryHref('tasks', reloaded), new RegExp(`duePeriod=${period}`));
    assert.notDeepEqual(taskWhere(reloaded, now).dueDate, taskWhere(reloaded, new Date('2027-04-14T16:00:00Z')).dueDate);
    assert.equal(taskWhere(reloaded, now).assignedToId, 7);
  }
  const old = { dueFrom: '2026-10-01', dueTo: '2026-10-31', status: 'COMPLETED' };
  assert.deepEqual(normalizeSavedQuery('tasks', old), old);
  assert.equal(savedQueryHref('tasks', old), '/tasks?status=COMPLETED&dueFrom=2026-10-01&dueTo=2026-10-31');
  assert.deepEqual(taskWhere(old, now), taskWhere(old, new Date('2027-04-14T16:00:00Z')));
  assert.deepEqual(normalizeSavedQuery('tasks', { ...old, duePeriod: 'custom' }), { ...old, duePeriod: 'custom' });
  assert.deepEqual(normalizeSavedQuery('tasks', { ...old, duePeriod: 'unknown' }), old);
  assert.deepEqual(normalizeSavedQuery('tasks', { ...old, duePeriod: '' }), { status: 'COMPLETED' });
});

test('New York midnight rolls the period; UTC midnight does not', () => {
  assert.deepEqual(range('today', new Date('2026-01-07T04:59:59Z')), { gte: date('2026-01-06'), lt: date('2026-01-07') });
  assert.deepEqual(range('today', new Date('2026-01-07T05:00:00Z')), { gte: date('2026-01-07'), lt: date('2026-01-08') });
  assert.deepEqual(range('today', new Date('2026-10-14T23:59:59Z')), range('today', new Date('2026-10-15T00:00:00Z')));
  assert.equal(range('today', new Date('2026-10-15T03:59:59Z')).gte.toISOString().slice(0, 10), '2026-10-14');
  assert.equal(range('today', new Date('2026-10-15T04:00:00Z')).gte.toISOString().slice(0, 10), '2026-10-15');
});

test('DST spring-forward/fall-back and process timezone cannot shift date-only windows', () => {
  for (const [before, after, day, end] of [
    ['2026-03-08T06:59:59Z', '2026-03-08T07:00:00Z', '2026-03-08', '2026-03-16'],
    ['2026-11-01T05:59:59Z', '2026-11-01T06:00:00Z', '2026-11-01', '2026-11-09'],
  ]) {
    assert.deepEqual(range('today', new Date(before)), range('today', new Date(after)));
    assert.deepEqual(range('next-7-days', new Date(after)), { gte: date(day), lt: date(end) });
  }
  const previous = process.env.TZ;
  try {
    for (const zone of ['UTC', 'Pacific/Honolulu', 'Asia/Tokyo']) {
      process.env.TZ = zone;
      assert.deepEqual(range('today'), { gte: date('2026-10-14'), lt: date('2026-10-15') });
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('This Week rolls only at Eastern Monday, including year rollover', () => {
  assert.deepEqual(range('this-week', new Date('2026-10-19T03:59:59Z')), { gte: date('2026-10-12'), lt: date('2026-10-19') });
  assert.deepEqual(range('this-week', new Date('2026-10-19T04:00:00Z')), { gte: date('2026-10-19'), lt: date('2026-10-26') });
  assert.deepEqual(range('this-week', new Date('2027-01-01T18:00:00Z')), { gte: date('2026-12-28'), lt: date('2027-01-04') });
  assert.deepEqual(businessWeekBounds(now), { start: date('2026-10-12'), end: date('2026-10-19') });
  assert.deepEqual(dayBounds(now), { start: date('2026-10-14'), end: date('2026-10-15') });
  assert.equal(taskTiming({ status: 'OPEN', dueDate: date('2026-10-14') }, now), 'Due today');
});

test('due period counts as one filter, custom range included; cleared/stale dates do not count', () => {
  assert.equal(countTaskFilters({ visibility: 'active' }), 0);
  assert.equal(countTaskFilters({ assignedToId: '7', duePeriod: 'next-7-days' }), 2);
  assert.equal(countTaskFilters({ duePeriod: 'custom', dueFrom: '2026-10-01', dueTo: '2026-10-31' }), 1);
  assert.equal(countTaskFilters({ dueFrom: '2026-10-01', dueTo: '2026-10-31' }), 1);
  assert.equal(countTaskFilters({ duePeriod: '', dueFrom: '2026-10-01' }), 0);
});

test('relative views retain role access and effective-assignee filtering without mutation permission changes', () => {
  for (const role of ['ADMIN', 'SALES_MANAGER', 'SALES', 'MARKETING_MANAGER', 'READ_ONLY', 'SUPPORT']) {
    const actor = { id: 7, role, active: true, archivedAt: null };
    assert.equal(canUseSavedViews(actor, 'tasks'), can(actor, 'tasks.read'));
    const base = taskWhere({ assignedToId: '7' }, now);
    const period = taskWhere({ assignedToId: '7', duePeriod: 'overdue' }, now);
    assert.deepEqual(period, { ...base, status: { not: 'COMPLETED' }, dueDate: range('overdue') });
  }
});

test('impersonated My Tasks uses the effective Sales assignee and retains read-only restrictions', async () => {
  const real = { id: 1, name: 'Admin', email: 'admin@example.test', role: 'ADMIN', active: true };
  for (const role of ['SALES', 'READ_ONLY']) {
    const target = { id: 7, firstName: 'Effective', lastName: 'User', email: 'effective@example.test', role, active: true };
    const context = await resolveUserContext(real, '7', { user: { findUnique: async () => target } }, { NODE_ENV: 'development', ENABLE_DEV_IMPERSONATION: 'true' });
    assert.equal(context.real.id, 1);
    assert.equal(context.effective.id, 7);
    assert.equal(canUseSavedViews(context.effective, 'tasks'), true);
    assert.equal(can(context.effective, 'tasks.write'), role === 'SALES');
    if (role === 'SALES') {
      assert.deepEqual(taskScope(context.effective), { assignedToId: 7 });
      assert.equal(taskWhere({ duePeriod: 'overdue', assignedToId: String(context.effective.id) }, now).assignedToId, 7);
    }
  }
});
