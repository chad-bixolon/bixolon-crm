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
const { logger, normalizeError, sanitizeContext, correlationIdFromHeader, logUnexpectedOnce, jobLogger, warnInvalidJobSecret, isExpectedError } = require(path.join(root, 'lib/observability.ts'));
const originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
  if (name === 'next/headers') return { headers: async () => new Headers({ 'x-request-id': '11111111-2222-4333-8444-555555555555' }) };
  return originalLoad.call(this, name, parent, isMain);
};
const { captureActionError, captureRouteError, requestIdFor } = require(path.join(root, 'lib/request-observability.ts'));
Module._load = originalLoad;

test('production event is one structured line with bounded safe metadata', t => {
  const lines = [];
  t.mock.method(console, 'log', line => { lines.push(line); });
  logger.info('job.completed', { requestId: 'abc123456789', jobName: 'calendar-sync', processed: 4, nested: { secret: 'bad' } });
  assert.equal(lines.length, 1);
  const event = JSON.parse(lines[0]);
  assert.match(event.timestamp, /^\d{4}-\d\d-\d\dT/);
  assert.equal(event.event, 'job.completed');
  assert.equal(event.level, 'info');
  assert.equal(event.processed, 4);
  assert.equal(event.nested, undefined);
});

test('request IDs are stable when valid and otherwise generated opaque IDs', () => {
  assert.equal(correlationIdFromHeader('11111111-2222-4333-8444-555555555555'), '11111111-2222-4333-8444-555555555555');
  assert.match(correlationIdFromHeader('customer@example.test'), /^[0-9a-f-]{36}$/);
  assert.notEqual(correlationIdFromHeader(null), correlationIdFromHeader(null));
});

test('secrets and content cannot enter context, including circular and throwing values', () => {
  const metadata = { password: 'p', token: 't', accessToken: 'a', refreshToken: 'r', authorization: 'Bearer a', cookie: 'c', secret: 's', clientSecret: 'x', databaseUrl: 'postgres://x', emailBody: 'private', notes: 'private' };
  metadata.self = metadata;
  const safe = sanitizeContext(metadata);
  for (const key of ['password', 'token', 'accessToken', 'refreshToken', 'authorization', 'cookie', 'secret', 'clientSecret', 'databaseUrl']) assert.equal(safe[key], '[REDACTED]');
  assert.equal(safe.emailBody, undefined);
  assert.equal(safe.notes, undefined);
  assert.deepEqual(sanitizeContext(new Proxy({}, { ownKeys() { throw new Error('boom'); } })), {});
});

test('error normalization does not serialize arbitrary exception content', () => {
  const error = new Error('postgres://user:secret@host customer text');
  error.code = 'P1001';
  error.cause = new TypeError('Bearer token');
  const safe = normalizeError(error);
  assert.equal(safe.message, 'Unexpected failure');
  assert.equal(safe.errorCode, 'P1001');
  assert.equal(safe.causeClass, 'TypeError');
  assert.equal(normalizeError({ name: 'CustomerSecret', code: 'DATABASE_HOST_PRIVATE' }).errorCode, undefined);
  assert.equal(normalizeError({ name: 'CustomerSecret' }).errorClass, 'UnknownError');
  assert.doesNotMatch(JSON.stringify(safe), /secret|Bearer token|customer text/);
  error.name = 'Customer Smith';
  assert.equal(normalizeError(error).errorClass, 'UnknownError');
});

test('expected errors are not promoted and one unexpected object logs once', t => {
  const lines = [];
  t.mock.method(console, 'error', line => { lines.push(line); });
  assert.equal(logUnexpectedOnce('action.failed', Object.assign(new Error('stale'), { code: 'P2025' })), false);
  assert.equal(logUnexpectedOnce('action.failed', new Error('Access denied')), false);
  const failure = Object.assign(new Error('password=secret'), { code: 'P1001' });
  const scope = new WeakSet();
  assert.equal(logUnexpectedOnce('action.failed', failure, { operation: 'account.save' }, false, scope), true);
  assert.equal(logUnexpectedOnce('request.failed', failure, {}, false, scope), false);
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).operation, 'account.save');
});

test('action boundary returns a reference only for unexpected failures', async t => {
  const lines = [];
  t.mock.method(console, 'error', line => { lines.push(JSON.parse(line)); });
  assert.equal(await captureActionError(new Error('Access denied'), 'account.save'), undefined);
  assert.equal(await captureActionError(new Error('database private data'), 'account.save', { userId: 4 }), 'Something went wrong. Reference: 11111111-2222-4333-8444-555555555555');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].requestId, '11111111-2222-4333-8444-555555555555');
  assert.equal(lines[0].operation, 'account.save');
  assert.doesNotMatch(JSON.stringify(lines), /database private data/);
});

test('job lifecycle emits start, completion and failed once with a common ID', t => {
  const out = [], err = [];
  t.mock.method(console, 'log', line => { out.push(JSON.parse(line)); });
  t.mock.method(console, 'error', line => { err.push(JSON.parse(line)); });
  const success = jobLogger('weekly-snapshots', 'run_12345678'); success.completed({ processed: 2 });
  const partial = jobLogger('calendar-sync', 'run_34567890'); partial.failedOutcome({ failed: 1 });
  const failure = jobLogger('calendar-sync', 'run_23456789'); failure.failed(new Error('private provider text'));
  assert.deepEqual(out.map(row => row.event), ['job.started', 'job.completed', 'job.started', 'job.failed', 'job.started']);
  assert.equal(out[0].requestId, out[1].requestId);
  assert.equal(out[3].requestId, out[2].requestId);
  assert.equal(err[0].event, 'job.failed');
  assert.equal(err[0].requestId, out[4].requestId);
});

test('logger serialization failure falls back without throwing', t => {
  let writes = 0;
  t.mock.method(console, 'error', () => { writes++; throw new Error('stream failed'); });
  t.mock.method(process.stderr, 'write', () => { writes++; return true; });
  assert.doesNotThrow(() => logger.error('action.failed', new Error('bad'), { operation: 'account.save' }));
  assert.equal(writes, 2);
});

test('hostile exception getters cannot crash error capture', t => {
  t.mock.method(console, 'error', () => {});
  const hostile = new Proxy({}, { get() { throw new Error('private getter'); } });
  assert.doesNotThrow(() => logUnexpectedOnce('action.failed', hostile, { operation: 'account.save' }));
});

test('repeated invalid job-secret attempts produce one safe warning per window', t => {
  const lines = [];
  t.mock.method(console, 'log', line => { lines.push(JSON.parse(line)); });
  warnInvalidJobSecret('weekly-snapshots');
  warnInvalidJobSecret('weekly-snapshots');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].event, 'auth.denied');
  assert.equal(lines[0].reason, 'invalid-job-secret');
  assert.doesNotMatch(JSON.stringify(lines), /authorization|cookie|password/);
});


test('request scopes isolate concurrent requests even with a reused error and caller ID', async t => {
  const lines = [];
  t.mock.method(console, 'error', line => lines.push(JSON.parse(line)));
  const shared = new Error('private');
  const requests = Array.from({ length: 20 }, () => new Request('https://example.test', { headers: { 'x-request-id': 'a'.repeat(32) } }));
  await Promise.all(requests.map(async (request, index) => {
    const first = captureRouteError(request, shared, 'account.save', { userId: index });
    assert.equal(captureRouteError(request, shared, 'account.save'), first);
    assert.match(first, /Reference:/);
  }));
  assert.equal(lines.length, requests.length);
  assert.equal(new Set(lines.map(line => line.userId)).size, requests.length);
  const bare = new Request('https://example.test');
  assert.equal(requestIdFor(bare), requestIdFor(bare));
  assert.notEqual(requestIdFor(bare), requestIdFor(new Request('https://example.test')));
});

test('hostile metadata is bounded and never executes getters or toJSON', () => {
  let called = 0;
  const context = { operation: 'Customer Smith', entityId: 'Customer Smith', route: 'private note', processed: 5, access_token: 'private', refresh_token: 'private', client_secret: 'private', authorizationHeader: 'private', DATABASE_URL: 'private', cookieHeader: 'private', api_key: 'private', MiXeDToKeN: 'private', nested: { operation: 'private' }, toJSON() { called++; throw Error(); } };
  Object.defineProperty(context, 'userId', { enumerable: true, get() { called++; throw Error(); } });
  context.array = [context]; context.circular = context;
  context.note = 'private'.repeat(100000);
  let deep = {}; context.deep = deep;
  for (let i = 0; i < 10000; i++) deep = deep.child = {};
  assert.deepEqual(sanitizeContext(context), { processed: 5 });
  assert.equal(called, 0);
});

test('normalization handles arbitrary throws, cyclic causes and hostile stacks', () => {
  for (const value of [null, undefined, 1, 'private', Symbol('private'), 1n]) assert.equal(normalizeError(value).errorClass, 'UnknownError');
  const error = new Error('private'); error.cause = error; error.meta = { sql: 'private' };
  error.stack = 'private\n    at private customer content\n    at query (https://user:password@host/path?token=private:1:2)';
  assert.doesNotMatch(JSON.stringify(normalizeError(error)), /private|password|sql/);
  assert.equal(isExpectedError(new TypeError('Invalid URL')), false);
  assert.equal(isExpectedError(Object.assign(new Error('fixed provider failure'), { name: 'SupportGmailHttpError' })), true);
  assert.equal(isExpectedError(Object.assign(new Error('Invalid query'), { name: 'PrismaClientValidationError' })), false);
  for (const message of ['Access denied', 'File type is not supported.', 'Choose a currency.', 'Price Exception changed. Refresh and try again.']) assert.equal(isExpectedError(new Error(message)), true);
});

test('logger fallback and boundary metadata failures cannot replace an exception', async t => {
  t.mock.method(console, 'error', () => { throw Error('write'); });
  t.mock.method(process.stderr, 'write', () => { throw Error('fallback'); });
  assert.doesNotThrow(() => logger.error('action.failed', undefined));
  const metadata = new Proxy({}, { getOwnPropertyDescriptor() { throw Error('private'); } });
  assert.match(await captureActionError(new Error('private'), 'account.save', metadata), /Reference:/);
});

test('job terminal outcome is emitted only once and duration is nonnegative', t => {
  const lines = [];
  t.mock.method(console, 'log', line => lines.push(JSON.parse(line)));
  t.mock.method(console, 'error', line => lines.push(JSON.parse(line)));
  const log = jobLogger('calendar-sync');
  log.failed(new Error('private')); log.completed(); log.failedOutcome();
  assert.deepEqual(lines.map(line => line.event), ['job.started', 'job.failed']);
  assert.ok(lines[1].durationMs >= 0);
});
