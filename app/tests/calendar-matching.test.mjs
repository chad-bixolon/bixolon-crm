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
const { matchCalendarAttendees, classifyCalendarMatch, evaluateCalendarEvent } = require(path.join(root, 'lib/calendar-matching.ts'));
const { calendarLocalInput, calendarLocalToUtc } = require(path.join(root, 'lib/calendar-time.ts'));
const contact = (id, email, accountId = 10) => ({ id, firstName: 'Jane', lastName: String(id), email, accountId });
const attendee = email => ({ email, displayName: null, self: false });
const match = (attendees, contacts) => matchCalendarAttendees(attendees, contacts, 'bixolon.com', 'owner@bixolon.com');

test('exact normalized email matches a single active candidate and infers its Account', () => {
  const result = match([attendee(' JANE@CUSTOMER.COM ')], [contact(1, 'jane@customer.com')]);
  assert.deepEqual(result.contactIds, [1]); assert.equal(result.accountId, 10); assert.equal(result.ambiguous, false);
  assert.match(result.explanations[0], /Matched Jane 1 by email/);
});
test('missing and duplicate emails remain unresolved; internal and self attendees are excluded', () => {
  const result = match([attendee('none@example.com'), attendee('duplicate@example.com'), attendee('sales@bixolon.com'), { ...attendee('self@customer.com'), self: true }, attendee('owner@bixolon.com')], [contact(1, 'duplicate@example.com'), contact(2, 'DUPLICATE@example.com'), contact(3, 'sales@bixolon.com'), contact(4, 'self@customer.com')]);
  assert.deepEqual(result.contactIds, []); assert.equal(result.ambiguous, true); assert.equal(result.external.length, 2);
});
test('multiple Contacts at one Account are clear; multiple Accounts and unassigned Contact are conservative', () => {
  const same = match([attendee('a@example.com'), attendee('b@example.com')], [contact(1, 'a@example.com'), contact(2, 'b@example.com')]);
  assert.equal(same.accountId, 10); assert.equal(same.ambiguous, false);
  const multiple = match([attendee('a@example.com'), attendee('b@example.com')], [contact(1, 'a@example.com'), contact(2, 'b@example.com', 20)]);
  assert.equal(multiple.accountId, null); assert.equal(multiple.ambiguous, true);
  assert.equal(match([attendee('a@example.com')], [contact(1, 'a@example.com', null)]).accountId, null);
});
test('classification requires a clear Account and leaves multiple related records for review', () => {
  assert.equal(classifyCalendarMatch(0, null, false, 0, 0), 'UNMATCHED');
  assert.equal(classifyCalendarMatch(1, 10, false, 1, 1), 'MATCHED');
  assert.equal(classifyCalendarMatch(1, 10, false, 2, 0), 'SUGGESTED');
  assert.equal(classifyCalendarMatch(1, 10, false, 0, 2), 'SUGGESTED');
  assert.equal(classifyCalendarMatch(1, null, true, 0, 0), 'SUGGESTED');
});
test('opportunity and project suggestions exclude closed or irrelevant rows through CRM predicates', async () => {
  const calls = []; let saved;
  const client = {
    googleCalendarEvent: { findUniqueOrThrow: async () => ({ attendees: [attendee('jane@example.com')] }) },
    contact: { findMany: async () => [contact(1, 'jane@example.com')] },
    account: { findFirst: async () => ({ id: 10 }) },
    opportunity: { findMany: async args => { calls.push(args.where); return [{ id: 50 }]; } },
    project: { findMany: async args => { calls.push(args.where); return [{ id: 70 }]; } },
    googleCalendarEventReview: { upsert: async args => { saved = args.create; } },
  };
  const actor = { id: 7, role: 'SALES', active: true, archivedAt: null };
  const result = await evaluateCalendarEvent(client, 1, actor, 'owner@bixolon.com');
  assert.equal(result.status, 'MATCHED'); assert.equal(result.opportunityId, 50); assert.equal(result.projectId, 70);
  assert.equal(calls[0].stage.isClosed, false); assert.equal(calls[0].ownerId, 7);
  assert.deepEqual(calls[1].status.in, ['PLANNING', 'ACTIVE']); assert.equal(saved.suggestedProjectId, 70);
});
test('multiple open Opportunities and Projects stay unselected', async () => {
  const client = {
    googleCalendarEvent: { findUniqueOrThrow: async () => ({ attendees: [attendee('jane@example.com')] }) },
    contact: { findMany: async () => [contact(1, 'jane@example.com')] },
    account: { findFirst: async () => ({ id: 10 }) },
    opportunity: { findMany: async () => [{ id: 50 }, { id: 51 }] },
    project: { findMany: async () => [{ id: 70 }, { id: 71 }] },
    googleCalendarEventReview: { upsert: async () => {} },
  };
  const result = await evaluateCalendarEvent(client, 1, { id: 7, role: 'SALES', active: true }, 'owner@bixolon.com');
  assert.equal(result.status, 'SUGGESTED'); assert.equal(result.opportunityId, null); assert.equal(result.projectId, null);
  assert.match(result.explanations.join(' '), /Multiple open Opportunities/);
});
test('timezone conversion preserves the same UTC instant across Eastern, Pacific and DST', () => {
  const instant = new Date('2026-03-08T14:00:00Z');
  assert.equal(calendarLocalInput(instant, 'America/New_York'), '2026-03-08T10:00');
  assert.equal(calendarLocalInput(instant, 'America/Los_Angeles'), '2026-03-08T07:00');
  assert.equal(calendarLocalToUtc('2026-03-08T10:00', 'America/New_York').toISOString(), instant.toISOString());
  assert.equal(calendarLocalToUtc('2026-03-08T02:30', 'America/New_York'), null);
});

const internal = email => attendee(email);
const actor = { id: 7, role: 'SALES', active: true, archivedAt: null };
function evaluationClient(event, contacts = []) {
  let review = event.review ?? null;
  let writes = 0;
  const client = {
    googleCalendarEvent: { findUniqueOrThrow: async () => event },
    contact: { findMany: async () => contacts },
    account: { findFirst: async () => ({ id: 10 }) },
    opportunity: { findMany: async () => [{ id: 50 }] },
    project: { findMany: async () => [{ id: 70 }] },
    googleCalendarEventReview: { upsert: async ({ create, update }) => { writes++; review = { ...review, ...(review ? update : create) }; return review; } },
  };
  return { client, get review() { return review; }, get writes() { return writes; } };
}
async function evaluateWithDomain(fixture, eventId = 20) {
  const prior = process.env.GOOGLE_WORKSPACE_DOMAIN;
  process.env.GOOGLE_WORKSPACE_DOMAIN = 'bixolonusa.com';
  try { return await evaluateCalendarEvent(fixture.client, eventId, actor, 'owner@bixolonusa.com'); }
  finally { if (prior === undefined) delete process.env.GOOGLE_WORKSPACE_DOMAIN; else process.env.GOOGLE_WORKSPACE_DOMAIN = prior; }
}

test('internal-only attendees and owner/self-only events persist INTERNAL without touching source or creating Activities', async () => {
  for (const attendees of [
    [internal('cguenther@bixolonusa.com'), internal('rpersaud@bixolonusa.com')],
    [{ ...internal('owner@bixolonusa.com'), self: true }],
  ]) {
    const event = { attendees, organizerEmail: 'owner@bixolonusa.com', summary: 'Customer planning call' };
    const source = structuredClone(event);
    const fixture = evaluationClient(event);
    const result = await evaluateWithDomain(fixture);
    assert.equal(result.status, 'INTERNAL'); assert.deepEqual(result.explanations, []);
    assert.equal(fixture.review.matchStatus, 'INTERNAL'); assert.equal(fixture.review.suggestedAccountId, null);
    assert.deepEqual(event, source); assert.equal(fixture.client.activity, undefined);
  }
});

test('a previously unreviewed UNMATCHED internal event becomes INTERNAL', async () => {
  const fixture = evaluationClient({ attendees: [internal('rep@bixolonusa.com')], organizerEmail: 'owner@bixolonusa.com', review: { matchStatus: 'UNMATCHED', selectionsConfirmed: false, activityId: null } });
  assert.equal((await evaluateWithDomain(fixture)).status, 'INTERNAL');
  assert.equal(fixture.review.matchStatus, 'INTERNAL'); assert.equal(fixture.writes, 1);
});

test('mixed internal and external attendees follow normal matching and exclude internal addresses from explanations', async () => {
  const attendees = [internal('cguenther@bixolonusa.com'), internal('rpersaud@bixolonusa.com'), attendee('jane@customer.com')];
  const fixture = evaluationClient({ attendees, organizerEmail: 'cguenther@bixolonusa.com' }, [contact(3, 'jane@customer.com')]);
  const result = await evaluateWithDomain(fixture);
  assert.equal(result.status, 'MATCHED'); assert.deepEqual(result.contactIds, [3]);
  assert.equal(result.accountId, 10); assert.equal(result.opportunityId, 50); assert.equal(result.projectId, 70);
  assert.ok(result.explanations.some(message => message.includes('jane@customer.com')));
  assert.ok(result.explanations.every(message => !message.includes('bixolonusa.com')));
});

test('external attendee without a Contact is UNMATCHED, including with an internal organizer', async () => {
  const fixture = evaluationClient({ attendees: [internal('owner@bixolonusa.com'), attendee('vendor@example.com')], organizerEmail: 'owner@bixolonusa.com' });
  const result = await evaluateWithDomain(fixture);
  assert.equal(result.status, 'UNMATCHED');
  assert.deepEqual(result.explanations, ['No SalesHub Contact found for vendor@example.com']);
});

test('external organizer and incomplete attendee data are never classified INTERNAL', async () => {
  for (const event of [
    { attendees: [internal('owner@bixolonusa.com')], organizerEmail: 'vendor@example.com' },
    { attendees: [], organizerEmail: 'owner@bixolonusa.com' },
    { attendees: [internal('owner@bixolonusa.com'), attendee('')], organizerEmail: 'owner@bixolonusa.com' },
  ]) {
    const result = await evaluateWithDomain(evaluationClient(event));
    assert.equal(result.status, 'UNMATCHED');
  }
});

test('a confirmed or logged review keeps its decision and Activity when attendee data becomes internal-only', async () => {
  for (const activityId of [null, 91]) {
    const review = { matchStatus: 'MATCHED', selectionsConfirmed: true, selectedContactIds: [3], selectedAccountId: 10, selectedOpportunityId: 50, selectedProjectId: 70, suggestedContactIds: [3], suggestedAccountId: 10, suggestedOpportunityId: 50, suggestedProjectId: 70, explanations: ['Prior match'], activityId };
    const fixture = evaluationClient({ attendees: [internal('owner@bixolonusa.com')], organizerEmail: 'owner@bixolonusa.com', review });
    const result = await evaluateWithDomain(fixture);
    assert.equal(result.status, 'MATCHED'); assert.equal(fixture.writes, 0);
    assert.deepEqual(fixture.review, review); assert.equal(fixture.review.activityId, activityId);
  }
});

test('cancelled internal events remain classified INTERNAL while cancellation stays in source', async () => {
  const event = { attendees: [internal('owner@bixolonusa.com')], organizerEmail: 'owner@bixolonusa.com', status: 'CANCELLED', cancelledAt: new Date('2026-10-07T12:00:00Z') };
  const fixture = evaluationClient(event);
  assert.equal((await evaluateWithDomain(fixture)).status, 'INTERNAL');
  assert.equal(event.status, 'CANCELLED'); assert.ok(event.cancelledAt);
});
