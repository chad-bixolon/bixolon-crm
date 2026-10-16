import { productionEnv, installConnectionDb, resetGmailRuntime } from './support-gmail-test-helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(import.meta.url);
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...args) { return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...args); };
const credentials = installConnectionDb();
const gmail = require(path.join(root, 'lib/support-gmail.ts'));
const { SupportGmailRuntime, supportGmailRuntime } = require(path.join(root, 'lib/support-gmail-runtime.ts'));
const { signEmailSource } = require(path.join(root, 'lib/support-email-source.ts'));
const newRuntime = () => { let now = Date.now(); return new SupportGmailRuntime(() => now, async ms => { now += ms; }, () => 0); };
const connection = require(path.join(root, 'lib/support-gmail-connection.ts'));
const { SUPPORT_GMAIL_SCOPE } = require(path.join(root, 'lib/support-gmail-config.ts'));
const { throwSupportGmailHttpError } = require(path.join(root, 'lib/support-gmail-errors.ts'));
const actor = { id: 5, role: 'SUPPORT', active: true };
const dismissed = new Set();
const tx = { $executeRaw: async () => 1, supportCaseEmail: { findUnique: async () => null }, supportInboxDismissal: { upsert: async ({create}) => dismissed.add(create.gmailMessageId) } };
const load = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'next/cache') return { revalidatePath: () => {} };
  if (request === 'next/navigation') return { redirect: () => { throw new Error('test redirect'); } };
  if (request === 'next/headers') return {};
  if (request === '@/lib/current-user') return { requireMutation: async () => actor };
  if (request === '@/lib/prisma') return { prisma: { $transaction: async run => run(tx) } };
  return load.call(this, request, parent, isMain);
};
const { ignoreInboxMessage } = require(path.join(root, 'app/support/inbox/actions.ts'));
Module._load = load;

const json = (value, status = 200) => new Response(JSON.stringify(value), {status});
const message = id => ({ id, threadId: `thread-${id}`, internalDate: String(Date.now()), payload: { headers: [{name: 'From', value: 'customer@example.test'}], mimeType: 'text/plain', body: {data: Buffer.from('Printer jam').toString('base64url')} } });
const form = id => { const data = new FormData(); data.set('messageId', id); data.set('emailSource', signEmailSource(actor, {id, threadId: `thread-${id}`})); return data; };
function provider({failStage, failure, scope, tokenPrefix = 'access'} = {}) {
  const calls = []; let refreshes = 0;
  const fetcher = async (url, init) => {
    const stage = url.endsWith('/token') ? 'token-refresh' : url.endsWith('/profile') ? 'profile' : url.includes('messages?') ? 'list' : 'message';
    calls.push({stage, method: init.method ?? 'GET', cache: init.cache});
    if (stage === failStage) return failure();
    if (stage === 'token-refresh') return json({access_token: `${tokenPrefix}-${++refreshes}`, expires_in: 1, ...(scope === undefined ? {} : {scope})});
    assert.equal(init.headers.Authorization, `Bearer ${tokenPrefix}-${refreshes}`);
    if (stage === 'profile') return json({emailAddress: 'support@example.test'});
    if (url.includes('/messages/missing?')) return json({}, 404);
    if (stage === 'list') return json({messages: [{id:'one'}, {id:'two'}, {id:'three'}]});
    return json(message(url.match(/messages\/([^?]+)/)[1]));
  };
  return {fetcher, calls, get refreshes() {return refreshes;}};
}

let original, logs;
test.beforeEach(t => {
  const env = productionEnv(); original = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env); credentials.reset(); dismissed.clear(); resetGmailRuntime(supportGmailRuntime); logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
});
test.afterEach(() => { for (const [key, value] of Object.entries(original)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });

test('real connect, repeated Ignore, refresh without scope and fresh adapters retain the original grant', async t => {
  const google = provider();
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url.endsWith('/token') && init.body.get('grant_type') === 'authorization_code') return json({access_token:'initial-access', refresh_token:'original-refresh', token_type:'Bearer', scope:SUPPORT_GMAIL_SCOPE});
    if (init.headers?.Authorization === 'Bearer initial-access') return json({emailAddress:'support@example.test'});
    return google.fetcher(url, init);
  });
  const flow = connection.beginSupportGmailAuthorization(actor.id);
  assert.equal(await connection.completeSupportGmailAuthorization({actor, state:flow.state, cookie:flow.state, verifier:flow.verifier, code:'synthetic-code', error:null}), 'connected');
  for (const id of ['one', 'two', 'three', 'one']) await assert.rejects(ignoreInboxMessage({}, form(id)), /test redirect/);
  assert.deepEqual([...dismissed], ['one', 'two', 'three']);
  assert.equal(google.refreshes, 4);
  assert.equal(credentials.record.grantedScope, SUPPORT_GMAIL_SCOPE);
  const fresh = new gmail.GoogleGmailSupportMailbox(google.fetcher, newRuntime());
  assert.equal((await fresh.get('one')).id, 'one');
  assert.equal(google.refreshes, 5);
  assert.ok(google.calls.every(call => call.cache === 'no-store'));
  assert.ok(google.calls.filter(call => call.stage !== 'token-refresh').every(call => call.method === 'GET'));
  assert.ok(!logs.length);
  assert.equal(google.calls.filter(call => call.stage === 'list').length, 0);
  assert.equal(google.calls.filter(call => call.stage === 'message').length, 5);
});

test('403 reason mapping is consistent at profile, list, full message, get and attachment reads', async () => {
  await connection.saveSupportGmailConnection('support@example.test', 'refresh', actor);
  for (const [status, reason, expected, category] of [
    [403, 'userRateLimitExceeded', /rate limited/, 'rate-limit'],
    [403, 'rateLimitExceeded', /rate limited/, 'rate-limit'],
    [403, 'dailyLimitExceeded', /quota was exceeded/, 'quota'],
    [403, 'quotaExceeded', /quota was exceeded/, 'quota'],
    [403, 'insufficientPermissions', /read permission is missing/, 'insufficient-scope'],
    [403, 'domainPolicy', /Workspace policy/, 'domain-policy'],
    [403, 'private-unknown-reason', /access was denied/, 'forbidden'],
    [401, 'authError', /connection expired/, 'invalid-token'],
    [404, 'notFound', /message not found/, 'not-found'],
    [429, 'userRateLimitExceeded', /rate limited/, 'rate-limit'],
    [503, 'backendError', /temporarily unavailable/, 'transient'],
  ]) {
    for (const [failStage, operation] of [['profile','recent'], ['list','recent'], ['message','recent'], ['message','get'], ['message','attachment']]) {
      const google = provider({failStage, failure: () => json({error:{message:'private-provider-message', errors:[{reason}]}}, status)});
      const mailbox = new gmail.GoogleGmailSupportMailbox(google.fetcher, newRuntime());
      if (status === 404 && operation === 'get') { assert.equal(await mailbox.get('one'), null); continue; }
      await assert.rejects(mailbox[operation]('one', '0'), expected);
      // recent() fetches several messages concurrently, each with safe diagnostics.
      assert.ok(logs.at(-1)[0].endsWith(`status=${status} category=${category}`));
    }
  }
  assert.doesNotMatch(JSON.stringify(logs), /private-provider-message|private-unknown-reason/);
});

test('modern ErrorInfo scope/rate categories and malformed/unknown 403 bodies never guess missing scope', async () => {
  for (const [reason, expected] of [['ACCESS_TOKEN_SCOPE_INSUFFICIENT', /permission is missing/], ['RATE_LIMIT_EXCEEDED', /rate limited/]]) {
    await assert.rejects(throwSupportGmailHttpError(json({error:{details:[{'@type':'type.googleapis.com/google.rpc.ErrorInfo', reason}]}}, 403), 'read'), expected);
  }
  for (const body of ['', 'not json', 'null', '{"error":null}', '{"error":{"status":"PERMISSION_DENIED"}}']) {
    await assert.rejects(throwSupportGmailHttpError(new Response(body, {status:403}), 'read'), /access was denied/);
  }
});

test('Ignore does not persist on a Gmail failure; recovery needs no reconnect and connection stays saved', async t => {
  await connection.saveSupportGmailConnection('support@example.test', 'refresh', actor);
  for (const [status, reason, expected] of [[403,'userRateLimitExceeded',/rate limited/], [404,'notFound',/message not found/], [503,'backendError',/temporarily unavailable/]]) {
    const google = provider({failStage:'message', failure: () => json({error:{errors:[{reason}]}}, status)});
    resetGmailRuntime(supportGmailRuntime);
    t.mock.method(globalThis, 'fetch', google.fetcher);
    const result = await ignoreInboxMessage({}, form('one'));
    assert.match(result.message, expected); assert.equal(dismissed.size, 0);
    assert.equal((await connection.connectionStatus()).connected, true);
  }
  resetGmailRuntime(supportGmailRuntime);
  t.mock.method(globalThis, 'fetch', provider().fetcher);
  assert.deepEqual(await ignoreInboxMessage({}, form('missing')), {message:'Gmail message not found.'});
  assert.equal(dismissed.size, 0);
  await assert.rejects(ignoreInboxMessage({}, form('one')), /test redirect/);
  assert.deepEqual([...dismissed], ['one']);
});

test('expired access token, revoked refresh token, OAuth client rejection and explicit broader scope stay distinct', async () => {
  await connection.saveSupportGmailConnection('support@example.test', 'refresh', actor);
  for (const [status, error, expected] of [[400,'invalid_grant',/connection expired/], [401,'invalid_client',/OAuth client was rejected/], [400,'invalid_request',/token refresh failed/]]) {
    await assert.rejects(new gmail.GoogleGmailSupportMailbox(provider({failStage:'token-refresh', failure:() => json({error},status)}).fetcher, newRuntime()).recent(), expected);
  }
  const stale = provider({failStage:'message', failure:() => json({error:{errors:[{reason:'authError'}]}},401)});
  await assert.rejects(new gmail.GoogleGmailSupportMailbox(stale.fetcher, newRuntime()).get('one'), /connection expired/);
  // A new operation refreshes again; no stale access token survives the operation.
  assert.equal((await new gmail.GoogleGmailSupportMailbox(provider({tokenPrefix:'fresh'}).fetcher, newRuntime()).get('one')).id, 'one');
  for (const scope of ['', `${SUPPORT_GMAIL_SCOPE} https://www.googleapis.com/auth/gmail.modify`]) {
    await assert.rejects(new gmail.GoogleGmailSupportMailbox(provider({scope}).fetcher, newRuntime()).recent(), /only gmail.readonly/);
  }
  assert.equal(credentials.record.grantedScope, SUPPORT_GMAIL_SCOPE);
});

test('network and timeout diagnostics contain only fixed stages/status/categories', async () => {
  await connection.saveSupportGmailConnection('support@example.test', 'private-refresh-token', actor);
  for (const failStage of ['token-refresh', 'profile', 'message']) for (const [name, expected, category] of [['Error', /connection failed/, 'network'], ['TimeoutError', /timed out/, 'timeout']]) {
    const failure = () => { throw Object.assign(new Error('private-access-token private-client-secret private-encryption-key private-authorization-code'), {name}); };
    await assert.rejects(new gmail.GoogleGmailSupportMailbox(provider({failStage, failure}).fetcher, newRuntime()).get('one'), expected);
    assert.deepEqual(logs.at(-1), [`[Support Gmail] stage=${failStage === 'message' ? 'read' : failStage} status=none category=${category}`]);
  }
  assert.doesNotMatch(JSON.stringify(logs), /private-|https:|Bearer|refresh_token/);
});

test('concurrent mailbox requests use local fresh tokens and reread shared connection after reconnect/disconnect', async () => {
  await connection.saveSupportGmailConnection('support@example.test', 'old-refresh', actor);
  const a = new gmail.GoogleGmailSupportMailbox(provider({tokenPrefix:'instance-a'}).fetcher, newRuntime());
  const b = new gmail.GoogleGmailSupportMailbox(provider({tokenPrefix:'instance-b'}).fetcher, newRuntime());
  assert.deepEqual((await Promise.all([a.get('one'), b.get('two')])).map(row => row.id), ['one','two']);
  await connection.saveSupportGmailConnection('support@example.test', 'new-refresh', actor);
  const next = provider();
  const fetcher = async (url, init) => { if (url.endsWith('/token')) assert.equal(init.body.get('refresh_token'), 'new-refresh'); return next.fetcher(url, init); };
  assert.equal((await new gmail.GoogleGmailSupportMailbox(fetcher, newRuntime()).get('one')).id, 'one');
  await connection.disconnectSupportGmail(actor);
  await assert.rejects(a.get('one'), /Connect Support Gmail/);
  await assert.rejects(b.get('two'), /Connect Support Gmail/);
});
