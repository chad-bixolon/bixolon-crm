import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(import.meta.url);
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
let real = { id: 7, active: true }, calls = [];
const originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
  if (name === 'next/headers') return { cookies: async () => ({ set: () => {} }) };
  if (name === 'next/navigation') return { redirect: url => { throw new Error(`REDIRECT:${url}`); } };
  if (name === '@/lib/current-user') return { getRealAuthenticatedUser: async () => real };
  if (name === '@/lib/prisma') return { prisma: { googleCalendarConnection: { findUnique: async ({ where }) => { calls.push(where); return where.userId === 7 ? { id: 4 } : null; } } } };
  if (name === '@/lib/google-calendar-oauth') return { realCalendarUserId: value => { if (!value?.active) throw new Error('Sign in'); return value.id; } };
  if (name === '@/lib/google-calendar-sync') return { syncGoogleCalendarConnection: async (_client, id) => { calls.push(id); return { success: true }; } };
  if (name === '@/lib/user-time-zone') return { saveOwnTimeZone: async () => {} };
  return originalLoad.call(this, name, parent, isMain);
};
let syncMyGoogleCalendar;
try { ({ syncMyGoogleCalendar } = require(path.join(root, 'app/my-integrations/actions.ts'))); }
finally { Module._load = originalLoad; }

test('manual sync requires real user and selects only their connection during impersonation', async () => {
  real = null; calls = [];
  await assert.rejects(syncMyGoogleCalendar(), /Sign in/);
  assert.deepEqual(calls, []);
  // Effective impersonated user would be 8; the action only asks for the real user.
  real = { id: 7, active: true, effectiveUserId: 8 };
  await assert.rejects(syncMyGoogleCalendar(), /REDIRECT:\/my-integrations\?result=synced/);
  assert.deepEqual(calls, [{ userId: 7 }, 4]);
});
