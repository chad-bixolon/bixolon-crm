import { fixtureEnv, productionEnv, installConnectionDb } from './support-gmail-test-helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const fileType = await import('file-type');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const originalLoad = Module._load;
Module._load = function(request, parent, main) { return request === 'file-type' ? fileType : originalLoad.call(this, request, parent, main); };
const require = Module.createRequire(import.meta.url);
installConnectionDb();
Object.assign(process.env, fixtureEnv);
const discovery = require(path.join(root, 'lib/support-gmail-files.ts'));
const gmail = require(path.join(root, 'lib/support-gmail.ts'));
const source = require(path.join(root, 'lib/support-email-source.ts'));
const service = require(path.join(root, 'lib/support-email-file-import.ts'));
const validation = require(path.join(root, 'lib/support-attachment-validation.ts'));
Module._load = originalLoad;
Object.assign(process.env, { NODE_ENV: 'test', SUPPORT_GMAIL_ENABLED: 'true', SUPPORT_GMAIL_MOCK: 'true', E2E_AUTH_ENABLED: 'true', SUPPORT_GMAIL_MAILBOX: 'support@bixolonusa.com', AUTH_SECRET: 'unit-email-files' });
const actor = { id: 2, role: 'SUPPORT', active: true, archivedAt: null };
const mailbox = new gmail.MockGmailSupportMailbox();
const message = (await mailbox.recent()).find(row => row.subject === 'POC intake files request');
const token = source.signEmailSource(actor, message);
const options = service.emailFileOptions(actor, token, [message]);
const option = name => options.find(row => row.name === name).token;

const part = (id, filename, mimeType, size, headers = []) => ({ partId: id, filename, mimeType, body: { attachmentId: `attachment-${id}`, size }, headers });
test('MIME discovery distinguishes explicit attachments, meaningful inline photos and uncertain/decorative assets', () => {
  const files = discovery.discoverGmailFiles({ mimeType: 'multipart/mixed', parts: [
    part('1','log.txt','text/plain',42,[{name:'Content-Disposition',value:'attachment'}]),
    part('2','printer-photo.jpg','image/jpeg',50000,[{name:'Content-ID',value:'<photo>'}]),
    part('3','signature-logo.png','image/png',50000,[{name:'Content-ID',value:'<logo>'}]),
    part('4','pixel.png','image/png',80,[{name:'Content-Disposition',value:'inline'}]),
    part('5','image001.png','image/png',50000,[{name:'Content-Disposition',value:'inline'}]),
    part('6','unsafe.svg','image/svg+xml',50000,[{name:'Content-Disposition',value:'attachment'}]),
    part('7','huge.log','text/plain',26*1024*1024),
    {mimeType:'text/plain',body:{data:Buffer.from('Body only').toString('base64url'),size:9}},
  ] });
  assert.equal(files.length,7);
  assert.equal(files[0].kind,'attachment'); assert.equal(files[0].hiddenReason,null);
  assert.equal(files[1].kind,'inline'); assert.equal(files[1].hiddenReason,null);
  assert.ok(files[2].hiddenReason); assert.ok(files[3].hiddenReason); assert.ok(files[4].hiddenReason);
  assert.match(files[5].unavailableReason,/not supported/); assert.match(files[6].unavailableReason,/too large/);
});
test('inline dimensions hide small assets and can identify a large generic screenshot', () => {
  const html='<img src="cid:large" width="640" height="480"><img src="cid:small" width="1" height="1">';
  const files=discovery.discoverGmailFiles({parts:[{mimeType:'text/html',body:{data:Buffer.from(html).toString('base64url')}},part('1','image001.png','image/png',9000,[{name:'Content-ID',value:'<large>'}]),part('2','printer-photo.png','image/png',9000,[{name:'Content-ID',value:'<small>'}])]});
  assert.equal(files[0].hiddenReason,null);assert.ok(files[1].hiddenReason);
});
test('file grants require explicit selection and reject tamper, cross-user, unrelated source and unsupported types', () => {
  assert.deepEqual(service.selectedEmailFiles(actor,token,[]),[]);
  assert.equal(service.selectedEmailFiles(actor,token,[option('error-log.txt'),option('error-log.txt')]).length,1);
  assert.throws(()=>service.selectedEmailFiles(actor,token,[option('error-log.txt')+'forged']),/Invalid email file/);
  assert.throws(()=>service.selectedEmailFiles({...actor,id:3},token,[option('error-log.txt')]),/Invalid or expired/);
  assert.throws(()=>service.selectedEmailFiles({...actor,role:'READ_ONLY'},token,[option('error-log.txt')]),/Access denied/);
  const another=source.signEmailSource(actor,{...message,id:'other'});
  assert.throws(()=>service.selectedEmailFiles(actor,another,[option('error-log.txt')]),/Invalid email file/);
  assert.equal(options.find(row=>row.name==='program.exe').token,'');
  assert.equal(options.find(row=>row.name==='huge.log').token,'');
});
function fixture() {
  let rows=[],events=[],objects=new Map(),sequence=0;
  let tail=Promise.resolve();
  const tx={ $executeRaw:async strings=>{assert.match(strings.join(''),/advisory_xact_lock/);return 1;},supportCase:{findFirst:async()=>({id:11,status:'OPEN',archivedAt:null})},supportCaseAttachment:{findFirst:async({where})=>rows.find(row=>Object.entries(where).every(([key,value])=>row[key]===value))??null,create:async({data})=>{const row={id:++sequence,...data,deletedAt:null};rows.push(row);return row;},findMany:async()=>rows},supportCaseEmail:{findFirst:async()=>({id:1}),findMany:async()=>[{gmailMessageId:message.id,gmailThreadId:message.threadId}]},supportCaseLifecycleEvent:{create:async({data})=>events.push(data),findMany:async()=>events}};
  const attempts=[];
  const db={...tx,scheduledJobRun:{create:async({data})=>{const row={id:attempts.length+1,...data};attempts.push(row);return row;},update:async({where,data})=>Object.assign(attempts.find(r=>r.id===where.id),data)},$transaction(run){const job=tail.then(()=>run(tx));tail=job.catch(()=>{});return job;}};
  const storage={createSupportKey:()=>`e2e/support-cases/test-${sequence+1}`,createKey:()=>'',uploadDocumentObject:async({storageKey,body})=>objects.set(storageKey,body),deleteDocumentObject:async key=>objects.delete(key),createSignedDocumentUrl:async()=>''};
  return {db,storage,rows,events,objects};
}
test('only selected files are validated and stored with source metadata; repeats and concurrent imports do not duplicate', async()=>{
  const f=fixture();
  const selected=[option('error-log.txt')];
  const results=await Promise.all([service.importSelectedEmailFiles(f.db,f.storage,actor,11,token,selected,mailbox),service.importSelectedEmailFiles(f.db,f.storage,actor,11,token,selected,mailbox)]);
  assert.equal(results.reduce((n,row)=>n+row.imported,0),1);assert.equal(f.rows.length,1);assert.equal(f.objects.size,1);
  assert.equal(f.rows[0].sourceGmailMessageId,message.id);assert.equal(f.rows[0].sourceGmailThreadId,message.threadId);assert.equal(f.rows[0].sourceGmailPartId,'log');
  assert.equal(f.rows[0].originalFileName,'error-log.txt');assert.ok(!f.rows.some(row=>row.sourceGmailPartId==='photo'));
  f.rows[0].deletedAt=new Date();
  assert.equal((await service.importSelectedEmailFiles(f.db,f.storage,actor,11,token,selected,mailbox)).duplicate,1);
});
test('a failed optional file preserves successful files and records recoverable filename state; retry reconciles',async()=>{
  const f=fixture();let fail=true;
  const flaky={attachment:async(id,partId)=>{if(partId==='photo'&&fail)throw new Error('Support Gmail read failed.');return mailbox.attachment(id,partId);}};
  const selected=[option('error-log.txt'),option('printer-photo.png')];
  const result=await service.importSelectedEmailFiles(f.db,f.storage,actor,11,token,selected,flaky);
  assert.equal(result.imported,1);assert.equal(result.failures[0].name,'printer-photo.png');assert.equal(f.rows.length,1);
  await service.recordEmailFileImport(f.db,actor,11,result);
  assert.equal((await service.emailFileRecovery(f.db,11)).length,1);
  fail=false;
  const retry=await service.importSelectedEmailFiles(f.db,f.storage,actor,11,token,selected,flaky);
  assert.equal(retry.imported,1);assert.equal(retry.duplicate,1);assert.equal(f.rows.length,2);assert.equal((await service.emailFileRecovery(f.db,11)).length,0);
});
test('storage/metadata failure compensates objects without touching the linked Case',async()=>{
  const f=fixture();f.db.supportCaseAttachment.create=async()=>{throw new Error('Database failed');};
  const result=await service.importSelectedEmailFiles(f.db,f.storage,actor,11,token,[option('error-log.txt')],mailbox);
  assert.equal(result.failures.length,1);assert.equal(f.objects.size,0);
});
test('file bytes reuse existing type/size policy and source metadata changes are rejected',async()=>{
  await assert.rejects(validation.validateSupportAttachment({name:'photo.png',type:'image/png',size:4,arrayBuffer:async()=>new TextEncoder().encode('HTML').buffer}),/not supported/);
  assert.throws(()=>discovery.decodeGmailFile('!',4),/incomplete/);
  assert.throws(()=>discovery.decodeGmailFile(Buffer.from('data').toString('base64url'),5),/incomplete/);
  const f=fixture();const forged={attachment:async()=>({message:{...message,threadId:'other'},file:message.files[0],body:new Uint8Array()})};
  assert.equal((await service.importSelectedEmailFiles(f.db,f.storage,actor,11,token,[option('error-log.txt')],forged)).failures.length,1);assert.equal(f.rows.length,0);
  f.db.supportCaseEmail.findFirst=async()=>null;
  await assert.rejects(service.importSelectedEmailFiles(f.db,f.storage,actor,11,token,[option('error-log.txt')],mailbox),/not linked/);
});

test('Google adapter discovers parts, keeps Description text-only and only GETs selected attachment bytes',async()=>{
  const connection=require(path.join(root,'lib/support-gmail-connection.ts'));
  const env=productionEnv('support@bixolonusa.com');
  const prior=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));
  Object.assign(process.env,env);
  const bytes=Buffer.from('ATTACHMENT CONTENT NOT BODY');
  const raw={id:'unit-message',threadId:'unit-thread',internalDate:String(Date.now()),payload:{mimeType:'multipart/mixed',headers:[{name:'From',value:'Customer <customer@example.test>'},{name:'Subject',value:'Printer diagnosis'}],parts:[{partId:'1',filename:'log.txt',mimeType:'text/plain',headers:[{name:'Content-Disposition',value:'attachment'}],body:{size:bytes.length,attachmentId:'unit-attachment'}},{partId:'2',mimeType:'text/plain',body:{size:16,data:Buffer.from('Real body only.').toString('base64url')}},{partId:'3',filename:'printer-photo.png',mimeType:'image/png',headers:[{name:'Content-ID',value:'<photo>'}],body:{size:message.files[1].size,data:Buffer.from((await mailbox.attachment(message.id,'photo')).body).toString('base64url')}}]}};
  const calls=[];
  const fetcher=async(url,init={})=>{const value=String(url);calls.push({url:value,method:init.method??'GET'});let data;if(value.includes('/token'))data={access_token:'unit-token',scope:gmail.SUPPORT_GMAIL_SCOPE};else if(value.endsWith('/profile'))data={emailAddress:'support@bixolonusa.com'};else if(value.includes('/attachments/'))data={size:bytes.length,data:bytes.toString('base64url')};else if(value.includes('/messages?'))data={messages:[{id:raw.id}]};else data=raw;return new Response(JSON.stringify(data));};
  try{
    await connection.saveSupportGmailConnection('support@bixolonusa.com','unit-refresh',actor);
    const adapter=new gmail.GoogleGmailSupportMailbox(fetcher);
    const [summary]=await adapter.recent();
    assert.equal(summary.bodyText,'');assert.equal(summary.files,undefined);
    const normalized=await adapter.get(summary.id);
    assert.equal(normalized.files.length,2);assert.equal(normalized.bodyText,'Real body only.');
    const description=source.emailCasePrefill(normalized,normalized,null,null).description;
    assert.doesNotMatch(description,/ATTACHMENT CONTENT|base64|Content-Disposition|iVBORw/);
    assert.equal(calls.filter(row=>row.url.includes('/attachments/')).length,0);
    assert.equal(Buffer.from((await adapter.attachment(raw.id,'1')).body).toString(),bytes.toString());
    const count=calls.filter(row=>row.url.includes('/attachments/')).length;
    await assert.rejects(adapter.attachment(raw.id,'forged'),/no longer available/);
    assert.equal(calls.filter(row=>row.url.includes('/attachments/')).length,count);
    for(const call of calls.filter(row=>row.url.includes('gmail.googleapis.com'))) {assert.equal(call.method,'GET');assert.match(call.url,/\/users\/me\/(profile|messages)/);assert.doesNotMatch(new URL(call.url).pathname,/\/(send|drafts|modify|trash|labels)(?:\/|$)/);}
    assert.equal(gmail.SUPPORT_GMAIL_SCOPE,'https://www.googleapis.com/auth/gmail.readonly');
  }finally{for(const[key,value]of Object.entries(prior))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});


test('ambiguous transaction acknowledgement never deletes an object with committed metadata', async()=>{
  const f=fixture();const transaction=f.db.$transaction;f.db.$transaction=async(run)=>{await transaction(run);throw new Error('Commit acknowledgement lost');};
  const result=await service.importSelectedEmailFiles(f.db,f.storage,actor,11,token,[option('error-log.txt')],mailbox);
  assert.equal(result.imported,1);assert.equal(f.rows.length,1);assert.equal(f.objects.size,1);
});

function reviewFixture(messages, { imported = [], failures = [] } = {}) {
  const links = messages.map((row, index) => ({ id: index + 1, gmailMessageId: row.id, gmailThreadId: row.threadId, messageDate: row.messageDate, supportCaseId: 11 }));
  const calls = [];
  function select(rows, query) {
    calls.push(query);
    assert.ok(query.take > 0, 'metadata queries must have an explicit bound');
    let result = rows.filter(row => Object.entries(query.where).every(([key, value]) => {
      if (key === 'OR') return value.some(filter => Object.entries(filter).every(([field, expected]) => row[field] === expected));
      if (value && typeof value === 'object') return value.in ? value.in.includes(row[key]) : value.not === null ? row[key] != null : true;
      return row[key] === value;
    }));
    if (query.orderBy) for (const order of [...(Array.isArray(query.orderBy) ? query.orderBy : [query.orderBy])].reverse()) {
      const [key, direction] = Object.entries(order)[0];
      result.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (direction === 'desc' ? -1 : 1));
    }
    if (query.distinct) result = [...new Map(result.map(row => [query.distinct.map(key => row[key]).join(':'), row])).values()];
    if (query.cursor) result = result.slice(result.findIndex(row => row.id === query.cursor.id) + query.skip);
    return result.slice(0, query.take);
  }
  const db = {
    supportCase: { findFirst: async () => ({ id: 11, status: 'OPEN', archivedAt: null }) },
    supportCaseEmail: { findMany: async query => select(links, query), findFirst: async ({ where }) => links.find(row => row.id === where.id && row.supportCaseId === where.supportCaseId) ?? null },
    supportCaseAttachment: { findMany: async query => select(imported.map((row, index) => ({ id: index + 1, supportCaseId: 11, sourceMailbox: process.env.SUPPORT_GMAIL_MAILBOX, deletedAt: null, ...row })), query) },
    supportCaseLifecycleEvent: { findMany: async query => { calls.push(query); assert.equal(query.take, 50); return failures.length ? [{ newValue: JSON.stringify({ failures }) }] : []; } },
  };
  const reads = [];
  return { db, links, calls, reads, mailbox: { get: async id => { reads.push(id); return messages.find(row => row.id === id) ?? null; }, recent: async () => [] } };
}
const reviewMessage = (index, files = [{ ...message.files[0], fileName: `diagnostic-${index}.txt` }]) => ({ ...message, id: `review-${index}`, threadId: 'review-thread', messageDate: new Date(Date.UTC(2026, 0, index + 1)), files });

test('review prioritizes old failed imports and newest unimported files beyond 50 links, with bounded paging', async () => {
  const messages = Array.from({ length: 61 }, (_, index) => reviewMessage(index));
  const imported = messages.slice(1, 60).map(row => ({ sourceGmailMessageId: row.id, sourceGmailThreadId: row.threadId, sourceGmailPartId: row.files[0].partId }));
  const failures = [{ threadId: messages[0].threadId, messageId: messages[0].id, partId: messages[0].files[0].partId, name: 'diagnostic-0.txt', reason: 'Please retry.' }];
  const f = reviewFixture(messages, { imported, failures });
  const review = await service.caseEmailFileContext(f.db, actor, 11, undefined, f.mailbox);
  const files = review.groups.flatMap(group => group.options);
  assert.deepEqual(files.slice(0, 2).map(row => row.name), ['diagnostic-0.txt', 'diagnostic-60.txt']);
  assert.ok(files.slice(2).every(row => row.alreadyImported));
  assert.equal(review.nextCursor, 12);
  assert.ok(f.reads.length <= 200);
  const older = await service.caseEmailFileContext(f.db, actor, 11, review.nextCursor, f.mailbox);
  assert.equal(older.nextCursor, null);
  assert.ok(older.groups.flatMap(group => group.options).some(row => row.name === 'diagnostic-0.txt'));
  await assert.rejects(service.caseEmailFileContext(f.db, actor, 11, 999, f.mailbox), /Invalid email attachment page/);
});

test('completed files do not consume the 200-option cap before newer actionable files', async () => {
  const completed = reviewMessage(0, Array.from({ length: 200 }, (_, index) => ({ ...message.files[0], partId: `part-${index}`, fileName: `completed-${index}.txt` })));
  const newest = reviewMessage(1);
  const imported = completed.files.map(file => ({ sourceGmailMessageId: completed.id, sourceGmailThreadId: completed.threadId, sourceGmailPartId: file.partId }));
  const f = reviewFixture([completed, newest], { imported });
  const review = await service.caseEmailFileContext(f.db, actor, 11, undefined, f.mailbox);
  assert.equal(review.groups[0].options.length, 200);
  assert.equal(review.groups[0].options[0].name, 'diagnostic-1.txt');
  assert.equal(review.groups[0].options[0].alreadyImported, undefined);
});

test('more than 50 failed reply sources remain reachable through bounded retry pages', async () => {
  const origin = reviewMessage(100);
  const replies = Array.from({ length: 51 }, (_, index) => reviewMessage(index));
  const failures = replies.map(row => ({ threadId: row.threadId, messageId: row.id, partId: row.files[0].partId, name: row.files[0].fileName, reason: 'Please retry.' }));
  const f = reviewFixture([origin]);
  // Two events stay within the existing 50-selections-per-import contract.
  f.db.supportCaseLifecycleEvent.findMany = async () => [{ newValue: JSON.stringify({ failures: failures.slice(0, 50) }) }, { newValue: JSON.stringify({ failures: failures.slice(50) }) }];
  f.mailbox.get = async id => [origin, ...replies].find(row => row.id === id) ?? null;
  const first = await service.caseEmailFileContext(f.db, actor, 11, undefined, f.mailbox);
  assert.equal(first.nextRetryPage, 1);
  const second = await service.caseEmailFileContext(f.db, actor, 11, undefined, f.mailbox, first.nextRetryPage);
  assert.equal(second.nextRetryPage, null);
  assert.equal(second.groups[0].options[0].name, 'diagnostic-50.txt');
  await assert.rejects(service.caseEmailFileContext(f.db, actor, 11, undefined, f.mailbox, 50), /Invalid email attachment retry page/);
});

test('missing origin uses surviving retained reply and preserves exact attachment provenance', async () => {
  const origin = reviewMessage(0), reply = reviewMessage(1, message.files.slice(0, 2));
  const f = reviewFixture([origin], { imported: [{ sourceGmailMessageId: reply.id, sourceGmailThreadId: reply.threadId, sourceGmailPartId: reply.files[0].partId }] });
  f.mailbox.get = async id => id === reply.id ? reply : null;
  const review = await service.caseEmailFileContext(f.db, actor, 11, undefined, f.mailbox);
  assert.equal(review.groups.length, 1);
  assert.equal(review.unavailable[0].messageId, origin.id);
  const group = review.groups[0];
  assert.equal(source.validateEmailSource(actor, group.token).messageId, reply.id);
  assert.equal(group.options[0].name, reply.files[1].fileName);
  const grant = service.selectedEmailFiles(actor, group.token, [group.options[0].token])[0];
  assert.equal(grant.messageId, reply.id);
  assert.equal(grant.threadId, reply.threadId);
  assert.equal(grant.file.partId, reply.files[1].partId);
});

test('missing origin can recover recent same-thread context while unrelated replies stay excluded', async () => {
  const origin = reviewMessage(0), reply = reviewMessage(1);
  const f = reviewFixture([origin]);
  f.mailbox.get = async id => id === reply.id ? reply : null;
  f.mailbox.recent = async () => [reply, { ...reply, id: 'unrelated', threadId: 'unrelated-thread' }];
  const review = await service.caseEmailFileContext(f.db, actor, 11, undefined, f.mailbox);
  assert.equal(review.groups.length, 1);
  assert.equal(review.groups[0].options.length, 1);
  assert.equal(source.validateEmailSource(actor, review.groups[0].token).messageId, reply.id);
  assert.match(review.unavailable[0].reason, /Source email is missing/);
});

test('unreadable origins and missing failed parts report retry states without blocking other messages', async () => {
  const first = reviewMessage(0), second = reviewMessage(1);
  const failure = { threadId: second.threadId, messageId: second.id, partId: 'gone', name: 'lost.txt', reason: 'Please retry.' };
  const f = reviewFixture([first, second], { failures: [failure] });
  f.mailbox.get = async id => { if (id === first.id) throw new Error('Provider failed'); return second; };
  f.mailbox.recent = async () => { throw new Error('Provider failed'); };
  const review = await service.caseEmailFileContext(f.db, actor, 11, undefined, f.mailbox);
  assert.equal(review.groups.length, 1);
  assert.equal(review.unavailable.length, 2);
  assert.ok(review.unavailable.some(row => /lost.txt.*no longer available/.test(row.reason)));
  assert.ok(review.unavailable.some(row => /Check the Gmail connection and retry/.test(row.reason)));
  f.mailbox.get = async () => null;
  const absent = await service.caseEmailFileContext(f.db, actor, 11, undefined, f.mailbox);
  assert.deepEqual(absent.groups, []);
  assert.ok(absent.unavailable.length > 0);
});
