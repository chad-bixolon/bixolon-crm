import { fixtureEnv, installConnectionDb } from './support-gmail-test-helpers.mjs';
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
installConnectionDb();
Object.assign(process.env, fixtureEnv);
const source = require(path.join(root, 'lib/support-email-source.ts'));
const { createCaseFromSupportEmail } = require(path.join(root, 'lib/support-email.ts'));
Object.assign(process.env, { NODE_ENV: 'test', SUPPORT_GMAIL_ENABLED: 'true', SUPPORT_GMAIL_MOCK: 'true', E2E_AUTH_ENABLED: 'true', SUPPORT_GMAIL_MAILBOX: 'support@bixolonusa.com', AUTH_SECRET: 'unit-intake-secret' });
const actor = { id: 5, role: 'SUPPORT', active: true, archivedAt: null };
const message = { id: 'poc-xd5-1', threadId: 'poc-xd5-thread', subject: 'Printer jam', senderName: 'Jane', senderEmail: 'jane@example.test', bodyText: 'Please help.', snippet: '', messageDate: new Date('2026-10-12T12:00:00Z') };

test('source signature binds mailbox, user, message, thread and expiry; rejects forgery and permissions', () => {
  const token = source.signEmailSource(actor, message);
  assert.equal(source.validateEmailSource(actor, token).messageId, message.id);
  for (const bad of ['', 'forged', token + 'x', token.split('.')[0] + '.bad']) assert.throws(() => source.validateEmailSource(actor, bad), /Invalid or expired/);
  assert.throws(() => source.validateEmailSource({ ...actor, id: 6 }, token), /Invalid or expired/);
  assert.throws(() => source.validateEmailSource({ ...actor, role: 'SALES' }, token), /Access denied/);
  assert.throws(() => source.validateEmailSource(actor, token, Date.now() + 86400001), /Invalid or expired/);
  process.env.SUPPORT_GMAIL_MAILBOX = 'other@example.test';
  assert.throws(() => source.validateEmailSource(actor, token), /Invalid or expired/);
  process.env.SUPPORT_GMAIL_MAILBOX = 'support@bixolonusa.com';
});

test('matching prefills existing records, unmatched requester survives, and earliest available request is used', async () => {
  const account = { id: 3, name: 'Acme', status: 'ACTIVE' }, contact = { id: 2, firstName: 'Jane', lastName: 'Smith', account };
  const db = { internalEmailDomain: { findMany: async () => [] }, trustedSignInDomain: { findMany: async () => [] }, contact: { findMany: async () => [contact] }, supportCaseEmail: { findMany: async () => [] }, supportCase: { findMany: async () => [] } };
  const matched = await source.emailIntakeContext(db, actor, 'poc-xd5-1');
  assert.equal(matched.prefill.subject, 'XD5 printer still jamming');
  assert.equal(matched.prefill.customerNameText, 'E2E Picker Contact');
  assert.equal(matched.prefill.contact.id, 2); assert.equal(matched.prefill.accountId, 3);
  assert.match(matched.prefill.description, /Original email request\nFrom: E2E Picker Contact <e2e-picker-00@example.test>/);
  const resolved = await source.resolveEmailSource(actor, matched.token);
  assert.equal(resolved.message.id, 'poc-xd5-1'); assert.equal(resolved.message.threadId, 'poc-xd5-thread');
  db.contact.findMany = async () => [];
  const unmatched = await source.emailIntakeContext(db, actor, 'poc-unknown');
  assert.equal(unmatched.prefill.account, null); assert.equal(unmatched.prefill.contact, null);
  assert.equal(unmatched.prefill.customerNameText, 'new-customer@example.test');
  const thread = await source.emailIntakeContext(db, actor, 'poc-thread-1');
  assert.equal(thread.firstMessage.id, 'poc-thread-5');
  assert.match(thread.prefill.description, /Reply 5/);
  assert.equal((await source.resolveEmailSource(actor, thread.token)).message.id, 'poc-thread-1');
  await assert.rejects(source.emailIntakeContext(db, actor, 'poc-historical'), /Invalid or expired/);
  await assert.rejects(source.emailIntakeContext(db, actor, '../forged'), /Invalid or expired/);
  await assert.rejects(source.resolveEmailSource(actor, source.signEmailSource(actor, { ...message, threadId: 'forged' })), /Invalid or expired/);
  await assert.rejects(source.resolveEmailSource(actor, source.signEmailSource(actor, { ...message, id: 'missing' })), /Invalid or expired/);
});

function transactionalDb(failLink = false) {
  let state = { cases: [], links: [], events: [] };
  let tail = Promise.resolve();
  return { get state() { return state; }, $transaction(run) {
    const job = tail.then(async () => {
      const draft = structuredClone(state);
      const tx = {
        $executeRaw: async (strings) => { assert.match(strings.join(''), /pg_advisory_xact_lock/); return 1; },
        $queryRaw: async (strings) => { assert.match(strings.join(''), /pg_advisory_xact_lock|SupportCaseNumberCounter/); return [{ lastNumber: draft.cases.length + 1 }]; },
        supportCase: { create: async ({ data }) => { const row = { id: draft.cases.length + 1, ...data }; draft.cases.push(row); return row; }, findFirst: async () => draft.cases.at(-1), findUnique: async () => null },
        supportCaseEmail: { findUnique: async ({ where }) => draft.links.find(row => row.gmailMessageId === where.gmailMessageId) ?? null, findMany: async ({ where }) => draft.links.filter(row => where.OR ? row.gmailThreadId === where.OR[1].gmailThreadId : row.gmailThreadId === where.gmailThreadId), create: async ({ data }) => { if (failLink) throw new Error('Link storage failed'); draft.links.push(data); } },
        supportInboxDismissal: { deleteMany: async () => ({ count: 0 }) },
        supportCaseLifecycleEvent: { createMany: async ({ data }) => draft.events.push(...data), findMany: async () => [] },
      };
      const result = await run(tx); state = draft; return result;
    });
    tail = job.catch(() => {}); return job;
  } };
}
const input = { customerNameText: 'Jane', subject: 'Printer jam', description: 'Original email request', source: 'EMAIL' };
test('atomic save links metadata, marks origin and serializes repeat and same-thread submissions', async () => {
  const db = transactionalDb();
  const [a, b] = await Promise.all([createCaseFromSupportEmail(db, actor, input, message), createCaseFromSupportEmail(db, actor, input, { ...message, id: 'reply' })]);
  assert.equal(a.id, b.id); assert.equal(b.duplicate, true);
  assert.equal(db.state.cases.length, 1); assert.equal(db.state.links.length, 1);
  assert.equal(db.state.links[0].gmailThreadId, message.threadId); assert.equal(db.state.links[0].senderName, 'Jane');
  assert.equal(db.state.events.find(row => row.field === 'CREATED').source, `EMAIL_ORIGIN:${message.id}`);
  assert.equal((await createCaseFromSupportEmail(db, actor, input, message)).duplicate, true);
  for (const role of ['SALES','READ_ONLY','SALES_MANAGER','MARKETING_MANAGER']) await assert.rejects(createCaseFromSupportEmail(db, { ...actor, role }, input, message), /Access denied/);
});
test('link failure rolls back Case, counter and lifecycle; no false success', async () => {
  const db = transactionalDb(true);
  await assert.rejects(createCaseFromSupportEmail(db, actor, input, message), /Link storage failed/);
  assert.deepEqual(db.state, { cases: [], links: [], events: [] });
});
test('different first request and selected reply are both linked atomically', async () => {
  const db = transactionalDb();
  await createCaseFromSupportEmail(db, actor, input, { ...message, id: 'reply' }, message);
  assert.deepEqual(db.state.links.map(row => row.gmailMessageId), ['reply', message.id]);
});
