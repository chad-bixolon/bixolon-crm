import { productionEnv, installConnectionDb, resetGmailRuntime } from './support-gmail-test-helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText, filename);
const require = Module.createRequire(import.meta.url);
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...args) { return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...args); };
const credentials = installConnectionDb();
const gmail = require(path.join(root, 'lib/support-gmail.ts'));
const source = require(path.join(root, 'lib/support-email-source.ts'));
const connection = require(path.join(root, 'lib/support-gmail-connection.ts'));
const { SupportGmailRuntime, supportGmailRuntime: shared, GMAIL_BUSY } = require(path.join(root, 'lib/support-gmail-runtime.ts'));
const { throwSupportGmailHttpError, retryAfterMilliseconds } = require(path.join(root, 'lib/support-gmail-errors.ts'));
const actor = { id: 5, role: 'SUPPORT', active: true };
const dismissed = new Set();
const tx = { $executeRaw: async () => 1, supportCaseEmail: {findUnique: async () => null}, supportInboxDismissal: {upsert: async ({create}) => dismissed.add(create.gmailMessageId)} };
const load = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'next/cache') return {revalidatePath: () => {}};
  if (request === 'next/navigation') return {redirect: () => {throw new Error('test redirect');}};
  if (request === 'next/headers') return {};
  if (request === '@/lib/current-user') return {requireMutation: async () => actor};
  if (request === '@/lib/prisma') return {prisma: {...credentials.db, $transaction: async run => run(tx)}};
  return load.call(this, request, parent, isMain);
};
const actions = require(path.join(root, 'app/support/inbox/actions.ts'));
Module._load = load;
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {status, headers});
const deferred = () => { let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve}; };
let now, logs, original;
test.beforeEach(async t => {
  const env = productionEnv(); original = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env); credentials.reset(); dismissed.clear(); resetGmailRuntime(shared);
  now = Date.now(); logs = [];
  t.mock.method(shared, 'now', () => now);
  t.mock.method(shared, 'sleep', async ms => {now += ms;});
  t.mock.method(shared, 'random', () => 0);
  t.mock.method(console, 'log', line => { logs.push(line); });
  await connection.saveSupportGmailConnection('support@example.test', 'private-refresh', { ...actor, role: 'ADMIN' });
});
test.afterEach(() => {for (const [key, value] of Object.entries(original)) if (value === undefined) delete process.env[key]; else process.env[key] = value;});
function provider(count = 50) {
  const calls = [], removed = new Set(), overrides = new Map();
  const fetcher = async (url, init) => {
    calls.push({url, method: init.method ?? 'GET'});
    if (url.endsWith('/token')) return json({access_token: 'private-access', scope: gmail.SUPPORT_GMAIL_SCOPE});
    if (url.endsWith('/profile')) return json({emailAddress: 'support@example.test'});
    if (url.includes('messages?')) return json({messages: Array.from({length: count}, (_, i) => ({id: `m${i}`}))});
    const id = new URL(url).pathname.split('/').at(-1);
    if (removed.has(id)) return json({}, 404);
    const full = new URL(url).searchParams.get('format') === 'full';
    return json({id, threadId: `t${id}`, labelIds: ['INBOX'], internalDate: String(Date.now() - 1000), snippet: 'Printer preview', payload: {headers: [{name: 'From', value: 'Customer <customer@example.test>'}, {name: 'Subject', value: 'Printer issue'}], ...(full ? {mimeType: 'text/plain', body: {data: Buffer.from('PRIVATE MESSAGE BODY').toString('base64url')}} : {})}, ...overrides.get(id)});
  };
  return {calls, removed, overrides, fetcher};
}
function form(id, who = actor) { const form = new FormData(); form.set('messageId', id); form.set('emailSource', source.signEmailSource(who, {id, threadId: `t${id}`})); return form; }

test('50-message cold inbox costs 53 metadata requests; cache copies, TTL and connection changes are safe', async t => {
  const google = provider(); t.mock.method(globalThis, 'fetch', google.fetcher);
  const first = await gmail.recentSupportMail();
  assert.equal(google.calls.length, 53);
  assert.equal(google.calls.filter(c => c.url.includes('format=metadata')).length, 50);
  assert.ok(first.every(row => row.bodyText === '' && row.files === undefined));
  first[0].subject = 'mutated';
  assert.notEqual((await gmail.recentSupportMail())[0].subject, 'mutated');
  assert.equal(google.calls.length, 53);
  now += 10001; await gmail.recentSupportMail(); assert.equal(google.calls.length, 106);
  await connection.disconnectSupportGmail({...actor,role:'ADMIN'});
  await assert.rejects(gmail.recentSupportMail(), /Connect Support Gmail/);
  assert.equal(google.calls.length, 106);
  await connection.saveSupportGmailConnection('support@example.test', 'replacement-refresh', { ...actor, role: 'ADMIN' });
  await gmail.recentSupportMail(); assert.equal(google.calls.length, 159);
  assert.doesNotMatch(JSON.stringify([...shared.cache]), /private-access|private-refresh|PRIVATE MESSAGE BODY/);
});

test('Ignore and repeated Ignore use three targeted requests plus zero on a warm redirect', async t => {
  const google = provider(); t.mock.method(globalThis, 'fetch', google.fetcher);
  await gmail.recentSupportMail(); google.calls.length = 0;
  for (const id of ['m0', 'm1', 'm0']) {
    await assert.rejects(actions.ignoreInboxMessage({}, form(id)), /test redirect/);
    await gmail.recentSupportMail();
  }
  assert.equal(google.calls.length, 9);
  assert.equal(google.calls.filter(c => c.url.includes('format=full')).length, 3);
  assert.equal(google.calls.filter(c => c.url.includes('messages?')).length, 0);
  assert.deepEqual([...dismissed], ['m0', 'm1']);
  assert.ok(logs.every(line => !line.includes('integration.activity')));
});

test('stale inbox cache cannot authorize missing, moved, wrong-thread or outside-window messages', async t => {
  const google = provider(); t.mock.method(globalThis, 'fetch', google.fetcher);
  await gmail.recentSupportMail(); google.calls.length = 0; google.removed.add('m0');
  assert.match((await actions.ignoreInboxMessage({}, form('m0'))).message, /message not found/);
  for (const override of [{threadId:'changed'}, {labelIds:['TRASH']}, {labelIds:['SPAM']}, {internalDate: String(Date.now() - 31 * 86400000)}]) {
    google.overrides.set('m1', override);
    assert.match((await actions.ignoreInboxMessage({}, form('m1'))).message, /message not found/);
  }
  assert.equal(dismissed.size, 0);
  const before = google.calls.length;
  const forged = form('m2'); forged.set('messageId','m3');
  assert.match((await actions.ignoreInboxMessage({}, forged)).message, /Invalid Support inbox source/);
  const wrongUser = form('m2', {...actor, id:6});
  assert.match((await actions.ignoreInboxMessage({}, wrongUser)).message, /Invalid or expired/);
  const unsigned = new FormData(); unsigned.set('messageId','m2');
  assert.match((await actions.ignoreInboxMessage({}, unsigned)).message, /Invalid or expired/);
  assert.equal(google.calls.length, before);
});

test('two users coalesce the same live source validation; distinct actions stay bounded and repeat reads stay fresh', async t => {
  const google = provider(); const gate = deferred(), entered = deferred();
  t.mock.method(globalThis, 'fetch', async (url, init) => { if (url.includes('/messages/m0?')) {entered.resolve(); await gate.promise;} return google.fetcher(url, init); });
  const other = {...actor, id:6};
  const a = source.resolveInboxSource(actor, form('m0').get('emailSource'), 'm0');
  await entered.promise;
  const b = source.resolveInboxSource(other, form('m0', other).get('emailSource'), 'm0');
  await new Promise(resolve => setImmediate(resolve)); gate.resolve();
  assert.deepEqual((await Promise.all([a,b])).map(row => row.id), ['m0','m0']);
  assert.equal(google.calls.length, 3);
  await source.resolveInboxSource(actor, form('m0').get('emailSource'), 'm0');
  assert.equal(google.calls.length, 6);
  await Promise.all(['m1','m2','m3'].map(id => source.resolveInboxSource(actor, form(id).get('emailSource'), id)));
  assert.equal(google.calls.length, 15);
  assert.ok(logs.every(line => !line.includes('integration.activity')));
});

test('duplicate cold inbox requests coalesce across fresh adapters and failures are never cached', async () => {
  const google = provider(), gate = deferred(), entered = deferred();
  const fetcher = async (url, init) => { if (url.includes('messages?')) {entered.resolve(); await gate.promise;} return google.fetcher(url, init); };
  const a = new gmail.GoogleGmailSupportMailbox(fetcher).recent(); await entered.promise;
  const b = new gmail.GoogleGmailSupportMailbox(fetcher).recent();
  await new Promise(resolve => setImmediate(resolve)); gate.resolve();
  await Promise.all([a,b]); assert.equal(google.calls.length, 53);
  const runtime = new SupportGmailRuntime(); let attempts = 0;
  const read = () => runtime.run('mailbox','version','recent',true,10000, async () => {if (++attempts === 1) throw new Error('failed'); return [];});
  await assert.rejects(read(), /failed/); await read(); assert.equal(attempts,2);
});

test('local operation/concurrency/request budgets return the local retry message and release on errors', async () => {
  const runtime = new SupportGmailRuntime(() => now);
  const gate = deferred(); const active = [];
  for (let i=0; i<3; i++) active.push(runtime.run('mailbox','v',`get:${i}`,false,0, () => gate.promise));
  await assert.rejects(runtime.run('mailbox','v','fourth',false,0,async()=>[]), {message: GMAIL_BUSY});
  gate.resolve([]); await Promise.all(active);
  const expensive = deferred(); const a = runtime.run('mailbox','v','review',true,0,()=>expensive.promise);
  await assert.rejects(runtime.run('mailbox','v','recent',true,0,async()=>[]), {message: GMAIL_BUSY});
  expensive.resolve([]); await a;
  now += 10001;
  for (let i=0;i<60;i++) await runtime.run('mailbox','v',`get:${i}`,false,0,async()=>[]);
  await assert.rejects(runtime.run('mailbox','v','extra',false,0,async()=>[]), {message: GMAIL_BUSY});
  now += 10001;
  await runtime.run('mailbox','v','extra',false,0,async()=>[]);
  const check = response => throwSupportGmailHttpError(response, 'read');
  for (let i=0;i<300;i++) await runtime.request('other',true,async()=>json({}),check);
  await assert.rejects(runtime.request('other',true,async()=>json({}),check), {message: GMAIL_BUSY});
  assert.ok(logs.every(line => !line.includes('integration.activity')));
});

test('Google 429 and rate-limit 403 retry once with jitter/Retry-After and retain provider classification', async () => {
  const waits = [], check = response => throwSupportGmailHttpError(response, 'read');
  for (const status of [429,403]) {
    const runtime = new SupportGmailRuntime(() => now, async ms => {waits.push(ms); now += ms;}, () => 0.5);
    let attempts = 0;
    const send = async () => ++attempts === 1 ? json({error:{errors:[{reason:'userRateLimitExceeded'}]}},status,{'Retry-After':'1.5'}) : json({ok:true});
    assert.equal((await runtime.request('mailbox',true,send,check)).status,200);
    assert.equal(attempts,2); assert.equal(waits.at(-1),1500);
  }
  const runtime = new SupportGmailRuntime(() => now, async ms => {now += ms;}, () => 0);
  let attempts = 0;
  await assert.rejects(runtime.request('mailbox',true,async()=>{attempts++;return json({},429);},check), /rate limited/);
  assert.equal(attempts,2);
  await assert.rejects(runtime.request('mailbox',true,async()=>{attempts++;return json({});},check), /rate limited/);
  assert.equal(attempts,2);
  assert.ok(logs.some(line=>line.includes('integration.failed')));
  assert.equal(retryAfterMilliseconds('Fri, 16 Oct 2026 15:00:10 GMT', Date.parse('2026-10-16T15:00:00Z')),10000);
  assert.equal(retryAfterMilliseconds('garbage'),undefined);
});

test('long Retry-After is honored without waiting in a user request; refresh POST never retries', async () => {
  const waits = [], runtime = new SupportGmailRuntime(() => now, async ms => {waits.push(ms);now += ms;}, () => 0);
  const check = response => throwSupportGmailHttpError(response, 'read'); let attempts = 0;
  const send = async () => {attempts++;return json({},429,{'Retry-After':'60'});};
  await assert.rejects(runtime.request('mailbox',true,send,check), /rate limited/);
  now += 59000;
  await assert.rejects(runtime.request('mailbox',true,send,check), /rate limited/);
  assert.equal(attempts,1); assert.deepEqual(waits,[]);
  await assert.rejects(runtime.request('different',false,send,check), /rate limited/);
  assert.equal(attempts,2); assert.deepEqual(waits,[]);
});

test('concurrent provider rate limits have only one retry owner per mailbox', async () => {
  const wake = deferred(), sleeping = deferred(); let attempts = 0;
  const runtime = new SupportGmailRuntime(() => now, async ms => {sleeping.resolve();await wake.promise;now += ms;}, () => 0);
  const check = response => throwSupportGmailHttpError(response, 'read');
  const read = runtime.request('mailbox',true,async()=>{attempts++;return attempts === 1 ? json({},429) : json({});},check);
  await sleeping.promise;
  await assert.rejects(runtime.request('mailbox',true,async()=>{attempts++;return json({},429);},check), /rate limited/);
  assert.equal(attempts,1); wake.resolve(); await read; assert.equal(attempts,2);
});

test('separate replica runtimes revalidate source and connection independently; no cache is required for correctness', async () => {
  const google = provider(2);
  const a = new gmail.GoogleGmailSupportMailbox(google.fetcher,new SupportGmailRuntime());
  const b = new gmail.GoogleGmailSupportMailbox(google.fetcher,new SupportGmailRuntime());
  await a.recent(); await b.recent(); assert.equal(google.calls.length,10);
  google.removed.add('m0');
  assert.equal(await a.get('m0'),null); assert.equal(await b.get('m0'),null);
  await connection.disconnectSupportGmail({...actor,role:'ADMIN'});
  await assert.rejects(a.recent(),/Connect Support Gmail/); await assert.rejects(b.recent(),/Connect Support Gmail/);
});

test('Create review/save share token and profile within each operation, hydrate thread, and preserve read-only scope', async t => {
  const google = provider(2); google.overrides.set('m1',{threadId:'tm0'});
  t.mock.method(globalThis,'fetch',google.fetcher);
  await gmail.recentSupportMail(); google.calls.length = 0;
  const db = {internalEmailDomain:{findMany:async()=>[]},trustedSignInDomain:{findMany:async()=>[]},contact:{findMany:async()=>[]},supportCaseEmail:{findMany:async()=>[]},supportCase:{findMany:async()=>[]}};
  const context = await source.emailIntakeContext(db,actor,'m0');
  assert.equal(google.calls.length,4); assert.equal(context.messages.length,2);
  assert.match(context.prefill.description,/PRIVATE MESSAGE BODY/);
  google.calls.length=0;
  await source.resolveEmailSource(actor,context.token);
  assert.ok(google.calls.length === 3 || google.calls.length === 4);
  assert.equal(gmail.SUPPORT_GMAIL_SCOPE,'https://www.googleapis.com/auth/gmail.readonly');
  assert.ok(google.calls.filter(c=>c.url.includes('gmail.googleapis.com')).every(c=>c.method==='GET'));
  assert.doesNotMatch(logs.join('\n'),/private-access|private-refresh|PRIVATE MESSAGE BODY|support@example|customer@example|https:/);
});

test('Ignore surfaces the local busy message without calling Google or changing CRM state', async t => {
  const google = provider(); t.mock.method(globalThis, 'fetch', google.fetcher);
  for (let i=0; i<60; i++) await shared.run('support@example.test','test',`get:${i}`,false,0,async()=>[]);
  assert.deepEqual(await actions.ignoreInboxMessage({},form('m0')), {message:GMAIL_BUSY});
  assert.equal(google.calls.length,0); assert.equal(dismissed.size,0);
});

test('50-source file review costs 52 requests, shares profile verification, and retains individual missing sources', async () => {
  const google = provider(); google.removed.add('m10');
  const mailbox = new gmail.GoogleGmailSupportMailbox(google.fetcher,new SupportGmailRuntime());
  const review = await mailbox.review(Array.from({length:50},(_,i)=>`m${i}`));
  assert.equal(google.calls.length,52); assert.equal(review[10].message,null);
  assert.equal(review.filter(row=>row.message).length,49);
  assert.equal(google.calls.filter(row=>row.url.endsWith('/profile')).length,1);
});

test('connection replacement during an in-flight read fails closed and never populates the cache', async () => {
  const google = provider(1), entered = deferred(), release = deferred();
  const runtime = new SupportGmailRuntime();
  const mailbox = new gmail.GoogleGmailSupportMailbox(async (url,init) => {
    if (url.includes('messages?')) {entered.resolve(); await release.promise;}
    return google.fetcher(url,init);
  },runtime);
  const read = mailbox.recent(); await entered.promise;
  await connection.disconnectSupportGmail({...actor,role:'ADMIN'}); release.resolve();
  await assert.rejects(read,/Connect Support Gmail/);
  assert.equal(runtime.cache.size,0);
});

test('the process-wide runtime recognizes typed provider errors from separately bundled routes', async () => {
  const runtime = new SupportGmailRuntime(() => now, async () => {throw new Error('must not sleep');});
  class OtherBundleHttpError extends Error { name = 'SupportGmailHttpError'; category = 'rate-limit'; retryAfterMs = 10000; }
  await assert.rejects(runtime.request('mailbox',true,async()=>json({},429),async()=>{throw new OtherBundleHttpError('Support Gmail is rate limited. Try again later.');}), /rate limited/);
  let calls = 0;
  await assert.rejects(runtime.request('mailbox',true,async()=>{calls++;return json({});},response=>throwSupportGmailHttpError(response,'read')), /rate limited/);
  assert.equal(calls,0);
});

test('triage views and counts reuse one bounded provider batch without additional Gmail requests', async () => {
  const { inboxTriageState, inboxMatchesView, inboxTriageCounts } = require(path.join(root, 'lib/support-inbox-display.ts'));
  const google = provider(50);
  const mailbox = new gmail.GoogleGmailSupportMailbox(google.fetcher, new SupportGmailRuntime());
  const messages = await mailbox.recent();
  const calls = google.calls.length;
  assert.equal(calls, 53);
  const rows = messages.slice(1).map((message, index) => ({ message, ...inboxTriageState({ alreadyLinkedCaseId: index % 2 ? 1 : null, ambiguousContact: index % 3 === 0, suggestedCases: [], relatedCaseCount: 0 }) }));
  const counts = inboxTriageCounts(rows);
  for (const view of ['all', 'unlinked', 'needs-review']) assert.equal(rows.filter(row => inboxMatchesView(row, view)).length, counts[view]);
  assert.equal(counts.all, 49); // A locally hidden message never expands the fetch.
  assert.equal(google.calls.length, calls);
  assert.equal(google.calls.filter(row => row.url.includes('messages?')).length, 1);
  assert.match(google.calls.find(row => row.url.includes('messages?')).url, /maxResults=50/);
});
