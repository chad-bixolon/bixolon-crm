import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(import.meta.url);
const { NextRequest } = require('next/server');
const { unstable_doesMiddlewareMatch } = require('next/experimental/testing/server');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
let runs = 0;
const originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
  if (name === '@/auth') return { auth: handler => handler };
  if (name === '@/lib/authorization') return { routeAccess: () => 'sign-in' };
  if (name === '@/lib/dev-impersonation') return { DEV_IMPERSONATION_COOKIE: 'dev-impersonation', impersonationAdminAllowed: () => false, resolveUserContext: async () => ({ real: null, effective: null, clearCookie: false }) };
  if (name === '@/lib/prisma') return { prisma: {} };
  if (name === '@/lib/google-calendar-sync') return { syncAllGoogleCalendarConnections: async () => { runs++; return [{ success: true, processed: 3 }]; } };
  return originalLoad.call(this, name, parent, isMain);
};
let config, POST;
try {
  ({ config } = require(path.join(root, 'proxy.ts')));
  ({ POST } = require(path.join(root, 'app/api/internal/calendar/sync/route.ts')));
} finally { Module._load = originalLoad; }

test('only exact Calendar sync route skips session proxy and still requires a separate secret', async () => {
  const route = '/api/internal/calendar/sync';
  const matches = pathname => unstable_doesMiddlewareMatch({ config, url: `https://crm.example${pathname}` });
  assert.equal(matches(route), false);
  assert.equal(matches(`${route}/extra`), true);
  assert.equal(matches(`${route}-other`), true);
  const prior = process.env.CALENDAR_SYNC_SECRET;
  try {
    process.env.CALENDAR_SYNC_SECRET = 's'.repeat(32);
    const request = headers => new NextRequest(`https://crm.example${route}`, { method: 'POST', headers });
    assert.equal((await POST(request({}))).status, 404);
    assert.equal((await POST(request({ cookie: 'authjs.session-token=fake' }))).status, 404);
    assert.equal((await POST(request({ authorization: 'Bearer wrong' }))).status, 404);
    assert.equal(runs, 0);
    const response = await POST(request({ authorization: `Bearer ${process.env.CALENDAR_SYNC_SECRET}` }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { connections: 1, succeeded: 1, failed: 0, processed: 3 });
    assert.equal(runs, 1);
  } finally {
    if (prior === undefined) delete process.env.CALENDAR_SYNC_SECRET;
    else process.env.CALENDAR_SYNC_SECRET = prior;
  }
});
