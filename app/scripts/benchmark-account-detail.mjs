// Local only: compare the actual pre-refactor page queries against selected-tab loaders.
// Run after npm run test:e2e:prepare. Never reads the application's DATABASE_URL.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { PrismaClient } from '@prisma/client';
import { databaseUrl, emails } from '../e2e/constants.mjs';
import { ensureLargeAccount, fixtureCounts } from '../e2e/account-detail-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = Module.createRequire(import.meta.url);
const transpile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
Module._extensions['.ts'] = (mod, file) => mod._compile(transpile(fs.readFileSync(file, 'utf8')), file);
const { loadAccountContext, loadAccountTab, resolveAccountTab } = require('../lib/account-detail.ts');
const { loadRelatedWork } = require('../lib/related-work-data.ts');
const { loadDocumentList } = require('../lib/document-list.ts');
const { assertDocumentParentAccess } = require('../lib/documents.ts');
const { getLabels } = require('../lib/configuration.ts');
const id = await ensureLargeAccount();
let calls = [], sql = [];
const original = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [{ emit: 'event', level: 'query' }] });
original.$on('query', event => sql.push({ duration: event.duration }));
const db = original.$extends({ query: { $allModels: { async $allOperations({ model, operation, args, query }) {
  const result = await query(args);
  calls.push({ model, operation, args, bytes: Buffer.byteLength(JSON.stringify(result) ?? '') });
  return result;
} } } });
const actor = await db.user.findUniqueOrThrow({ where: { email: emails.admin } });

function oldLoader(file, returnExpression) {
  const source = execFileSync('git', ['show', `797117e:app/${file}`], { cwd: root, encoding: 'utf8' });
  const start = source.indexOf('return <');
  assert.ok(start > 0, `Cannot locate baseline render: ${file}`);
  const compiled = new Module(path.join(root, file), require);
  compiled.filename = path.join(root, file); compiled.paths = Module._nodeModulePaths(root);
  const savedLoad = Module._load;
  Module._load = function(request, parent, main) {
    if (request === '@/lib/prisma') return { prisma: db };
    if (request === '@/lib/current-user') return { currentUser: async () => actor };
    if (request === 'next/navigation') return { notFound: () => { throw Error('Missing fixture'); } };
    if (request.startsWith('@/')) return savedLoad.call(this, path.join(root, request.slice(2)), parent, main);
    return savedLoad.call(this, request, parent, main);
  };
  // Rendering is excluded; all original data reads above the render are executed unchanged.
  try { compiled._compile(transpile(`${source.slice(0, start)}return ${returnExpression};\n}`), compiled.filename); }
  finally { Module._load = savedLoad; }
  return compiled.exports;
}
// The old page still needs demoListInclude before render; compile TSX dependencies normally.
Module._extensions['.tsx'] = (mod, file) => mod._compile(transpile(fs.readFileSync(file, 'utf8')), file);
const baseline = oldLoader('app/accounts/[id]/page.tsx', '{ account, projects, labels, lastActivity, openTasks, priceExceptions, odmSkus, demos, demoCount }').default;
const oldWork = oldLoader('components/related-work.tsx', '{ rows }').RelatedWork;
const oldDocuments = oldLoader('components/documents-section.tsx', '{ documents }').DocumentsSection;
const workKinds = { Activity: 'activities', Tasks: 'tasks', Notes: 'notes' };
async function before(tab) {
  await baseline({ params: Promise.resolve({ id: String(id) }), searchParams: Promise.resolve({ tab: tab.toLowerCase() }) });
  if (workKinds[tab]) await oldWork({ accountId: id, kind: workKinds[tab] });
  if (tab === 'Documents') await oldDocuments({ parentType: 'account', parentId: id, actor, basePath: `/accounts/${id}?tab=documents` });
}
async function after(tab, params = {}) {
  const selected = resolveAccountTab(tab, actor);
  const context = await loadAccountContext(db, id, actor);
  assert.deepEqual(context.counts, fixtureCounts);
  const [data] = await Promise.all([loadAccountTab(db, id, actor, selected, params, context.counts), getLabels(db)]);
  if (workKinds[tab]) await loadRelatedWork(db, { accountId: id, kind: workKinds[tab], ...params });
  if (tab === 'Documents') {
    await assertDocumentParentAccess(db, actor, { type: 'account', id }, 'read');
    await assertDocumentParentAccess(db, actor, { type: 'account', id }, 'write');
    await loadDocumentList(db, { type: 'account', id }, false, params.page);
  }
  return data;
}
function collectionReads() {
  return calls.flatMap(call => [
    ...(call.operation === 'findMany' && call.model !== 'TerminologyLabel' ? [call.model] : []),
    ...(call.model === 'Account' && call.args.include?.contacts ? ['Contact (nested)'] : []),
    ...(call.model === 'Account' && call.args.include?.opportunityMemberships ? ['OpportunityAccount (nested)'] : []),
  ]);
}
async function measure(run, tab) {
  await run(tab); // warm-up
  const samples = [];
  for (let i = 0; i < 5; i++) {
    calls = []; sql = [];
    const start = performance.now(); await run(tab);
    samples.push({ ms: performance.now() - start, operations: calls.length, sqlQueries: sql.length,
      sqlMs: sql.reduce((sum, q) => sum + q.duration, 0), resultBytes: calls.reduce((sum, c) => sum + c.bytes, 0), collections: collectionReads() });
  }
  return samples.sort((a, b) => a.ms - b.ms)[2];
}
try {
  const evidence = [];
  for (const tab of ['Overview', 'Contacts', 'Opportunities', 'Projects', 'Activity', 'Tasks', 'Notes', 'Documents', 'Demos']) {
    const old = await measure(before, tab), current = await measure(after, tab);
    const allowed = { Overview: ['ProductSku', 'PriceException'], Contacts: ['Contact'], Opportunities: ['OpportunityAccount'], Projects: ['Project'], Activity: ['Activity'], Tasks: ['Task'], Notes: ['Note'], Documents: ['Document'], Demos: ['DemoRequest'] }[tab];
    assert.deepEqual([...current.collections].sort(), [...allowed].sort(), `${tab} loaded unrelated collections`);
    for (const call of calls.filter(c => c.operation === 'findMany' && c.model !== 'TerminologyLabel')) assert.ok(call.args.take <= 25, `${tab}: unbounded ${call.model}`);
    assert.ok(current.resultBytes < old.resultBytes, `${tab}: hydrated payload did not shrink`);
    evidence.push({ tab, before: old, after: current });
  }
  console.log(JSON.stringify({ baselineCommit: '797117e', database: new URL(databaseUrl).pathname, accountId: id, samples: 5,
    note: 'Warm loader wall time; SQL event duration is summed, not elapsed. Result bytes are a hydration proxy, not heap/RSS. Excludes authentication/layout/render/network.', evidence }, null, 2));
} finally { await original.$disconnect(); }
