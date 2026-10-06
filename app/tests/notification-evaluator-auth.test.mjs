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
let evaluations = 0;

Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { routeAccess } = require(path.join(root, 'lib/authorization.ts'));

const originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
  if (name === '@/auth') return { auth: handler => handler };
  if (name === '@/lib/authorization') return { routeAccess };
  if (name === '@/lib/dev-impersonation') return {
    DEV_IMPERSONATION_COOKIE: 'dev-impersonation',
    impersonationAdminAllowed: () => false,
    resolveUserContext: async () => ({ real: null, effective: null, clearCookie: false }),
  };
  if (name === '@/lib/prisma') return { prisma: {} };
  if (name === '@/lib/pe-notification-evaluator') return { evaluatePeNotifications: async () => { evaluations++; return { evaluated: true }; } };
  return originalLoad.call(this, name, parent, isMain);
};
let proxy, config, POST;
try {
  ({ default: proxy, config } = require(path.join(root, 'proxy.ts')));
  ({ POST } = require(path.join(root, 'app/api/internal/notifications/evaluate/route.ts')));
} finally {
  Module._load = originalLoad;
}

const evaluatorPath = '/api/internal/notifications/evaluate';
const url = pathname => `https://crm.example${pathname}`;
const matchesProxy = pathname => unstable_doesMiddlewareMatch({ config, url: url(pathname) });
async function dispatch(pathname, headers = {}) {
  const request = new NextRequest(url(pathname), { method: 'POST', headers });
  if (matchesProxy(pathname)) return proxy(request);
  return POST(request);
}

test('only the exact evaluator pathname skips interactive authentication', async () => {
  assert.equal(matchesProxy(evaluatorPath), false);
  for (const pathname of [
    '/api/internal/other',
    '/api/internal/notifications/evaluate/extra',
    '/api/internal/notifications/evaluate-extra',
    '/api/notifications',
    '/accounts',
  ]) {
    assert.equal(matchesProxy(pathname), true, pathname);
    assert.equal(routeAccess(pathname, null), 'sign-in', pathname);
    const response = await dispatch(pathname);
    assert.equal(response.status, 307, pathname);
    assert.equal(new URL(response.headers.get('location')).pathname, '/sign-in', pathname);
  }
});

test('evaluator requires its own Bearer secret, including for a browser session', async () => {
  const prior = process.env.NOTIFICATION_EVALUATOR_SECRET;
  const secret = 'a'.repeat(32);
  try {
    process.env.NOTIFICATION_EVALUATOR_SECRET = secret;
    evaluations = 0;
    for (const headers of [{}, { authorization: 'Bearer invalid' }, { cookie: 'authjs.session-token=browser-session' }]) {
      const response = await dispatch(evaluatorPath, headers);
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('location'), null);
    }
    assert.equal(evaluations, 0);

    delete process.env.NOTIFICATION_EVALUATOR_SECRET;
    assert.equal((await dispatch(evaluatorPath, { authorization: `Bearer ${secret}` })).status, 404);
    process.env.NOTIFICATION_EVALUATOR_SECRET = 'short';
    assert.equal((await dispatch(evaluatorPath, { authorization: 'Bearer short' })).status, 404);
    assert.equal(evaluations, 0);

    process.env.NOTIFICATION_EVALUATOR_SECRET = secret;
    const response = await dispatch(evaluatorPath, { authorization: `Bearer ${secret}` });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { evaluated: true });
    assert.equal(evaluations, 1);
  } finally {
    if (prior === undefined) delete process.env.NOTIFICATION_EVALUATOR_SECRET;
    else process.env.NOTIFICATION_EVALUATOR_SECRET = prior;
  }
});
