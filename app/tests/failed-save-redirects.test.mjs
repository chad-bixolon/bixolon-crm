import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(import.meta.url);
const originalLoad = Module._load;
const originalTs = Module._extensions['.ts'];
let redirects = 0;
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
Module._load = function(request, parent, isMain) {
  if (request === 'next/cache') return { revalidatePath: () => {} };
  if (request === 'next/navigation') return { redirect: () => { redirects++; throw new Error('Unexpected redirect'); } };
  if (request === '@/lib/current-user') return { requireMutation: async () => ({ id: 1, role: 'ADMIN' }) };
  if (request === '@/lib/prisma') return { prisma: {} };
  if (request === '@/lib/sales-plan') return { saveLineAllocation: async () => { throw new Error('Allocation total is invalid.'); } };
  if (request === '@/lib/sales-targets') return { saveSalesTarget: async () => { throw new Error('An active target already exists for this rep, quarter, and currency.'); }, archiveSalesTarget: async () => {} };
  return originalLoad.call(this, request, parent, isMain);
};
const { allocateAction } = require(path.join(root, 'app/sales-plan/actions.ts'));
const { saveTargetAction } = require(path.join(root, 'app/administration/sales-targets/actions.ts'));
Module._load = originalLoad;
Module._extensions['.ts'] = originalTs;

test('Sales Plan validation keeps allocation controls on the current page', async () => {
  const form = new FormData();
  form.set('lineId', '10');
  form.set('Q1Units', '12');
  form.set('Q2Revenue', '100.00');
  const result = await allocateAction(form);
  assert.equal(result.error, 'Allocation total is invalid.');
  assert.equal(form.get('Q1Units'), '12');
  assert.equal(form.get('Q2Revenue'), '100.00');
  assert.equal(redirects, 0);
});

test('Sales Target duplicate validation returns in place for create and edit', async () => {
  for (const id of ['', '12']) {
    const form = new FormData();
    form.set('id', id);
    form.set('userId', '4');
    form.set('targetAmount', '12345.67');
    form.set('notes', 'Keep this note');
    const result = await saveTargetAction(form);
    assert.match(result.error, /active target already exists/);
    assert.equal(form.get('targetAmount'), '12345.67');
    assert.equal(form.get('notes'), 'Keep this note');
  }
  assert.equal(redirects, 0);
});
