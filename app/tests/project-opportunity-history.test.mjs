import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(fileURLToPath(import.meta.url));
const originalLoad = Module._load;
const originalTs = Module._extensions['.ts'];
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
let linked = false, failHistory = false;
const events = [], permissions = [];
const prisma = { $transaction: async fn => {
  let working = linked;
  const pending = [];
  const tx = {
    project: { findUnique: async () => ({ id: 20, name: 'SRP-S300II Deployment', archivedAt: null, primaryAccount: { ownerId: 7 } }) },
    opportunity: { findUnique: async () => ({ id: 5, name: 'Deal', archivedAt: null }) },
    opportunityProject: {
      create: async () => { if (working) throw new Error('already linked'); working = true; },
      delete: async () => { if (!working) throw new Error('link missing'); working = false; },
    },
    user: { findUnique: async () => ({ firstName: 'Ryan', lastName: 'Persaud' }) },
    opportunityHistoryEvent: { create: async ({ data }) => { if (failHistory) throw new Error('history unavailable'); pending.push(data); } },
  };
  const result = await fn(tx);
  linked = working;
  events.push(...pending);
  return result;
} };
Module._load = function(request, parent, isMain) {
  if (request === 'next/cache') return { revalidatePath: () => {} };
  if (request === '@/lib/prisma') return { prisma };
  if (request === '@/lib/current-user') return { requireMutation: async permission => { permissions.push(permission); return { id: 7, role: 'ADMIN' }; } };
  if (request === '@/lib/projects') return { canEditProject: () => true };
  if (request === '@/lib/crm-validation') return { friendlyError: error => error.message };
  return originalLoad.call(this, request, parent, isMain);
};
let changeProjectOpportunity;
try { ({ changeProjectOpportunity } = require(path.join(root, 'app/projects/[id]/opportunity-actions.ts'))); }
finally { Module._load = originalLoad; Module._extensions['.ts'] = originalTs; }

const form = operation => { const value = new FormData(); value.set('opportunityId', '5'); value.set('operation', operation); return value; };

test('Project-page link and unlink write named Opportunity history in the same transaction', async () => {
  linked = false; failHistory = false; events.length = 0; permissions.length = 0;
  assert.deepEqual(await changeProjectOpportunity(20, {}, form('link')), {});
  assert.equal(linked, true);
  assert.deepEqual(events.map(event => event.eventType), ['PROJECT_LINKED']);
  assert.deepEqual([events[0].relatedRecordId, events[0].relatedRecordName, events[0].actorId, events[0].actorName], [20, 'SRP-S300II Deployment', 7, 'Ryan Persaud']);
  assert.match((await changeProjectOpportunity(20, {}, form('link'))).message, /already linked/);
  assert.equal(events.length, 1);
  assert.deepEqual(await changeProjectOpportunity(20, {}, form('unlink')), {});
  assert.equal(linked, false);
  assert.deepEqual(events.map(event => event.eventType), ['PROJECT_LINKED', 'PROJECT_UNLINKED']);
  assert.match((await changeProjectOpportunity(20, {}, form('unlink'))).message, /link missing/);
  assert.equal(events.length, 2);
  assert.deepEqual(permissions, Array(4).fill('sales.write'));
});

test('Project-page relationship stays unchanged if history writing fails', async () => {
  linked = false; failHistory = true; events.length = 0;
  assert.match((await changeProjectOpportunity(20, {}, form('link'))).message, /history unavailable/);
  assert.equal(linked, false);
  assert.deepEqual(events, []);
  failHistory = false;
});
