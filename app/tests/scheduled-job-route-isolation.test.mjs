import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(import.meta.url);
const { NextRequest } = require('next/server');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const monitoring = require(path.join(root, 'lib/scheduled-job-runs.ts'));

let create, update, evaluation, sync;
const db = { scheduledJobRun: { create: (...args) => create(...args), update: (...args) => update(...args) } };
const originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
  if (name === '@/lib/prisma') return { prisma: db };
  if (name === '@/lib/scheduled-job-runs') return monitoring;
  if (name === '@/lib/pe-notification-evaluator') return { evaluatePeNotifications: () => evaluation() };
  if (name === '@/lib/work-notification-evaluator') return { evaluateWorkNotifications: async () => ({ evaluated: { tasks: 0, opportunities: 0 }, created: { tasks: 0, opportunities: 0 }, resolved: { tasks: 0, opportunities: 0 } }) };
  if (name === '@/lib/support-notifications') return { evaluateSupportNotifications: async () => ({ evaluated: 0, created: 0, resolved: 0 }) };
  if (name === '@/lib/google-calendar-sync') return { syncAllGoogleCalendarConnections: () => sync() };
  return originalLoad.call(this, name, parent, isMain);
};
let notificationPost, calendarPost;
try {
  ({ POST: notificationPost } = require(path.join(root, 'app/api/internal/notifications/evaluate/route.ts')));
  ({ POST: calendarPost } = require(path.join(root, 'app/api/internal/calendar/sync/route.ts')));
} finally { Module._load = originalLoad; }

for (const [name, post, secretName, url] of [
  ['Notification Evaluator', notificationPost, 'NOTIFICATION_EVALUATOR_SECRET', 'notifications/evaluate'],
  ['Calendar Sync', calendarPost, 'CALENDAR_SYNC_SECRET', 'calendar/sync'],
]) {
  test(`${name} business outcome is independent of monitoring create and update`, async () => {
    const prior = process.env[secretName];
    process.env[secretName] = 's'.repeat(32);
    const request = () => new NextRequest(`https://crm.example/api/internal/${url}`, { method: 'POST', headers: { authorization: `Bearer ${process.env[secretName]}` } });
    evaluation = async () => ({ evaluated: 1, created: 0, resolved: 0 });
    sync = async () => [{ success: true, processed: 3 }];
    try {
      let rejectCreate;
      create = () => new Promise((_, reject) => { rejectCreate = reject; });
      update = () => { throw new Error('update should not run after failed create'); };
      const first = await Promise.race([post(request()), new Promise((_, reject) => setTimeout(() => reject(new Error('job waited for monitoring create')), 500))]);
      assert.equal(first.status, 200);
      rejectCreate(new Error('monitoring create failed'));

      create = async () => ({ id: 7 });
      let releaseUpdate;
      update = () => new Promise(resolve => { releaseUpdate = resolve; });
      const second = await Promise.race([post(request()), new Promise((_, reject) => setTimeout(() => reject(new Error('response waited for monitoring update')), 500))]);
      assert.equal(second.status, 200);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(typeof releaseUpdate, 'function');
      releaseUpdate();

      evaluation = async () => { throw new Error('business failure'); };
      sync = async () => { throw new Error('business failure'); };
      update = async () => { throw new Error('monitoring update failed'); };
      const failed = await post(request());
      assert.equal(failed.status, 500);
    } finally {
      if (prior === undefined) delete process.env[secretName]; else process.env[secretName] = prior;
    }
  });
}
