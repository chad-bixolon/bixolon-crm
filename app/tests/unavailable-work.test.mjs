import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const require = Module.createRequire(import.meta.url);
const { ownershipWhere } = require(path.join(root, 'lib/admin-ownership.ts'));
const { reassignUnavailable } = require(path.join(root, 'lib/unavailable-reassignment.ts'));
const { canEditDemo, demoEditWhere } = require(path.join(root, 'lib/demos.ts'));
const { userChangeImpact } = require(path.join(root, 'lib/user-lifecycle.ts'));
const actor = (role, id = 1) => ({ id, role, active: true, archivedAt: null });

test('current work predicates exclude completed history and use explicit operational fields', () => {
  const demo = ownershipWhere('Demo');
  assert.match(JSON.stringify(demo), /operationalOwnerId/);
  assert.doesNotMatch(JSON.stringify(demo), /requestedById|reviewedById|shippedById/);
  assert.match(JSON.stringify(demo), /DEPLOYED/);
  const pe = ownershipWhere('Price Exception Follow-up');
  assert.doesNotMatch(JSON.stringify(pe), /assignedSalesRepUserId/);
  assert.match(JSON.stringify(pe), /NO_RENEWAL_NEEDED/);
  assert.deepEqual(ownershipWhere('Trade Show Lead').AND[0].status.in, ['NEW', 'CONTACTED', 'QUALIFIED']);
  assert.equal(ownershipWhere('Trade Show Lead').AND[0].routing, 'BIXOLON_SALES');
  assert.equal(ownershipWhere('Trade Show Lead').AND[0].convertedOpportunityId, null);
  assert.equal(ownershipWhere('Trade Show Lead').assignedSalesRep.is.NOT.active, true);
  assert.equal(ownershipWhere('Trade Show').marketingOwner.is.NOT.role.in.includes('MARKETING_MANAGER'), true);
  assert.equal(ownershipWhere('Audience').owner.is.NOT.role.in.includes('MARKETING_MANAGER'), true);
});

test('Demo edit policy lets the current Sales owner work and preserves oversight', () => {
  const record = { requestedById: 2, operationalOwnerId: 3 };
  assert.equal(canEditDemo(actor('SALES', 3), record), true);
  assert.equal(canEditDemo(actor('SALES', 2), record), false);
  assert.equal(canEditDemo(actor('SALES_MANAGER'), record), true);
  assert.equal(canEditDemo(actor('ADMIN'), record), true);
  assert.equal(canEditDemo(actor('READ_ONLY'), record), false);
  assert.equal(canEditDemo(actor('SALES', 2), { requestedById: 2, operationalOwnerId: null }), true);
  assert.deepEqual(demoEditWhere(actor('SALES', 3)), { OR: [{ operationalOwnerId: 3 }, { operationalOwnerId: null, requestedById: 3 }] });
  assert.deepEqual(demoEditWhere(actor('SALES_MANAGER')), {});
  assert.deepEqual(demoEditWhere(actor('READ_ONLY')), { id: -1 });
});

test('lifecycle Demo and PE counts use operational owners, not historical actors', async () => {
  const seen = [];
  const tx = Object.fromEntries(['account','opportunity','project','task','supportCase','tradeShowLead','tradeShow','priceException','demoRequest','marketingAudience','reportDefinition'].map(model => [model, { count: async ({ where }) => { seen.push([model, where]); return 1; } }]));
  await userChangeImpact(tx, actor('ADMIN'), actor('SALES', 7), actor('EXECUTIVE', 7), new Date('2026-10-24T12:00:00Z'));
  const demo = seen.find(([model]) => model === 'demoRequest')[1];
  const pe = seen.find(([model]) => model === 'priceException')[1];
  assert.equal(demo.operationalOwnerId, 7);
  assert.doesNotMatch(JSON.stringify(demo), /requestedById/);
  assert.equal(pe.followUp.ownerId, 7);
  assert.doesNotMatch(JSON.stringify(pe), /assignedSalesRepUserId/);
});

test('Admin Demo recovery checks actor, replacement, issue and stale version atomically', async () => {
  const version = new Date('2026-10-24T12:00:00.000Z');
  const row = { id: 9, status: 'SHIPPED', operationalOwnerId: null, updatedAt: version };
  const changes = [], history = [];
  const tx = { $queryRaw: async () => [], user: {
    findUnique: async () => ({ ...actor('ADMIN'), firstName: 'Ada', lastName: 'Admin' }),
    findFirst: async ({ where }) => where.id === 8 && where.role.in.includes('SALES') ? { ...actor('SALES', 8), firstName: 'Sam', lastName: 'Sales' } : null,
  }, demoRequest: {
    findFirst: async ({ where }) => { assert.match(JSON.stringify(where), /operationalOwnerId/); return row; },
    update: async ({ data }) => { changes.push(data); return { ...row, ...data }; },
  }, adminMaintenanceEvent: { create: async ({ data }) => history.push(data) } };
  const db = { $transaction: async fn => fn(tx) };
  for (const who of ['READ_ONLY','EXECUTIVE','SALES_MANAGER'].map(actor).concat([{ ...actor('ADMIN'), active: false }, { ...actor('ADMIN'), archivedAt: new Date() }]))
    await assert.rejects(reassignUnavailable(db, who, 'Demo', 9, 8, version.toISOString()), /Access denied/);
  await assert.rejects(reassignUnavailable(db, actor('ADMIN'), 'Demo', 9, 77, version.toISOString()), /eligible replacement/);
  await assert.rejects(reassignUnavailable(db, actor('ADMIN'), 'Demo', 9, 8, new Date(version.getTime() - 1).toISOString()), /changed/);
  assert.equal(changes.length, 0);
  await reassignUnavailable(db, actor('ADMIN'), 'Demo', 9, 8, version.toISOString());
  assert.equal(changes[0].operationalOwnerId, 8);
  assert.equal(history[0].newOwnerId, 8);
  assert.equal(history[0].oldValue, 'Unassigned');
});

test('Demo migration is additive and leaves existing owner values null', () => {
  const migration = fs.readFileSync(path.join(root, 'prisma/migrations/20261024210000_demo_operational_owner/migration.sql'), 'utf8');
  assert.match(migration, /ADD COLUMN "operationalOwnerId" INTEGER/);
  assert.doesNotMatch(migration, /^\s*(UPDATE|INSERT)\b|requestedById|reviewedById|shippedById/im);
});
