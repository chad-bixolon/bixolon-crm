import { fixtureEnv, productionEnv, installConnectionDb } from './support-gmail-test-helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(import.meta.url);
const credentials = installConnectionDb();
Object.assign(process.env, fixtureEnv);
const { supportGmailEnabled, MockGmailSupportMailbox, GoogleGmailSupportMailbox, SUPPORT_GMAIL_SCOPE, recentMockMessages, withinLookback, htmlToPlainText } = require(path.join(root, 'lib/support-gmail.ts'));
const { saveSupportGmailConnection, connectionStatus, disconnectSupportGmail, makeSupportGmailState, validSupportGmailState, supportGmailAuthorizationUrl, exchangeSupportGmailCode, assertExpectedMailbox } = require(path.join(root, 'lib/support-gmail-connection.ts'));
const { suggestSupportEmail, suggestSupportEmails, linkSupportEmail, ignoreSupportEmail, restoreSupportEmail, limitedEmailBody, caseReferences } = require(path.join(root, 'lib/support-email.ts'));
const { routeAccess } = require(path.join(root, 'lib/authorization.ts'));
const actor = role => ({ id: 5, role, active: true, archivedAt: null });
Object.assign(process.env, { SUPPORT_GMAIL_ENABLED: 'true', SUPPORT_GMAIL_MOCK: 'true', E2E_AUTH_ENABLED: 'true', SUPPORT_GMAIL_MAILBOX: 'support@bixolonusa.com', NODE_ENV: 'test' });

test('Support-only inbox access and explicit feature flag', () => {
  for (const role of ['SUPPORT', 'ADMIN']) assert.equal(routeAccess('/support/inbox', actor(role)), 'allowed');
  for (const role of ['SALES', 'MARKETING_MANAGER', 'READ_ONLY']) assert.equal(routeAccess('/support/inbox', actor(role)), 'denied');
  process.env.SUPPORT_GMAIL_ENABLED = 'false';
  assert.equal(supportGmailEnabled(), false);
  assert.equal(routeAccess('/support/inbox', actor('ADMIN')), 'denied');
  process.env.SUPPORT_GMAIL_ENABLED = 'true';
  assert.equal(SUPPORT_GMAIL_SCOPE, 'https://www.googleapis.com/auth/gmail.readonly');
});

test('exact Contact, Account, thread and case number suggestions stay conservative', async () => {
  const message = (await new MockGmailSupportMailbox().recent())[0];
  const db = {
    supportCaseEmail: { findMany: async () => [{ supportCase: { id: 7, caseNumber: 'BXS-2026-000007', subject: 'Thread', status: 'OPEN', accountId: 3 } }] },
    contact: { findMany: async ({ where }) => { assert.equal(where.email.equals, 'e2e-picker-00@example.test'); return [{ id: 2, firstName: 'Jane', lastName: 'Smith', accountId: 3, account: { id: 3, name: 'Acme' } }]; } },
    supportCase: { findFirst: async () => null, findMany: async () => [{ id: 8, caseNumber: 'BXS-2026-000008', subject: 'Open', status: 'OPEN', accountId: 3 }] },
  };
  const result = await suggestSupportEmail(db, message);
  assert.equal(result.contact.id, 2); assert.equal(result.account.name, 'Acme');
  assert.deepEqual(result.suggestedCases.map(row => row.id), [7, 8]);
  db.contact.findMany = async () => [{ id: 2 }, { id: 3 }];
  const ambiguous = await suggestSupportEmail(db, message);
  assert.equal(ambiguous.contact, null);
  assert.equal(ambiguous.account, null);
  db.supportCase.findFirst = async ({ where }) => where.caseNumber === 'BXS-2026-000009' ? { id: 9, caseNumber: where.caseNumber, subject: 'Numbered', status: 'OPEN', accountId: null } : null;
  const numbered = await suggestSupportEmail(db, { ...message, bodyText: 'Please check BXS-2026-000009' });
  assert.equal(numbered.numberedCaseId, 9);
});

test('manual link persists only selected email and prevents duplicate', async () => {
  const previous = process.env.SUPPORT_GMAIL_ENABLED; process.env.SUPPORT_GMAIL_ENABLED = 'true';
  const previousMode = process.env.NODE_ENV; process.env.NODE_ENV = 'test';
  try {
    const message = (await new MockGmailSupportMailbox().recent())[0];
    let saved;
    const db = { supportCase: { findFirst: async () => ({ id: 9 }) }, supportCaseEmail: { findUnique: async () => saved ? { supportCaseId: 9 } : null, findMany: async () => [], create: async ({ data }) => { saved = data; } } };
    db.supportInboxDismissal = { deleteMany: async () => ({ count: 0 }) };
    db.$executeRaw = async () => 1; db.$transaction = async run => run(db);
    assert.deepEqual(await linkSupportEmail(db, actor('SUPPORT'), message, 9), { duplicate: false });
    assert.equal(saved.gmailMessageId, message.id); assert.equal(saved.gmailThreadId, message.threadId); assert.equal(saved.supportCaseId, 9);
    assert.deepEqual(await linkSupportEmail(db, actor('SUPPORT'), message, 9), { duplicate: true });
    await assert.rejects(linkSupportEmail(db, actor('SUPPORT'), message, 0), /Choose a valid Support Case/);
    for (const role of ['SALES','READ_ONLY','SALES_MANAGER','MARKETING_MANAGER']) await assert.rejects(linkSupportEmail(db, actor(role), message, 9), /Access denied/);
  } finally { if (previous === undefined) delete process.env.SUPPORT_GMAIL_ENABLED; else process.env.SUPPORT_GMAIL_ENABLED = previous; if (previousMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousMode; }
});

test('large fixture remains bounded, recent, sorted, and contains distinct duplicate-looking IDs', () => {
  const rows = recentMockMessages();
  assert.equal(rows.length, 50);
  assert.ok(rows.every(row => row.messageDate.getTime() >= Date.now() - 30 * 86400000 - 1000));
  assert.ok(rows.every((row, i) => i === 0 || rows[i - 1].messageDate >= row.messageDate));
  const now = new Date('2026-10-11T12:00:00Z');
  assert.equal(withinLookback(new Date(now.getTime() - 30 * 86400000), now), true);
  assert.equal(withinLookback(new Date(now.getTime() - 30 * 86400000 - 1), now), false);
  assert.ok(!rows.some(row => row.id === 'poc-cutoff-outside' || row.id === 'poc-historical'));
  assert.equal(rows.filter(row => row.subject === 'Same text').length, 2);
  assert.equal(new Set(rows.filter(row => row.threadId === 'poc-five-message-thread').map(row => row.id)).size, 5);
});

test('HTML is text only and Unicode body limit does not split surrogate pairs', () => {
  assert.equal(htmlToPlainText('<style>bad</style><script>alert(1)</script><p>Hello &amp; goodbye</p><img src=x onerror=alert(1)>'), 'Hello & goodbye');
  const body = 'a'.repeat(19999) + '😀end';
  assert.equal(Array.from(limitedEmailBody(body)).length, 20000);
  assert.ok(limitedEmailBody(body).endsWith('😀'));
});

test('conflicting thread and multiple case references do not pick a case', async () => {
  const message = { ...(await new MockGmailSupportMailbox().recent())[0], subject: 'BXS-2026-000123 and BXS-2026-000124', bodyText: '' };
  const db = {
    supportCaseEmail: { findMany: async () => [{ supportCase: { id: 1 } }, { supportCase: { id: 2 } }] },
    contact: { findMany: async () => [] },
    supportCase: { findFirst: async () => { throw new Error('Ambiguous references must not query one case'); }, findMany: async () => [] },
  };
  const result = await suggestSupportEmail(db, message);
  assert.equal(result.threadConflict, true);
  assert.equal(result.multipleCaseReferences, true);
  assert.deepEqual(result.suggestedCases, []);
});

test('quoted old case number is ignored and batch matching uses bounded query count', async () => {
  const messages = recentMockMessages();
  const quoted = messages.find(row => row.id === 'poc-bxs-quoted');
  assert.deepEqual(caseReferences(quoted), []);
  let queries = 0;
  const count = rows => { queries++; return rows; };
  const db = {
    supportCaseEmail: { findMany: async () => count([]) },
    contact: { findMany: async () => count([]) },
    supportCase: { findMany: async () => count([]) },
  };
  const result = await suggestSupportEmails(db, messages);
  assert.equal(result.length, 50);
  assert.equal(queries, 3);
  assert.equal(result.find(row => row.message.id === 'poc-unknown').suggestion.contact, null);
});

test('configured mailbox is mandatory and exact', () => {
  const old = process.env.SUPPORT_GMAIL_MAILBOX;
  try {
    process.env.SUPPORT_GMAIL_MAILBOX = 'support@bixolonusa.com';
    assert.doesNotThrow(() => assertExpectedMailbox('SUPPORT@BIXOLONUSA.COM'));
    assert.throws(() => assertExpectedMailbox('personal@example.test'), /does not match/);
    delete process.env.SUPPORT_GMAIL_MAILBOX;
    assert.throws(() => assertExpectedMailbox('support@bixolonusa.com'), /must name/);
  } finally { if (old === undefined) delete process.env.SUPPORT_GMAIL_MAILBOX; else process.env.SUPPORT_GMAIL_MAILBOX = old; }
});

test('ten ignored messages persist only mailbox, message ID, actor and no duplicates', async () => {
  const previous = Object.fromEntries(['SUPPORT_GMAIL_ENABLED', 'SUPPORT_GMAIL_MAILBOX', 'NODE_ENV'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { SUPPORT_GMAIL_ENABLED: 'true', SUPPORT_GMAIL_MAILBOX: 'support@bixolonusa.com', NODE_ENV: 'test' });
  const stored = new Map();
  const db = { supportCaseEmail: { findUnique: async () => null }, supportInboxDismissal: { upsert: async ({ where, create }) => { assert.deepEqual(Object.keys(create).sort(), ['gmailMessageId', 'ignoredByUserId', 'mailbox']); stored.set(where.mailbox_gmailMessageId.gmailMessageId, create); }, deleteMany: async ({ where }) => { stored.delete(where.gmailMessageId); } } };
  db.$executeRaw = async () => 1; db.$transaction = async run => run(db);
  try {
    for (let i = 0; i < 12; i++) await ignoreSupportEmail(db, actor('SUPPORT'), 'support@bixolonusa.com', `poc-volume-${i}`);
    await ignoreSupportEmail(db, actor('SUPPORT'), 'support@bixolonusa.com', 'poc-volume-1');
    await ignoreSupportEmail(db, actor('ADMIN'), 'support@bixolonusa.com', 'poc-volume-1');
    assert.equal(stored.size, 12);
    await restoreSupportEmail(db, actor('SUPPORT'), 'support@bixolonusa.com', 'poc-volume-1');
    assert.equal(stored.size, 11);
    db.supportCaseEmail.findUnique = async () => ({ id: 1 });
    await assert.rejects(ignoreSupportEmail(db, actor('SUPPORT'), 'support@bixolonusa.com', 'poc-xd5-1'), /already linked/);
    db.supportCaseEmail.findUnique = async () => null;
    for (const role of ['SALES','READ_ONLY','SALES_MANAGER','MARKETING_MANAGER']) {
      await assert.rejects(ignoreSupportEmail(db, actor(role), 'support@bixolonusa.com', 'poc-volume-99'), /Access denied/);
      await assert.rejects(restoreSupportEmail(db, actor(role), 'support@bixolonusa.com', 'poc-volume-99'), /Access denied/);
    }
    db.supportInboxDismissal.upsert = async () => { throw new Error('database unavailable'); };
    await assert.rejects(ignoreSupportEmail(db, actor('SUPPORT'), 'support@bixolonusa.com', 'poc-volume-99'), /database unavailable/);
  } finally { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

test('link and repeat link clear ignored state atomically; failed cleanup rolls the link back', async () => {
  let state = { links: [], ignored: [ 'race-message' ] };
  let failCleanup = false;
  const locks = [];
  const message = { id: 'race-message', threadId: 'race-thread', subject: 'Race', senderEmail: 'customer@example.test', senderName: null, bodyText: 'Help', messageDate: new Date() };
  const db = { $transaction: async run => {
    const draft = structuredClone(state);
    const tx = {
      $executeRaw: async (_strings, key) => { locks.push(key); return 1; },
      supportCase: { findFirst: async () => ({ id: 9 }) },
      supportCaseEmail: { findUnique: async () => draft.links[0] ?? null, findMany: async () => draft.links, create: async ({ data }) => { draft.links.push(data); } },
      supportInboxDismissal: { deleteMany: async () => { if (failCleanup) throw new Error('Cleanup failed'); draft.ignored = []; }, upsert: async () => { draft.ignored.push(message.id); } },
    };
    const result = await run(tx); state = draft; return result;
  } };
  failCleanup = true;
  await assert.rejects(linkSupportEmail(db, actor('SUPPORT'), message, 9), /Cleanup failed/);
  assert.equal(state.links.length, 0);
  assert.deepEqual(state.ignored, [message.id]);
  failCleanup = false;
  assert.deepEqual(await linkSupportEmail(db, actor('SUPPORT'), message, 9), { duplicate: false });
  assert.deepEqual(state.ignored, []);
  state.ignored.push(message.id); // Repair an inconsistent state left by the old code.
  assert.deepEqual(await linkSupportEmail(db, actor('SUPPORT'), message, 9), { duplicate: true });
  assert.deepEqual(state.ignored, []);
  assert.equal(state.links.length, 1);
  await assert.rejects(ignoreSupportEmail(db, actor('ADMIN'), process.env.SUPPORT_GMAIL_MAILBOX, message.id), /already linked/);
  assert.deepEqual(state.ignored, []);
  assert.ok(locks.filter(key => key === `support-email-message:${process.env.SUPPORT_GMAIL_MAILBOX}:${message.id}`).length >= 4);
});

test('encrypted connection and Google adapter only call Gmail read endpoints with bounded list', async () => {
  const keys = ['SUPPORT_GMAIL_CLIENT_ID', 'SUPPORT_GMAIL_CLIENT_SECRET', 'SUPPORT_GMAIL_MAILBOX', 'SUPPORT_GMAIL_ENCRYPTION_KEY', 'SUPPORT_GMAIL_EXPECTED_DATABASE_IDENTITY', 'E2E_AUTH_ENABLED', 'SUPPORT_GMAIL_OAUTH_CALLBACK_URL', 'SUPPORT_GMAIL_ENABLED', 'SUPPORT_GMAIL_MOCK', 'SUPPORT_GMAIL_TEST_FIXTURE', 'SUPPORT_GMAIL_INITIAL_LOOKBACK_DAYS', 'NODE_ENV', 'AUTH_SECRET', 'AUTH_URL', 'DATABASE_URL'];
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = global.fetch;
  Object.assign(process.env, productionEnv('test@example.test'));
  const { SupportGmailRuntime } = require(path.join(root, 'lib/support-gmail-runtime.ts'));
  const calls = [];
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET' });
    const data = String(url).includes('/token') ? { access_token: 'token', scope: SUPPORT_GMAIL_SCOPE } : String(url).endsWith('/profile') ? { emailAddress: 'test@example.test' } : { messages: [] };
    return { ok: true, json: async () => data };
  };
  try {
    await saveSupportGmailConnection('test@example.test', 'refresh', actor('ADMIN'));
    assert.equal((await connectionStatus()).email, 'test@example.test');
    assert.doesNotMatch(credentials.record.refreshTokenEncrypted, /refresh/);
    const verifier = crypto.randomBytes(32).toString('base64url');
    const state = makeSupportGmailState(5, Date.now(), verifier);
    assert.equal(validSupportGmailState(state, state, 5), true);
    assert.equal(validSupportGmailState(state, state, 6), false);
    const authorization = new URL(supportGmailAuthorizationUrl(state, verifier));
    assert.equal(authorization.searchParams.get('scope'), SUPPORT_GMAIL_SCOPE);
    assert.equal(authorization.searchParams.get('redirect_uri'), 'https://saleshub.example.test/api/support-gmail/callback');
    await assert.rejects(exchangeSupportGmailCode('code', verifier, async () => ({ ok: true, json: async () => ({ access_token: 'token', refresh_token: 'refresh', token_type: 'Bearer', scope: `${SUPPORT_GMAIL_SCOPE} https://www.googleapis.com/auth/gmail.modify` }) })), /only gmail.readonly/);
    assert.deepEqual(await new GoogleGmailSupportMailbox(undefined, new SupportGmailRuntime()).recent(), []);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls.length, 3);
    for (const call of calls.slice(1)) { assert.equal(call.method, 'GET'); assert.match(call.url, /\/users\/me\/(?:profile|messages\?)/); }
    assert.match(calls[2].url, /maxResults=50/);
    assert.match(decodeURIComponent(calls[2].url), /after:\d+ -in:spam -in:trash/);
    const after = Number(decodeURIComponent(calls[2].url).match(/after:(\d+)/)[1]);
    assert.ok(Math.abs(after - Math.floor((Date.now() - 30 * 86400000) / 1000)) < 5);
    for (const [status, message] of [[401, /expired/], [403, /denied/], [429, /rate limited/], [500, /temporarily unavailable/]]) {
      global.fetch = async url => String(url).includes('/token') ? { ok: true, json: async () => ({ access_token: 'token', scope: SUPPORT_GMAIL_SCOPE }) } : String(url).endsWith('/profile') ? { ok: true, json: async () => ({ emailAddress: 'test@example.test' }) } : new Response('', {status, headers: {'Retry-After':'10'}});
      await assert.rejects(new GoogleGmailSupportMailbox(undefined, new SupportGmailRuntime()).recent(), message);
    }
    global.fetch = async () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); };
    await assert.rejects(new GoogleGmailSupportMailbox(undefined, new SupportGmailRuntime()).recent(), /timed out/);
    await disconnectSupportGmail(actor('ADMIN'));
    assert.equal((await connectionStatus()).connected, false);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(old)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
