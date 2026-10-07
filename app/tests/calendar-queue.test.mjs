import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(import.meta.url);
const { calendarQueueWhere } = require(path.join(root, 'lib/calendar-queue.ts'));
const base = { userId: 7, from: new Date('2026-08-08T00:00:00Z'), to: new Date('2027-01-05T00:00:00Z'), now: new Date('2026-10-07T15:00:00Z') };

test('Needs Review is personal, completed, recent, unlogged, unignored and uncancelled', () => {
  const rows = calendarQueueWhere({ ...base, status: 'review' }).AND;
  assert.deepEqual(rows[0], { userId: 7, connection: { userId: 7 } });
  assert.equal(rows[1].OR[0].startAt.gte.toISOString(), base.from.toISOString());
  assert.equal(rows[2].review.activityId, null); assert.equal(rows[2].review.ignoredAt, null);
  assert.equal(rows[2].status.not, 'CANCELLED'); assert.equal(rows[2].cancelledAt, null);
  assert.equal(rows[3].OR[0].endAt.lte.toISOString(), base.now.toISOString());
});
test('upcoming, logged, ignored and cancelled use separate views', () => {
  assert.equal(calendarQueueWhere({ ...base, status: 'upcoming' }).AND[3].OR[0].endAt.gt.toISOString(), base.now.toISOString());
  assert.deepEqual(calendarQueueWhere({ ...base, status: 'logged' }).AND[2], { review: { activityId: { not: null } } });
  assert.deepEqual(calendarQueueWhere({ ...base, status: 'ignored' }).AND[2], { review: { ignoredAt: { not: null } } });
  assert.deepEqual(calendarQueueWhere({ ...base, status: 'cancelled' }).AND[2], { OR: [{ status: 'CANCELLED' }, { cancelledAt: { not: null } }] });
});
test('Account filter follows confirmed selections rather than stale suggestions', () => {
  const rows = calendarQueueWhere({ ...base, status: 'matched', accountId: 10, search: 'customer' }).AND;
  assert.deepEqual(rows[3].review.OR, [{ selectionsConfirmed: true, selectedAccountId: 10 }, { selectionsConfirmed: false, suggestedAccountId: 10 }]);
  assert.deepEqual(rows[4].review.matchStatus, 'MATCHED');
});

test('Needs Review and Upcoming exclude INTERNAL while explicit match filters select their own status', () => {
  for (const status of ['review', 'upcoming']) {
    const rows = calendarQueueWhere({ ...base, status }).AND;
    assert.deepEqual(rows[2].review.matchStatus, { not: 'INTERNAL' });
  }
  for (const [status, matchStatus] of [['matched', 'MATCHED'], ['suggested', 'SUGGESTED'], ['unmatched', 'UNMATCHED']]) {
    assert.equal(calendarQueueWhere({ ...base, status }).AND[2].review.matchStatus, matchStatus);
  }
  assert.deepEqual(calendarQueueWhere({ ...base, status: 'logged' }).AND[2], { review: { activityId: { not: null } } });
  assert.deepEqual(calendarQueueWhere({ ...base, status: 'cancelled' }).AND[2], { OR: [{ status: 'CANCELLED' }, { cancelledAt: { not: null } }] });
});
