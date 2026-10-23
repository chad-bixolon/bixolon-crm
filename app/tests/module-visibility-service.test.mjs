import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filename = path.join(root, 'lib/module-availability.ts');
const tsLoader = Module._extensions['.ts'];
const originalLoad = Module._load;
Module._extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
Module._load = function (request, parent, isMain) {
  if (request === 'react') return { cache: fn => fn };
  if (request === 'next/navigation') return { notFound: () => { throw new Error('not found'); } };
  if (request === './prisma' && parent?.filename === filename) return { prisma: {} };
  return originalLoad.call(this, request, parent, isMain);
};
const serviceModule = new Module(filename);
serviceModule.filename = filename;
serviceModule.paths = Module._nodeModulePaths(path.dirname(filename));
serviceModule._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
Module._load = originalLoad;
Module._extensions['.ts'] = tsLoader;
const { setModuleVisibility, readModules } = serviceModule.exports;

const actor = role => ({ id: 7, role, active: true, archivedAt: null, delegatedUserAdministrationEnabled: role === 'SALES_MANAGER' });
function fixture() {
  const state = { rows: new Map(), events: [], persisted: actor('ADMIN'), transactions: 0 };
  const db = {
    $queryRaw: async () => [],
    $transaction: async callback => { state.transactions++; return callback(db); },
    user: { findUnique: async () => state.persisted },
    deploymentModuleVisibility: {
      findMany: async () => [...state.rows].map(([module, enabled]) => ({ module, enabled })),
      upsert: async ({ where, create, update }) => { state.rows.set(where.module, state.rows.has(where.module) ? update.enabled : create.enabled); },
    },
    adminMaintenanceEvent: { create: async ({ data }) => { state.events.push(data); } },
  };
  return { db, state };
}

test('missing rows remain enabled; parent disable preserves child choice and audits effective consequences', async () => {
  const { db, state } = fixture();
  assert.equal((await readModules(db)).effective.has('FORECASTING'), true);
  await setModuleVisibility(db, actor('ADMIN'), 'OPPORTUNITIES', false);
  const disabled = await readModules(db);
  assert.equal(disabled.configured.has('FORECASTING'), true);
  assert.equal(disabled.effective.has('FORECASTING'), false);
  assert.equal(disabled.effective.has('PROJECTS'), true);
  assert.deepEqual(state.events.map(event => [event.actorId, event.action, event.entityType]), [[7, 'Disabled', 'Module']]);
  assert.match(state.events[0].newValue, /Forecasting.*unavailable through dependency/);
  await setModuleVisibility(db, actor('ADMIN'), 'OPPORTUNITIES', true);
  assert.equal((await readModules(db)).effective.has('FORECASTING'), true);
  assert.equal(state.events[1].action, 'Enabled');
  assert.match(state.events[1].newValue, /Forecasting.*available again/);
});

test('delegated User Admin and Executive cannot change modules, and stale Admin role is rechecked', async () => {
  const { db, state } = fixture();
  for (const role of ['SALES_MANAGER', 'EXECUTIVE']) await assert.rejects(setModuleVisibility(db, actor(role), 'DEMOS', false), /Access denied/);
  assert.equal(state.transactions, 0);
  state.persisted = actor('SALES_MANAGER');
  await assert.rejects(setModuleVisibility(db, actor('ADMIN'), 'DEMOS', false), /Access denied/);
  assert.equal(state.rows.size, 0);
  assert.equal(state.events.length, 0);
});
