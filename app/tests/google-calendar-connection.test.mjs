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
const crypto = require(path.join(root, 'lib/calendar-crypto.ts'));
const oauth = require(path.join(root, 'lib/google-calendar-oauth.ts'));
const old = { AUTH_SECRET: process.env.AUTH_SECRET, AUTH_URL: process.env.AUTH_URL, AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET, CALENDAR_TOKEN_ENCRYPTION_KEY: process.env.CALENDAR_TOKEN_ENCRYPTION_KEY };
process.env.AUTH_SECRET = 'test-auth-secret-with-sufficient-length';
process.env.AUTH_URL = 'http://localhost:3000';
process.env.AUTH_GOOGLE_ID = 'test-client';
process.env.AUTH_GOOGLE_SECRET = 'test-client-secret';
process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = 'ab'.repeat(32);

test.after(() => { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

test('separate consent requests only read-only Calendar events and offline access', () => {
  const state = oauth.createCalendarState(7, 1000);
  const url = new URL(oauth.calendarAuthorizationUrl(state));
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:3000/api/calendar/callback');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('include_granted_scopes'), 'true');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.deepEqual(url.searchParams.get('scope').split(' '), ['openid', 'email', 'profile', oauth.CALENDAR_SCOPE]);
  assert.ok(!url.searchParams.get('scope').includes('calendar.events '));
});

test('state is signed, short lived and bound to the real signed-in user', () => {
  const state = oauth.createCalendarState(7, 1000);
  assert.equal(oauth.validateCalendarState(state, state, 7, 2000), true);
  assert.equal(oauth.validateCalendarState(state, state, 8, 2000), false);
  assert.equal(oauth.validateCalendarState(state, state, 7, 601001), false);
  assert.equal(oauth.validateCalendarState(state, state + 'x', 7, 2000), false);
  assert.equal(oauth.validateCalendarState(state + 'x', state + 'x', 7, 2000), false);
  assert.equal(oauth.validateCalendarState(state, undefined, 7, 2000), false);
});

test('Calendar actions require real authentication even if an effective impersonated user exists', () => {
  assert.throws(() => oauth.realCalendarUserId(null), /Sign in/);
  assert.throws(() => oauth.realCalendarUserId({ id: 7, active: false }), /Sign in/);
  const context = { real: { id: 7, active: true }, effective: { id: 8, active: true } };
  assert.equal(oauth.realCalendarUserId(context.real), 7);
});

test('refresh credential is authenticated encrypted and tampering is rejected', () => {
  const encrypted = crypto.encryptCalendarToken('secret-refresh-token');
  assert.ok(!encrypted.includes('secret-refresh-token'));
  assert.equal(crypto.decryptCalendarToken(encrypted), 'secret-refresh-token');
  assert.throws(() => crypto.decryptCalendarToken(encrypted.slice(0, -2) + 'xx'));
});

function fixture() {
  let row = null;
  let mutations = 0;
  const client = {
    externalIdentity: { findFirst: async ({ where }) => where.userId === 7 && where.subject === 'google-7' ? { id: 11 } : null },
    googleCalendarConnection: {
      findUnique: async ({ where }) => where.userId === 7 ? row : null,
      upsert: async ({ where, create, update }) => { assert.equal(where.userId, 7); row = row ? { ...row, ...update } : { ...create }; mutations++; return row; },
      deleteMany: async ({ where }) => { assert.equal(where.userId, 7); row = null; mutations++; return { count: 1 }; },
      updateMany: async ({ where, data }) => { assert.equal(where.userId, 7); row = { ...row, ...data }; mutations++; return { count: 1 }; },
    },
  };
  return { client, row: () => row, mutations: () => mutations };
}

test('connection is scoped to real login identity; reconnect retains existing refresh token', async () => {
  const f = fixture();
  const identity = { googleAccountId: 'google-7', googleEmail: 'user@example.com' };
  const token = { refresh_token: 'refresh-1', scope: oauth.CALENDAR_SCOPE };
  await assert.rejects(oauth.storeCalendarConnection(f.client, 8, identity, token), /SalesHub sign-in/);
  await assert.rejects(oauth.storeCalendarConnection(f.client, 7, { ...identity, googleAccountId: 'other' }, token), /SalesHub sign-in/);
  await assert.rejects(oauth.storeCalendarConnection(f.client, 7, identity, { refresh_token: 'refresh-1', scope: 'openid email profile' }), /Calendar read permission/);
  assert.equal(f.mutations(), 0);
  await oauth.storeCalendarConnection(f.client, 7, identity, token);
  const first = f.row().refreshTokenEncrypted;
  assert.equal(crypto.decryptCalendarToken(first), 'refresh-1');
  await oauth.storeCalendarConnection(f.client, 7, identity, { scope: oauth.CALENDAR_SCOPE });
  assert.equal(f.row().refreshTokenEncrypted, first);
  assert.equal(f.row().connectionStatus, 'CONNECTED');
  await oauth.disconnectCalendar(f.client, 7);
  assert.equal(f.row(), null);
  await assert.rejects(oauth.storeCalendarConnection(f.client, 7, identity, { scope: oauth.CALENDAR_SCOPE }), /offline access/);
});

test('revoked refresh token marks only Calendar as needing reauthorization', async () => {
  const f = fixture();
  await oauth.storeCalendarConnection(f.client, 7, { googleAccountId: 'google-7', googleEmail: 'user@example.com' }, { refresh_token: 'refresh-1', scope: oauth.CALENDAR_SCOPE });
  const result = await oauth.refreshCalendarAccessToken(f.client, 7, async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) }));
  assert.equal(result, null);
  assert.equal(f.row().connectionStatus, 'NEEDS_REAUTH');
  assert.equal(await oauth.refreshCalendarAccessToken(f.client, 7, async () => { throw new Error('must not call'); }), null);
});

test('temporary refresh failure leaves connection usable for retry', async () => {
  const f = fixture();
  await oauth.storeCalendarConnection(f.client, 7, { googleAccountId: 'google-7', googleEmail: 'user@example.com' }, { refresh_token: 'refresh-1', scope: oauth.CALENDAR_SCOPE });
  assert.equal(await oauth.refreshCalendarAccessToken(f.client, 7, async () => { throw new Error('network unavailable'); }), null);
  assert.equal(f.row().connectionStatus, 'CONNECTED');
  assert.equal(await oauth.refreshCalendarAccessToken(f.client, 7, async () => ({ ok: true, json: async () => ({ access_token: 'short-lived', scope: oauth.CALENDAR_SCOPE }) })), 'short-lived');
  assert.equal(f.row().connectionStatus, 'CONNECTED');
});
