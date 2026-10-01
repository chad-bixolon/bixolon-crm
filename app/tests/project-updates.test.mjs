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
const { saveProjectUpdate, projectUpdateWhere } = require(path.join(root, 'lib/project-updates.ts'));
const actor = { id: 7, role: 'ADMIN', active: true, archivedAt: null };
const project = { id: 3, ownerId: 7, archivedAt: null, primaryAccount: null };
const opportunity = { id: 8, ownerId: 7, archivedAt: null };
function form(body, otherField, otherId) { const result = new FormData(); result.set('body', body); if (otherId) result.set(otherField, String(otherId)); return result; }

test('a dual-linked update is one record returned in both parent contexts', async () => {
  const records = [];
  const tx = {
    project: { findUnique: async ({ where }) => where.id === 3 ? project : null },
    opportunity: { findUnique: async ({ where }) => where.id === 8 ? opportunity : null },
    opportunityProject: { findUnique: async ({ where }) => where.opportunityId_projectId.projectId === 3 && where.opportunityId_projectId.opportunityId === 8 ? {} : null },
    projectUpdate: {
      findUnique: async ({ where }) => records.find(record => record.id === where.id) ?? null,
      create: async ({ data }) => { const record = { id: records.length + 1, ...data }; records.push(record); return record; },
      update: async ({ where, data }) => Object.assign(records.find(record => record.id === where.id), data),
    },
  };
  const client = { $transaction: async callback => callback(tx) };
  const saved = await saveProjectUpdate(client, actor, { kind: 'project', id: 3 }, null, form('Milestone reached', 'opportunityId', 8));
  assert.equal(saved.id, 1);
  assert.equal(records.filter(row => row.projectId === projectUpdateWhere({ kind: 'project', id: 3 }).projectId).length, 1);
  assert.equal(records.filter(row => row.opportunityId === projectUpdateWhere({ kind: 'opportunity', id: 8 }).opportunityId).length, 1);
  await saveProjectUpdate(client, actor, { kind: 'opportunity', id: 8 }, saved.id, form('Milestone revised', 'projectId', 3));
  assert.equal(records.length, 1);
  assert.equal(records[0].body, 'Milestone revised');
  await assert.rejects(saveProjectUpdate(client, actor, { kind: 'project', id: 4 }, saved.id, form('Wrong context', 'opportunityId', 8)), /not found in this record/);
});

test('updates require a writable parent and a real Project Opportunity link', async () => {
  let creates = 0;
  const tx = {
    project: { findUnique: async () => project },
    opportunity: { findUnique: async () => opportunity },
    opportunityProject: { findUnique: async () => null },
    projectUpdate: { create: async () => { creates++; return { id: 1 }; } },
  };
  const client = { $transaction: async callback => callback(tx) };
  await assert.rejects(saveProjectUpdate(client, actor, { kind: 'project', id: 3 }, null, form('No link', 'opportunityId', 8)), /linked Project and Opportunity/);
  await assert.rejects(saveProjectUpdate(client, { ...actor, role: 'READ_ONLY' }, { kind: 'project', id: 3 }, null, form('Cannot write')), /Access denied/);
  await assert.rejects(saveProjectUpdate(client, actor, { kind: 'project', id: 3 }, null, form('   ')), /Enter an update/);
  assert.equal(creates, 0);
});

test('Sales ownership, Admin access, Read Only, and parent archives control writes', async () => {
  let currentProject = { ...project };
  let currentOpportunity = { ...opportunity };
  let writes = 0;
  const tx = {
    project: { findUnique: async () => currentProject },
    opportunity: { findUnique: async () => currentOpportunity },
    opportunityProject: { findUnique: async () => ({}) },
    projectUpdate: { create: async () => ({ id: ++writes }) },
  };
  const client = { $transaction: async callback => callback(tx) };
  const sales = { ...actor, role: 'SALES' };
  await saveProjectUpdate(client, sales, { kind: 'project', id: 3 }, null, form('Owned project'));
  await saveProjectUpdate(client, sales, { kind: 'opportunity', id: 8 }, null, form('Owned opportunity'));
  await saveProjectUpdate(client, sales, { kind: 'project', id: 3 }, null, form('Both owned', 'opportunityId', 8));
  currentProject = { ...project, ownerId: 99 };
  await assert.rejects(saveProjectUpdate(client, sales, { kind: 'project', id: 3 }, null, form('Unowned')), /Access denied/);
  await saveProjectUpdate(client, actor, { kind: 'project', id: 3 }, null, form('Admin can write'));
  currentProject = { ...project, archivedAt: new Date() };
  await assert.rejects(saveProjectUpdate(client, actor, { kind: 'project', id: 3 }, null, form('Archived project')), /Access denied/);
  currentProject = { ...project };
  currentOpportunity = { ...opportunity, archivedAt: new Date() };
  await assert.rejects(saveProjectUpdate(client, actor, { kind: 'opportunity', id: 8 }, null, form('Archived opportunity')), /Access denied/);
  await assert.rejects(saveProjectUpdate(client, { ...actor, role: 'READ_ONLY' }, { kind: 'opportunity', id: 8 }, null, form('Read Only')), /Access denied/);
  assert.equal(writes, 4);
});

test('project updates remain contextual in navigation and routes', () => {
  const shell = fs.readFileSync(path.join(root, 'components/shell.tsx'), 'utf8');
  const projectPage = fs.readFileSync(path.join(root, 'app/projects/[id]/page.tsx'), 'utf8');
  const opportunityPage = fs.readFileSync(path.join(root, 'app/opportunities/[id]/page.tsx'), 'utf8');
  assert.doesNotMatch(shell, /["']Project Updates["']|\/project-updates/);
  assert.equal(fs.existsSync(path.join(root, 'app/project-updates')), false);
  assert.match(projectPage, /projectUpdate\.findMany\(\{ where: \{ projectId: id \}/);
  assert.match(opportunityPage, /projectUpdate\.findMany\(\{ where: \{ opportunityId: id \}/);
  assert.match(projectPage, /<ProjectUpdates context=\{\{ kind: 'project', id \}\}/);
  assert.match(opportunityPage, /<ProjectUpdates context=\{\{ kind: 'opportunity', id \}\}/);
});
