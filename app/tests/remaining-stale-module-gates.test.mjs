import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(import.meta.url);
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { resolveModules, reportTypeAvailable } = require(path.join(root, 'lib/module-policy.ts'));
const stale = require(path.join(root, 'lib/stale-edit.ts'));
const originalLoad = Module._load;
function loadAction(relativePath, mocks) {
  Module._load = function(specifier, parent, isMain) { return specifier in mocks ? mocks[specifier] : originalLoad.call(this, specifier, parent, isMain); };
  try { return require(path.join(root, relativePath)); }
  finally { Module._load = originalLoad; }
}

test('Report edit checks the submitted type as well as the current type against module visibility', async () => {
  let saves = 0;
  const actions = loadAction('app/reports/actions.ts', {
    'next/navigation': { redirect: path => { throw new Error(`REDIRECT:${path}`); } },
    'next/cache': { revalidatePath: () => {} },
    '@/lib/prisma': { prisma: { reportDefinition: { findUnique: async () => ({ reportType: 'PIPELINE' }) } } },
    '@/lib/current-user': { currentUser: async () => ({ id: 7, role: 'ADMIN' }) },
    '@/lib/saved-reports': { saveReportDefinition: async () => { saves++; return 3; } },
    '@/lib/module-availability': { getModuleAvailability: async () => resolveModules([{ module: 'TRADE_SHOWS', enabled: false }]), reportTypeAvailable },
    '@/lib/stale-edit': stale,
  });
  const form = new FormData();
  form.set('reportId', '3'); form.set('reportType', 'TRADE_SHOW'); form.set('configuration', '{}');
  form.set('name', 'Changed report'); form.set('visibility', 'SHARED'); form.set('editToken', '2026-10-01T00:00:00.000Z');
  await assert.rejects(actions.saveReportAction(form), /Report unavailable/);
  assert.equal(saves, 0);
  form.set('reportType', 'PIPELINE');
  await assert.rejects(actions.saveReportAction(form), /REDIRECT:\/reports\/3/);
  assert.equal(saves, 1);
});

test('Project and Opportunity Update actions enforce modules for hidden old links and open editors', async () => {
  const disabled = new Set(['OPPORTUNITIES']);
  let oldOpportunityId = 9, saves = 0;
  const actions = loadAction('app/project-update-actions.ts', {
    'next/cache': { revalidatePath: () => {} },
    '@/lib/prisma': { prisma: { projectUpdate: { findUnique: async () => ({ opportunityId: oldOpportunityId }) } } },
    '@/lib/current-user': { currentUser: async () => ({ id: 7, role: 'ADMIN' }) },
    '@/lib/project-updates': { saveProjectUpdate: async () => { saves++; return { id: 5, projectId: 7, opportunityId: null, oldProjectId: 7, oldOpportunityId: null }; } },
    '@/lib/module-availability': { assertModuleEnabled: async module => { if (disabled.has(module)) throw new Error(`${module} unavailable`); } },
    '@/lib/stale-edit': stale,
  });
  const form = new FormData();
  await assert.rejects(actions.submitProjectUpdate({ kind: 'project', id: 7 }, 5, {}, form), /OPPORTUNITIES unavailable/);
  assert.equal(saves, 0);
  oldOpportunityId = null;
  assert.equal((await actions.submitProjectUpdate({ kind: 'project', id: 7 }, 5, {}, form)).saved, true);
  assert.equal(saves, 1);
  disabled.clear(); disabled.add('PROJECTS');
  await assert.rejects(actions.submitProjectUpdate({ kind: 'opportunity', id: 8 }, 5, {}, form), /PROJECTS unavailable/);
  assert.equal(saves, 1);
});
