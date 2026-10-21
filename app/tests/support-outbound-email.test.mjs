import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compile = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, file);
Module._extensions['.ts'] = compile;
Module._extensions['.tsx'] = compile;
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...args) { return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...args); };
const require = Module.createRequire(import.meta.url);
const { outboundEmailPrefill, parseOutboundEmail, logSupportOutboundEmail, supportOutboundEmailContext, canLogSupportEmail, outboundEmailSaveErrorMessage } = require(path.join(root, 'lib/support-outbound-email.ts'));
const { supportActivityTimelineItem, caseHistoryView } = require(path.join(root, 'lib/support-case-timeline.ts'));
const { CaseTimelineEntry } = require(path.join(root, 'components/support-case-timeline.tsx'));
const { assertPermission } = require(path.join(root, 'lib/authorization.ts'));
const { parseActivity, saveActivity } = require(path.join(root, 'lib/work.ts'));
const actor = (role = 'SUPPORT') => ({ id: 7, role, active: true });
const caseRow = (changes = {}) => ({ id: 12, caseNumber: 'BXS-2026-000012', subject: 'RFID calibration', accountId: 3, contactId: 5, status: 'OPEN', archivedAt: null, account: { name: 'Acme' }, contact: { firstName: 'Jane', lastName: 'Smith', email: 'jane@example.test', active: true, archivedAt: null, accountId: 3 }, ...changes });
const linked = { senderName: 'Requester', senderEmail: 'requester@example.test', subject: 'Re: RFID setup' };
const form = (changes = {}) => { const f = new FormData(); for (const [key, value] of Object.entries({ recipientName: 'Jane Smith', recipientEmail: 'jane@example.test', subject: 'Re: RFID setup', summary: 'Sent updated firmware and requested a retest.', sentAt: '2026-10-10T09:42', ...changes })) f.set(key, value); return f; };
const input = (changes = {}) => parseOutboundEmail(form(changes), 'America/New_York', new Date('2026-10-11T12:00Z')).value;
function mockDb(row = caseRow()) {
  const calls = [], records = [], links = [];
  const tx = {
    supportCase: { findFirst: async args => { calls.push(['case', args]); return row; }, findUnique: async () => row },
    supportCaseEmail: { findFirst: async args => { calls.push(['email metadata', args]); return linked; } },
    account: { findFirst: async () => ({ id: 3 }) },
    activityType: { findFirst: async () => ({ code: 'EMAIL' }) },
    user: { findFirst: async () => ({ id: 7 }) },
    contact: { findMany: async () => row.contact ? [{ id: row.contactId, ...row.contact }] : [] },
    activityContact: { createMany: async args => { links.push(...args.data); } },
    activity: { create: async ({ data }) => { const record = { id: records.length + 1, ...data }; records.push(record); return record; } },
  };
  return { db: { ...tx, $transaction: async fn => fn(tx) }, records, links, calls, tx };
}

let actionActor, actionDb;
const revalidated = [];
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'next/cache') return { revalidatePath: value => revalidated.push(value) };
  if (request === '@/lib/current-user') return { requireMutation: async permission => { assertPermission(actionActor, permission); return actionActor; } };
  if (request === '@/lib/prisma') return { prisma: new Proxy({}, { get: (_target, property) => actionDb[property] }) };
  if (request === '@/lib/support-case-ui') return { supportUserZone: async () => 'America/New_York' };
  return originalLoad.call(this, request, parent, isMain);
};
const { logEmailResponse } = require(path.join(root, 'app/support/cases/outbound-email-actions.ts'));
Module._load = originalLoad;

test('prefills Case, Account, Contact and recipient; preserves Re: and uses linked subject', () => {
  assert.deepEqual(outboundEmailPrefill(caseRow(), linked), { caseNumber: 'BXS-2026-000012', accountName: 'Acme', contactName: 'Jane Smith', recipientName: 'Jane Smith', recipientEmail: 'jane@example.test', subject: 'Re: RFID setup' });
  assert.equal(outboundEmailPrefill(caseRow(), { ...linked, subject: 'RE: Existing reply' }).subject, 'RE: Existing reply');
  assert.equal(outboundEmailPrefill(caseRow(), null).subject, 'Re: RFID calibration');
});

test('requester fallback is metadata-only; missing/invalid/own mailbox addresses stay blank', async () => {
  const noContact = caseRow({ contactId: null, contact: null });
  const prefill = outboundEmailPrefill(noContact, linked);
  assert.equal(prefill.recipientEmail, linked.senderEmail); assert.equal(prefill.recipientName, linked.senderName);
  for (const email of [null, { ...linked, senderEmail: 'invalid' }, { ...linked, senderEmail: 'support@bixolonusa.com' }]) assert.equal(outboundEmailPrefill(noContact, email, 'support@bixolonusa.com').recipientEmail, '');
  assert.equal(outboundEmailPrefill(caseRow({ contact: { ...caseRow().contact, active: false } }), linked).recipientEmail, linked.senderEmail);
  assert.equal(outboundEmailPrefill(caseRow({ contact: { ...caseRow().contact, email: null } }), null).recipientEmail, '');
  const mock = mockDb();
  await supportOutboundEmailContext(mock.db, actor(), 12);
  const query = mock.calls.find(call => call[0] === 'email metadata')[1];
  assert.deepEqual(query.select, { senderName: true, senderEmail: true, subject: true });
  assert.deepEqual(query.orderBy, [{ messageDate: 'desc' }, { id: 'desc' }]);
  assert.equal(query.where.supportCaseId, 12);
});

test('validates recipient, subject, bounded summary and local sent time; ignores posted author/relations/body', () => {
  const parsed = parseOutboundEmail(form({ subject: 'Edited subject', userId: '99', accountId: '99', contactId: '99', supportCaseId: '99', body: 'Do not retain full mail' }), 'America/New_York', new Date('2026-10-11T12:00Z'));
  assert.deepEqual(parsed.errors, {}); assert.equal(parsed.value.subject, 'Edited subject');
  assert.equal(parsed.value.sentAt.toISOString(), '2026-10-10T13:42:00.000Z');
  assert.equal(parsed.value.userId, undefined); assert.equal(parsed.value.body, undefined);
  for (const [field, value] of [['summary', ''], ['summary', '   '], ['summary', 'x'.repeat(2001)], ['recipientEmail', ''], ['recipientEmail', 'not-an-address'], ['subject', ''], ['subject', 'x'.repeat(201)], ['recipientName', 'x'.repeat(201)], ['sentAt', '2026-02-30T10:00'], ['sentAt', '2026-10-12T12:00']]) {
    const result = parseOutboundEmail(form({ [field]: value }), 'America/New_York', new Date('2026-10-11T12:00Z'));
    assert.ok(result.errors[field], `${field} rejected`); assert.equal(result.value, undefined);
  }
  assert.ok(input({ summary: 'x'.repeat(2000), recipientName: '' }));
  assert.ok(parseOutboundEmail(form({ sentAt: '2026-03-08T02:30' }), 'America/New_York', new Date('2026-10-11T12:00Z')).errors.sentAt);
});

test('creates an existing EMAIL/OUTBOUND Activity with correct author, relationships and no Gmail work', async t => {
  const externalCalls = [];
  t.mock.method(globalThis, 'fetch', async (...args) => { externalCalls.push(args); throw new Error('Gmail/network forbidden'); });
  const mock = mockDb();
  const row = await logSupportOutboundEmail(mock.db, actor(), 12, input({ subject: 'Edited subject', userId: '99', body: 'Full email must not be stored' }));
  assert.equal(row.type, 'EMAIL'); assert.equal(row.direction, 'OUTBOUND');
  assert.equal(row.supportCaseId, 12); assert.equal(row.accountId, 3);
  assert.equal(row.userId, 7); assert.equal(row.createdById, 7); assert.equal(row.updatedById, 7);
  assert.equal(row.subject, 'Edited subject'); assert.equal(row.description, input().summary);
  assert.equal(row.emailRecipientName, 'Jane Smith'); assert.equal(row.emailRecipientEmail, 'jane@example.test');
  assert.equal(row.activityDate.toISOString(), '2026-10-10T13:42:00.000Z');
  assert.equal(row.opportunityId, null); assert.equal(row.projectId, null);
  assert.equal(row.bodyText, undefined); assert.equal(row.attachments, undefined);
  assert.deepEqual(mock.links, [{ activityId: row.id, contactId: 5 }]);
  assert.deepEqual(externalCalls, []); assert.equal(mock.records.length, 1);
});

test('logging needs no Gmail enable flag, OAuth credentials, encryption key or Gmail connection', async t => {
  const keys = ['SUPPORT_GMAIL_ENABLED', 'SUPPORT_GMAIL_CLIENT_ID', 'SUPPORT_GMAIL_CLIENT_SECRET', 'SUPPORT_GMAIL_ENCRYPTION_KEY', 'SUPPORT_GMAIL_EXPECTED_DATABASE_IDENTITY'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('No Gmail/network work allowed'); });
  try {
    for (const key of keys) delete process.env[key];
    process.env.SUPPORT_GMAIL_ENABLED = 'false';
    assert.equal((await logSupportOutboundEmail(mockDb().db, actor(), 12, input())).type, 'EMAIL');
  } finally { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

test('Case-only logging needs no invented Account or Contact; edited recipient does not misattribute a Contact', async () => {
  const mock = mockDb(caseRow({ accountId: null, account: null, contactId: null, contact: null }));
  mock.tx.account.findFirst = async () => { throw new Error('Account query unexpected'); };
  const row = await logSupportOutboundEmail(mock.db, actor(), 12, input({ recipientEmail: 'manual@example.test', recipientName: '' }));
  assert.equal(row.accountId, null); assert.deepEqual(mock.links, []);
  const changed = mockDb();
  await logSupportOutboundEmail(changed.db, actor(), 12, input({ recipientEmail: 'other@example.test' }));
  assert.deepEqual(changed.links, []);
});

test('Activities permit a real Case parent without an Account while preserving Sales relationship checks', async () => {
  const make = changes => { const f = new FormData(); for (const [key, value] of Object.entries({ subject: 'Call', type: 'CALL', userId: '7', activityDate: '2026-10-10T13:42', ...changes })) f.set(key, value); return parseActivity(f); };
  assert.ok(make({}).errors.accountId);
  const parsed = make({ supportCaseId: '12' });
  assert.deepEqual(parsed.errors, {});
  const mock = mockDb(caseRow({ accountId: null, account: null, contactId: null, contact: null }));
  assert.equal((await saveActivity(mock.db, parsed.value)).supportCaseId, 12);
  await assert.rejects(saveActivity(mock.db, { ...parsed.value, opportunityId: 99 }), /Choose an Account/);
  await assert.rejects(saveActivity(mock.db, { ...parsed.value, supportCaseId: 999, accountId: 99 }), /Support Case Account/);
});

test('Support/Admin allowed; Read Only, other roles and inactive users denied before any database or Gmail work', async () => {
  for (const role of ['SUPPORT', 'ADMIN']) { assert.equal(canLogSupportEmail(actor(role)), true); assert.equal((await logSupportOutboundEmail(mockDb().db, actor(role), 12, input())).userId, 7); }
  for (const user of [actor('READ_ONLY'), actor('SALES'), actor('SALES_MANAGER'), actor('MARKETING_MANAGER'), { ...actor(), active: false }, { ...actor(), archivedAt: new Date() }]) {
    assert.equal(canLogSupportEmail(user), false);
    const mock = mockDb();
    await assert.rejects(logSupportOutboundEmail(mock.db, user, 12, input()), /Access denied/);
    assert.deepEqual(mock.calls, []); assert.deepEqual(mock.records, []);
  }
});

test('closed/archived/missing Cases and invalid metadata cannot create an Activity', async () => {
  for (const row of [null, caseRow({ status: 'CLOSED' }), caseRow({ archivedAt: new Date() })]) {
    const mock = mockDb(row); await assert.rejects(logSupportOutboundEmail(mock.db, actor(), 12, input()), /unavailable|Reopen or restore/); assert.deepEqual(mock.records, []);
  }
  const mock = mockDb();
  await assert.rejects(logSupportOutboundEmail(mock.db, actor(), 12, { ...input(), summary: 'x'.repeat(2001) }), /Invalid outbound/);
  mock.tx.activityType.findFirst = async () => null;
  await assert.rejects(logSupportOutboundEmail(mock.db, actor(), 12, input()), /active activity type/);
  assert.deepEqual(mock.records, []);
});

test('timeline renders outbound attribution/time/summary/subject/recipient distinctly without full-email disclosure', async () => {
  const mock = mockDb();
  const row = await logSupportOutboundEmail(mock.db, actor(), 12, input());
  const activity = { ...row, activityType: { name: 'Email' }, user: { firstName: 'Chad', lastName: 'Guenther' }, contacts: [{ contact: { firstName: 'Jane', lastName: 'Smith' } }] };
  const item = supportActivityTimelineItem(activity);
  assert.equal(item.kind, 'Email Response Logged'); assert.equal(item.title, 'Email Response Logged'); assert.equal(item.actor, 'Chad Guenther → Jane Smith');
  assert.equal(item.detail, input().summary); assert.equal(item.fullBody, undefined);
  const generic = supportActivityTimelineItem({ ...activity, emailRecipientEmail: null, emailRecipientName: null, description: 'x'.repeat(5000) });
  assert.equal(generic.href, `/activities/${row.id}`); assert.ok(generic.detail.length <= 241);
  const html = renderToStaticMarkup(React.createElement(CaseTimelineEntry, { item, zone: 'America/New_York' }));
  for (const text of ['Email Response Logged', 'Chad Guenther → Jane Smith', 'Sent updated firmware', 'Re: RFID setup', 'jane@example.test', '9:42']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Outbound Email|Read full email|attachment|Send button/);
  const db = { supportCaseLifecycleEvent: { findMany: async () => [] }, activity: { findMany: async () => [activity] }, task: { findMany: async () => [] }, note: { findMany: async () => [] }, supportCaseAttachment: { findMany: async () => [] }, supportCaseEmail: { findMany: async () => [{ id: 8, messageDate: new Date('2026-10-09T12:00Z'), gmailMessageId: 'inbound', subject: 'RFID setup', senderEmail: 'jane@example.test', bodyText: 'Existing inbound content' }] } };
  db.$queryRaw=async()=>[];
  assert.deepEqual((await caseHistoryView(db, 12, new Date('2026-10-09'), 'UTC', true)).timeline.map(entry => entry.kind), ['Email Response Logged', 'Inbound Email']);
  for (const [source, label] of [['Note', 'Note'], ['Task', 'Task'], ['Case', 'Case Update']]) assert.ok(renderToStaticMarkup(React.createElement(CaseTimelineEntry, { item: { key: source, at: new Date(), source, title: 'Test' }, zone: 'UTC' })).includes(label));
});

test('server action enforces permissions, rejects oversized summaries and uses server attribution/relationships', async () => {
  const mock = mockDb(); actionDb = mock.db; actionActor = actor('READ_ONLY');
  await assert.rejects(logEmailResponse(12, {}, form()), /Access denied/);
  assert.deepEqual(mock.calls, []); assert.deepEqual(mock.records, []);
  actionActor = actor(); revalidated.length = 0;
  const oversized = form({ summary: 'x'.repeat(2001), subject: 'Edited subject' });
  assert.ok((await logEmailResponse(12, {}, oversized)).errors.summary);
  assert.equal(oversized.get('subject'), 'Edited subject'); assert.equal(mock.records.length, 0);
  assert.deepEqual(await logEmailResponse(12, {}, form({ userId: '99', accountId: '99', contactId: '99', supportCaseId: '99', subject: 'Edited subject' })), { success: true, message: 'Email response logged.' });
  assert.equal(mock.records[0].createdById, 7); assert.equal(mock.records[0].accountId, 3); assert.equal(mock.records[0].supportCaseId, 12);
  assert.equal(mock.records[0].subject, 'Edited subject');
  assert.deepEqual(revalidated, ['/support/cases/12', '/tasks', '/reports/engagement', '/accounts/3']);
});

test('BXS-2026-000004 shape passes business validation; stale runtime Client gets an actionable schema error', async () => {
  const row = caseRow({ id: 4, caseNumber: 'BXS-2026-000004', customerNameText: '7-Eleven', account: { name: '7-Eleven' }, assignedToId: 42, contact: { ...caseRow().contact, firstName: 'Craig', lastName: 'Griffith', email: 'craig@example.test' } });
  const mock = mockDb(row); actionDb = mock.db; actionActor = actor('ADMIN');
  const originalCreate = mock.tx.activity.create;
  mock.tx.activity.create = async () => { throw new Prisma.PrismaClientValidationError('Unknown argument `emailRecipientName`. private-recipient-and-summary', { clientVersion: '6.19.3' }); };
  const submitted = form({ recipientName: 'Craig Griffith', recipientEmail: 'craig@example.test' });
  const result = await logEmailResponse(4, {}, submitted);
  assert.deepEqual(result, { message: 'Email logging is not ready on this server. Ask an administrator to apply the outbound email migration, regenerate Prisma Client, and restart the app.' });
  assert.doesNotMatch(result.message, /private-recipient|summary|Craig|craig@example/);
  assert.equal(mock.records.length, 0);
  mock.tx.activity.create = originalCreate;
  assert.equal((await logEmailResponse(4, {}, submitted)).success, true);
  assert.equal(mock.records[0].supportCaseId, 4); assert.equal(mock.records[0].accountId, 3);
  assert.equal(mock.records[0].userId, 7); assert.notEqual(mock.records[0].userId, row.assignedToId);
  assert.equal(mock.records[0].createdById, 7); assert.equal(mock.records[0].emailRecipientName, 'Craig Griffith');
  assert.deepEqual(mock.links, [{ activityId: mock.records[0].id, contactId: row.contactId }]);
});

test('schema and business failure messages are specific and never expose raw Prisma/provider errors', () => {
  const schemaMessage = 'Email logging is not ready on this server. Ask an administrator to apply the outbound email migration, regenerate Prisma Client, and restart the app.';
  for (const field of ['emailRecipientName', 'emailRecipientEmail']) {
    assert.equal(outboundEmailSaveErrorMessage(new Prisma.PrismaClientValidationError(`Unknown argument \`${field}\`. private-payload`, { clientVersion: '6.19.3' })), schemaMessage);
    assert.equal(outboundEmailSaveErrorMessage(new Prisma.PrismaClientKnownRequestError('private-database-url-and-email', { code: 'P2022', clientVersion: '6.19.3', meta: { column: `Activity.${field}` } })), schemaMessage);
  }
  assert.match(outboundEmailSaveErrorMessage(new Error('Choose an active activity type.')), /active Email activity type/);
  assert.match(outboundEmailSaveErrorMessage(new Error('Account not found or archived.')), /linked Account is inactive or archived/);
  assert.match(outboundEmailSaveErrorMessage(new Error('Reopen or restore the Support Case before adding work.')), /Reopen or restore/);
  const fallback = 'Could not log the response. Please retry or ask an administrator for help.';
  assert.equal(outboundEmailSaveErrorMessage(new Error('private-database-url-and-email')), fallback);
  assert.equal(outboundEmailSaveErrorMessage(new Prisma.PrismaClientKnownRequestError('private-payload', { code: 'P2022', clientVersion: '6.19.3', meta: { column: 'User.unrelatedColumn' } })), fallback);
  assert.equal(outboundEmailSaveErrorMessage(new Prisma.PrismaClientValidationError('Unknown argument `unrelatedField`. private-payload', { clientVersion: '6.19.3' })), fallback);
});
