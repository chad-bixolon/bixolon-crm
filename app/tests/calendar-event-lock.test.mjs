import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(import.meta.url);
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const { lockCalendarEvent } = require(path.join(root, 'lib/calendar-event-lock.ts'));

test('Calendar lock binds a PostgreSQL integer/integer signature and rejects IDs outside the database range', async () => {
  const calls = [];
  const tx = { $executeRaw: async (strings, id) => { calls.push({ strings: [...strings], id }); } };
  await lockCalendarEvent(tx, 2147483647);
  assert.deepEqual(calls, [{ strings: ['SELECT pg_advisory_xact_lock(726234013::integer, ', '::integer)'], id: 2147483647 }]);
  for (const id of [0, -1, 2147483648, Number.MAX_SAFE_INTEGER, 1.5]) await assert.rejects(lockCalendarEvent(tx, id), /Invalid Calendar event ID/);
  assert.equal(calls.length, 1);
});

let event, review, activityCreates, locks;
const db = {
  googleCalendarEvent: { findFirst: async () => ({ ...event, review }) },
  googleCalendarEventReview: {},
  $transaction: async callback => callback({
    $executeRaw: async (strings, id) => { locks.push({ sql: strings.join('?'), id }); },
    googleCalendarEventReview: {
      findUnique: async () => review,
      upsert: async ({ create, update }) => { review = { ...review, ...(review ? update : create) }; return review; },
    },
  }),
};
const originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
  if (name === 'next/navigation') return { redirect: url => { throw new Error(`REDIRECT:${url}`); } };
  if (name === 'next/cache') return { revalidatePath: () => {} };
  if (name === '@/lib/prisma') return { prisma: db };
  if (name === '@/lib/current-user') return { currentUser: async () => ({ id: 7 }), getRealAuthenticatedUser: async () => ({ id: 7 }) };
  if (name === '@/lib/authorization') return { assertPermission: () => {}, opportunityScope: () => ({}) };
  if (name === '@/lib/projects') return { assertProjectWorkEdit: async () => {}, projectReadWhere: () => ({}) };
  if (name === '@/lib/work') return { activityErrorField: () => null, activityFailureState: () => ({}), parseActivity: () => ({ value: null }), saveActivity: async () => { activityCreates++; } };
  if (name === '@/lib/operational-where') return { operationalAccountWhere: {}, operationalContactWhere: {}, operationalOpportunityWhere: {}, operationalProjectWhere: {} };
  if (name === '@/lib/calendar-time') return { calendarLocalInput: () => '', calendarLocalToUtc: () => null };
  if (name === '@/lib/calendar-event-lock') return { lockCalendarEvent };
  return originalLoad.call(this, name, parent, isMain);
};
let actions;
try { actions = require(path.join(root, 'app/calendar-matches/actions.ts')); }
finally { Module._load = originalLoad; }

for (const unmatchedCount of [0, 3]) test(`Ignore saves attribution with ${unmatchedCount} unmatched attendees`, async () => {
  event = { id: 11, attendees: [{ contactId: 3 }, ...Array.from({ length: unmatchedCount }, () => ({ contactId: null }))] };
  const source = structuredClone(event);
  review = { matchStatus: 'MATCHED', suggestedContactIds: [3], suggestedAccountId: 10, activityId: null, ignoredAt: null };
  activityCreates = 0; locks = [];
  const form = new FormData(); form.set('eventId', '11');
  await assert.rejects(actions.ignoreCalendarEvent(form), /REDIRECT:\/calendar-matches/);
  assert.ok(review.ignoredAt instanceof Date); assert.equal(review.ignoredById, 7);
  assert.equal(review.activityId, null); assert.equal(activityCreates, 0);
  assert.deepEqual(event, source); assert.deepEqual(review.suggestedContactIds, [3]);
  assert.equal(locks.length, 1); assert.equal(locks[0].id, 11);
});

test('Change Match saves confirmed selections without overwriting suggestions or source event', async () => {
  event = { id: 12, attendees: [{ contactId: 3 }] };
  const source = structuredClone(event);
  review = { matchStatus: 'SUGGESTED', suggestedContactIds: [3], suggestedAccountId: 10, activityId: null, ignoredAt: null };
  locks = [];
  const form = new FormData(); form.set('eventId', '12'); form.set('accountId', ''); form.append('contactIds', '3');
  db.contact = { findMany: async () => [{ id: 3, accountId: null }] };
  await assert.rejects(actions.saveCalendarSelection(form), /REDIRECT:\/calendar-matches\/12/);
  assert.deepEqual(review.selectedContactIds, [3]); assert.equal(review.selectionsConfirmed, true);
  assert.deepEqual(review.suggestedContactIds, [3]); assert.equal(review.suggestedAccountId, 10);
  assert.deepEqual(event, source); assert.equal(locks.length, 1);
});
