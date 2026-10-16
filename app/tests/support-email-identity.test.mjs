import { fixtureEnv, productionEnv, installConnectionDb } from './support-gmail-test-helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(import.meta.url);
installConnectionDb();
Object.assign(process.env, fixtureEnv);
const { GoogleGmailSupportMailbox, SUPPORT_GMAIL_SCOPE } = require(path.join(root, 'lib/support-gmail.ts'));
const { saveSupportGmailConnection } = require(path.join(root, 'lib/support-gmail-connection.ts'));
const { suggestSupportEmails, linkSupportEmail, existingEmailCase } = require(path.join(root, 'lib/support-email.ts'));
const { inboxAttachmentLabel } = require(path.join(root, 'lib/support-inbox-display.ts'));

// Reproduce a direct delivery and Google Group delivery with the same originating
// RFC Message-ID, different Gmail IDs/threads, and a group-added subject prefix.
// Include a legitimate follow-up and a separate identical-looking email.
function rawMessages() {
  const internalDate = String(Date.now() - 1000);
  const headers = [{ name: 'From', value: 'Requester <requester@example.test>' }, { name: 'To', value: 'support@example.test' }];
  const make = (id, threadId, subject, rfcId) => ({ id, threadId, internalDate, labelIds: ['INBOX'], snippet: 'Printer problem.', payload: {
    mimeType: 'multipart/mixed', headers: [...headers, { name: 'Subject', value: subject }, { name: 'Message-ID', value: rfcId }],
    parts: [
      { mimeType: 'multipart/alternative', parts: [
        { mimeType: 'text/plain', body: { data: Buffer.from('Printer problem.').toString('base64url') } },
        { mimeType: 'text/html', body: { data: Buffer.from('<p>Printer problem.</p>').toString('base64url') } },
      ] },
      ...['printer-log.txt', 'error-log.txt'].map((filename, index) => ({ partId: String(index + 1), mimeType: 'text/plain', filename, headers: [{ name: 'Content-Disposition', value: 'attachment' }, { name: 'Subject', value: 'Nested subject must not replace message subject' }], body: { attachmentId: `file-${index}`, size: 100 } })),
    ],
  } });
  const group = make('group-copy', 'group-thread', '[tech-support]', '<original@example.test>');
  group.payload.headers.push({ name: 'List-ID', value: '<techsupport.example.test>' });
  return [group, make('direct-copy', 'direct-thread', '', '<original@example.test>'), make('follow-up', 'group-thread', 'Re: [tech-support]', '<reply@example.test>'), make('separate-email', 'separate-thread', '[tech-support]', '<separate@example.test>')];
}

async function withMessages(run) {
  const env = productionEnv();
  const prior = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  try {
    await saveSupportGmailConnection('support@example.test', 'unit-refresh', {id:5, role:'SUPPORT', active:true});
    const raw = rawMessages(), calls = [];
    const mailbox = new GoogleGmailSupportMailbox(async (url, init = {}) => {
      const value = String(url); calls.push({ url: value, method: init.method ?? 'GET' });
      let data;
      if (value.endsWith('/token')) data = { access_token: 'unit-access', scope: SUPPORT_GMAIL_SCOPE };
      else if (value.endsWith('/profile')) data = { emailAddress: 'support@example.test' };
      else if (value.includes('/messages?')) data = { messages: raw.map(({ id, threadId }) => ({ id, threadId })) };
      else {
        const id = new URL(value).pathname.split('/').at(-1);
        data = raw.find(message => message.id === id);
        assert.ok(data, 'only listed individual messages may be fetched');
      }
      return new Response(JSON.stringify(data));
    });
    await run(await mailbox.recent(), calls, mailbox);
  } finally {
    for (const [key, value] of Object.entries(prior)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}

function caseDatabase() {
  const stored = [];
  const cases = [9, 10].map(id => ({ id, caseNumber: `BXS-2026-${String(id).padStart(6, '0')}`, subject: 'Printer issue', status: 'OPEN', accountId: null }));
  const db = {
    supportCaseEmail: {
      findMany: async ({ where }) => stored.filter(row => where.OR ? where.OR.some(filter => filter.gmailMessageId === row.gmailMessageId || filter.gmailThreadId === row.gmailThreadId) : typeof where.gmailThreadId === 'string' ? row.gmailThreadId === where.gmailThreadId : where.gmailThreadId.in.includes(row.gmailThreadId)).map(row => ({ ...row, supportCase: cases.find(item => item.id === row.supportCaseId) })),
      findUnique: async ({ where }) => stored.find(row => row.gmailMessageId === where.gmailMessageId) ?? null,
      create: async ({ data }) => { stored.push(data); return data; },
    },
    contact: { findMany: async () => [] },
    supportCase: { findMany: async () => [], findFirst: async ({ where }) => cases.find(item => item.id === where.id) ?? null },
    supportInboxDismissal: { deleteMany: async () => ({ count: 0 }) },
    $executeRaw: async () => 1,
  };
  db.$transaction = async run => run(db);
  return { db, stored };
}

test('routed copies keep distinct Gmail IDs despite a shared RFC Message-ID, time, body and files', async () => {
  await withMessages(async (messages, calls, mailbox) => {
    assert.equal(messages.length, 4);
    assert.equal(new Set(messages.map(message => message.id)).size, 4);
    const group = messages.find(message => message.id === 'group-copy');
    const direct = messages.find(message => message.id === 'direct-copy');
    assert.equal(group.messageDate.getTime(), direct.messageDate.getTime());
    assert.equal(group.bodyText, direct.bodyText);
    assert.equal(group.subject, '[tech-support]');
    assert.equal(direct.subject, '(no subject)');
    assert.notEqual(group.threadId, direct.threadId);
    assert.equal(inboxAttachmentLabel(group), null);
    assert.equal(inboxAttachmentLabel(direct), null);
    assert.equal(messages.filter(message => message.threadId === 'group-thread').length, 2);
    assert.equal(calls.filter(call => call.url.includes('?format=metadata')).length, 4);
    assert.ok(calls.every(call => !call.url.includes('/threads')));
    assert.equal(calls[0].method, 'POST');
    assert.ok(calls.slice(1).every(call => call.method === 'GET'));
    for (const message of messages) { const full = await mailbox.get(message.id); assert.equal(full.id, message.id); assert.equal(full.threadId, message.threadId); assert.equal(full.bodyText, 'Printer problem.'); assert.equal(inboxAttachmentLabel(full), '2 attachments'); }
  });
});

test('Case handling and repeat linking use exact Gmail message IDs; a thread match is only a suggestion', async () => {
  await withMessages(async messages => {
    const { db, stored } = caseDatabase();
    const actor = { id: 5, role: 'SUPPORT', active: true };
    const group = messages.find(message => message.id === 'group-copy');
    const direct = messages.find(message => message.id === 'direct-copy');
    const followUp = messages.find(message => message.id === 'follow-up');
    assert.deepEqual(await linkSupportEmail(db, actor, group, 9), { duplicate: false });
    assert.deepEqual(await linkSupportEmail(db, actor, group, 9), { duplicate: true });
    let rows = await suggestSupportEmails(db, messages);
    assert.equal(rows.find(row => row.message.id === group.id).suggestion.alreadyLinkedCaseId, 9);
    assert.equal(rows.find(row => row.message.id === direct.id).suggestion.alreadyLinkedCaseId, null);
    assert.equal(rows.find(row => row.message.id === direct.id).suggestion.linkedThreadCaseId, null);
    assert.equal(rows.find(row => row.message.id === followUp.id).suggestion.alreadyLinkedCaseId, null);
    assert.equal(rows.find(row => row.message.id === followUp.id).suggestion.linkedThreadCaseId, 9);
    assert.equal(await existingEmailCase(db, direct), null);
    assert.equal(await existingEmailCase(db, followUp), 9);
    await linkSupportEmail(db, actor, direct, 10);
    await linkSupportEmail(db, actor, followUp, 9);
    assert.deepEqual(stored.map(row => [row.gmailMessageId, row.gmailThreadId, row.supportCaseId]), [['group-copy', 'group-thread', 9], ['direct-copy', 'direct-thread', 10], ['follow-up', 'group-thread', 9]]);
    rows = await suggestSupportEmails(db, messages);
    assert.equal(rows.find(row => row.message.id === group.id).suggestion.alreadyLinkedCaseId, 9);
    assert.equal(rows.find(row => row.message.id === direct.id).suggestion.alreadyLinkedCaseId, 10);
    assert.equal(rows.find(row => row.message.id === followUp.id).suggestion.alreadyLinkedCaseId, 9);
    assert.equal(rows.find(row => row.message.id === 'separate-email').suggestion.alreadyLinkedCaseId, null);
    await assert.rejects(linkSupportEmail(db, actor, group, 10), /already linked to another Support Case/);
  });
});

test('a recent reply surfaces an older thread without importing dormant messages or discarding quoted history', async () => {
  const env = productionEnv();
  const prior = Object.fromEntries(Object.keys(env).map(key => [key,process.env[key]]));
  Object.assign(process.env,env);
  try {
    await saveSupportGmailConnection('support@example.test','synthetic-refresh',{id:5,role:'SUPPORT',active:true});
    const quoted = 'New problem.\n> Original request from three months ago.';
    const rows = [
      {id:'recent-reply',threadId:'old-thread',internalDate:String(Date.now()-1000)},
      {id:'dormant',threadId:'dormant-thread',internalDate:String(Date.now()-90*86400000)},
    ];
    const adapter = new GoogleGmailSupportMailbox(async (url,init={}) => {
      const value=String(url);
      if(value.endsWith('/token'))return new Response(JSON.stringify({access_token:'synthetic',scope:SUPPORT_GMAIL_SCOPE}));
      assert.equal(init.method ?? 'GET','GET');
      if(value.endsWith('/profile'))return new Response(JSON.stringify({emailAddress:'support@example.test'}));
      if(value.includes('/messages?')) {
        const query=new URL(value).searchParams.get('q');
        const after=Number(query.match(/after:(\d+)/)[1]);
        assert.ok(Math.abs(after-Math.floor((Date.now()-30*86400000)/1000))<5);
        return new Response(JSON.stringify({messages:rows.map(({id})=>({id}))}));
      }
      assert.ok(!value.includes('/threads'));
      const id=new URL(value).pathname.split('/').at(-1);
      const row=rows.find(row=>row.id===id);
      assert.ok(row);
      return new Response(JSON.stringify({...row,payload:{mimeType:'text/plain',body:{data:Buffer.from(quoted).toString('base64url')},headers:[{name:'From',value:'customer@example.test'},{name:'Subject',value:'Re: Original request'}]}}));
    });
    const messages=await adapter.recent();
    assert.deepEqual(messages.map(row=>[row.id,row.threadId]),[['recent-reply','old-thread']]);
    assert.equal(messages[0].bodyText,'');
    assert.equal((await adapter.get('recent-reply')).bodyText,quoted);
  } finally {for(const[key,value]of Object.entries(prior))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
