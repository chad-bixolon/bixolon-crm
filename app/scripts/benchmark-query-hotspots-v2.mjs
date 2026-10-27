// In-process query-shape benchmark. The 3 ms mock round trip is a model, not a database measurement.
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';

Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const { Prisma } = require('@prisma/client');
const { executePipelineReport, executePipelineReportGroups, defaultReportConfiguration } = require(path.join(root, 'lib/reporting.ts'));
const { evaluatePeNotifications } = require(path.join(root, 'lib/pe-notification-evaluator.ts'));
const pause = () => new Promise(resolve => setTimeout(resolve, 3));
const timed = async fn => { const start = performance.now(); const count = await fn(); return { operations: count, ms: Math.round((performance.now() - start) * 10) / 10 }; };
const actor = { id: 7, role: 'SALES_MANAGER', active: true, archivedAt: null };
const opportunities = Array.from({ length: 1000 }, (_, i) => ({
  id: i + 1, name: `Deal ${i + 1}`, currencyCode: i % 2 ? 'USD' : 'EUR', probability: 50,
  expectedCloseDate: new Date('2026-11-01T12:00:00Z'), ownerId: 7,
  stage: { id: 1, name: 'Qualified', probability: 50, sortOrder: 1 }, owner: { firstName: 'Sales', lastName: 'Rep' },
  participants: [], projects: [], products: [{ quantity: 1, estimatedUnitPrice: new Prisma.Decimal('100'), product: { categoryId: 1, category: { name: 'POS' } } }],
}));
const config = defaultReportConfiguration('PIPELINE');
const pipeline = async batched => {
  let operations = 0;
  const db = { opportunity: { findMany: async () => { operations++; await pause(); return opportunities; } } };
  if (batched) await executePipelineReportGroups(db, actor, config, ['stage', 'productCategory']);
  else { await executePipelineReport(db, actor, { ...config, groupBy: 'stage' }); await executePipelineReport(db, actor, { ...config, groupBy: 'productCategory' }); }
  return operations;
};
const pes = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, peCode: `PE-${i + 1}`, status: 'ACTIVE', archivedAt: null, expirationDate: new Date('2026-10-01T00:00:00Z'), assignedSalesRepUserId: 7, followUp: { ownerId: 7, status: i % 2 ? 'IN_PROGRESS' : 'NOT_STARTED', nextFollowUpAt: null } }));
const accounts = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, ownerId: i % 100 + 1 }));
const tasks = Array.from({ length: 2000 }, (_, i) => ({ id: i + 1, assignedToId: i % 100 + 1 }));
const users = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, role: 'SALES' }));
const snapshots = Array.from({ length: 8 }, (_, i) => ({ year: 2025 + Math.floor(i / 4), quarter: `Q${i % 4 + 1}` }));
const legacyMessageWrites = async () => { for (const pe of pes) { void pe; await pause(); } return pes.length; };
const batchedPe = async () => {
  let writes = 0;
  const db = {
    user: { findMany: async () => [{ id: 7, role: 'SALES' }] },
    priceException: { findMany: async ({ where }) => where.id.gt === 0 ? pes.slice(0, 200) : where.id.gt === 200 ? pes.slice(200) : [] },
    notification: { findMany: async () => [], createMany: async ({ data }) => ({ count: data.length }), updateMany: async () => ({ count: 0 }) },
    notificationPreference: { findMany: async () => [] },
    $executeRaw: async () => { writes++; await pause(); return 200; },
  };
  await evaluatePeNotifications(db, new Date('2026-10-26T16:00:00Z'));
  return writes;
};
const scenario = { accounts: accounts.length, opportunities: opportunities.length, tasks: tasks.length, priceExceptions: pes.length, users: users.length, snapshotQuarters: snapshots.length };
console.log(JSON.stringify({ scenario, mockRoundTripMs: 3, pipelineBefore: await timed(() => pipeline(false)), pipelineAfter: await timed(() => pipeline(true)), expiredPeMessageWritesBefore: await timed(legacyMessageWrites), expiredPeMessageWritesAfter: await timed(batchedPe) }, null, 2));
