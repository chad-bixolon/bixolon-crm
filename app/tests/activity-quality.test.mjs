import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compile = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, file);
Module._extensions['.ts'] = compile;
Module._extensions['.tsx'] = compile;
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...args) { return originalResolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...args); };
const require = Module.createRequire(import.meta.url);
const { parseActivity, saveActivity, activityErrorField } = require(path.join(root, 'lib/work.ts'));
const { activityAccountPrefill } = require(path.join(root, 'lib/activity-relations.ts'));
const { activityTypeHelp, defaultActivityType, validateActivityOccurrence } = require(path.join(root, 'lib/activity-quality.ts'));
const { ActivityContext } = require(path.join(root, 'components/activity-context.tsx'));
const { assertWorkPermission } = require(path.join(root, 'lib/support-work.ts'));
const { routeAccess } = require(path.join(root, 'lib/authorization.ts'));
const form = changes => { const result = new FormData(); for (const [key, value] of Object.entries({ subject: 'Discussed rollout', type: 'CALL', accountId: '1', userId: '7', activityDate: '2026-01-10T14:30', ...changes })) if (value !== null) result.append(key, value); return result; };
function fixture(existing = null) {
  const writes = [];
  const tx = {
    account: { findFirst: async () => ({ id: 1 }) },
    opportunity: { findFirst: async () => ({ id: 2 }) },
    opportunityAccount: { findUnique: async () => ({}) },
    project: { findFirst: async () => ({ id: 3 }), findUnique: async () => ({ primaryAccountId: 1, participants: [] }) },
    opportunityProject: { findUnique: async () => ({}) },
    supportCase: { findUnique: async () => ({ accountId: 1, status: 'OPEN', archivedAt: null }) },
    activityType: { findFirst: async () => ({}) },
    user: { findFirst: async () => ({ id: 7 }) },
    contact: { findMany: async () => [{ id: 5, accountId: 1, active: true, archivedAt: null }] },
    activityContact: { findMany: async () => existing ? [{ contactId: 5 }] : [], count: async () => existing ? 1 : 0, createMany: async () => ({}), deleteMany: async () => ({}) },
    activity: { findFirst: async () => existing, create: async ({ data }) => { writes.push(data); return { id: 42, ...data }; }, update: async ({ data }) => { writes.push(data); return { id: 42, ...data }; } },
  };
  return { tx, writes, client: { $transaction: async callback => callback(tx) } };
}

for (const type of ['CALL','MEETING','EMAIL','FOLLOW_UP','DEMO','SITE_VISIT','QUOTE_PROPOSAL','SAMPLE_EVALUATION','TECHNICAL_REVIEW','TRADE_SHOW','OTHER','CUSTOM']) {
  test(`${type} saves a completed interaction with a short summary and no irrelevant required fields`, async () => {
    const parsed = parseActivity(form({ type }));
    assert.deepEqual(parsed.errors, {});
    const db = fixture();
    const row = await saveActivity(db.client, parsed.value, undefined, 7);
    assert.equal(row.type, type); assert.equal(row.subject, 'Discussed rollout');
    assert.equal(row.userId, 7); assert.equal(row.activityDate.toISOString(), '2026-01-10T14:30:00.000Z');
    assert.equal(row.createdById, 7); assert.equal(row.outcome, null); assert.equal(row.followUpTaskCreated, false);
  });
}

test('type defaults and guidance distinguish completed work, planned Tasks and Calendar', () => {
  assert.equal(defaultActivityType([{ code: 'EMAIL' }, { code: 'CALL' }]), 'CALL');
  assert.equal(defaultActivityType([{ code: 'CUSTOM' }]), 'CUSTOM');
  assert.equal(defaultActivityType([{ code: 'EMAIL' }, { code: 'MEETING' }]), '');
  assert.equal(defaultActivityType([]), '');
  assert.match(activityTypeHelp('MEETING'), /Calendar Matches/);
  assert.match(activityTypeHelp('EMAIL'), /sent or received/);
  assert.match(activityTypeHelp('FOLLOW_UP'), /already happened.*Task/);
  assert.match(activityTypeHelp('CALL'), /short summary/);
});

for (const type of ['CALL', 'MEETING', 'EMAIL', 'FOLLOW_UP']) {
  test(`${type} rejects future completed work at the save boundary`, async () => {
    const db = fixture();
    const value = parseActivity(form({ type, activityDate: '2099-01-01T12:00' })).value;
    await assert.rejects(saveActivity(db.client, value), /Activities record completed work/);
    assert.equal(db.writes.length, 0);
  });
}

test('future historical dates and missing historical owners survive unrelated edits', async () => {
  const value = parseActivity(form({ userId: null, activityDate: '2099-01-01T12:00' })).value;
  const existing = { id: 42, ...value, activityDate: new Date('2099-01-01T12:00:32.123Z') };
  const db = fixture(existing);
  await saveActivity(db.client, value, 42, 7);
  assert.equal(db.writes.length, 1);
  assert.equal(db.writes[0].activityDate.toISOString(), '2099-01-01T12:00:32.123Z');
  assert.equal(validateActivityOccurrence(new Date('invalid')), 'Choose a valid activity date and time.');
  assert.equal(activityErrorField('Activities record completed work. Choose a past or current activity date and time; use a Task for planned work.'), 'activityDate');
});

test('new Activities and previously assigned Activities require a responsible user', async () => {
  const value = parseActivity(form({ userId: null })).value;
  await assert.rejects(saveActivity(fixture().client, value), /responsible user/);
  const db = fixture({ id: 42, ...value, userId: 7 });
  await assert.rejects(saveActivity(db.client, value, 42), /responsible user/);
});

test('unconfigured types are rejected while unchanged inactive historical types are retained', async () => {
  const value = parseActivity(form({ type: 'LEGACY' })).value;
  const db = fixture(); db.tx.activityType.findFirst = async () => null;
  await assert.rejects(saveActivity(db.client, value), /active activity type/);
  const historical = fixture({ id: 42, ...value }); historical.tx.activityType.findFirst = async () => null;
  await saveActivity(historical.client, value, 42);
});

test('prefills infer known Contact, single Opportunity and primary or single Project Accounts', () => {
  assert.equal(activityAccountPrefill({ contact: { accountId: 1 } }), 1);
  assert.equal(activityAccountPrefill({ opportunity: { participants: [{ accountId: 1 }] } }), 1);
  assert.equal(activityAccountPrefill({ project: { primaryAccountId: 1, participants: [{ accountId: 2 }] } }), 1);
  assert.equal(activityAccountPrefill({ project: { primaryAccountId: null, participants: [{ accountId: 2 }] } }), 2);
  assert.equal(activityAccountPrefill({ project: { primaryAccountId: null, participants: [{ accountId: 1 }, { accountId: 2 }] } }), undefined);
  assert.equal(activityAccountPrefill({ opportunity: { participants: [{ accountId: 1 }, { accountId: 2 }] } }), undefined);
  assert.equal(activityAccountPrefill({ contact: { accountId: null } }), undefined);
  assert.equal(activityAccountPrefill({ contact: { accountId: 3 }, opportunity: { participants: [{ accountId: 1 }] } }), undefined);
});

test('invalid Account, Contact, Opportunity, Project and Support Case combinations never write', async () => {
  for (const relation of ['account', 'contact', 'opportunity', 'project', 'projectOpportunity', 'supportCase']) {
    const db = fixture();
    const value = parseActivity(form({ opportunityId: '2', projectId: '3', supportCaseId: '4', contactIds: '5' })).value;
    if (relation === 'account') db.tx.account.findFirst = async () => null;
    if (relation === 'contact') db.tx.contact.findMany = async () => [{ id: 5, accountId: 9, active: true }];
    if (relation === 'opportunity') db.tx.opportunityAccount.findUnique = async () => null;
    if (relation === 'project') db.tx.project.findUnique = async () => ({ primaryAccountId: 9, participants: [] });
    if (relation === 'projectOpportunity') db.tx.opportunityProject.findUnique = async () => null;
    if (relation === 'supportCase') db.tx.supportCase.findUnique = async () => ({ accountId: 9, status: 'OPEN' });
    await assert.rejects(saveActivity(db.client, value));
    assert.equal(db.writes.length, 0, relation);
  }
});

test('retained Contact history cannot bypass validation when the Case context changes', async () => {
  const value = parseActivity(form({ supportCaseId: '4', contactIds: '5' })).value;
  const db = fixture({ id: 42, ...value, supportCaseId: 2 });
  db.tx.contact.findMany = async () => [{ id: 5, accountId: 9, active: true }];
  await assert.rejects(saveActivity(db.client, value, 42), /Contact is not associated/);
  assert.equal(db.writes.length, 0);
});

test('manual Meetings have no inferred Calendar identity and are never merged by subject or time', async () => {
  const db = fixture();
  const value = parseActivity(form({ type: 'MEETING' })).value;
  await saveActivity(db.client, value, undefined, 7);
  await saveActivity(db.client, value, undefined, 7);
  assert.equal(db.writes.length, 2);
  assert.equal(db.writes[0].calendarReview, undefined);
  assert.equal(db.writes[1].calendarReview, undefined);
});

test('Case Activities can retain an unassigned Case and eligible unassigned Contact', async () => {
  const db = fixture();
  db.tx.supportCase.findUnique = async () => ({ accountId: null, status: 'OPEN' });
  db.tx.contact.findMany = async () => [{ id: 5, accountId: null, active: true }];
  const value = parseActivity(form({ accountId: null, supportCaseId: '4', contactIds: '5' })).value;
  assert.equal((await saveActivity(db.client, value)).supportCaseId, 4);
});

test('relationship presentation links all known context, identifies Calendar source and handles older records', () => {
  const row = { account: { id: 1, name: 'Acme' }, opportunity: { id: 2, name: 'Rollout' }, project: { id: 3, name: 'Pilot' }, supportCase: { id: 4, caseNumber: 'BXS-000004' }, calendarReview: { eventId: 8 } };
  const markup = renderToStaticMarkup(React.createElement(ActivityContext, { row, actor: { id: 7, role: 'READ_ONLY', active: true } }));
  for (const href of ['/accounts/1','/opportunities/2','/projects/3','/support/cases/4']) assert.ok(markup.includes(href));
  assert.match(markup, /Calendar-linked meeting/);
  const legacy = renderToStaticMarkup(React.createElement(ActivityContext, { row: { account: null, opportunity: null, project: null, supportCase: null }, actor: { id: 7, role: 'READ_ONLY', active: true } }));
  assert.doesNotMatch(legacy, /undefined|null|Calendar/);
});

test('Read Only cannot create or edit and Support may read only through a Case-authorized detail page', () => {
  const readOnly = { id: 7, role: 'READ_ONLY', active: true };
  assert.throws(() => assertWorkPermission(readOnly, null), /Access denied/);
  assert.throws(() => assertWorkPermission(readOnly, 4), /Access denied/);
  assert.equal(routeAccess('/activities/new', readOnly), 'denied');
  assert.equal(routeAccess('/activities/42/edit', readOnly), 'denied');
  assert.equal(routeAccess('/activities/42', readOnly), 'allowed');
  assert.equal(routeAccess('/activities/42', { ...readOnly, role: 'SUPPORT' }), 'allowed');
  assert.equal(routeAccess('/activities/42/edit', { ...readOnly, role: 'SUPPORT' }), 'denied');
});
