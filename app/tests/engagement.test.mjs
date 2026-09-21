import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(fileURLToPath(import.meta.url));
const { parseActivity, saveActivity } = require(path.join(root, 'lib/work.ts'));
const { engagementAccountWhere, engagementState, hasNoActivityInDays, latestAccountActivityOrder, lookbackStart, repAccountSummary, reportAccountScope, taskRollup } = require(path.join(root, 'lib/engagement.ts'));
const { routeAccess } = require(path.join(root, 'lib/authorization.ts'));
const form = entries => { const value = new FormData(); for (const [key, item] of entries) value.append(key, item); return value; };
const fields = [['subject','Meeting'],['type','MEETING'],['accountId','1'],['activityDate','2026-09-16T14:30'],['direction','OUTBOUND'],['contactIds','2'],['nextStep','Send proposal'],['followUpDate','2026-09-20']];
test('Activity validates date, direction, contacts, and follow-up fields', () => {
  const valid = parseActivity(form(fields));
  assert.deepEqual(valid.errors, {});
  assert.equal(valid.value.activityDate.toISOString(), '2026-09-16T14:30:00.000Z');
  assert.equal(valid.value.direction, 'OUTBOUND');
  assert.deepEqual(valid.value.contactIds, [2]);
  assert.equal(valid.value.nextStep, 'Send proposal');
  assert.equal(valid.value.followUpDate.toISOString().slice(0,10), '2026-09-20');
  assert.match(parseActivity(form(fields.map(([k,v])=>[k,k==='direction'?'SIDEWAYS':v]))).errors.direction, /direction/);
  assert.match(parseActivity(form(fields.map(([k,v])=>[k,k==='activityDate'?'2026-02-30T14:30':v]))).errors.activityDate, /date/);
  assert.match(parseActivity(form([...fields, ['contactIds','bad']])).errors.contactIds, /valid/);
  assert.match(parseActivity(form(fields.filter(([k])=>k!=='accountId'))).errors.accountId, /Account/);
});
test('Activity contact links append once, reject wrong Account, and retain inactive history', async () => {
  let row={id:4,type:'MEETING',accountId:1,opportunityId:null,projectId:null,archivedAt:null}, links=[{contactId:2}], contacts=[{id:2,accountId:1,active:false},{id:3,accountId:1,active:true}];
  const tx={account:{findFirst:async()=>({id:1})},activity:{findFirst:async()=>row,update:async({data})=>(row={...row,...data})},activityType:{findFirst:async()=>({code:'MEETING'})},contact:{findMany:async({where})=>contacts.filter(c=>where.id.in.includes(c.id))},activityContact:{findMany:async()=>links,createMany:async({data})=>{if(!links.some(l=>l.contactId===data[0].contactId))links.push({contactId:data[0].contactId});}}};
  const client={$transaction:fn=>fn(tx)};
  const value=parseActivity(form([...fields,['contactIds','3']])).value;
  await saveActivity(client,value,4);
  assert.deepEqual(links.map(l=>l.contactId),[2,3]);
  contacts=[{id:2,accountId:1,active:false}];
  await assert.rejects(saveActivity(client,{...value,contactIds:[9]},4),/Account/);
  await assert.rejects(saveActivity(client,{...value,contactIds:[2,3]},4),/Account/);
  assert.deepEqual(links.map(l=>l.contactId),[2,3]);
});
test('Activity links unassigned Contacts only with an explicit valid Account', async () => {
  let row = null;
  const links = [];
  const contact = { id: 5, accountId: null, active: true };
  const tx = {
    account: { findFirst: async ({ where }) => where.id === 1 ? { id: 1 } : null },
    activityType: { findFirst: async () => ({ code: 'MEETING' }) },
    contact: { findMany: async () => [contact] },
    activityContact: { createMany: async ({ data }) => links.push(data[0]) },
    activity: { create: async ({ data }) => (row = { id: 12, ...data }) },
  };
  const client = { $transaction: fn => fn(tx) };
  const value = parseActivity(form([...fields.filter(([key]) => key !== 'contactIds'), ['contactIds', '5']])).value;
  assert.equal((await saveActivity(client, value)).accountId, 1);
  assert.deepEqual(links, [{ activityId: 12, contactId: 5 }]);
  await assert.rejects(saveActivity(client, { ...value, accountId: 99 }), /Account not found/);
  contact.accountId = 2;
  await assert.rejects(saveActivity(client, value), /Contact is not associated/);
  assert.equal(row.accountId, 1);
});
test('stale and no-activity states use configured thresholds', () => {
  const now=new Date('2026-09-17T12:00:00Z'), last=new Date('2026-08-18T12:00:00Z');
  assert.equal(engagementState(null,90,now),'No activity ever');
  assert.equal(engagementState(last,90,now),'Active / recent');
  assert.equal(engagementState(last,30,now),'Stale');
  assert.equal(hasNoActivityInDays(null,30,now),true);
  assert.equal(hasNoActivityInDays(last,30,now),true);
  assert.equal(hasNoActivityInDays(last,31,now),false);
});
test('rep summary and activity lookback respond to settings', () => {
  const now=new Date('2026-09-17T12:00:00Z');
  const accounts=[{activities:[]},{activities:[{activityDate:new Date('2026-08-18T12:00:00Z')}]}];
  assert.deepEqual(repAccountSummary(accounts,90,now),{owned:2,withoutRecentActivity:1});
  assert.deepEqual(repAccountSummary(accounts,30,now),{owned:2,withoutRecentActivity:2});
  const activities=[new Date('2026-09-01T12:00:00Z'),new Date('2026-08-01T12:00:00Z')];
  assert.equal(activities.filter(x=>x>=lookbackStart(30,now)).length,1);
  assert.equal(activities.filter(x=>x>=lookbackStart(60,now)).length,2);
});
test('report scope and task rollup enforce role and open overdue logic', () => {
  const actor=role=>({id:7,role,active:true});
  assert.deepEqual(reportAccountScope(actor('SALES')),{ownerId:7});
  assert.deepEqual(reportAccountScope(actor('SALES_MANAGER')),{});
  assert.deepEqual(reportAccountScope(actor('ADMIN')),{});
  assert.deepEqual(engagementAccountWhere(actor('SALES')),{ownerId:7,archivedAt:null,status:'ACTIVE'});
  assert.deepEqual(latestAccountActivityOrder(),[{activityDate:'desc'},{id:'desc'}]);
  assert.throws(()=>reportAccountScope(actor('MARKETING_MANAGER')));
  for (const role of ['ADMIN','SALES_MANAGER','SALES']) assert.equal(routeAccess('/reports/engagement',actor(role)),'allowed');
  for (const role of ['MARKETING_MANAGER','READ_ONLY']) assert.equal(routeAccess('/reports/engagement',actor(role)),'denied');
  const rollup=taskRollup([{status:'OPEN',dueDate:new Date('2026-09-15'),archivedAt:null},{status:'IN_PROGRESS',dueDate:null,archivedAt:null},{status:'COMPLETED',dueDate:new Date('2026-09-15'),archivedAt:null},{status:'OPEN',dueDate:new Date('2026-09-15'),archivedAt:new Date()}],new Date('2026-09-16'));
  assert.deepEqual(rollup,{open:2,overdue:1});
});
