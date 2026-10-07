import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(import.meta.url);
const { saveActivity } = require(path.join(root, 'lib/work.ts'));
const value = { subject: 'Customer meeting', description: null, accountId: 10, opportunityId: null, projectId: null, userId: 7, type: 'MEETING', activityDate: new Date('2026-10-06T13:00:00Z'), direction: 'NA', outcome: null, nextStep: null, followUpDate: null, contactIds: [3], createFollowUpTask: false, followUpTaskCreateKey: '' };

test('Calendar Activity guard rejects repeat logging before Activity creation', async () => {
  let creates = 0, locks = 0;
  const client = { task: { findUnique: async () => null }, $transaction: async callback => callback({
    $executeRaw: async () => { locks++; },
    googleCalendarEventReview: { findUnique: async () => ({ activityId: 99, ignoredAt: null, event: { status: 'confirmed', endAt: new Date('2026-10-06T14:00:00Z') } }) },
    activity: { create: async () => { creates++; } },
  }) };
  await assert.rejects(saveActivity(client, value, undefined, 7, 1), /no longer available/);
  assert.equal(locks, 1); assert.equal(creates, 0);
});
test('Calendar Activity guard rejects cancelled, ignored and upcoming meetings', async () => {
  for (const review of [
    { ignoredAt: new Date(), activityId: null, event: { status: 'confirmed', endAt: new Date('2026-10-06T14:00:00Z') } },
    { ignoredAt: null, activityId: null, event: { status: 'CANCELLED', endAt: new Date('2026-10-06T14:00:00Z') } },
    { ignoredAt: null, activityId: null, event: { status: 'confirmed', endAt: new Date('2099-10-06T14:00:00Z') } },
  ]) {
    const client = { task: { findUnique: async () => null }, $transaction: async callback => callback({ $executeRaw: async () => {}, googleCalendarEventReview: { findUnique: async () => review } }) };
    await assert.rejects(saveActivity(client, value, undefined, 7, 1), /no longer available/);
  }
});
test('successful Calendar Activity save links the review and keeps the meeting timestamp', async () => {
  const writes = [];
  const tx = {
    $executeRaw: async () => {},
    googleCalendarEventReview: {
      findUnique: async () => ({ activityId: null, ignoredAt: null, event: { status: 'CONFIRMED', endAt: new Date('2026-10-06T14:00:00Z') } }),
      update: async args => { writes.push(args); },
    },
    account: { findFirst: async () => ({ id: 10 }) },
    activityType: { findFirst: async () => ({ code: 'MEETING' }) },
    user: { findFirst: async () => ({ id: 7 }) },
    contact: { findMany: async () => [{ id: 3, accountId: 10, active: true, archivedAt: null }] },
    activity: { create: async ({ data }) => { assert.equal(data.activityDate.toISOString(), '2026-10-06T13:00:00.000Z'); return { id: 42, ...data }; } },
    activityContact: { createMany: async () => {} },
  };
  const client = { $transaction: async callback => callback(tx) };
  const row = await saveActivity(client, value, undefined, 7, 1);
  assert.equal(row.id, 42); assert.equal(writes.length, 1);
  assert.equal(writes[0].data.activityId, 42); assert.equal(writes[0].data.reviewedById, 7);
  assert.deepEqual(writes[0].data.selectedContactIds, [3]);
});

test('concurrent Calendar Activity submissions serialize and create only one Activity', async () => {
  let review = { activityId: null, ignoredAt: null, event: { status: 'CONFIRMED', endAt: new Date('2026-10-06T14:00:00Z') } };
  let creates = 0, lockCount = 0;
  let release = Promise.resolve();
  const client = { $transaction: async callback => {
    const previous = release;
    let done;
    release = new Promise(resolve => { done = resolve; });
    await previous;
    try { return await callback({
      $executeRaw: async () => { lockCount++; },
      googleCalendarEventReview: { findUnique: async () => review, update: async ({ data }) => { review = { ...review, ...data }; } },
      account: { findFirst: async () => ({ id: 10 }) },
      activityType: { findFirst: async () => ({ code: 'MEETING' }) },
      user: { findFirst: async () => ({ id: 7 }) },
      contact: { findMany: async () => [{ id: 3, accountId: 10, active: true, archivedAt: null }] },
      activity: { create: async ({ data }) => { creates++; return { id: 42, ...data }; } },
      activityContact: { createMany: async () => {} },
    }); } finally { done(); }
  } };
  const results = await Promise.allSettled([saveActivity(client, value, undefined, 7, 1), saveActivity(client, value, undefined, 7, 1)]);
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected']);
  assert.match(results[1].reason.message, /no longer available/);
  assert.equal(creates, 1); assert.equal(review.activityId, 42); assert.equal(lockCount, 2);
});
