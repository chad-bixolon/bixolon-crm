import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const require = Module.createRequire(import.meta.url);
const compile = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
Module._extensions['.ts'] = compile;
Module._extensions['.tsx'] = compile;
const resolve = Module._resolveFilename, load = Module._load;
Module._resolveFilename = function(request, parent, ...args) { return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...args); };
const { opportunityScope } = require('../lib/authorization.ts');
const { operationalOpportunityWhere } = require('../lib/operational-where.ts');
let actor = { id: 7, role: 'SALES', active: true }, query;
const db = {
  opportunity: { findMany: async args => { query = args; return []; } },
  user: { findMany: async () => [] }, salesStage: { findMany: async () => [] }, territory: { findMany: async () => [] },
  task: { findMany: async () => [{ id: 42, subject: 'Call customer', status: 'OPEN', priority: 'NORMAL', dueDate: null }] },
  note: { findMany: async () => [{ id: 43, body: 'Customer background', createdAt: new Date('2026-10-16'), createdBy: null }] },
};
Module._load = function(request, parent, isMain) {
  if (request === 'next/link') return function Link({ href, children, ...props }) { return React.createElement('a', { href, ...props }, children); };
  if (request === '@/lib/prisma') return { prisma: db };
  if (request === '@/lib/current-user') return { currentUser: async () => actor };
  if (request === '@/components/shell') return { Content: ({ children }) => React.createElement('main', null, children), PageHeader: () => null };
  if (request === '@/components/saved-views') return { SavedViews: () => null };
  if (request.endsWith('/filter-disclosure')) return { FilterDisclosure: () => null };
  if (request === '@/components/optional-project-filter') return { OptionalProjectFilter: () => null };
  return load.call(this, request, parent, isMain);
};
const Pipeline = require('../app/pipeline/page.tsx').default;
const { RelatedWork } = require('../components/related-work.tsx');
Module._load = load;

test('standalone Pipeline combines canonical scope with filters without changing category eligibility', async () => {
  for (const role of ['SALES', 'SALES_MANAGER', 'ADMIN']) {
    actor = { id: 7, role, active: true };
    await Pipeline({ searchParams: Promise.resolve({ ownerId: '99', stageId: '3', closeFrom: '2026-10-01', closeTo: '2026-10-31' }) });
    assert.deepEqual(query.where.AND, [operationalOpportunityWhere, opportunityScope(actor)]);
    assert.equal(query.where.ownerId, 99);
    assert.equal(query.where.stageId, 3);
    assert.deepEqual(query.where.stage, { isClosed: false });
    assert.equal(query.where.forecastCategory, undefined);
    assert.deepEqual(query.where.expectedCloseDate, { gte: new Date('2026-10-01'), lt: new Date('2026-11-01') });
  }
});

test('related Task navigation reads details; Note editing follows writer and parent permissions', async () => {
  actor = { id: 7, role: 'READ_ONLY', active: true };
  const tasks = renderToStaticMarkup(await RelatedWork({ accountId: 1, kind: 'tasks', allowCreate: false }));
  assert.match(tasks, /href="\/tasks\/42"/);
  assert.doesNotMatch(tasks, /\/tasks\/42\/edit/);
  const notes = renderToStaticMarkup(await RelatedWork({ accountId: 1, kind: 'notes', allowCreate: false }));
  assert.match(notes, /Customer background/);
  assert.doesNotMatch(notes, /\/notes\/43\/edit|>View<|>Edit note</);
  actor = { id: 7, role: 'ADMIN', active: true };
  assert.match(renderToStaticMarkup(await RelatedWork({ accountId: 1, kind: 'notes' })), /href="\/notes\/43\/edit"[^>]*>Edit note</);
  assert.doesNotMatch(renderToStaticMarkup(await RelatedWork({ projectId: 1, kind: 'notes', allowCreate: false })), /\/notes\/43\/edit/);
});
