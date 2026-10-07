import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(fileURLToPath(import.meta.url));
const { encryptCalendarToken } = require(path.join(root, 'lib/calendar-crypto.ts'));
const sync = require(path.join(root, 'lib/google-calendar-sync.ts'));
const old = { CALENDAR_TOKEN_ENCRYPTION_KEY: process.env.CALENDAR_TOKEN_ENCRYPTION_KEY, AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET };
process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = 'ab'.repeat(32);
process.env.AUTH_GOOGLE_ID = 'test-id';
process.env.AUTH_GOOGLE_SECRET = 'test-secret';
test.after(() => { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

function fixture() {
  const connection = { id: 4, userId: 7, primaryCalendarId: 'primary', syncToken: null, connectionStatus: 'CONNECTED', syncLeaseUntil: null, refreshTokenEncrypted: encryptCalendarToken('refresh-secret') };
  const events = new Map();
  const key = where => where.connectionId_googleCalendarId_googleEventId.googleEventId;
  const client = {
    googleCalendarConnection: {
      findUnique: async ({ where }) => where.id === 4 || where.userId === 7 ? { ...connection } : null,
      findMany: async () => [{ id: 4 }],
      updateMany: async ({ where, data }) => {
        if (where.id && where.id !== 4 || where.userId && where.userId !== 7) return { count: 0 };
        if (where.OR && connection.syncLeaseUntil && connection.syncLeaseUntil >= new Date('2026-10-07T12:00:00Z')) return { count: 0 };
        Object.assign(connection, data);
        return { count: 1 };
      },
    },
    googleCalendarEvent: {
      findUnique: async ({ where }) => events.get(key(where)) ?? null,
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const [id, event] of events) {
          if (where.googleEventId.notIn.includes(id) || event.status === 'CANCELLED') continue;
          const timedOverlap = event.startAt && event.endAt && event.startAt < where.OR[0].startAt.lt && event.endAt > where.OR[0].endAt.gt;
          const dayOverlap = event.startDate && event.endDate && event.startDate < where.OR[1].startDate.lt && event.endDate > where.OR[1].endDate.gt;
          if (!timedOverlap && !dayOverlap) continue;
          events.set(id, { ...event, ...data }); count++;
        }
        return { count };
      },
      create: async ({ data }) => { events.set(data.googleEventId, { ...data, id: events.size + 1 }); },
      update: async ({ where, data }) => { const id = key(where); events.set(id, { ...events.get(id), ...data }); },
      upsert: async ({ where, create, update }) => {
        const id = key(where);
        const existing = events.get(id);
        if (existing) events.set(id, { ...existing, ...update, attendees: { create: update.attendees.create } });
        else events.set(id, { ...create, id: events.size + 1 });
      },
    },
  };
  return { client, connection, events };
}
function response(data, status = 200) { return { ok: status === 200, status, json: async () => data }; }
function fetchPages(pages, urls) {
  return async (url, options) => {
    if (url.includes('oauth2.googleapis.com/token')) {
      assert.equal(options.body.get('refresh_token'), 'refresh-secret');
      return response({ access_token: 'access-secret' });
    }
    assert.equal(options.headers.Authorization, 'Bearer access-secret');
    urls.push(new URL(url));
    return pages.shift();
  };
}
const timed = (id, summary = 'Meeting') => ({ id, summary, status: 'confirmed', start: { dateTime: '2026-10-08T09:00:00-04:00', timeZone: 'America/New_York' }, end: { dateTime: '2026-10-08T10:00:00-04:00' }, attendees: [{ email: 'Person@Example.com', displayName: 'Person', responseStatus: 'accepted' }] });

test('initial sync bounds window, pages through recurrence, stores attendees and all-day dates, then commits token', async () => {
  const f = fixture(); const urls = [];
  const pages = [response({ items: [timed('series_20261008'), { id: 'all-day', start: { date: '2026-10-09' }, end: { date: '2026-10-10' } }], nextPageToken: 'page2' }), response({ items: [{ ...timed('series_20261009'), recurringEventId: 'series', originalStartTime: { dateTime: '2026-10-09T09:00:00-04:00' } }], nextSyncToken: 'token-a' })];
  const result = await sync.syncGoogleCalendarConnection(f.client, 4, fetchPages(pages, urls), new Date('2026-10-07T12:00:00Z'));
  assert.equal(result.success, true); assert.equal(result.inserted, 3); assert.equal(f.connection.syncToken, 'token-a');
  assert.equal(urls.length, 2); assert.equal(urls[1].searchParams.get('pageToken'), 'page2');
  assert.equal(urls[0].searchParams.get('singleEvents'), 'true'); assert.equal(urls[0].searchParams.get('showDeleted'), 'true');
  assert.equal(urls[0].searchParams.get('timeMin'), '2026-08-08T12:00:00.000Z');
  assert.equal(urls[0].searchParams.get('timeMax'), '2027-01-05T12:00:00.000Z');
  assert.equal(f.events.get('series_20261008').attendees.create[0].normalizedEmail, 'person@example.com');
  assert.equal(f.events.get('all-day').allDay, true); assert.equal(f.events.get('all-day').startAt, null);
  assert.equal(f.events.get('series_20261009').recurringEventId, 'series');
});

test('failed later page keeps old token; repeat initial updates existing rows', async () => {
  const f = fixture(); const urls = [];
  const first = await sync.syncGoogleCalendarConnection(f.client, 4, fetchPages([response({ items: [timed('a')], nextPageToken: 'p' }), response({}, 503)], urls), new Date('2026-10-07T12:00:00Z'));
  assert.equal(first.success, false); assert.equal(f.connection.syncToken, null); assert.equal(f.events.size, 1);
  const second = await sync.syncGoogleCalendarConnection(f.client, 4, fetchPages([response({ items: [timed('a', 'Changed')], nextSyncToken: 't' })], []), new Date('2026-10-07T12:00:00Z'));
  assert.equal(second.updated, 1); assert.equal(f.events.size, 1); assert.equal(f.events.get('a').summary, 'Changed');
});

test('incremental pages update, insert and retain cancellation tombstone', async () => {
  const f = fixture(); f.connection.syncToken = 'old'; f.events.set('a', { id: 1, summary: 'Old', attendees: { create: [] } });
  const urls = [];
  const result = await sync.syncGoogleCalendarConnection(f.client, 4, fetchPages([response({ items: [timed('a', 'New'), timed('b')], nextPageToken: 'p2' }), response({ items: [{ id: 'a', status: 'cancelled' }], nextSyncToken: 'new' })], urls), new Date('2026-10-07T12:00:00Z'));
  assert.equal(result.success, true); assert.equal(result.cancelled, 1); assert.equal(f.events.size, 2);
  assert.equal(f.events.get('a').status, 'CANCELLED'); assert.equal(f.events.get('a').summary, 'New');
  assert.equal(f.connection.syncToken, 'new'); assert.equal(urls[0].searchParams.get('syncToken'), 'old');
  assert.equal(urls[1].searchParams.get('syncToken'), 'old'); assert.equal(urls[0].searchParams.has('timeMin'), false);
});

test('410 clears token and recovers with bounded scan without duplicates', async () => {
  const f = fixture(); f.connection.syncToken = 'expired'; f.events.set('a', { id: 1, summary: 'Old' });
  f.events.set('removed', { id: 2, status: 'CONFIRMED', startAt: new Date('2026-10-08T13:00:00Z'), endAt: new Date('2026-10-08T14:00:00Z') });
  const urls = [];
  const result = await sync.syncGoogleCalendarConnection(f.client, 4, fetchPages([response({}, 410), response({ items: [timed('a', 'Recovered')], nextSyncToken: 'fresh' })], urls), new Date('2026-10-07T12:00:00Z'));
  assert.equal(result.mode, 'RECOVERY'); assert.equal(result.updated, 1); assert.equal(f.events.size, 2);
  assert.equal(f.events.get('removed').status, 'CANCELLED'); assert.equal(result.cancelled, 1);
  assert.equal(f.connection.syncToken, 'fresh'); assert.equal(urls[1].searchParams.has('syncToken'), false);
});

test('invalid_grant requires reauthorization and preserves events', async () => {
  const f = fixture(); f.events.set('a', { id: 1 });
  const result = await sync.syncGoogleCalendarConnection(f.client, 4, async () => response({ error: 'invalid_grant' }, 400), new Date('2026-10-07T12:00:00Z'));
  assert.equal(result.reason, 'reauth'); assert.equal(f.connection.connectionStatus, 'NEEDS_REAUTH'); assert.equal(f.events.size, 1);
});
