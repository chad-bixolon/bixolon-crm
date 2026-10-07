import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
process.env.GOOGLE_WORKSPACE_DOMAIN = 'bixolon.com';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const require = Module.createRequire(import.meta.url);
const { getMyDaySummary, mergedMinutes, myDayBounds, myDayToday } = require(path.join(root, 'lib/my-day.ts'));
const at = value => new Date(value);
const event = (id, start, end, attendees, review = null, extra = {}) => ({ id, summary: `Meeting ${id}`, startAt: at(start), endAt: at(end), allDay: false, startDate: null, organizerEmail: 'rep@bixolon.com', attendees: attendees.map(email => ({ email, displayName: null, self: false })), connection: { googleEmail: 'rep@bixolon.com' }, review, ...extra });
const external = ['customer@example.com'];
const internal = ['team@bixolon.com'];
function client({ events = [], activities = [], completed = [], due = [] } = {}) {
  const queries = [];
  return { queries, googleCalendarEvent: { findMany: async args => { queries.push(args.where); return events; } }, activity: { findMany: async args => { queries.push(args.where); return activities; } }, task: { findMany: async args => { queries.push(args.where); return args.where.status === 'COMPLETED' ? completed : due; }, count: async args => { queries.push(args.where); return 0; } } };
}
test('day bounds follow configured zone and DST', () => {
  assert.equal(myDayBounds('2026-03-08', 'America/New_York').end.getTime() - myDayBounds('2026-03-08', 'America/New_York').start.getTime(), 23 * 3600000);
  assert.equal(myDayToday(at('2026-10-07T04:30:00Z'), 'America/New_York'), '2026-10-07');
  assert.equal(myDayToday(at('2026-10-07T04:30:00Z'), 'America/Los_Angeles'), '2026-10-06');
});
test('overlap merges and customer category wins mixed overlap', async () => {
  const events = [
    event(1, '2026-10-07T14:00:00Z', '2026-10-07T15:00:00Z', external),
    event(2, '2026-10-07T14:30:00Z', '2026-10-07T15:30:00Z', internal, { matchStatus: 'INTERNAL' }),
    event(3, '2026-10-07T16:00:00Z', '2026-10-07T17:00:00Z', [...external, ...internal], { matchStatus: 'INTERNAL' }),
    event(4, '2026-10-07T18:00:00Z', '2026-10-07T19:00:00Z', external),
    event(5, '2026-10-07T20:00:00Z', '2026-10-07T21:00:00Z', external, null, { allDay: true, startAt: null, endAt: null, startDate: '2026-10-07', endDate: '2026-10-08' }),
  ];
  const result = await getMyDaySummary(client({ events }), 7, '2026-10-07', 'America/New_York', at('2026-10-07T17:30:00Z'));
  assert.equal(result.customerMeetingCount, 2);
  assert.equal(result.customerMeetingMinutes, 120);
  assert.equal(result.internalMeetingMinutes, 30);
  assert.equal(result.totalMeetingMinutes, 150);
  assert.equal(mergedMinutes([{ start: 0, end: 60000 }, { start: 30000, end: 90000 }]), 2);
});
test('Activities and Tasks use owner, local completion window, and linked Activity appears once', async () => {
  const activity = { id: 10, subject: 'Review', activityDate: at('2026-10-07T15:00:00Z'), calendarReview: { eventId: 1 } };
  const own = { id: 11, subject: 'Call', activityDate: at('2026-10-07T16:00:00Z'), calendarReview: null };
  const db = client({ events: [event(1, '2026-10-07T15:00:00Z', '2026-10-07T16:00:00Z', external, { activityId: 10 })], activities: [activity, own], completed: [{ id: 20, subject: 'Send quote', completedAt: at('2026-10-07T17:00:00Z') }], due: [{ id: 21, subject: 'Follow up', dueDate: at('2026-10-07T00:00:00Z') }] });
  const result = await getMyDaySummary(db, 7, '2026-10-07', 'America/New_York', at('2026-10-07T18:00:00Z'));
  assert.equal(result.completedActivityCount, 2);
  assert.equal(result.completedTaskCount, 1);
  assert.equal(result.dueTodayTaskCount, 1);
  assert.equal(result.timeline.filter(item => item.key === 'activity-10').length, 0);
  assert.match(result.timeline.find(item => item.key === 'calendar-1').detail, /Logged as Activity/);
  assert.equal(db.queries[0].userId, 7);
  assert.equal(db.queries[1].userId, 7);
  assert.equal(db.queries[2].assignedToId, 7);
});
test('confirmed match context is batched and permission filtered', async () => {
  const review = { matchStatus: 'MATCHED', selectionsConfirmed: true, selectedAccountId: 30, selectedContactIds: [40], selectedOpportunityId: 50, selectedProjectId: 60 };
  const db = client({ events: [event(1, '2026-10-07T15:00:00Z', '2026-10-07T16:00:00Z', external, review)] });
  db.account = { findMany: async ({ where }) => { assert.deepEqual(where.id.in, [30]); return [{ id: 30, name: 'Acme' }]; } };
  db.contact = { findMany: async () => [{ id: 40, firstName: 'Jane', lastName: 'Smith' }] };
  db.opportunity = { findMany: async ({ where }) => { assert.equal(where.ownerId, 7); return [{ id: 50, name: 'Renewal' }]; } };
  db.project = { findMany: async () => [{ id: 60, name: 'Launch' }] };
  const summary = await getMyDaySummary(db, 7, '2026-10-07', 'America/New_York', at('2026-10-07T17:00:00Z'), { id: 7, role: 'SALES', active: true });
  assert.match(summary.timeline[0].detail, /Acme · Jane Smith · Renewal · Launch/);
});
